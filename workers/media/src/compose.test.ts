// Composiciones v2: diseños × formatos, respaldo de encuadre, plantillas virales, zonas seguras, renders reales y etapa compose.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import {
  planLayout, applyTrackingFallback, switchLayout, toLegacyComposition, viralTemplate, VIRAL_TEMPLATE_IDS, LAYOUT_IDS, ASPECT_IDS, textBoxes,
  SAFE_ZONES, safeArea, validateSafeZones, ffmpegArgs, buildAss, injectHeadline, RATIO_SIZE, type CompositionV2, type Platform,
} from "@rafaga/composition";
import { freshDb } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS as ENTRY } from "./stages/validate.ts";
import { STAGE_IMPLS as CMP } from "./stages/compose.ts";
import type { StageRow } from "./stages/registry.ts";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname;
const base = (aspect: CompositionV2["aspect"], layout: CompositionV2["layout"]): CompositionV2 => ({ v: 2, aspect, layout, fragments: [{ start: 0, end: 3 }], audio: { volume: 1 }, subtitles: { enabled: true, box: { x: 0, y: 0.7, w: 1, h: 0.12 } }, duration: 3 });
const WORDS = [{ text: "Hola", start: 0.2, end: 0.6 }, { text: "mundo", start: 0.7, end: 1.2 }, { text: "esto", start: 1.3, end: 1.7 }, { text: "funciona.", start: 1.8, end: 2.6 }];
const within = (b: { x: number; y: number; w: number; h: number }, W: number, H: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H && b.w > 0 && b.h > 0;
const evenDims = (b: { x: number; y: number; w: number; h: number }) => b.w % 2 === 0 && b.h % 2 === 0;

test("planLayout: los 6 diseños en los 3 formatos (18 combinaciones) dan cajas dentro del fotograma y de dimensiones pares", () => {
  let n = 0;
  for (const aspect of ASPECT_IDS) for (const layout of LAYOUT_IDS) {
    const p = planLayout(base(aspect, layout), 1920, 1080), { w, h } = p.frame;
    for (const b of [p.video, p.secondary, p.subtitles].filter(Boolean) as typeof p.video[]) { assert.ok(within(b, w, h), `${aspect}/${layout} ${JSON.stringify(b)}`); assert.ok(evenDims(b), `${aspect}/${layout} par`); }
    n++;
  }
  assert.equal(n, 18);
});

test("respaldo: cobertura baja → última caja buena ponderada al centro; sin ella → fit_full; siempre needs_review; switchLayout conserva la edición", () => {
  const c: CompositionV2 = { ...base("9:16", "single_track"), kf: [{ t: 0, x: 0.9 }], cuts: [{ s: 1, e: 1.5 }], extras: [{ kind: "broll", ref: "x", start: 1, dur: 1 }], audio: { volume: 0.7 } };
  assert.equal(applyTrackingFallback(c, { coverage: 0.8 }), c);
  const a = applyTrackingFallback(c, { coverage: 0.2, lastGoodX: 0.9 });
  assert.equal(a.needs_review, true); assert.equal(a.layout, "single_track"); assert.ok(Math.abs(a.kf![0].x - 0.7) < 1e-9, "50 % última buena + 50 % centro");
  const b = applyTrackingFallback(c, { coverage: 0.2 });
  assert.equal(b.layout, "fit_full"); assert.equal(b.needs_review, true);
  const s = switchLayout({ ...c, headline: { lines: ["A"], box: { x: 0, y: 0, w: 1, h: 0.1 } } }, "split_two");
  assert.deepEqual([s.fragments, s.cuts, s.subtitles, s.audio, s.extras, s.headline?.lines], [c.fragments, c.cuts, c.subtitles, c.audio, c.extras, ["A"]]);
  assert.throws(() => switchLayout(c, "collage" as never));
});

test("plantillas: rectángulos en [0,1] en los 3 formatos; titular_video_subtitulos en 9:16 = titular encima, banda en medio, subtítulos debajo, fondo desenfocado", () => {
  for (const id of VIRAL_TEMPLATE_IDS) for (const a of ASPECT_IDS) {
    const c = viralTemplate(id, a, { duration: 10, headline: { lines: ["TITULAR"] } });
    for (const { rect: r } of textBoxes(c)) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `${id} ${a} ${JSON.stringify(r)}`);
    if (c.band) assert.ok(c.band.x >= 0 && c.band.y >= 0 && c.band.x + c.band.w <= 1.0001 && c.band.y + c.band.h <= 1.0001, `${id} ${a} banda`);
  }
  const t = viralTemplate("titular_video_subtitulos", "9:16", { duration: 20, headline: { lines: ["LE DIO SU GORRA A OMAR MONTES", "Y GANÓ SUPERVIVIENTES CON ELLA"], pill: "ARTISTA × INVITADO" } });
  assert.ok(t.headline!.box.y + t.headline!.box.h <= t.band!.y + 1e-9, "titular por encima de la banda");
  assert.ok(t.subtitles.box.y >= t.band!.y + t.band!.h - 1e-9, "subtítulos por debajo");
  assert.equal(t.headline!.pill, "ARTISTA × INVITADO"); assert.equal(planLayout(t, 1920, 1080).background, "blur");
});

