// Rendimiento de Lyric Studio (modo --quick): canción sintética de 180 s → validación y sincronización (ASR simulado de 1,5 s)
// → vista previa (diseño + primera escena + ASS) → 3 variantes a 1080p con el render real del worker. Escribe SU sección de docs/PERF.md
// entre <!-- lyric-perf:start --> y <!-- lyric-perf:end -->; el resto del archivo (clipping) no se toca.
// Límite de la medida: un solo hilo de JavaScript (ffmpeg bloquea), así que las 3 variantes se intercalan pero no corren en paralelo real.
//   node scripts/lyric-perf.ts --quick
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, arch, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../supabase/tests/migrate.ts";
import { makeFixture, pgliteRpc } from "../workers/media/src/fixtures.ts";
import { STAGE_IMPLS, renderLyricItem } from "../workers/media/src/stages/lyric.ts";
import { validateLyricComposition, lyricLayout, lyricSceneAt, lyricAss, planLyricVariants } from "../packages/composition/src/index.ts";

const ROOT = new URL("../", import.meta.url).pathname;
if (!process.argv.includes("--quick")) { console.error("Uso: node scripts/lyric-perf.ts --quick"); process.exit(64); }
const START = "<!-- lyric-perf:start -->", END = "<!-- lyric-perf:end -->";

const { db, wsA: ws, A } = (await freshDb()) as unknown as { db: PGlite; wsA: string; A: string };
await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
// R2 en memoria que COPIA el contenido al subir (el worker borra sus temporales al terminar la etapa).
const store = new Map<string, Buffer>(), fake = { store, r2: { download: async (k: string, dest: string) => { const b = store.get(k); if (!b) throw new Error(`R2: no existe ${k}`); writeFileSync(dest, b); }, upload: async (k: string, f: string) => { store.set(k, readFileSync(f)); }, remove: async (ks: string[]) => { for (const k of ks) store.delete(k); } } };
const file = makeFixture("song180", join(ROOT, ".fixtures")), tmp = mkdtempSync(join(tmpdir(), "rafaga-lperf-"));
const rpc = pgliteRpc(db);
const baseCtx = { workerId: "perf", componentVersions: {}, log: () => {}, tmpDir: tmp, r2: fake.r2, env: {}, rpc };

// ── canción + letra de ~300 palabras ──
const LINES = Array.from({ length: 60 }, (_, i) => `esta es la línea ${i + 1} de una canción de prueba`).join("\n");
const src = (await q<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, mime, bytes) values ('${ws}','upload','uploaded','${A}','audio/wav',${statSync(file).size}) returning id`))[0].id;
const key = `${ws}/${src}/original`; await db.exec(`update sources set storage_path='${key}' where id='${src}'`); store.set(key, readFileSync(file));
await db.exec(`insert into projects(workspace_id, source_id, name, mode, created_by) values ('${ws}','${src}','Perf','lyrics','${A}')`);
const song = (await q<{ id: string }>(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id, status, lyrics_text) values ('${ws}','Perf','${key}','audio/wav',${statSync(file).size},'${A}','${src}','pending', '${LINES}') returning id`))[0].id;
const WORDS = LINES.split("\n").flatMap((l, li) => l.split(" ").map((text) => ({ text, li }))).map(({ text, li }, k) => ({ text, start: +(k * 0.55).toFixed(2), end: +(k * 0.55 + 0.45).toFixed(2), line: li }));
const row = (stage: string, params: Record<string, unknown>) => ({ id: "s", workspace_id: ws, job_id: "j", stage, seq: 1, attempts: 1, params, units: 0, worker_id: "w" }) as never;

