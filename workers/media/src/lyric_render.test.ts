// Render de letra con ffmpeg real a 720p: ajustes, filtros idénticos a v1, audio solo de la canción y lote con una variante rota.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { FILTERS } from "@rafaga/lyrics";
import { validateLyricComposition, lyricRenderArgs, lyricAss, LYRIC_FILTERS, type LyricComposition } from "@rafaga/composition";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS } from "./stages/export.ts";
import type { StageRow } from "./stages/registry.ts";
import { writeFileSync } from "node:fs";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname, FONTS = new URL("../../../apps/web/public/fonts/caption", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "rafaga-lr-"));
let song: string, bgVideo: string;
const WORDS = [{ text: "Hola", start: 0.2, end: 1, line: 0 }, { text: "mundo", start: 1, end: 2, line: 0 }, { text: "azul", start: 2, end: 2.8, line: 0 }];
const comp = (o: Record<string, unknown> = {}): LyricComposition => validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 0, end: 3 }, words: WORDS, preset: "texto_estatico", seed: 7, style: { active: "none", entrance: "none" },
  background: { kind: "media", items: [{ ref: "bg", kind: "video" }], interval: 3, fit: "fill" }, ...o });
const ff = (a: string[]) => spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { encoding: "utf8" });
function render(c: LyricComposition, name: string, audio = song, items = [bgVideo]) {
  const ass = join(tmp, `${name}.ass`), out = join(tmp, `${name}.mp4`); writeFileSync(ass, lyricAss(c));
  const r = spawnSync("ffmpeg", lyricRenderArgs(c, { audio, items, ass, fontsDir: FONTS, out }), { encoding: "utf8" }); assert.equal(r.status, 0, `${name}: ${r.stderr?.slice(-300)}`); return out;
}
const probe = (f: string) => { const j = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,width,height,codec_type", "-of", "json", f], { encoding: "utf8" }).stdout) as { streams: { codec_name: string; pix_fmt?: string; width?: number; height?: number; codec_type: string }[] }; return j.streams; };
const frame = (f: string, t: number, pix: "gray" | "rgb24") => spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-pix_fmt", pix, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 }).stdout;
const meanLum = (f: string) => { const g = frame(f, 1.5, "gray"); return g.reduce((a, b) => a + b, 0) / g.length; };
const md5 = (f: string) => spawnSync("ffmpeg", ["-v", "error", "-i", f, "-map", "0:a", "-f", "md5", "-"], { encoding: "utf8" }).stdout.trim();

before(() => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  song = makeFixture("song_wav", FX); bgVideo = join(tmp, "bg.mp4");
  assert.equal(ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", bgVideo]).status, 0);
});

test("LYRIC_FILTERS es idéntico a FILTERS de v1 (midnight, super8, noir, vaporwave) y FILTERS no cambia", () => {
  assert.equal(LYRIC_FILTERS.noche, FILTERS.midnight); assert.equal(LYRIC_FILTERS.super8, FILTERS.super8); assert.equal(LYRIC_FILTERS.bn, FILTERS.noir); assert.equal(LYRIC_FILTERS.vapor, FILTERS.vaporwave);
  assert.deepEqual(Object.keys(FILTERS), ["none", "midnight", "super8", "noir", "vaporwave"]);
});

test("720p, 3 s: MP4 H.264 yuv420p de 720×1280; el recorte deja negras las barras; oscurecer baja la luminancia; bn deja la saturación < 2", () => {
  const base = render(comp(), "base"), st = probe(base), v = st.find((s) => s.codec_type === "video")!;
  assert.deepEqual([v.codec_name, v.pix_fmt, v.width, v.height], ["h264", "yuv420p", 720, 1280]); assert.ok(st.some((s) => s.codec_type === "audio" && s.codec_name === "aac"));
  const g = frame(render(comp({ settings: { crop: 0.5 } }), "crop"), 1.5, "gray");
  for (let y = 0; y < 128; y++) for (let x = 0; x < 720; x += 40) { assert.ok(g[y * 720 + x] < 16, `barra superior y=${y}`); assert.ok(g[(1279 - y) * 720 + x] < 16, `barra inferior y=${y}`); }
  assert.ok(meanLum(render(comp({ settings: { dim: 0.6 } }), "dim")) < meanLum(base));
  const rgb = frame(render(comp({ settings: { filter: "bn" } }), "bn"), 1.5, "rgb24"); let sat = 0; for (let i = 0; i < rgb.length; i += 3) sat += Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2]);
  assert.ok(sat / (rgb.length / 3) < 2, `saturación ${sat / (rgb.length / 3)}`);
});