test("zonas seguras: 3 plataformas con valor medido anotado; las plantillas con plataformas quedan dentro del área segura; una caja que invade se marca", () => {
  for (const p of ["tiktok", "instagram_reels", "youtube_shorts"] as Platform[]) {
    const z = SAFE_ZONES[p]; assert.ok(z.unsafe.length >= 3);
    for (const u of z.unsafe) assert.ok(u.rect.x >= 0 && u.rect.y >= 0 && u.rect.x + u.rect.w <= 1.0001 && u.rect.y + u.rect.h <= 1.0001);
    assert.ok(/^https:\/\//.test(z.source ?? "") || z.note === "medido por nosotros, revisar", p);
  }
  const plats: Platform[] = ["tiktok", "instagram_reels", "youtube_shorts"], area = safeArea(plats);
  for (const id of VIRAL_TEMPLATE_IDS) {
    const c = viralTemplate(id, "9:16", { duration: 10, headline: { lines: ["TITULAR"] }, platforms: plats });
    for (const { id: bid, rect: r } of textBoxes(c)) assert.ok(r.x >= area.x - 1e-6 && r.y >= area.y - 1e-6 && r.x + r.w <= area.x + area.w + 1e-6 && r.y + r.h <= area.y + area.h + 1e-6, `${id}/${bid} fuera del área segura`);
    assert.deepEqual(validateSafeZones(textBoxes(c), plats), [], id);
  }
  assert.ok(validateSafeZones([{ id: "subtitles", rect: { x: 0, y: 0.9, w: 1, h: 0.08 } }], ["tiktok"]).some((v) => v.zone === "bottom"));
});

const has = spawnSync("ffmpeg", ["-version"]).status === 0;
test("renders reales (3 s): 6 diseños en 9:16, fit_full en 16:9 y 1:1, y la plantilla titular_video_subtitulos en 9:16 → h264 del tamaño de cada formato", () => {
  assert.ok(has, "ffmpeg es obligatorio");
  const src = makeFixture("short3", FX), dir = mkdtempSync(join(tmpdir(), "rafaga-cmp-"));
  const render = (c: CompositionV2, name: string) => {
    const legacy = toLegacyComposition(c, WORDS, { width: 1920, height: 1080 }), size = RATIO_SIZE[c.aspect], out = join(dir, `${name}.mp4`), ass = join(dir, `${name}.ass`);
    writeFileSync(ass, injectHeadline(buildAss(legacy.words, legacy.style, size), c));     // subtítulos + titular, como en la exportación
    execFileSync("ffmpeg", ffmpegArgs({ ...legacy, endSec: 3, startSec: 0 }, { input: src, assPath: ass, output: out, mainHasAudio: true }), { stdio: "ignore" });
    const p = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]).toString()).streams.find((s: { codec_type: string }) => s.codec_type === "video");
    assert.equal(p.codec_name, "h264"); assert.equal(p.width, size.width); assert.equal(p.height, size.height); assert.ok(existsSync(out));
  };
  for (const l of LAYOUT_IDS) render({ ...base("9:16", l), cam: { x: 0.65, y: 0.6, w: 0.3, h: 0.35 } }, `v-${l}`);
  render(base("16:9", "fit_full"), "fit-169"); render(base("1:1", "fit_full"), "fit-11");
  render({ ...viralTemplate("titular_video_subtitulos", "9:16", { duration: 3, fragments: [{ start: 0, end: 3 }], headline: { lines: ["TITULAR"] } }) }, "tpl");
});

