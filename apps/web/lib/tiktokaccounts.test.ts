// Varias cuentas de TikTok: conexión por cuenta, perfil, publicación con cuenta/música/tope/duplicados/pausa y worker con el token de cada cuenta. Sin red.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "../../../supabase/tests/fake-supabase.ts";
import { handleIntegrations } from "./routes/integrations.ts";
import { STAGE_IMPLS } from "../../../workers/media/src/stages/integrations.ts";
import type { StageCtx, StageRow } from "../../../workers/media/src/stages/registry.ts";

let db: PGlite, wsA: string; const renders: string[] = []; const revoked: string[] = [];
const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const rpcUser = async (fn: string, a: Record<string, unknown>) => (await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${tokenFor(A)}` }, body: JSON.stringify(a) })).json() as Promise<Record<string, unknown>>;
const rpcSvc = async <T>(fn: string, a: Record<string, unknown> = {}): Promise<T> => { const r = await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(a) }); const j = await r.json(); if (!r.ok) throw new Error((j as { message: string }).message); return j as T; };
const call = (method: string, rest: string[], body?: unknown, idem?: string, integration = "tiktok") => handleIntegrations(new Request(`https://app/api/${integration}/${rest.join("/")}`, { method, headers: { Authorization: `Bearer ${tokenFor(A)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }),
  integration, rest, { f: fakeSupabaseFetch(db), wake: () => {}, provider: (async (_u: string, i?: RequestInit) => { revoked.push(String((i?.body as URLSearchParams)?.get("token"))); return new Response("{}"); }) as never });
const save = (key: string, alias: string, token: string) => rpcUser("oauth_save", { p_provider: "tiktok", p_label: alias + " (TikTok)", p_scopes: ["video.publish"], p_access: token, p_refresh: "refresh-" + token, p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_account: key, p_alias: alias });
const pub = (render: string, conn: string | null, extra: Record<string, unknown> = {}, idem = "idem-" + Math.random().toString(36).slice(2, 12)) =>
  call("POST", [], { export_id: render, platform: "tiktok", title: "Canción - Artista", description: "Canción - Artista #musica", connection_id: conn ?? undefined, ...extra }, idem, "publish");
const tomorrow = () => new Date(Date.now() + 86400000).toISOString();
let ppId: string, tldId: string;

