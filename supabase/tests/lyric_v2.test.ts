// Lyric Studio v2, esquema (migración 100): tablas y columnas, CHECK superconjunto, RLS, estilos v2, canciones v1/v2 y piezas de letra.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";

let db: PGlite, ws: string, wsB: string, src: string;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
const as = async <T>(uid: string, sql: string) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}', false);`);
  try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); }
};
const err = async (uid: string, sql: string) => { try { await as(uid, sql); return null; } catch (e) { return (e as Error).message; } };
const mkSrc = () => one(`insert into sources(workspace_id, kind, status, created_by, bytes) values ('${ws}','upload','validated','${A}', 1000) returning id`);
const style = (extra: Record<string, unknown> = {}) => JSON.stringify({ rafagaStyle: 2, font: "Inter", ...extra }).replace(/'/g, "''");

before(async () => {
  ({ db, wsA: ws, wsB } = (await freshDb()) as unknown as { db: PGlite; wsA: string; wsB: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  src = await one(`insert into sources(workspace_id, kind, status, created_by, bytes) values ('${ws}','upload','validated','${A}', 1000) returning id`);
});

test("el esquema expone tablas, columnas y valores nuevos", async () => {
  const has = async (t: string, c: string) => (await q(`select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`)).length === 1;
  for (const t of ["lyric_projects", "hook_packs"]) assert.equal((await q(`select 1 from information_schema.tables where table_schema='public' and table_name='${t}'`)).length, 1, t);
  for (const [t, c] of [["songs", "source_id"], ["songs", "duration_ms"], ["song_alignments", "revision"], ["media_collections", "official"], ["media_collections", "purpose"], ["media_items", "storage_backend"]]) assert.ok(await has(t, c), `${t}.${c}`);
  // valores aceptados por las CHECK ampliadas
  const song = await one(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','S','${ws}/${src}/original','audio/flac',2000,'${A}','${src}') returning id`);
  const pid = (await q<{ create_lyric_project: string }>(`select 1`)).length && await one(`insert into projects(workspace_id, source_id, name, mode, created_by) values ('${ws}','${src}','L','lyrics','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${ws}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${ws}','${pid}','${tid}','r','m') returning id`);
  const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${ws}','${pid}','${gen}','C') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${ws}',1,'{}','4:5','single_track','x')`);
  for (const k of ["lrc", "lrc_word", "ass"]) await db.exec(`insert into renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind) values ('${ws}','${clip}',1,'9:16',false,'h-${k}','queued','${k}')`);
  await db.exec(`insert into storage_objects(workspace_id, key, bytes, kind) values ('${ws}','${ws}/media/x.jpg',10,'media')`);
  for (const [i, st] of ["song_validate", "lyric_sync", "media_split"].entries())
    await db.exec(`select public.enqueue_job('${ws}','import', '[{"stage":"${st}","seq":1,"units":0,"params":{}}]'::jsonb, 'lyric-stage-${i}-0001', '{}'::jsonb, null, null)`);
  assert.ok(song);
});

test("RLS: el usuario B no ve ni inserta lyric_projects y hook_packs de A", async () => {
  const s1 = await mkSrc();
  const sid = await one(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','RLS','${ws}/${s1}/original','audio/mpeg',500,'${A}','${s1}') returning id`);
  const pid = (await as<{ create_lyric_project: string }>(A, `select public.create_lyric_project('${sid}','letra','Pieza A') as create_lyric_project`))[0].create_lyric_project;
  const hid = (await as<{ save_hook_pack: string }>(A, `select public.save_hook_pack('${ws}', null, 'Ganchos', array['Uno','Dos']) as save_hook_pack`))[0].save_hook_pack;
  assert.ok(pid && hid);
  assert.equal((await as(B, `select * from lyric_projects where workspace_id='${ws}'`)).length, 0);
  assert.equal((await as(B, `select * from hook_packs where workspace_id='${ws}'`)).length, 0);
  assert.ok(await err(B, `insert into lyric_projects(project_id, workspace_id, song_id, mode) values (gen_random_uuid(),'${ws}','${sid}','letra')`));
  assert.ok(await err(B, `insert into hook_packs(workspace_id, name, hooks) values ('${ws}','x',array['a'])`));
  assert.equal((await as(A, `select * from lyric_projects where workspace_id='${ws}'`)).length >= 1, true);
  void wsB;
});

test("save_caption_style: >4000 bytes, sin rafagaStyle=2 y el estilo 21 se rechazan sin escribir; un estilo v1 se inserta directo", async () => {
  const before = (await q<{ n: number }>("select count(*)::int n from text_styles"))[0].n;
  assert.match((await err(A, `select public.save_caption_style('${ws}', null, 'Grande', '${style({ pad: "x".repeat(4100) })}'::jsonb)`)) ?? "", /style_too_large/);
  assert.match((await err(A, `select public.save_caption_style('${ws}', null, 'v1', '{"font":"Inter"}'::jsonb)`)) ?? "", /invalid_style/);
  assert.equal((await q<{ n: number }>("select count(*)::int n from text_styles"))[0].n, before);
  for (let i = 0; i < 20; i++) await as(A, `select public.save_caption_style('${ws}', null, 'E${i}', '${style({ i })}'::jsonb)`);
  assert.match((await err(A, `select public.save_caption_style('${ws}', null, 'E21', '${style({ i: 21 })}'::jsonb)`)) ?? "", /style_limit/);
  assert.equal((await q<{ n: number }>("select count(*)::int n from text_styles where style->>'rafagaStyle'='2'"))[0].n, 20);
  await db.exec(`insert into text_styles(workspace_id, name, style, created_by) values ('${ws}','v1-viejo','{"font":"Inter"}','${A}')`);
});

test("canciones: v1 (audio/mpeg, <ws>/songs/…) y v2 (audio/flac, <ws>/<source>/original) se aceptan; una v2 de más de 60 MiB no", async () => {
  await db.exec(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by) values ('${ws}','v1','${ws}/songs/a.mp3','audio/mpeg',1000,'${A}')`);
  const [a, b] = [await mkSrc(), await mkSrc()];
  await db.exec(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','v2','${ws}/${a}/original','audio/flac',1000,'${A}','${a}')`);
  await assert.rejects(db.exec(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','grande','${ws}/${b}/original','audio/flac',62914561,'${A}','${b}')`));
});

test("cambiar el modo de letra a portada y volver conserva canción, estilo y fondos sin tocar song_alignments; request_lyrics crea un trabajo v1", async () => {
  const s2 = await mkSrc();
  const sid = await one(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','Modo','${ws}/${s2}/original','audio/mpeg',900,'${A}','${s2}') returning id`);
  await db.exec(`insert into song_alignments(song_id, workspace_id, lyrics_sha256, words) values ('${sid}','${ws}','sha-demo','[]')`);
  const pid = (await as<{ r: string }>(A, `select public.create_lyric_project('${sid}','letra','Modo') r`))[0].r;
  await as(A, `select public.save_lyric_project('${pid}', '{"style":{"rafagaStyle":2,"font":"Inter"},"background":{"kind":"solid","color":"#000000"}}'::jsonb)`);
  const alBefore = (await q<{ n: number }>(`select count(*)::int n from song_alignments where song_id='${sid}'`))[0].n;
  await as(A, `select public.save_lyric_project('${pid}', '{"mode":"portada"}'::jsonb)`); await as(A, `select public.save_lyric_project('${pid}', '{"mode":"letra"}'::jsonb)`);
  const [lp] = await q<{ song_id: string; mode: string; style: { font: string }; background: { kind: string } }>(`select song_id, mode, style, background from lyric_projects where project_id='${pid}'`);
  assert.equal(lp.song_id, sid); assert.equal(lp.mode, "letra"); assert.equal(lp.style.font, "Inter"); assert.equal(lp.background.kind, "solid");
  assert.equal((await q<{ n: number }>(`select count(*)::int n from song_alignments where song_id='${sid}'`))[0].n, alBefore);
  assert.match((await err(A, `select public.save_lyric_project('${pid}', '{"mode":"otro"}'::jsonb)`)) ?? "", /invalid_params/);
  const jid = (await as<{ r: string }>(A, `select public.request_lyrics('${sid}', '{"n":3,"ratio":"9:16","res":"1080"}'::jsonb, 'lyric-key-0001') r`))[0].r;
  const claimed = (await db.query<{ id: string; engine: string; kind: string }>("select id, engine, kind from public.claim_job()")).rows;
  assert.ok(claimed.some((c) => c.id === jid && c.kind === "lyrics" && c.engine === "v1"), JSON.stringify(claimed));
});
