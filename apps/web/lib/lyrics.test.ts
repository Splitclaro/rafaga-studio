// API de letra: registro de canciones desde una subida, URL de audio firmada tras el acceso, piezas y modos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handleLyrics } from "./routes/lyrics.ts";
import { handleExports } from "./routes/exports.ts";
import { validateLyricComposition, planLyricVariants } from "@rafaga/composition";

let db: PGlite, ws: string;
const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK" };
const woken: string[] = [];
const call = (uid: string, method: string, path: string, body?: unknown, idem?: string) =>
  handleLyrics(new Request(`https://app/api/lyrics${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined }), path.split("/").filter(Boolean), { f: fakeSupabaseFetch(db), env: ENV, wake: (_r, j) => woken.push(j) });
const as = async <T>(sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
const session = async (mime: string, bytes: number, idem: string) => (await as<{ r: { upload_id: string } }>(`select public.create_upload_session('${ws}','Tema',${bytes},'${mime}', null, null, true, 'multipart', 8388608, '${idem}') r`))[0].r.upload_id;

before(async () => {
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  await db.exec(`select public.grant_units('${ws}', 20, 'pruebas', 'grant-lyr-0001')`);
});

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

// ───────── Sincronización (paso 5) ─────────
async function readySong(idem: string, lyrics: string | null = "uno dos tres") {
  const up = await session("audio/flac", 5_000_000, idem);
  const { song_id } = (await (await call(A, "POST", "/songs", { upload_id: up, title: "Sync" })).json()) as { song_id: string };
  await db.exec(`update songs set status='ready', duration_ms=180000, lyrics_text=${lyrics === null ? "null" : `'${lyrics}'`} where id='${song_id}'`);
  return song_id;
}
const W = (n: number, manual = false) => Array.from({ length: n }, (_, i) => ({ text: `p${i}`, start: i, end: i + 0.5, line: 0, manual }));

test("POST /songs/:id/sync: 180 s sin ASR → 202 con 3 unidades reservadas; con el ASR guardado → 0 y cached sin filas nuevas en el libro", async () => {
  const s = await readySong("lyr-up-0010");
  const ledger = async () => (await db.query<{ n: number }>("select count(*)::int n from credit_ledger")).rows[0].n;
  const l0 = await ledger();
  const a = await call(A, "POST", `/songs/${s}/sync`, { mode: "align" }, "sync-route-0001"), ja = (await a.json()) as { job_id: string; units_reserved: number; cached: boolean };
  assert.equal(a.status, 202); assert.equal(ja.units_reserved, 3); assert.equal(ja.cached, false); assert.equal(await ledger(), l0 + 1);
  assert.ok(woken.includes(ja.job_id));
  assert.equal((await db.query<{ units: string }>("select units from credit_ledger where kind='reserve' order by created_at desc limit 1")).rows[0].units, "-3.00");
  await db.exec(`select public.save_song_asr('${s}', 'whisper-large-v3-turbo', '[{"text":"uno","start":0,"end":0.4}]'::jsonb)`);
  const l1 = await ledger();
  const b = await call(A, "POST", `/songs/${s}/sync`, { mode: "align" }, "sync-route-0002"), jb = (await b.json()) as { units_reserved: number; cached: boolean };
  assert.equal(b.status, 202); assert.equal(jb.units_reserved, 0); assert.equal(jb.cached, true); assert.equal(await ledger(), l1);
  assert.equal((await call(A, "POST", `/songs/${s}/sync`, { mode: "align" })).status, 400, "sin Idempotency-Key");
});

test("align sin letra guardada → 409 lyrics_required; PUT de la letra y luego sí", async () => {
  const s = await readySong("lyr-up-0011", null);
  const r = await call(A, "POST", `/songs/${s}/sync`, { mode: "align" }, "sync-route-0003");
  assert.equal(r.status, 409); assert.equal(((await r.json()) as { error: { code: string } }).error.code, "lyrics_required");
  assert.equal((await call(A, "PUT", `/songs/${s}/lyrics`, { text: "hola mundo" })).status, 200);
  assert.equal((await call(A, "POST", `/songs/${s}/sync`, { mode: "align" }, "sync-route-0004")).status, 202);
});

test("PUT /alignment: base obsoleta → 409 con current_revision; tiempos decrecientes → 400 invalid_words; restore crea revisión con la primera aligned", async () => {
  const s = await readySong("lyr-up-0012");
  await db.exec(`select public.save_song_alignment('${s}', null, '${JSON.stringify(W(3))}'::jsonb, 'aligned', '[]'::jsonb)`);       // revisión 1 (worker)
  const ok = await call(A, "PUT", `/songs/${s}/alignment`, { base_revision: 1, words: W(3, true) }); assert.equal(ok.status, 201); assert.equal(((await ok.json()) as { revision: number }).revision, 2);
  const stale = await call(A, "PUT", `/songs/${s}/alignment`, { base_revision: 1, words: W(3, true) });
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { conflict: { current_revision: 2 } });
  const bad = await call(A, "PUT", `/songs/${s}/alignment`, { base_revision: 2, words: [{ ...W(1)[0] }, { text: "b", start: 0.2, end: 0.1, line: 0, manual: false }] });
  assert.equal(bad.status, 400); assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "invalid_words");
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from song_alignments where song_id='${s}' and revision is not null`)).rows[0].n, 2, "ninguna revisión extra");
  const rs = await call(A, "POST", `/songs/${s}/alignment/restore`), jr = (await rs.json()) as { revision: number };
  assert.equal(rs.status, 201); assert.equal(jr.revision, 3);
  const got = (await (await call(A, "GET", `/songs/${s}/alignment`)).json()) as { revision: number; words: { manual: boolean }[] };
  assert.equal(got.revision, 3); assert.ok(got.words.every((w) => w.manual === false), "las palabras son las de la primera revisión aligned");
});

