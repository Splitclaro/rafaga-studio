// Medición de rendimiento (modo --quick): 2 proyectos de 5 min a la vez por las etapas REALES del worker sobre PGlite,
// con ASR y LLM simulados y R2 en memoria. Escribe docs/PERF.md con p50 y p95 de cada fase.
// Honestidad de la medida: corre en una sola máquina y un solo hilo de JavaScript (ffmpeg bloquea), sin cola de Modal ni red;
// sirve para detectar regresiones y fijar una línea base, no para prometer tiempos al usuario.
//   node scripts/perf-run.ts --quick
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../supabase/tests/migrate.ts";
import { pgliteCtx, fakeR2 } from "../workers/media/src/fixtures.ts";
import { runOnce } from "../workers/media/src/stages/runner.ts";

const ROOT = new URL("../", import.meta.url).pathname;
if (!process.argv.includes("--quick")) { console.error("Uso: node scripts/perf-run.ts --quick"); process.exit(64); }
const MIN = 5, PROJECTS = 2;

// ── Fixture: 5 min, 360p, audio pcm_s24le y timecode (lo habitual en material de cámara) ──
const fx = join(ROOT, ".fixtures", `perf-${MIN}min-360p.mov`);
mkdirSync(join(ROOT, ".fixtures"), { recursive: true });
if (!existsSync(fx)) {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=640x360:r=30:d=${MIN * 60}`, "-f", "lavfi", "-i", `sine=f=220:d=${MIN * 60}:sample_rate=48000`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s24le", "-timecode", "01:00:00:00", fx], { encoding: "utf8" });
  if (r.status !== 0) { console.error("ffmpeg no está disponible o falló:", r.stderr); process.exit(1); }
}

// ── ASR y LLM simulados ──
const BLOCK = ["Hoy aprendemos cómo mejorar el sonido de nuestras grabaciones caseras.", "Primero conviene colocar el micrófono cerca de la boca y lejos del ruido.", "Por eso cada pequeño ajuste cambia mucho el resultado final."];
const BW = BLOCK.join(" ").split(" ").length;
function transcript(seconds: number) {
  const w: { text: string; start: number; end: number }[] = []; let t = 0;
  while (t < seconds - 16) { for (const s of BLOCK) { for (const x of s.split(" ")) { w.push({ text: x, start: +t.toFixed(2), end: +(t + 0.34).toFixed(2) }); t += 0.38; } t += 0.8; } t += 4; }
  return w;
}
const deps = {
  transcribeChunk: async () => ({ words: transcript(MIN * 60), language: "es" }),
  faces: async () => Array.from({ length: 12 }, (_, i) => ({ t: i * 0.5, faces: [{ cx: 0.5, cy: 0.4, w: 0.2, h: 0.3, s: 0.9 }] })),
  propose: async (a: { windowText: string; want: number }) => {
    const idx = [...a.windowText.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]); if (!idx.length) return [];
    const first = idx[0], last = idx.at(-1)!, out = [];
    for (let s = Math.ceil(first / BW) * BW; s + BW - 1 <= last && out.length < a.want; s += BW * 2)
      out.push({ startWord: s, endWord: s + BW - 1, title: `Bloque ${s / BW}`, reason: "Explica cómo mejorar el sonido de las grabaciones.", briefFit: "", scores: { relevance: 7, hook: 6, standalone: 7, closure: 8 } });
    return out;
  },
};

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };
const ms = (a: string | null, b: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : NaN);

const { db, wsA, A } = await freshDb() as unknown as { db: PGlite; wsA: string; A: string };
await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
await db.exec(`select public.grant_units('${wsA}', 500, 'perf', 'grant-perf-0001')`);
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const r2 = fakeR2(), tmp = mkdtempSync(join(tmpdir(), "rafaga-perf-"));
const asUser = async <T>(sql: string, args: unknown[] = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`);
  try { return (await db.query<{ r: T }>(sql, args)).rows[0].r; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); }
};
const svc = async (sql: string) => { await db.exec("set role service_role"); try { return (await db.query<{ r: unknown }>(sql)).rows[0]?.r; } finally { await db.exec("reset role"); } };
const ctxFor = (w: number) => ({ ...pgliteCtx(db, { r2: r2.r2, tmpDir: join(tmp, `w${w}`), env: {}, deps }), workerId: `perf-${w}` });
async function assertNoFailures(phase: string) {
  const bad = await q<{ stage: string; status: string; error: string | null }>(`select stage, status, coalesce(error_code, '') || ' ' || coalesce(error_message, '') as error from job_stages where status in ('failed','cancelled')`);
  if (bad.length) console.error((await q(`select stage, status, left(output::text, 300) o from job_stages order by updated_at`)).map((r) => JSON.stringify(r)).join("\n"));
  if (bad.length) throw new Error(`fase ${phase}: ` + bad.map((b) => `${b.stage}=${b.status} ${b.error}`).join(" | "));
}
async function settle() {
  for (let i = 0; i < 400; i++) {
    await Promise.all(Array.from({ length: PROJECTS }, async (_, w) => { while (await runOnce(ctxFor(w) as never)) { /* sigue mientras haya etapas */ } }));
    if (!(await q<{ n: number }>("select count(*)::int n from job_stages where status in ('queued','running')"))[0].n) return;
  }
  throw new Error("las etapas no terminaron");
}

