// Demo de canción: cada apertura crea su copia (audio sintetizado, revisión 1 manual) sin llamar al ASR y sin tocar la constante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_SONG } from "@rafaga/lyrics";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS } from "./stages/lyric.ts";

test("open_lyric_demo dos veces: dos canciones ready distintas con audio sintético y revisión 1 manual, sin ASR; editar una no cambia la otra ni DEMO_SONG", async () => {
  const { db, wsA: ws } = (await freshDb()) as unknown as { db: import("@electric-sql/pglite").PGlite; wsA: string };
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const as = async <T>(sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
  const snapshot = JSON.stringify(DEMO_SONG);
  const fake = fakeR2(), opened = [] as { song_id: string; job_id: string }[];
  for (const k of ["demo-open-0001", "demo-open-0002"]) opened.push((await as<{ r: { song_id: string; job_id: string } }>(`select public.open_lyric_demo(null, '${k}') r`))[0].r);
  assert.notEqual(opened[0].song_id, opened[1].song_id);
  assert.equal((await as<{ r: { replay: boolean } }>(`select public.open_lyric_demo(null, 'demo-open-0001') r`))[0].r.replay, true);
  for (const o of opened) {
    const st = (await db.query<{ params: { source_id: string } }>(`select params from job_stages where job_id='${o.job_id}'`)).rows[0];
    const ctx = pgliteCtx(db, { r2: fake.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-demo-")), env: {} }) as never;
    await STAGE_IMPLS.song_validate.run(ctx, { id: "s", workspace_id: ws, job_id: o.job_id, stage: "song_validate", seq: 1, attempts: 1, params: { source_id: st.params.source_id, demo: true }, units: 0, worker_id: "w" } as never);
  }
  const songs = (await db.query<{ id: string; status: string; duration_ms: string; lyrics_text: string; demo: boolean; source_id: string }>(`select id, status, duration_ms, lyrics_text, demo, source_id from songs where demo order by created_at`)).rows;
  assert.equal(songs.length, 2); for (const s of songs) { assert.equal(s.status, "ready"); assert.ok(Math.abs(Number(s.duration_ms) / 1000 - 24) < 0.5); assert.equal(s.lyrics_text, DEMO_SONG.lyrics); }
  assert.ok(fake.uploaded.some((k) => k.endsWith("/original")) && fake.uploaded.some((k) => k.endsWith("/audio.opus")));
  const revs = async (id: string) => (await db.query<{ revision: number; kind: string; words: { text: string; start: number; end: number }[] }>(`select revision, kind, words from song_alignments where song_id='${id}' and revision is not null order by revision`)).rows;
  for (const s of songs) { const r = await revs(s.id); assert.equal(r.length, 1); assert.equal(r[0].kind, "manual"); assert.deepEqual(r[0].words.map((w) => [w.text, w.start, w.end]), DEMO_SONG.words.map((w) => [w.text, w.start, w.end])); }
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from song_alignments where kind='asr'")).rows[0].n, 0, "ninguna llamada al ASR");
  const second = JSON.stringify(await revs(songs[1].id));
  const edited = DEMO_SONG.words.map((w, i) => ({ ...w, ...(i === 2 ? { manual: true, start: w.start + 0.1, end: w.end + 0.1 } : {}) }));
  await as(`select public.save_song_alignment('${songs[0].id}', 1, '${JSON.stringify(edited)}'::jsonb, 'manual', '[]'::jsonb)`);
  assert.equal((await revs(songs[0].id)).length, 2); assert.equal(JSON.stringify(await revs(songs[1].id)), second); assert.equal(JSON.stringify(DEMO_SONG), snapshot);
});
