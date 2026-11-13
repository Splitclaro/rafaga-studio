// Etapas validate / mezzanine con fixtures reales de ffmpeg, PGlite y un R2 en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2, type FixtureKind } from "./fixtures.ts";
import { STAGE_IMPLS, probeFile, validateProbe, readHead, moovBeforeMdat, MAX_SECONDS } from "./stages/validate.ts";
import { runOnce } from "./stages/runner.ts";
import type { StageRow } from "./stages/registry.ts";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname;
let db: PGlite, wsA: string, A: string;
const row = (stage: string, source: string): StageRow => ({ id: "s", workspace_id: wsA, job_id: "j", stage: stage as never, seq: 1, attempts: 1, params: { source_id: source }, units: 0, worker_id: "w" });
const groq = (lang: string) => (async () => Response.json({ text: "hola", language: lang, duration: 6, words: [] })) as unknown as typeof fetch;

async function newSource(kind: FixtureKind, key = "orig") {
  const path = makeFixture(kind, FX);
  const sid = (await db.query<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, bytes, storage_backend, mime) values ('${wsA}','upload','uploaded','${A}', ${statSync(path).size}, 'r2', 'video/quicktime') returning id`)).rows[0].id;
  const storage = `${wsA}/${sid}/${key}`;
  await db.exec(`update sources set storage_path='${storage}' where id='${sid}'`);
  await db.exec(`insert into storage_objects(workspace_id, key, bytes, kind, source_id) values ('${wsA}','${storage}', ${statSync(path).size}, 'original', '${sid}')`);
  return { sid, storage, path };
}
const ctxFor = (r2: ReturnType<typeof fakeR2>["r2"], lang = "es") => pgliteCtx(db, { r2, fetch: groq(lang), env: { GROQ_API_KEY: "gsk_test_key_123" }, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-vt-")) });

before(async () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio para estas pruebas");
  mkdirSync(FX, { recursive: true });
  const f = await freshDb(); db = f.db; wsA = f.wsA; A = f.A;
});

test("validate del fixture ok (1080p25 H.264, pcm_s24le, timecode): metadatos, pista de datos ignorada e idioma de Groq", async () => {
  const { sid, storage, path } = await newSource("ok");
  const { r2 } = fakeR2({ [storage]: path });
  const out = (await STAGE_IMPLS.validate.run(ctxFor(r2, "es"), row("validate", sid))).output as Record<string, unknown>;
  assert.equal(out.status, "ok"); assert.ok(Math.abs(Number(out.duration_s) - 6) <= 0.1);
  assert.equal(out.width, 1920); assert.equal(out.height, 1080); assert.equal(out.fps, 25); assert.equal(out.audio_tracks, 1);
  assert.ok(Number(out.ignored_data_tracks) >= 1); assert.equal(out.language, "es");
  const s = (await db.query<{ duration_ms: number; width: number; has_audio: boolean; thumb_path: string; status: string }>(`select duration_ms, width, has_audio, thumb_path, status from sources where id='${sid}'`)).rows[0];
  assert.equal(s.width, 1920); assert.equal(s.has_audio, true); assert.match(s.thumb_path, /thumb\.jpg$/); assert.equal(s.status, "uploaded");
});

test("sin audio: ok con aviso no_audio, solo manual y destacados, sin subtítulos", () => {
  const p = probeFile(makeFixture("noaudio", FX));
  const r = validateProbe(p, readHead(makeFixture("noaudio", FX)), 1000, null);
  assert.equal(r.status, "ok"); assert.deepEqual(r.warnings, ["no_audio"]); assert.deepEqual(r.modes_available, ["manual", "destacados"]); assert.equal(r.subtitles, false);
});

test("truncado, formato no admitido, demasiado largo/grande, rotación y VFR", () => {
  const c = makeFixture("corrupt", FX);
  const r = validateProbe(probeFile(c), readHead(c), 4096, null);
  assert.equal(r.status, "unsupported"); assert.ok(["corrupt_file", "unsupported_container"].includes(r.reason!)); assert.match(r.message!, /vídeo|archivo|MP4|formato/i);
  assert.equal(validateProbe(null, new Uint8Array(32), 100, null).reason, "unsupported_container");
  const ok = probeFile(makeFixture("ok", FX))!;
  assert.equal(validateProbe({ ...ok, duration: MAX_SECONDS + 1 }, readHead(makeFixture("ok", FX)), 1000, null).reason, "too_long");
  assert.equal(validateProbe(ok, readHead(makeFixture("ok", FX)), 4294967297, null).reason, "too_large");
  const rot = validateProbe(probeFile(makeFixture("rotated", FX)), readHead(makeFixture("rotated", FX)), 1000, null);
  assert.equal(rot.status, "needs_conversion"); assert.ok(rot.conversion.includes("rotation"));
  const vfr = validateProbe(probeFile(makeFixture("vfr", FX)), readHead(makeFixture("vfr", FX)), 1000, null);
  assert.equal(vfr.status, "needs_conversion"); assert.ok(vfr.conversion.includes("vfr"));
});

test("mezzanine: MP4 h264 1080 con AAC, sin pista de datos, moov antes de mdat, claves ≤1 s; solo después se borra el original", async () => {
  const { sid, storage, path } = await newSource("ok");
  const f = fakeR2({ [storage]: path });
  const out = (await STAGE_IMPLS.mezzanine.run(ctxFor(f.r2), row("mezzanine", sid))).output as { key: string; faststart: boolean; keyframe_gap_s: number };
  const mez = f.store.get(out.key)!; const p = probeFile(mez)!;
  assert.equal(p.vcodec, "h264"); assert.equal(p.height, 1080); assert.equal(p.acodec, "aac"); assert.equal(p.dataTracks, 0);
  assert.equal(out.faststart, true); assert.equal(moovBeforeMdat(mez), true); assert.ok(out.keyframe_gap_s <= 1.05, `gap ${out.keyframe_gap_s}`);
  assert.ok(Math.abs(p.duration - probeFile(path)!.duration) <= 0.07);
  assert.deepEqual(f.deleted, [storage]);
  const s = (await db.query<{ storage_path: string; status: string }>(`select storage_path, status from sources where id='${sid}'`)).rows[0];
  assert.deepEqual(s, { storage_path: out.key, status: "validated" });
  assert.ok((await db.query(`select 1 from storage_objects where key='${storage}' and purged_at is not null`)).rows.length === 1);
});

test("mezzanine que falla la comprobación NO borra el original", async () => {
  const { sid, storage, path } = await newSource("short3");
  const f = fakeR2({ [storage]: path });
  const ctx = ctxFor(f.r2);
  const real = f.r2.upload; let n = 0; f.r2.upload = async (...a) => { n++; return real(...a); };
  await db.exec(`update sources set bytes = bytes where id='${sid}'`);
  // Se fuerza el fallo apuntando a un original que no es un vídeo.
  const bad = fakeR2({ [storage]: new URL(import.meta.url).pathname });
  await assert.rejects(() => STAGE_IMPLS.mezzanine.run(ctxFor(bad.r2), { ...row("mezzanine", sid), params: { source_id: sid } }));
  assert.deepEqual(bad.deleted, []); void ctx; void n;
});

test("criterio 1: el runner ejecuta validate y mezzanine solo con filas de base de datos y deja la fuente validada y el trabajo en done", async () => {
  const { sid, storage, path } = await newSource("short3");
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const j = (await db.query<{ r: { job_id: string } }>(`select public.enqueue_job('${wsA}','ingest','[{"stage":"validate","seq":1,"units":0,"params":{"source_id":"${sid}"}},{"stage":"mezzanine","seq":2,"units":0,"params":{"source_id":"${sid}"}}]'::jsonb,'ingest-test-${sid}','{}'::jsonb,null,null) r`)).rows[0].r.job_id;
  const f = fakeR2({ [storage]: path });
  const ctx = ctxFor(f.r2);
  const load = async (n: string) => STAGE_IMPLS[n];
  assert.equal((await runOnce(ctx, { load: load as never }))?.status, "done");
  assert.equal((await runOnce(ctx, { load: load as never }))?.status, "done");
  const st = (await db.query<{ status: string }>(`select status from job_stages where job_id='${j}' order by seq`)).rows.map((x) => x.status);
  assert.deepEqual(st, ["done", "done"]);
  assert.equal((await db.query<{ status: string }>(`select status from sources where id='${sid}'`)).rows[0].status, "validated");
  assert.equal((await db.query<{ status: string }>(`select status from jobs where id='${j}'`)).rows[0].status, "done");
});