// ── sync_ms: validación + ASR simulado (retardo fijo) + alineación ──
const t0 = performance.now();
await STAGE_IMPLS.song_validate.run({ ...baseCtx, env: {} } as never, row("song_validate", { source_id: src }));
const asr = WORDS.map(({ text, start, end }) => ({ text, start, end }));
await STAGE_IMPLS.lyric_sync.run({ ...baseCtx, deps: { transcribe: async () => { await new Promise((r) => setTimeout(r, 1500)); return { words: asr }; } } } as never, row("lyric_sync", { song_id: song, mode: "align", model: "whisper-large-v3-turbo", hints: [] }));
const sync_ms = performance.now() - t0;
const aligned = (await q<{ words: { text: string; start: number; end: number; line: number }[] }>(`select words from song_alignments where song_id='${song}' and revision is not null order by revision desc limit 1`))[0].words;

// ── preview_ready_ms: diseño + primera escena + ASS ──
const comp = validateLyricComposition({ aspect: "9:16", res: 1080, range: { start: 0, end: 15 }, words: aligned.map(({ text, start, end, line }) => ({ text, start, end, line })), seed: 1 });
const t1 = performance.now(); const L = lyricLayout(comp); lyricSceneAt(comp, 1, L); lyricAss(comp); const preview_ready_ms = performance.now() - t1;

// ── render_ms: 3 variantes 1080p ──
const variants = planLyricVariants(comp, 3, { song_range: true, lyrics_sync: true, format: true, background: true }, { styles: [{ ...comp.style, font: "Inter" }, { ...comp.style, font: "Oswald" }, { ...comp.style, font: "Anton" }] });
const renderCtx = { ...baseCtx, rpc: (async (fn: string, a: Record<string, unknown>) => (fn === "finish_render" ? null : rpc(fn, a))) as typeof rpc };
const times = await Promise.all(variants.map(async (v, i) => {
  const t = performance.now(), dir = mkdtempSync(join(tmp, `v${i}-`));
  await renderLyricItem(renderCtx as never, { render_id: `r${i}`, workspace_id: ws, clip_id: `c${i}`, version: 1, kind: "mp4", composition: v, source_id: src, title: "Perf" }, { key: `${ws}/perf/v${i}.mp4`, dir, fail: async (c, m) => { throw new Error(`${c}: ${m}`); } });
  return performance.now() - t;
}));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).stdout.split("\n")[0], r = (n: number) => String(Math.round(n));
const section = `${START}
## Lyric Studio (modo rápido)

Generado por \`node scripts/lyric-perf.ts --quick\` el ${new Date().toISOString().slice(0, 10)}. **Línea base local, no una promesa de tiempos.**

- Material: canción sintética de 180 s (WAV 44,1 kHz), letra de ${WORDS.length} palabras; ASR simulado con retardo fijo de 1,5 s; R2 en memoria; base de datos PGlite.
- Recorrido: validación de la canción → sincronización (ASR + alineación) → vista previa (diseño + primera escena + ASS) → 3 variantes de 15 s a 1080p con el render real (ffmpeg + libass).
- Entorno: ${platform()} ${arch()}, ${cpus().length} núcleos, ${ff}.
- Límite de la medida: un solo hilo de JavaScript (ffmpeg bloquea): las 3 variantes se intercalan, no corren en paralelo real; sin cola de Modal ni red. Con 3 muestras, p95 coincide con el máximo.

| Métrica | ms |
|---|---|
| \`sync_ms\` | ${r(sync_ms)} |
| \`preview_ready_ms\` | ${r(preview_ready_ms)} |
| \`render_ms_p50\` | ${r(pct(times, 50))} |
| \`render_ms_p95\` | ${r(pct(times, 95))} |
${END}`;
const path = join(ROOT, "docs", "PERF.md"), cur = existsSync(path) ? readFileSync(path, "utf8") : "# Rendimiento\n";
const a = cur.indexOf(START), b = cur.indexOf(END);
writeFileSync(path, a >= 0 && b > a ? cur.slice(0, a) + section + cur.slice(b + END.length) : `${cur.replace(/\s*$/, "")}\n\n${section}\n`);
console.log(section.split("\n").filter((l) => l.startsWith("|")).join("\n"));
process.exit(0);