test("el usuario B recibe 404 al pedir la alineación o sincronizar una canción de A", async () => {
  const s = await readySong("lyr-up-0013");
  assert.equal((await call(B, "GET", `/songs/${s}/alignment`)).status, 404);
  assert.equal((await call(B, "POST", `/songs/${s}/sync`, { mode: "align" }, "sync-route-0005")).status, 404);
});

// ───────── Medios y demo (paso 12) ─────────
let nColl = 0;
const mkColl = async () => (await as<{ r: string }>(`select public.create_media_collection('${ws}','Fondos ${++nColl}','backgrounds') r`))[0].r;
const mkSource = async () => (await db.query<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, mime, bytes, duration_ms, width, height) values ('${ws}','upload','validated','${A}','video/mp4',1000,10000,640,360) returning id`)).rows[0].id;

test("POST /media/items: >200 MiB → 413 con límite; con el uso actual por encima de 10 GiB → 507; válido → 201 con URL PUT de 900 s", async () => {
  const c = await mkColl(), body = (bytes: number) => ({ collection_id: c, name: "Fondo", kind: "video", mime: "video/mp4", bytes });
  const big = await call(A, "POST", "/media/items", body(209715201)); assert.equal(big.status, 413); assert.equal(((await big.json()) as { limit: number }).limit, 209715200);
  await db.exec(`insert into storage_objects(workspace_id, key, bytes, kind) values ('${ws}','${ws}/lleno/x',10737000000,'original')`);
  const full = await call(A, "POST", "/media/items", body(5_000_000)); assert.equal(full.status, 507); assert.equal(((await full.json()) as { quota: number }).quota, 10737418240);
  await db.exec(`delete from storage_objects where key='${ws}/lleno/x'`);
  const ok = await call(A, "POST", "/media/items", body(5_000_000)), j = (await ok.json()) as { item_id: string; url: string; expires_at: string };
  assert.equal(ok.status, 201); assert.ok(j.item_id); assert.match(j.url, /X-Amz-Expires=900/);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from media_items where id='${j.item_id}'`)).rows[0].n, 1);
  assert.equal((await call(A, "POST", "/media/items", { ...body(5), mime: "application/pdf" })).status, 415);
});