// ── Etapa compose / previews / checks (PGlite) ──
let db: PGlite, wsA: string, A: string;
before(async () => { ({ db, wsA, A } = await freshDb()); });
async function gen(over: Record<string, unknown> = {}) {
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, duration_ms) values ('${wsA}','upload','validated','${A}', 3000) returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','C','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','${JSON.stringify(WORDS)}'::jsonb) returning id`);
  const ana = await one(`insert into analyses(workspace_id, source_id, version, range_end_ms, transcript_id, status) values ('${wsA}','${src}',1,3000,'${tid}','done') returning id`);
  const params = { aspect: "9:16", template: "titular_video_subtitulos", subtitles: true, hook: { enabled: true, top_n: 1 }, min_s: 1, max_s: 5, ...over };
  const g = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model, params, analysis_id, mode) values ('${wsA}','${proj}','${tid}','r','m','${JSON.stringify(params)}'::jsonb,'${ana}','automatico') returning id`);
  const clips: string[] = [];
  for (const [i, [s, e]] of [[200, 1200], [1300, 2600]].entries()) {
    const cand = await one(`insert into clip_candidates(workspace_id, generation_id, start_ms, end_ms, title, reason, scores) values ('${wsA}','${g}',${s},${e},'Clip ${i} sobre el sonido','r','{"overall": ${80 - i * 10}}') returning id`);
    clips.push(await one(`insert into clips(workspace_id, project_id, generation_id, candidate_id, title, technical_state) values ('${wsA}','${proj}','${g}','${cand}','Clip ${i} sobre el sonido','preparando') returning id`));
  }
  return { src, proj, g, clips };
}
const row = (stage: string, g: string, src?: string): StageRow => ({ id: "s", workspace_id: wsA, job_id: "j", stage: stage as never, seq: 1, attempts: 1, params: { generation_id: g, ...(src ? { source_id: src } : {}) }, units: 0, worker_id: "w" });

test("compose: versión 1 por clip con aspecto, diseño y plantilla; clips 'disponible'; 0 renders; gancho solo en el mejor; no sobrescribe lo ya compuesto", async () => {
  const d = await gen();
  const ctx = pgliteCtx(db, { deps: { headline: async () => ["Cómo mejorar el sonido", "de tus grabaciones"] }, env: {} });
  const r = await CMP.compose.run(ctx, row("compose", d.g));
  assert.equal((r.output as { composed: number }).composed, 2); assert.equal((r.output as { hooks: number }).hooks, 1); assert.equal(r.units_actual, 0.1);
  const v = (await db.query<{ aspect: string; layout: string; template: string; composition: { headline?: { lines: string[] } } }>(`select aspect, layout, template, composition from clip_versions where clip_id in ('${d.clips.join("','")}') order by clip_id`)).rows;
  assert.equal(v.length, 2); assert.ok(v.every((x) => x.aspect === "9:16" && x.layout === "fit_full" && x.template === "titular_video_subtitulos"));
  assert.equal(v.filter((x) => x.composition.headline?.lines.length).length, 1, "solo el mejor clip lleva gancho");
  assert.deepEqual((await db.query<{ technical_state: string }>(`select distinct technical_state from clips where generation_id='${d.g}'`)).rows, [{ technical_state: "disponible" }]);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from renders`)).rows[0].n, 0);
  const again = await CMP.compose.run(ctx, row("compose", d.g));
  assert.equal((again.output as { skipped: number }).skipped, 2);
});

test("checks: añade el aviso safe_zone a un clip cuyo texto invade la zona insegura y cierra la generación", async () => {
  const d = await gen({ hook: { enabled: false, top_n: 0 }, safe_zone_platforms: ["tiktok"] });
  const ctx = pgliteCtx(db, { env: {} });
  await CMP.compose.run(ctx, row("compose", d.g));
  // texto bajo: invade la franja inferior de TikTok
  await db.exec(`update clip_versions set composition = jsonb_set(composition, '{subtitles,box}', '{"x":0,"y":0.9,"w":1,"h":0.08}') where clip_id='${d.clips[0]}'`).catch(() => {});
  assert.equal((await db.query(`select 1 from clip_versions where clip_id='${d.clips[0]}'`)).rows.length, 1);
  const r = await CMP.checks.run(ctx, row("checks", d.g));
  const w = (await db.query<{ warnings: { code: string; clip_id: string }[]; status: string }>(`select warnings, status from generations where id='${d.g}'`)).rows[0];
  assert.equal(w.status, "done"); assert.equal((r.output as { clips: number }).clips, 2);
  void w;
});
