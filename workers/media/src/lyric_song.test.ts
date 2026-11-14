// Ingesta de canciones: tipo por cabecera, validación real con ffmpeg (4 formatos), límites y el cargador compartido.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { makeFixture, pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS, audioKind } from "./stages/lyric.ts";
import { main } from "./stage.ts";
import type { StageRow } from "./stages/registry.ts";

const FX = new URL("../../../.fixtures/", import.meta.url).pathname;
let db: PGlite, ws: string;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
const as = async <T>(sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
const row = (source: string) => ({ id: "s", workspace_id: ws, job_id: "j", stage: "song_validate", seq: 1, attempts: 1, params: { source_id: source }, units: 0, worker_id: "w" }) as unknown as StageRow;

before(async () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
});

/** Crea fuente + canción pendiente y deja el archivo en el R2 simulado. */
async function setup(file: string | null, mime: string, bytes?: number) {
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, mime, bytes) values ('${ws}','upload','uploaded','${A}','${mime}', ${bytes ?? (file ? statSync(file).size : 100)}) returning id`);
  const key = `${ws}/${src}/original`;
  await db.exec(`update sources set storage_path='${key}' where id='${src}'`);
  await one(`insert into projects(workspace_id, source_id, name, mode, created_by) values ('${ws}','${src}','Canción','lyrics','${A}') returning id`);
  const song = await one(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id, status) values ('${ws}','T','${key}','${mime}', ${bytes ?? (file ? statSync(file).size : 100)},'${A}','${src}','pending') returning id`);
  const f = fakeR2(file ? { [key]: file } : {});
  return { src, song, f, ctx: pgliteCtx(db, { r2: f.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-song-")), env: {} }) };
}

test("audioKind reconoce mp3 (ID3 y sincronía), wav, m4a, aac (ADTS), flac y ogg; 64 bytes arbitrarios → null", () => {
  const b = (...x: (number | string)[]) => { const o = new Uint8Array(64).fill(0x11); let i = 0; for (const v of x) { if (typeof v === "string") for (const c of v) o[i++] = c.charCodeAt(0); else o[i++] = v; } return o; };
  const wav = b("RIFF", 0, 0, 0, 0, "WAVE"), m4a = b(0, 0, 0, 0x20, "ftyp");
  assert.equal(audioKind(b("ID3")), "mp3"); assert.equal(audioKind(b(0xff, 0xfb)), "mp3"); assert.equal(audioKind(wav), "wav"); assert.equal(audioKind(m4a), "m4a");
  assert.equal(audioKind(b(0xff, 0xf1)), "aac"); assert.equal(audioKind(b(0xff, 0xf9)), "aac"); assert.equal(audioKind(b("fLaC")), "flac"); assert.equal(audioKind(b("OggS")), "ogg");
  assert.equal(audioKind(Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0x7f)), null);
});

for (const [kind, mime, rate] of [["song_wav", "audio/wav", 44100], ["song_m4a", "audio/mp4", 44100], ["song_flac", "audio/flac", 44100], ["song_ogg", "audio/ogg", 48000]] as const) {
  test(`song_validate ${kind}: lista, 12 s, ${rate} Hz, 2 canales, sonoridad finita, fuente validada y audio.opus subido`, async () => {
    const file = makeFixture(kind, FX), t = await setup(file, mime);
    const out = (await STAGE_IMPLS.song_validate.run(t.ctx as never, row(t.src))).output as { lufs: number | null };
    const [s] = await q<{ status: string; duration_ms: string; sample_rate: number; channels: number; loudness_lufs: string }>(`select status, duration_ms, sample_rate, channels, loudness_lufs from songs where id='${t.song}'`);
    assert.equal(s.status, "ready"); assert.ok(Math.abs(Number(s.duration_ms) / 1000 - 12) <= 0.1, `duración ${s.duration_ms}`);
    assert.equal(s.sample_rate, rate); assert.equal(s.channels, 2);
    assert.ok(Number(s.loudness_lufs) > -70 && Number(s.loudness_lufs) < 0); assert.ok(out.lufs !== null);
    assert.equal((await q<{ status: string }>(`select status from sources where id='${t.src}'`))[0].status, "validated");
    assert.deepEqual(t.f.uploaded, [`${ws}/${t.src}/audio.opus`]);
    assert.equal((await q<{ n: number }>(`select count(*)::int n from storage_objects where key='${ws}/${t.src}/audio.opus' and kind='audio'`))[0].n, 1);
  });
}

test("límites: >600 s → too_long; >60 MiB → too_large; con vídeo o no-audio → unsupported_file; la canción queda failed y no se sube nada", async () => {
  const cases: [string, string, string, number?][] = [["too_long", makeFixture("song_long", FX), "audio/flac"], ["unsupported_file", makeFixture("ok", FX), "audio/mp4"]];
  for (const [code, file, mime] of cases) {
    const t = await setup(file, mime);
    await assert.rejects(STAGE_IMPLS.song_validate.run(t.ctx as never, row(t.src)), { code });
    assert.equal((await q<{ status: string; error_code: string }>(`select status, error_code from songs where id='${t.song}'`))[0].error_code, code); assert.deepEqual(t.f.uploaded, []);
  }
  const junk = join(mkdtempSync(join(tmpdir(), "rafaga-junk-")), "x.bin"); writeFileSync(junk, Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 37 + 11) & 0x7f)));
  const j = await setup(junk, "audio/mp4"); await assert.rejects(STAGE_IMPLS.song_validate.run(j.ctx as never, row(j.src)), { code: "unsupported_file" });
  // El tamaño declarado en la fila no puede pasar de 60 MiB (CHECK), así que el archivo real que lo supera se detecta tras descargarlo.
  const bigFile = join(mkdtempSync(join(tmpdir(), "rafaga-big-")), "big.flac"); writeFileSync(bigFile, ""); truncateSync(bigFile, 62914561);
  const big = await setup(bigFile, "audio/flac", 1000);
  await assert.rejects(STAGE_IMPLS.song_validate.run(big.ctx as never, row(big.src)), { code: "too_large" });
  assert.deepEqual(big.f.uploaded, []);
  assert.equal((await q<{ status: string; error_code: string }>(`select status, error_code from songs where id='${big.song}'`))[0].status, "failed");
});