const samples: Record<string, number[]> = { upload_ms: [], queue_ms: [], analysis_ms: [], first_clip_ms: [], all_clips_ms: [], render_ms: [], zip_ms: [] };
const projects: { src: string; proj: string; ingestJob: string; genJob?: string; expJob?: string }[] = [];

// Fase A · subida (copia) + ingesta (validate → mezzanine → proxy)
for (let k = 0; k < PROJECTS; k++) {
  const t0 = performance.now(), copy = join(tmp, `up${k}.mov`); copyFileSync(fx, copy);
  samples.upload_ms.push(performance.now() - t0);
  const src = (await q<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, bytes, storage_backend) values ('${wsA}','upload','uploaded','${A}', ${statSync(copy).size}, 'r2') returning id`))[0].id;
  const key = `${wsA}/${src}/original`; await db.exec(`update sources set storage_path='${key}' where id='${src}'`); r2.store.set(key, copy);
  const proj = (await q<{ id: string }>(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','Perf ${k}','${A}') returning id`))[0].id;
  const job = await svc(`select (public.enqueue_job('${wsA}','ingest', '${JSON.stringify(["validate", "mezzanine", "proxy"].map((s, i) => ({ stage: s, seq: i + 1, units: 0, params: { source_id: src } })))}'::jsonb, 'perf-ingest-${k}', '{"source_id":"${src}"}'::jsonb, '${proj}', null))->>'job_id' r`) as string;
  projects.push({ src, proj, ingestJob: job });
}
await settle(); await assertNoFailures("A");

// Fase B · generación (análisis + selección + composición + previews + comprobaciones)
for (const [k, p] of projects.entries()) {
  const params = { mode: "automatico", count: 3, min_s: 10, max_s: 30, range_start_ms: 0, range_end_ms: MIN * 60000, component_versions: { asr_model: "whisper-large-v3-turbo", llm_model: "simulado", rubric_version: "rubric-v1" } };
  const r = await asUser<{ job_id: string }>(`select to_jsonb(public.request_generation('${p.proj}', '${JSON.stringify(params)}'::jsonb, 'perf-gen-${k}-0001')) r`);
  p.genJob = r.job_id;
}
await settle(); await assertNoFailures("B");

// Fase C · exportación de los clips de cada proyecto y ZIP
for (const [k, p] of projects.entries()) {
  const clips = await q<{ id: string }>(`select id from clips where project_id='${p.proj}' order by created_at`);
  if (!clips.length) throw new Error(`el proyecto ${k} no produjo clips`);
  const items = clips.map((c) => ({ clip_id: c.id, version: 1, aspect: "9:16", burn_subtitles: true, kind: "mp4" }));
  const r = await asUser<{ job_id: string }>(`select to_jsonb(public.request_exports('${JSON.stringify(items)}'::jsonb, true, 'perf-exp-${k}-0001')) r`);
  p.expJob = r.job_id;
}
await settle();

