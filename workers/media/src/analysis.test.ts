// Análisis: trozos de transcripción, limitador de Groq, proxy 720p, hablantes con respaldo visual y caché por huella.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS as ENTRY } from "./stages/validate.ts";
import { STAGE_IMPLS as AN, planChunks, mergeChunks, visualSpeakers, type Chunk } from "./stages/analysis.ts";
import { GroqLimiter, limitsFromEnv, DEFAULT_LIMITS } from "./groqlimits.ts";
import { probeFile, moovBeforeMdat } from "./stages/validate.ts";
import { runOnce } from "./stages/runner.ts";
import { inputHash } from "./stages/hash.ts";
import type { StageRow, StageImpl } from "./stages/registry.ts";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname;
const ALL: Record<string, StageImpl> = { ...ENTRY, ...AN };
let db: PGlite, wsA: string, A: string, sid: string, fake: ReturnType<typeof fakeR2>, analysis: string;
const row = (stage: string, extra: Record<string, unknown> = {}): StageRow => ({ id: "s", workspace_id: wsA, job_id: "j", stage: stage as never, seq: 1, attempts: 1, params: { source_id: sid, analysis_id: analysis, ...extra }, units: 0, worker_id: "w" });
const ctx = (extra: Record<string, unknown> = {}) => pgliteCtx(db, { r2: fake.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-an-")), env: {}, ...extra });

before(async () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  ({ db, wsA, A } = await freshDb());
  const path = makeFixture("ok", FX);
  sid = (await db.query<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, bytes, storage_backend) values ('${wsA}','upload','uploaded','${A}', ${statSync(path).size}, 'r2') returning id`)).rows[0].id;
  const orig = `${wsA}/${sid}/original`;
  await db.exec(`update sources set storage_path='${orig}' where id='${sid}'`);
  fake = fakeR2({ [orig]: path });
  await ENTRY.mezzanine.run(ctx(), row("mezzanine"));     // deja la copia de trabajo y apunta storage_path a ella
  const tid = (await db.query<{ id: string }>(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${sid}','[]') returning id`)).rows[0].id;
  analysis = (await db.query<{ id: string }>(`insert into analyses(workspace_id, source_id, version, range_end_ms, transcript_id) values ('${wsA}','${sid}',1,6000,'${tid}') returning id`)).rows[0].id;
});

test("planChunks(3600): trozos ≤600 s con solape de 2 s que cubren [0, 3600] sin huecos", () => {
  const c = planChunks(3600);
  assert.ok(c.every((x) => x.end - x.start <= 600)); assert.equal(c[0].start, 0); assert.equal(c.at(-1)!.end, 3600);
  for (let i = 1; i < c.length; i++) assert.equal(c[i - 1].end - c[i].start, 2);
  assert.equal(planChunks(300).length, 1);
});

test("mergeChunks: cada palabra una sola vez, en orden y con tiempos globales", () => {
  const c: Chunk[] = [{ index: 0, start: 0, end: 600 }, { index: 1, start: 598, end: 1198 }];
  const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });
  const merged = mergeChunks([
    { chunk: c[0], words: [w("a", 10), w("b", 597.2), w("c", 598.6), w("d", 599.4)] },
    { chunk: c[1], words: [w("c", 0.6), w("d", 1.4), w("e", 5)] },   // c y d están en el solape (tiempos relativos 0.6 y 1.4 → globales 598.6 y 599.4)
  ]);
  assert.deepEqual(merged.map((x) => x.text), ["a", "b", "c", "d", "e"]);
  assert.ok(merged.every((x, i) => i === 0 || merged[i - 1].start <= x.start));
  assert.equal(merged.find((x) => x.text === "e")!.start, 603);
});

test("limitador: la 21.ª petición del minuto espera; un 429 con retry-after 7 retrasa ≥ 7000 ms; GROQ_LIMITS manda", async () => {
  let t = 1_000_000; const slept: number[] = [];
  const lim = new GroqLimiter(DEFAULT_LIMITS, () => t, async (ms) => { slept.push(ms); t += ms; });
  for (let i = 0; i < 20; i++) assert.equal(await lim.wait("stt", 10), 0);
  const w21 = await lim.wait("stt", 10);
  assert.ok(w21 > 0 && w21 <= 60_000, `espera ${w21}`);
  lim.on429(7);
  assert.ok(lim.waitMs("llm", 100) >= 7000 - 1);
  const env = limitsFromEnv({ GROQ_LIMITS: '{"stt":{"rpm":2}}' });
  assert.equal(env.stt.rpm, 2); assert.equal(env.stt.audio_s_per_day, 28800);
  const l2 = new GroqLimiter(env, () => t); await l2.wait("stt", 1); await l2.wait("stt", 1);
  assert.ok(l2.waitMs("stt", 1) > 0);
  const hourly = new GroqLimiter({ ...DEFAULT_LIMITS, stt: { ...DEFAULT_LIMITS.stt, rpm: 1000 } }, () => t, async (ms) => { t += ms; });
  for (let i = 0; i < 12; i++) assert.equal(await hourly.wait("stt", 600), 0);     // 12 × 600 s = 7200 s: llena la hora
  assert.ok(hourly.waitMs("stt", 600) > 0, "el audio por hora también espera");
});

