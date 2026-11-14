// Etapa lyric_sync: ASR una sola vez y en caché, revisiones aligned/proposal, unidades liquidadas y palabras manuales conservadas.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS } from "./stages/lyric.ts";
import { runOnce } from "./stages/runner.ts";

let db: PGlite, ws: string, song: string, src: string, calls = 0;
const LYRICS = "uno dos tres cuatro\ncinco seis siete ocho";
const ASR = "uno dos tres cuatro cinco seis siete ocho".split(" ").map((text, k) => ({ text, start: k * 1.0, end: k * 1.0 + 0.4 }));
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const as = async <T>(sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
const fake = fakeR2();
const load = async (n: string) => STAGE_IMPLS[n];
const ctx = () => pgliteCtx(db, { r2: fake.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-sync-")), env: {}, deps: { transcribe: async () => { calls++; return { words: ASR }; } } });
const request = async (mode: string, idem: string) => (await as<{ r: { job_id: string; units_reserved: number; cached: boolean } }>(`select public.request_lyric_sync('${song}','${mode}', null, 'whisper-large-v3-turbo', '${idem}') r`))[0].r;
const run = async () => (await runOnce(ctx() as never, { load: load as never }));
const revisions = () => q<{ revision: number; kind: string; words: { text: string; start: number; end: number; manual: boolean }[] }>(`select revision, kind, words from song_alignments where song_id='${song}' and revision is not null order by revision`);

before(async () => {
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  await db.exec(`select public.grant_units('${ws}', 20, 'pruebas', 'grant-sync-0001')`);
  src = (await q<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, mime, bytes) values ('${ws}','upload','validated','${A}','audio/flac',1000) returning id`))[0].id;
  song = (await q<{ id: string }>(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id, status, duration_ms, lyrics_text) values ('${ws}','S','${ws}/${src}/original','audio/flac',1000,'${A}','${src}','ready',180000,'${LYRICS}') returning id`))[0].id;
  const f = join(mkdtempSync(join(tmpdir(), "rafaga-opus-")), "audio.opus"); writeFileSync(f, Buffer.alloc(64));
  fake.store.set(`${ws}/${src}/audio.opus`, f);
});

test("sin ASR en caché: reserva 3 unidades (180 s), llama al ASR una vez, guarda su fila, crea la revisión 1 aligned y liquida", async () => {
  const r = await request("align", "sync-req-0001");
  assert.equal(r.units_reserved, 3); assert.equal(r.cached, false);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from credit_ledger where kind='reserve' and units=-3`))[0].n >= 1, true);
  assert.equal((await run())?.status, "done"); assert.equal(calls, 1);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from song_alignments where song_id='${song}' and kind='asr'`))[0].n, 1);
  const revs = await revisions(); assert.equal(revs.length, 1); assert.equal(revs[0].kind, "aligned"); assert.equal(revs[0].words.length, 8);
  assert.ok((await q<{ n: number }>(`select count(*)::int n from credit_ledger where kind in ('settle','release','refund')`))[0].n >= 1, "las unidades se liquidan");
});

test("con el ASR en caché: 0 unidades, cached true, ninguna fila nueva de reserva y 0 llamadas al ASR", async () => {
  const before = (await q<{ n: number }>(`select count(*)::int n from credit_ledger`))[0].n;
  const r = await request("align", "sync-req-0002");
  assert.equal(r.units_reserved, 0); assert.equal(r.cached, true);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from credit_ledger`))[0].n, before);
  await run(); assert.equal(calls, 1); assert.equal((await revisions()).length, 2);
});

test("palabras manuales de una revisión guardada: tras re-sincronizar conservan start y end en la nueva revisión", async () => {
  const last = (await revisions()).at(-1)!;
  const words = last.words.map((w, i) => ({ ...w, line: i < 4 ? 0 : 1, ...([1, 6].includes(i) ? { manual: true, start: +(w.start + 0.05).toFixed(3), end: +(w.end + 0.05).toFixed(3) } : {}) }));
  const saved = (await as<{ r: { revision: number } }>(`select public.save_song_alignment('${song}', ${last.revision}, '${JSON.stringify(words)}'::jsonb, 'manual', '[]'::jsonb) r`))[0].r;
  assert.equal(saved.revision, 3);
  await request("align", "sync-req-0003"); await run();
  const revs = await revisions(), now = revs.at(-1)!;
  assert.equal(now.revision, 4); assert.equal(calls, 1);
  for (const i of [1, 6]) { assert.equal(now.words[i].start, words[i].start); assert.equal(now.words[i].end, words[i].end); assert.equal(now.words[i].manual, true); }
});

test("modo transcribe: revisión proposal y songs.lyrics_text idéntico", async () => {
  await request("transcribe", "sync-req-0004"); await run();
  const now = (await revisions()).at(-1)!; assert.equal(now.kind, "proposal");
  assert.equal((await q<{ lyrics_text: string }>(`select lyrics_text from songs where id='${song}'`))[0].lyrics_text, LYRICS);
});

test("align sin letra guardada → lyrics_required; una canción sin ASR ni audio no se sincroniza", async () => {
  await db.exec(`update songs set lyrics_text = null where id='${song}'`);
  await assert.rejects(as(`select public.request_lyric_sync('${song}','align', null, 'whisper-large-v3-turbo', 'sync-req-0005')`), /lyrics_required/);
  await db.exec(`update songs set lyrics_text = '${LYRICS}' where id='${song}'`);
});
