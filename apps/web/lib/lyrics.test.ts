// API de letra: registro de canciones desde una subida, URL de audio firmada tras el acceso, piezas y modos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handleLyrics } from "./routes/lyrics.ts";

let db: PGlite, ws: string;
const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK" };
const call = (uid: string, method: string, path: string, body?: unknown) =>
  handleLyrics(new Request(`https://app/api/lyrics${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), path.split("/").filter(Boolean), { f: fakeSupabaseFetch(db), env: ENV });
const as = async <T>(sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
const session = async (mime: string, bytes: number, idem: string) => (await as<{ r: { upload_id: string } }>(`select public.create_upload_session('${ws}','Tema',${bytes},'${mime}', null, null, true, 'multipart', 8388608, '${idem}') r`))[0].r.upload_id;

before(async () => { ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string }); });

test("POST /songs: 201 con song_id y project_id, y repetida con la misma sesión devuelve los mismos", async () => {
  const up = await session("audio/flac", 5_000_000, "lyr-up-0001");
  const a = await call(A, "POST", "/songs", { upload_id: up, title: "Mi tema", artist: "Yo", lyrics: "hola" }), ja = (await a.json()) as { song_id: string; project_id: string };
  assert.equal(a.status, 201); assert.ok(ja.song_id && ja.project_id);
  const b = await call(A, "POST", "/songs", { upload_id: up, title: "Mi tema" }), jb = (await b.json()) as { song_id: string; project_id: string };
  assert.deepEqual(jb, ja);
});

test("POST /songs: más de 60 MiB → 413 con límite; mime que no es audio → 415; no se crea canción", async () => {
  const before = (await db.query<{ n: number }>("select count(*)::int n from songs")).rows[0].n;
  const big = await call(A, "POST", "/songs", { upload_id: await session("audio/flac", 70_000_000, "lyr-up-0002"), title: "Grande" });
  assert.equal(big.status, 413); const jb = (await big.json()) as { error: { code: string }; limit: number }; assert.equal(jb.error.code, "file_too_large"); assert.equal(jb.limit, 62914560);
  const vid = await call(A, "POST", "/songs", { upload_id: await session("video/mp4", 5_000_000, "lyr-up-0003"), title: "Vídeo" });
  assert.equal(vid.status, 415); assert.equal(((await vid.json()) as { error: { code: string } }).error.code, "unsupported_file");
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from songs")).rows[0].n, before);
});

test("GET /songs/:id/audio: B → 404 sin firmar; A con la canción lista → URL de R2 que caduca en 3600 s; no lista → 409", async () => {
  const up = await session("audio/flac", 5_000_000, "lyr-up-0004");
  const { song_id } = (await (await call(A, "POST", "/songs", { upload_id: up, title: "Audio" })).json()) as { song_id: string };
  assert.equal((await call(A, "GET", `/songs/${song_id}/audio`)).status, 409);
  await db.exec(`update songs set status='ready' where id='${song_id}'`);
  assert.equal((await call(B, "GET", `/songs/${song_id}/audio`)).status, 404);
  const r = await call(A, "GET", `/songs/${song_id}/audio`), j = (await r.json()) as { url: string; expires_at: string };
  assert.equal(r.status, 200); assert.match(j.url, /X-Amz-Expires=3600/); assert.ok(Math.abs(new Date(j.expires_at).getTime() - Date.now() - 3600_000) < 5000);
});

test("POST /projects (modo texto) y PUT a letra: 201 {project_id} y 200 {saved_at}; un modo desconocido → 400 con field", async () => {
  const up = await session("audio/flac", 5_000_000, "lyr-up-0005");
  const { song_id } = (await (await call(A, "POST", "/songs", { upload_id: up, title: "Piezas" })).json()) as { song_id: string };
  const c = await call(A, "POST", "/projects", { song_id, mode: "texto" }), { project_id } = (await c.json()) as { project_id: string };
  assert.equal(c.status, 201); assert.ok(project_id);
  const put = await call(A, "PUT", `/projects/${project_id}`, { mode: "letra" }); assert.equal(put.status, 200); assert.ok(((await put.json()) as { saved_at: string }).saved_at);
  assert.equal((await db.query<{ mode: string }>(`select mode from lyric_projects where project_id='${project_id}'`)).rows[0].mode, "letra");
  const bad = await call(A, "PUT", `/projects/${project_id}`, { mode: "otro" }); const jb = (await bad.json()) as { error: { code: string }; field: string };
  assert.equal(bad.status, 400); assert.equal(jb.error.code, "invalid_params"); assert.equal(jb.field, "mode");
  assert.equal((await call(B, "PUT", `/projects/${project_id}`, { mode: "letra" })).status, 404);
});