test("proxy: MP4 h264 de 720 px con moov antes de mdat y fotogramas clave a ≤1 s", async () => {
  const out = (await ENTRY.proxy.run(ctx(), row("proxy"))).output as { key: string };
  const f = fake.store.get(out.key)!, p = probeFile(f)!;
  assert.equal(p.vcodec, "h264"); assert.equal(p.height, 720); assert.equal(moovBeforeMdat(f), true);
  const kf = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim().split("\n").map(parseFloat).filter((x) => Number.isFinite(x));
  assert.ok(kf.length >= 5, `claves ${kf.length}`);
  for (let i = 1; i < kf.length; i++) assert.ok(kf[i] - kf[i - 1] <= 1.05, `hueco ${kf[i] - kf[i - 1]}`);
});

const faces = async () => Array.from({ length: 12 }, (_, i) => ({ t: i * 0.5, faces: [{ cx: i < 6 ? 0.25 : 0.75, cy: 0.4, w: 0.2, h: 0.3, s: 0.9 }] }));
test("speakers: 402 de Deepgram o sin clave → hablante activo visual con needs_review", async () => {
  const dg402 = async () => { throw Object.assign(new Error("Deepgram 402"), { status: 402 }); };
  const a = (await AN.speakers.run(ctx({ env: { DEEPGRAM_API_KEY: "k" }, deps: { deepgram: dg402, faces } }), row("speakers"))).output as Record<string, unknown>;
  assert.equal(a.method, "visual_largest_face"); assert.equal(a.needs_review, true); assert.equal((a.speakers as number[]).length, 2);
  const b = (await AN.speakers.run(ctx({ env: {}, deps: { faces } }), row("speakers"))).output as Record<string, unknown>;
  assert.equal(b.needs_review, true);
  const cdg = ctx({ env: { DEEPGRAM_API_KEY: "k" }, deps: { deepgram: async () => ({ words: [{ text: "hi", start: 0, end: 1, speaker: 0 }, { text: "yo", start: 1, end: 2, speaker: 1 }] }) } });
  await AN.prepare.run(cdg, row("prepare"));    // Deepgram trabaja sobre el audio preparado
  const ok = (await AN.speakers.run(cdg, row("speakers"))).output as Record<string, unknown>;
  assert.equal(ok.method, "deepgram"); assert.equal(ok.needs_review, false);
  assert.deepEqual(visualSpeakers([]).speakers, []);
});

test("criterio 3 (análisis): transcribe dos veces sobre el mismo audio y modelo → misma huella, segunda desde caché y 0 llamadas a la ASR", async () => {
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  let asrCalls = 0;
  const deps = { transcribeChunk: async () => { asrCalls++; return { words: [{ text: "Hola", start: 0.2, end: 0.6 }, { text: "mundo.", start: 0.7, end: 1.2 }], language: "es" }; } };
  const c = ctx({ deps, env: {} });
  await AN.prepare.run(c, row("prepare"));
  const h1 = inputHash(await AN.transcribe.inputs(c, row("transcribe")), c.componentVersions), h2 = inputHash(await AN.transcribe.inputs(c, row("transcribe")), c.componentVersions);
  assert.equal(h1, h2); assert.match(h1, /^[0-9a-f]{64}$/);
  const enqueue = async (key: string) => (await db.query<{ r: { job_id: string } }>(`select public.enqueue_job('${wsA}','generation','[{"stage":"transcribe","seq":1,"units":0,"params":{"source_id":"${sid}","analysis_id":"${analysis}","duration_s":6}}]'::jsonb,'${key}','{}'::jsonb,null,null) r`)).rows[0].r.job_id;
  const load = async (n: string) => ALL[n];
  await enqueue("transcribe-run-0001");
  assert.equal((await runOnce(c, { load: load as never }))?.status, "done"); assert.equal(asrCalls, 1);
  await enqueue("transcribe-run-0002");
  assert.equal((await runOnce(c, { load: load as never }))?.status, "skipped"); assert.equal(asrCalls, 1, "0 llamadas a la ASR la segunda vez");
  const t = (await db.query<{ words: unknown[]; language: string }>(`select t.words, t.language from analyses a join transcripts t on t.id = a.transcript_id where a.id='${analysis}'`)).rows[0];
  assert.equal(t.words.length, 2); assert.equal(t.language, "es");
});