test("cada ajuste renderiza: filtros, sacudida, fundido, ajustes preserve/fill/band, color sólido y portada", () => {
  const cases: [string, Record<string, unknown>][] = [["noche", { settings: { filter: "noche" } }], ["super8", { settings: { filter: "super8" } }], ["vapor", { settings: { filter: "vapor" } }], ["shake", { settings: { shake: true } }],
    ["blend", { background: { kind: "media", items: [{ ref: "bg", kind: "video" }, { ref: "bg", kind: "video" }], interval: 2, fit: "fill" }, settings: { blend: 1 } }], ["preserve", { background: { kind: "media", items: [{ ref: "bg", kind: "video" }], fit: "preserve" } }],
    ["band", { background: { kind: "media", items: [{ ref: "bg", kind: "video" }], fit: "band" } }], ["color", { background: { kind: "color", color: "#224466" } }]];
  for (const [n, o] of cases) { const f = render(comp(o), n, song, [bgVideo, bgVideo]); const v = probe(f).find((s) => s.codec_type === "video")!; assert.deepEqual([v.width, v.height], [720, 1280], n); }
});

test("dos variantes con estilos y fondos distintos sobre el mismo tramo producen el mismo audio (MD5 de las muestras decodificadas)", () => {
  const a = render(comp(), "va"), b = render(comp({ style: { font: "Anton", color: "#FFD400" }, background: { kind: "color", color: "#331155" }, settings: { filter: "super8" } }), "vb");
  assert.equal(md5(a), md5(b)); assert.match(md5(a), /^MD5=[0-9a-f]{32}$/);
});

test("lote de 2 variantes con un fondo ausente en el R2: una failed (render_failed), otra ready con ahash de 16 hex y el lote partial", async () => {
  const { db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string };
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, mime, bytes, duration_ms) values ('${ws}','upload','validated','${A}','audio/wav',100,12000) returning id`);
  const skey = `${ws}/${src}/original`; await db.exec(`update sources set storage_path='${skey}' where id='${src}'`);
  await db.exec(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id, status, duration_ms) values ('${ws}','S','${skey}','audio/wav',100,'${A}','${src}','ready',12000)`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, mode, created_by) values ('${ws}','${src}','L','lyrics','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${ws}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${ws}','${proj}','${tid}','r','m') returning id`);
  const ids: string[] = [];
  for (const [i, c] of [comp({ background: { kind: "color", color: "#334455" } }), comp({ background: { kind: "media", items: [{ ref: `${ws}/media/falta.mp4`, kind: "video" }], fit: "fill" } })].entries()) {
    const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${ws}','${proj}','${gen}','V${i}') returning id`); ids.push(clip);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${ws}',1,'${JSON.stringify(c)}','9:16','single_track','lyric')`);
  }
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`);
  const r = (await db.query<{ r: { export_ids: string[]; batch_id: string } }>(`select public.request_exports('${JSON.stringify(ids.map((clip_id) => ({ clip_id, version: 1, aspect: "9:16", burn_subtitles: true, kind: "mp4" })))}'::jsonb, true, 'lyric-batch-0001') r`)).rows[0].r;
  await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);");
  const fake = fakeR2({ [skey]: song });
  for (const rid of r.export_ids) { const ctx = pgliteCtx(db, { r2: fake.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-lb-")), env: {} }) as never; await STAGE_IMPLS.render.run(ctx, { id: "s", params: { render_id: rid } } as unknown as StageRow); }
  const rows = (await db.query<{ status: string; error_code: string | null; probe: { ahash?: string } | null; storage_path: string | null }>(`select status, error_code, probe, storage_path from renders where id in (${r.export_ids.map((x) => `'${x}'`).join(",")}) order by status`)).rows;
  assert.deepEqual(rows.map((x) => x.status), ["failed", "ready"]); assert.equal(rows[0].error_code, "render_failed"); assert.match(rows[1].probe!.ahash!, /^[0-9a-f]{16}$/); assert.ok(rows[1].storage_path);
  assert.equal((await db.query<{ s: string }>(`select public.finish_batch('${r.batch_id}') s`)).rows[0].s, "partial"); void statSync;
});