before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${wsA}','upload','validated','${A}') returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','P','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`);
  for (let i = 0; i < 4; i++) {
    const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','C${i}') returning id`);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${wsA}',1,'{}','9:16','single_track','x')`);
    renders.push(await one(`insert into renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind, settings_hash, storage_path, bytes) values ('${wsA}','${clip}',1,'9:16',true,'h${i}','ready','mp4','h${i}','${wsA}/${clip}/v1-h${i}.mp4',2048) returning id`));
  }
});

test("dos cuentas de TikTok conviven; volver a conectar la misma la actualiza; Google sigue siendo una sola", async () => {
  const a = await save("open-id-aaa", "Punto de Perreo", "token-perreo-1234567"), b = await save("open-id-bbb", "Te Lo Dedico", "token-dedico-1234567");
  ppId = a.id as string; tldId = b.id as string; assert.ok(ppId && tldId && ppId !== tldId, JSON.stringify(a));
  await save("open-id-aaa", "Punto de Perreo", "token-perreo-nuevo-12");
  assert.equal((await q<{ n: number }>("select count(*)::int n from oauth_connections where provider='tiktok'"))[0].n, 2);
  for (const t of ["g1-token-12345678", "g2-token-12345678"]) await rpcUser("oauth_save", { p_provider: "google", p_label: "g", p_scopes: [], p_access: t, p_refresh: null, p_expires_at: null });
  assert.equal((await q<{ n: number }>("select count(*)::int n from oauth_connections where provider='google'"))[0].n, 1);
  assert.equal(((await rpcUser("oauth_save", { p_provider: "tiktok", p_label: "x", p_scopes: [], p_access: "token-sin-cuenta-123", p_refresh: null, p_expires_at: null })).message ?? "").toString().includes("invalid_connection"), true, "TikTok exige identificador de cuenta");
});

test("GET /api/tiktok lista las cuentas con alias y perfil, nunca tokens", async () => {
  const r = await call("GET", []), j = (await r.json()) as { accounts: { id: string; alias: string; profile: object }[] }; const txt = JSON.stringify(j);
  assert.equal(r.status, 200); assert.deepEqual(j.accounts.map((x) => x.alias).sort(), ["Punto de Perreo", "Te Lo Dedico"]); assert.ok(!/token|refresh/i.test(txt.replace(/"account_label"[^,]*/g, "")), txt);
});

test("PATCH guarda y sanea el perfil (horas, tope, hashtags); un perfil enorme se rechaza", async () => {
  const r = await call("PATCH", [ppId], { alias: "Punto de Perreo 🔥", profile: { tone: "energía", hashtags: ["#puntodeperreo", "reggaeton"], slots: ["13:00", "25:99", "21:30"], daily_cap: 99, tz: "Europe/Madrid", paused: false, evil: "x" } });
  assert.equal(r.status, 200);
  const [c] = await q<{ alias: string; profile: Record<string, unknown> }>(`select alias, profile from oauth_connections where id='${ppId}'`);
  assert.equal(c.alias, "Punto de Perreo 🔥"); assert.deepEqual(c.profile.slots, ["13:00", "21:30"]); assert.equal(c.profile.daily_cap, 30); assert.deepEqual(c.profile.hashtags, ["puntodeperreo", "reggaeton"]); assert.equal(c.profile.evil, undefined);
  assert.equal((await call("PATCH", ["no-es-uuid"], {})).status, 404);
  const big = await rpcUser("oauth_set_profile", { p_conn: ppId, p_alias: null, p_profile: { x: "y".repeat(7000) } }); assert.match(JSON.stringify(big), /invalid_profile/);
});

test("publicar con dos cuentas exige elegir una y declarar el origen de la música; programa en la cuenta elegida", async () => {
  assert.equal((await pub(renders[0], null)).status, 409);
  const noMusic = await pub(renders[0], ppId, { scheduled_at: tomorrow() }); assert.equal(noMusic.status, 400); assert.equal(((await noMusic.json()) as { error: { code: string } }).error.code, "music_origin_required");
  const ok = await pub(renders[0], ppId, { scheduled_at: tomorrow(), music_origin: "licensed" }); assert.equal(ok.status, 202);
  const [p] = await q<{ connection_id: string; state: string; music_origin: string }>("select connection_id, state, music_origin from publications order by created_at desc limit 1");
  assert.deepEqual([p.connection_id, p.state, p.music_origin], [ppId, "scheduled", "licensed"]);
  assert.equal((await pub(renders[0], "00000000-0000-0000-0000-000000000000", { music_origin: "own" })).status, 409, "cuenta ajena o inexistente");
});

test("el mismo vídeo no se programa dos veces en la misma cuenta; el tope diario se respeta; cancelar libera el hueco", async () => {
  const dup = await pub(renders[0], ppId, { scheduled_at: tomorrow(), music_origin: "own" }); assert.equal(dup.status, 409); assert.equal(((await dup.json()) as { error: { code: string } }).error.code, "duplicate_publication");
  await call("PATCH", [tldId], { profile: { daily_cap: 1 } });
  const day = new Date(Date.now() + 2 * 86400000).toISOString();
  assert.equal((await pub(renders[1], tldId, { scheduled_at: day, music_origin: "free" })).status, 202);
  const cap = await pub(renders[2], tldId, { scheduled_at: day, music_origin: "free" }); assert.equal(cap.status, 409); assert.equal(((await cap.json()) as { error: { code: string } }).error.code, "daily_cap");
  const [first] = await q<{ id: string }>(`select id from publications where connection_id='${tldId}' limit 1`);
  assert.equal((await call("POST", [first.id, "cancel"], {}, undefined, "publish")).status, 200);
  assert.equal((await pub(renders[2], tldId, { scheduled_at: day, music_origin: "free" })).status, 202);
});

test("cuenta en pausa: no admite publicaciones nuevas y su cola programada no sale hasta reanudar", async () => {
  await call("PATCH", [ppId], { profile: { paused: true } });
  assert.equal(((await (await pub(renders[3], ppId, { scheduled_at: tomorrow(), music_origin: "own" })).json()) as { error: { code: string } }).error.code, "account_paused");
  await db.exec("update publications set scheduled_at = now() - interval '1 minute' where state='scheduled'");
  const before = (await q<{ n: number }>("select count(*)::int n from publications where state='queued'"))[0].n;
  const n = await rpcSvc<number>("enqueue_due_publications"); const after = await q<{ connection_id: string; state: string }>("select connection_id, state from publications where state in ('queued','scheduled')");
  assert.ok(after.filter((x) => x.connection_id === ppId).every((x) => x.state === "scheduled"), "la cuenta en pausa sigue programada"); assert.ok(n >= 1 && after.some((x) => x.connection_id === tldId && x.state === "queued"));
  assert.ok(before === 0);
  await call("PATCH", [ppId], { profile: { paused: false } });
  assert.ok((await rpcSvc<number>("enqueue_due_publications")) >= 1);
});

test("el worker publica con el token de la cuenta de la publicación (no con el de otra) y el pie lleva la descripción completa", async () => {
  const [p] = await q<{ id: string }>(`select id from publications where connection_id='${tldId}' and state='queued' order by created_at limit 1`);
  const seen: { auth: string; title: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url), h = (init?.headers ?? {}) as Record<string, string>;
    if (u.includes("creator_info")) { seen.push({ auth: h.Authorization, title: "" }); return new Response(JSON.stringify({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } })); }
    if (u.includes("video/init")) { seen.push({ auth: h.Authorization, title: (JSON.parse(String(init!.body)) as { post_info: { title: string } }).post_info.title }); return new Response(JSON.stringify({ data: { publish_id: "p1", upload_url: "https://upload.example.com/x" }, error: { code: "ok" } })); }
    if (u.includes("upload.example.com")) return new Response(null, { status: 201 });
    return new Response(JSON.stringify({ data: { status: "PUBLISH_COMPLETE" } }));
  }) as unknown as typeof fetch;
  const ctx: StageCtx = { workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "tt-")), rpc: rpcSvc as never, fetch: f,
    r2: { download: async (_k: string, d: string) => { writeFileSync(d, Buffer.alloc(2048)); }, upload: async () => {}, remove: async () => {} } as never, env: {} };
  const o = await STAGE_IMPLS.publish.run(ctx, { id: "s", params: { publication_id: p.id } } as unknown as StageRow);
  assert.equal(o.output.state, "published");
  assert.ok(seen.every((s) => s.auth === "Bearer token-dedico-1234567"), JSON.stringify(seen)); assert.equal(seen.find((s) => s.title)?.title, "Canción - Artista #musica");
});

test("desconectar una cuenta cancela sus programadas, borra solo esa conexión y revoca su token en TikTok", async () => {
  const r = await call("POST", [ppId, "disconnect"], {}); assert.equal(r.status, 200);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from oauth_connections where id='${ppId}'`))[0].n, 0); assert.equal((await q<{ n: number }>(`select count(*)::int n from oauth_connections where id='${tldId}'`))[0].n, 1);
  assert.ok((await q<{ n: number }>(`select count(*)::int n from publications where state='scheduled' and connection_id='${ppId}'`))[0].n === 0);
  assert.deepEqual(revoked, ["refresh-token-perreo-nuevo-12"]);
});

test("copys: sin clave de IA se devuelve la plantilla y se dice; con IA simulada se validan; sin canciones → 400", async () => {
  const r = await call("POST", ["copy"], { account_name: "Te Lo Dedico", profile: { hashtags: ["paradedicar"], emoji: "⭐" }, songs: [{ title: "Contando días", artist: "Crítika" }] });
  const j = (await r.json()) as { copies: { description: string; source: string; hashtags: string[] }[]; note?: string };
  assert.equal(r.status, 200); assert.equal(j.copies[0].source, "plantilla"); assert.match(j.copies[0].description, /^Contando días - Crítika ⭐ #paradedicar/); assert.match(j.note ?? "", /plantilla/);
  assert.equal((await call("POST", ["copy"], { songs: [] })).status, 400);
});