test("split y cut: misma Idempotency-Key → mismo job_id; length_s fuera de 3/5/10/15/30 → 400 con field; B → 404", async () => {
  const c = await mkColl(), s = await mkSource();
  const a = await call(A, "POST", "/media/split", { source_id: s, collection_id: c, length_s: 5 }, "split-key-0001"), b = await call(A, "POST", "/media/split", { source_id: s, collection_id: c, length_s: 5 }, "split-key-0001");
  assert.equal(a.status, 202); assert.equal(((await a.json()) as { job_id: string }).job_id, ((await b.json()) as { job_id: string }).job_id);
  const bad = await call(A, "POST", "/media/split", { source_id: s, collection_id: c, length_s: 4 }, "split-key-0002"); assert.equal(bad.status, 400); assert.equal(((await bad.json()) as { field: string }).field, "length_s");
  const segs = [{ start_ms: 0, end_ms: 3000 }], k1 = await call(A, "POST", "/media/cut", { source_id: s, collection_id: c, segments: segs, cut_mode: "exacto" }, "cut-key-00001"), k2 = await call(A, "POST", "/media/cut", { source_id: s, collection_id: c, segments: segs, cut_mode: "exacto" }, "cut-key-00001");
  assert.equal(k1.status, 202); assert.equal(((await k1.json()) as { job_id: string }).job_id, ((await k2.json()) as { job_id: string }).job_id);
  assert.equal((await call(B, "POST", "/media/split", { source_id: s, collection_id: c, length_s: 5 }, "split-key-0003")).status, 404);
});

test("GET /media/items/:id/url: B → 404 sin firmar; POST /demo sin Idempotency-Key → 400 y con clave → 202 {song_id, project_id, job_id}", async () => {
  const c = await mkColl(), made = (await (await call(A, "POST", "/media/items", { collection_id: c, name: "F", kind: "video", mime: "video/mp4", bytes: 1000 })).json()) as { item_id: string };
  await call(A, "POST", `/media/items/${made.item_id}/complete`, { duration_ms: 3000, width: 640, height: 360 });
  assert.equal((await call(B, "GET", `/media/items/${made.item_id}/url`)).status, 404);
  const u = await call(A, "GET", `/media/items/${made.item_id}/url`); assert.equal(u.status, 200); assert.match(((await u.json()) as { url: string }).url, /X-Amz-Expires=3600/);
  assert.equal((await call(A, "POST", "/demo", {})).status, 400);
  const d = await call(A, "POST", "/demo", {}, "demo-key-00001"), j = (await d.json()) as { song_id: string; project_id: string; job_id: string };
  assert.equal(d.status, 202); assert.ok(j.song_id && j.project_id && j.job_id);
});

// ───────── Variantes (paso 15) ─────────
async function lyricProject() {
  const s = await readySong(`lyr-up-v${Math.random().toString(36).slice(2, 8)}`), p = (await (await call(A, "POST", "/projects", { song_id: s, mode: "letra" })).json()) as { project_id: string };
  return p.project_id;
}
const baseComp = validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 0, end: 5 }, words: [{ text: "hola", start: 0.5, end: 1, line: 0 }], seed: 2 });
const plan = (n: number) => planLyricVariants(baseComp, n, { song_range: true, lyrics_sync: true, format: true, background: true }, { styles: [0, 1, 2, 3].map((k) => ({ ...baseComp.style, font: ["Inter", "Oswald", "Anton", "Lobster"][k] })) });
const cnt = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n;
const exp = (method: string, path: string, idem?: string) => handleExports(new Request(`https://app/api/exports${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(A)}`, ...(idem ? { "Idempotency-Key": idem } : {}) } }), path.split("/").filter(Boolean), { f: fakeSupabaseFetch(db), env: ENV, wake: () => {} });