// ── Métricas desde los tiempos reales de job_stages / clips ──
for (const p of projects) {
  const st = async (job: string) => q<{ stage: string; started_at: string; finished_at: string; created_at: string; status: string }>(`select s.stage, s.started_at, s.finished_at, j.created_at, s.status from job_stages s join jobs j on j.id = s.job_id where s.job_id='${job}'`);
  const ing = await st(p.ingestJob), gen = await st(p.genJob!), exp = await st(p.expJob!);
  const min = (xs: { started_at: string }[]) => xs.map((x) => x.started_at).sort()[0], max = (xs: { finished_at: string }[]) => xs.map((x) => x.finished_at).sort().at(-1)!;
  samples.queue_ms.push(ms(ing[0].created_at, min(ing)));
  const an = gen.filter((s) => ["prepare", "transcribe", "scenes", "speakers"].includes(s.stage));
  samples.analysis_ms.push(ms(min(ing), max(ing)) + ms(min(an), max(an)));
  const clipAt = (await q<{ t: string }>(`select min(created_at) t from clips where project_id='${p.proj}'`))[0].t;
  samples.first_clip_ms.push(ms(gen[0].created_at, clipAt)); samples.all_clips_ms.push(ms(gen[0].created_at, max(gen)));
  const rd = exp.filter((s) => s.stage === "render"), zp = exp.filter((s) => s.stage === "zip");
  samples.render_ms.push(ms(exp[0].created_at, max(rd))); samples.zip_ms.push(ms(min(zp), max(zp)));
  if (gen.some((s) => s.status !== "done" && s.status !== "skipped") || exp.some((s) => s.status !== "done" && s.status !== "skipped")) throw new Error("alguna etapa no terminó en done");
}

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n)) : "—");
const rows = Object.entries(samples).map(([k, v]) => `| \`${k}\` | ${fmt(pct(v, 50))} | ${fmt(pct(v, 95))} | ${v.length} |`).join("\n");
const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout.split("\n")[0];
const out = `# Rendimiento (modo rápido)

Generado por \`node scripts/perf-run.ts --quick\` el ${new Date().toISOString().slice(0, 10)}. **Línea base local, no una promesa de tiempos.**

- Material: ${PROJECTS} proyectos a la vez, vídeo de ${MIN} min a 640×360 (H.264), audio \`pcm_s24le\` y timecode.
- Recorrido: subida (copia) → validate → mezzanine → proxy → análisis → selección → composición → previews → comprobaciones → exportación MP4 de cada clip → ZIP.
- Sustituido por simulación: transcripción (ASR), selección con LLM y detección de caras; R2 en memoria; base de datos PGlite.
- Entorno: ${platform()} ${arch()}, ${cpus().length} núcleos, ${ff}.
- Límite de la medida: un solo hilo de JavaScript (ffmpeg bloquea), así que los 2 proyectos se intercalan pero no corren en paralelo real; sin cola de Modal ni red.

| Fase (ms) | p50 | p95 | muestras |
|---|---|---|---|
${rows}

Con ${PROJECTS} muestras por fase, p95 coincide con el máximo. Fases: \`upload_ms\` copia del archivo; \`queue_ms\` espera de la primera etapa; \`analysis_ms\` ingesta + análisis; \`first_clip_ms\` desde pedir la generación hasta el primer clip; \`all_clips_ms\` hasta terminar las comprobaciones; \`render_ms\` desde pedir la exportación hasta el último MP4; \`zip_ms\` empaquetado del lote.

## Pendiente

Los objetivos de rendimiento se fijan después de medir vídeos de 5, 30 y 60 min con Modal real y ASR/LLM reales, con una concurrencia definida. Hasta entonces la interfaz muestra la etapa actual y rangos estimados con datos reales, sin porcentajes inventados.
`;
const perfPath = join(ROOT, "docs", "PERF.md"), prev = existsSync(perfPath) ? readFileSync(perfPath, "utf8") : "", ls = prev.indexOf("<!-- lyric-perf:start -->"), le = prev.indexOf("<!-- lyric-perf:end -->");
writeFileSync(perfPath, ls >= 0 && le > ls ? `${out.replace(/\s*$/, "")}\n\n${prev.slice(ls, le + "<!-- lyric-perf:end -->".length)}\n` : out);   // la sección de Lyric Studio no se pierde
console.log(out.split("\n").filter((l) => l.startsWith("|")).join("\n"));
process.exit(0);