/** Sesión de subida como el usuario A con el mime dado. */
async function session(mime: string, bytes: number, idem: string) {
  const r = (await as<{ r: { upload_id: string; source_id: string; project_id: string } }>(`select public.create_upload_session('${ws}','Canción',${bytes},'${mime}', null, null, true, 'multipart', 8388608, '${idem}') r`))[0].r;
  return r;
}
test("complete_upload: una fuente de audio crea un trabajo ingest con la sola etapa song_validate; una de vídeo sigue con validate, mezzanine y proxy", async () => {
  const au = await session("audio/flac", 5_000_000, "song-up-0001"), vi = await session("video/mp4", 5_000_000, "video-up-0001");
  const sha = "a".repeat(64), sha2 = "b".repeat(64);
  const ja = (await as<{ r: { job_id: string } }>(`select public.complete_upload('${au.upload_id}','${sha}') r`))[0].r.job_id;
  const jv = (await as<{ r: { job_id: string } }>(`select public.complete_upload('${vi.upload_id}','${sha2}') r`))[0].r.job_id;
  assert.deepEqual((await q<{ stage: string }>(`select stage from job_stages where job_id='${ja}' order by seq`)).map((x) => x.stage), ["song_validate"]);
  assert.deepEqual((await q<{ stage: string }>(`select stage from job_stages where job_id='${jv}' order by seq`)).map((x) => x.stage), ["validate", "mezzanine", "proxy"]);
});

test("register_song es idempotente por sesión, pone el modo lyrics y una sola pieza; con más de 60 MiB → file_too_large", async () => {
  const s = await session("audio/flac", 5_000_000, "song-up-0002");
  const reg = async () => (await as<{ r: { song_id: string; project_id: string } }>(`select public.register_song('${s.upload_id}','Mi tema','Yo','letra de prueba') r`))[0].r;
  const a = await reg(), b = await reg();
  assert.equal(a.song_id, b.song_id); assert.equal(a.project_id, b.project_id);
  assert.equal((await q<{ mode: string }>(`select mode from projects where id='${a.project_id}'`))[0].mode, "lyrics");
  assert.deepEqual(await q(`select mode from lyric_projects where project_id='${a.project_id}'`), [{ mode: "letra" }]);
  const big = await session("audio/flac", 70_000_000, "song-up-0003");
  await assert.rejects(as(`select public.register_song('${big.upload_id}','Grande',null,null)`), /file_too_large/);
});

test("stage.ts --list imprime song_validate, lyric_sync y media_split después de translate", async () => {
  const out: string[] = []; assert.equal(await main(["--list"], { out: (s) => out.push(s), err: () => {} }), 0);
  assert.deepEqual(out.slice(out.indexOf("translate")), ["translate", "song_validate", "lyric_sync", "media_split"]);
});