test("variantes: 3 llamadas con la misma clave y 3 variantes crean 1 generación, 3 clips v1, 3 exportaciones en un lote y 1 trabajo; mismos identificadores; 0 filas en el libro", async () => {
  const pid = await lyricProject(), g0 = await cnt("generations"), c0 = await cnt("clips"), cv0 = await cnt("clip_versions"), r0 = await cnt("renders"), j0 = await cnt("jobs"), l0 = await cnt("credit_ledger");
  const out: { generation_id: string; clip_ids: string[]; export_ids: string[]; batch_id: string; job_id: string }[] = [];
  for (let i = 0; i < 3; i++) { const r = await call(A, "POST", `/projects/${pid}/variants`, { variants: plan(3) }, "variants-key-0001"); assert.equal(r.status, 202); out.push((await r.json()) as never); }
  assert.deepEqual(out[1], out[0]); assert.deepEqual(out[2], out[0]);
  assert.deepEqual([await cnt("generations") - g0, await cnt("clips") - c0, await cnt("clip_versions") - cv0, await cnt("renders") - r0, await cnt("jobs") - j0, await cnt("credit_ledger") - l0], [1, 3, 3, 3, 1, 0]);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from renders where batch_id='${out[0].batch_id}'`)).rows[0].n, 3);
  assert.equal(out[0].export_ids.length, 3); assert.ok(woken.includes(out[0].job_id));
});

test("variantes: 0, 11 o una composición que no es de letra → 400 con field variants sin escribir nada", async () => {
  const pid = await lyricProject(), before = [await cnt("generations"), await cnt("clips"), await cnt("jobs")];
  for (const v of [[], plan(10).concat(plan(1)), [{ kind: "clip", aspect: "9:16" }]]) {
    const r = await call(A, "POST", `/projects/${pid}/variants`, { variants: v }, `variants-bad-${Math.random().toString(36).slice(2, 8)}`);
    assert.equal(r.status, 400); assert.equal(((await r.json()) as { field: string }).field, "variants");
  }
  assert.deepEqual([await cnt("generations"), await cnt("clips"), await cnt("jobs")], before);
});

test("dos variantes con el mismo variant_hash se crean igualmente y añaden near_duplicate a generations.warnings", async () => {
  const pid = await lyricProject(), a = { ...baseComp, variant_hash: "abcd" }, b = { ...baseComp, variant_hash: "abcd", seed: 5 };
  const r = await call(A, "POST", `/projects/${pid}/variants`, { variants: [a, b, { ...baseComp, variant_hash: "zzzz" }] }, "variants-dup-0001"), j = (await r.json()) as { generation_id: string; clip_ids: string[]; warnings: { code: string; variants: number[] }[] };
  assert.equal(r.status, 202); assert.equal(j.clip_ids.length, 3); assert.deepEqual(j.warnings, [{ code: "near_duplicate", variants: [1, 2] }]);
  assert.deepEqual((await db.query<{ warnings: unknown }>(`select warnings from generations where id='${j.generation_id}'`)).rows[0].warnings, j.warnings);
});

test("lote con una exportación fallida: las otras 2 se descargan y el reintento reencola solo la fallida; request_exports acepta 4:5, lrc, lrc_word y ass", async () => {
  const pid = await lyricProject(), r = await call(A, "POST", `/projects/${pid}/variants`, { variants: plan(3) }, "variants-fail-001"), j = (await r.json()) as { export_ids: string[]; clip_ids: string[] };
  const [ok1, ok2, bad] = j.export_ids;
  for (const id of [ok1, ok2]) await db.exec(`update renders set status='ready', storage_path='${ws}/x/${id}.mp4', expires_at=now()+interval '5 days' where id='${id}'`);
  await db.exec(`update renders set status='failed', error_code='render_failed' where id='${bad}'`);
  for (const id of [ok1, ok2]) assert.equal((await exp("GET", `/${id}/url`)).status, 200);
  assert.equal((await exp("GET", `/${bad}/url`)).status, 409);
  const retry = await exp("POST", `/${bad}/retry`, "retry-key-00001"), jr = (await retry.json()) as { job_id: string | null }; assert.equal(retry.status, 202); assert.ok(jr.job_id);
  assert.equal((await db.query<{ status: string }>(`select status from renders where id='${bad}'`)).rows[0].status, "queued");
  assert.equal(((await (await exp("POST", `/${ok1}/retry`, "retry-key-00002")).json()) as { job_id: string | null }).job_id, null, "las listas no se reencolan");
  const items = ["lrc", "lrc_word", "ass"].map((kind) => ({ clip_id: j.clip_ids[0], version: 1, aspect: "4:5", burn_subtitles: false, kind }));
  const ex = (await as<{ r: { export_ids: string[] } }>(`select public.request_exports('${JSON.stringify(items)}'::jsonb, false, 'fmt-key-000001') r`))[0].r; assert.equal(ex.export_ids.length, 3);
});
