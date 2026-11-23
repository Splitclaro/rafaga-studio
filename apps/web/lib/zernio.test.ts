// Publicación pública en TikTok con Zernio: configuración cerrada a 2 cuentas, aislamiento por espacio, consentimiento, fecha vencida,
// envío con idempotencia, reintentos por límite, cancelación, webhooks firmados y deduplicados. Sin red (Zernio y Supabase simulados).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "../../../supabase/tests/fake-supabase.ts";
import { handleIntegrations } from "./routes/integrations.ts";
import { STAGE_IMPLS } from "../../../workers/media/src/stages/integrations.ts";
import { handleZernioEvent } from "../../../workers/media/src/zernio_event.ts";
import { zernioConfig, verifySignature, eventToUpdate } from "@rafaga/providers/zernio";
import type { StageCtx, StageRow } from "../../../workers/media/src/stages/registry.ts";

let db: PGlite, wsA: string; const renders: string[] = [];
const ACC1 = "acc_perreo_0001", ACC2 = "acc_dedico_0001", ACC3 = "acc_tercera_001";
const ENV = () => ({ ZERNIO_API_KEY: "zk_secret_test_key_123", ZERNIO_WORKSPACE_ID: wsA, ZERNIO_TARGETS: JSON.stringify([{ accountId: ACC1, username: "@PuntoDePerreo" }, { accountId: ACC2, username: "telodedico.music" }]), ZERNIO_WEBHOOK_SECRET: "whsec_test_123" });
const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const rpcSvc = async <T>(fn: string, a: Record<string, unknown> = {}): Promise<T> => { const r = await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(a) }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j as T; };

// ── Zernio simulado ──
interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
let seq = 0, calls: Call[] = [], mode: "ok" | "rate" | "payment" | "net" | "published_on_delete_400" | "no_public" = "ok", health = true;
const zernio = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url), method = init?.method ?? "GET", headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
  let body: unknown = init?.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* texto */ } }
  calls.push({ url: u, method, headers, body });
  const r = (s: number, j: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json", ...h } });
  if (u.startsWith("https://up.example/")) return new Response("", { status: 200 });
  const p = u.replace("https://zernio.com/api/v1", "");
  if (p === "/accounts/health") return r(200, { summary: { total: 3 }, accounts: [{ accountId: ACC1, platform: "tiktok", username: "puntodeperreo", canPost: true, tokenValid: true }, { accountId: ACC2, platform: "tiktok", username: health ? "telodedico.music" : "otra_persona", canPost: true, tokenValid: true }, { accountId: ACC3, platform: "tiktok", username: "extra", canPost: true }] });
  if (p.includes("/tiktok/creator-info")) return r(200, { creator: { nickname: "Nick", canPostMore: true }, privacyLevels: mode === "no_public" ? [{ value: "SELF_ONLY" }] : [{ value: "PUBLIC_TO_EVERYONE" }], postingLimits: { maxVideoDurationSec: 600, interactionSettings: {} } });
  if (p === "/media/presign") return r(200, { uploadUrl: "https://up.example/put?sig=1", publicUrl: "https://media.zernio.com/temp/x.mp4" });
  if (p === "/posts" && method === "POST") {
    if (mode === "rate") return r(429, { error: "Rate limit exceeded", details: { retryAfterSeconds: 120 } }, { "retry-after": "120" });
    if (mode === "payment") return r(402, { code: "PAYMENT_REQUIRED", reason: "free_tier_exceeded" });
    if (mode === "net") throw new Error("socket hang up");
    return r(201, { message: "ok", post: { _id: "zp_" + ++seq, status: (body as { publishNow?: boolean }).publishNow ? "publishing" : "scheduled" } });
  }
  if (method === "DELETE") return mode === "published_on_delete_400" ? r(400, { code: "invalid_resource_state", error: "published" }) : r(200, { message: "deleted" });
  return r(404, {});
}) as unknown as typeof fetch;

const call = (method: string, rest: string[], body?: unknown, idem?: string, integration = "publish", env: Record<string, string | undefined> = ENV()) =>
  handleIntegrations(new Request(`https://app/api/${integration}/${rest.join("/")}`, { method, headers: { Authorization: `Bearer ${tokenFor(A)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) }),
    integration, rest, { f: fakeSupabaseFetch(db), wake: () => {}, provider: zernio, env });
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const CONSENT = { preview_confirmed: true, express_consent: true, caption_reviewed: true, music_declared: true };
const pub = (render: string, extra: Record<string, unknown> = {}, idem = "idem-" + Math.random().toString(36).slice(2, 12)) =>
  call("POST", [], { provider: "zernio", export_id: render, zernio_account_id: ACC1, title: "Canción - Artista", description: "Canción #musica", scheduled_at: inDays(1), consent: CONSENT, options: { comment: true }, ...extra }, idem);
const workerCtx = (env = ENV()): StageCtx => ({ workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "zn-")), rpc: rpcSvc as never, fetch: zernio,
  r2: { download: async (_k: string, d: string) => { writeFileSync(d, Buffer.alloc(2048)); }, upload: async () => {}, remove: async () => {} } as never, env });
const runPub = (id: string, params: Record<string, unknown> = {}, env = ENV()) => STAGE_IMPLS.publish.run(workerCtx(env), { id: "s", params: { publication_id: id, ...params } } as unknown as StageRow);
const row = async (id: string) => (await q<Record<string, unknown>>(`select state, zernio_post_id, error_code, retry_at, post_url, scheduled_at, attempts, external_id, consent, provider from publications where id='${id}'`))[0];
const sign = (body: string, secret = "whsec_test_123") => createHmac("sha256", secret).update(body).digest("hex");

before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${wsA}','upload','validated','${A}') returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','P','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`);
  for (let i = 0; i < 24; i++) {
    const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','C${i}') returning id`);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${wsA}',1,'{}','9:16','single_track','x')`);
    renders.push(await one(`insert into renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind, settings_hash, storage_path, bytes) values ('${wsA}','${clip}',1,'9:16',true,'h${i}','ready','mp4','s${i}','${wsA}/r${i}.mp4',2048) returning id`));
  }
});

test("configuración: exactamente los destinos listados, nunca más de dos, espacio y clave obligatorios", () => {
  assert.equal(zernioConfig(ENV()).ok, true);
  const three = { ...ENV(), ZERNIO_TARGETS: JSON.stringify([{ accountId: ACC1, username: "a" }, { accountId: ACC2, username: "b" }, { accountId: ACC3, username: "c" }]) };
  assert.deepEqual(zernioConfig(three), { ok: false, reason: "ZERNIO_TARGETS admite como máximo 2 destinos" });
  assert.equal(zernioConfig({ ...ENV(), ZERNIO_API_KEY: "" }).ok, false); assert.equal(zernioConfig({ ...ENV(), ZERNIO_WORKSPACE_ID: "x" }).ok, false);
  assert.equal(zernioConfig({}).ok, false);
});

test("GET /api/zernio: muestra las dos cuentas, detecta un @usuario que no coincide y avisa de conexiones de más en el equipo", async () => {
  const ok = (await (await call("GET", [], undefined, undefined, "zernio")).json()) as { targets: { username: string; ok: boolean; problems: string[] }[]; extra_connections: number; warning: string | null };
  assert.equal(ok.targets.length, 2); assert.ok(ok.targets.every((t) => t.ok), JSON.stringify(ok)); assert.equal(ok.extra_connections, 1); assert.match(ok.warning ?? "", /más cuentas/);
  health = false; const bad = (await (await call("GET", [], undefined, undefined, "zernio")).json()) as { targets: { ok: boolean; problems: string[] }[] }; health = true;
  assert.equal(bad.targets[1].ok, false); assert.match(bad.targets[1].problems.join(" "), /@otra_persona/);
  assert.ok(!JSON.stringify(ok).includes("zk_secret_test_key"), "la clave no sale nunca al navegador");
});

test("creator-info: solo para destinos autorizados; muestra @usuario y bloquea cuentas sin publicación pública", async () => {
  const r = await call("GET", ["creator-info"], undefined, undefined, "zernio"); assert.equal(r.status, 403);   // sin ?account
  const url = (acc: string) => handleIntegrations(new Request(`https://app/api/zernio/creator-info?account=${acc}`, { headers: { Authorization: `Bearer ${tokenFor(A)}` } }), "zernio", ["creator-info"], { f: fakeSupabaseFetch(db), provider: zernio, env: ENV() });
  assert.equal((await url(ACC3)).status, 403);
  const j = (await (await url(ACC1)).json()) as { username: string; nickname: string; blocker: string | null }; assert.equal(j.username, "@puntodeperreo"); assert.equal(j.blocker, null);
  mode = "no_public"; assert.match(((await (await url(ACC1)).json()) as { blocker: string }).blocker, /públicas/); mode = "ok";
});

test("publicar: tercera cuenta bloqueada, sin consentimiento rechazado, fecha vencida rechazada, otro espacio rechazado", async () => {
  assert.equal((await pub(renders[0], { zernio_account_id: ACC3 })).status, 403);
  assert.equal((await pub(renders[0], { consent: { preview_confirmed: true } })).status, 400);
  const past = await pub(renders[0], { scheduled_at: new Date(Date.now() - 5000).toISOString() }); assert.equal(past.status, 400); assert.equal(((await past.json()) as { error: { code: string } }).error.code, "schedule_in_past");
  assert.equal((await call("POST", [], { provider: "zernio", export_id: renders[0], zernio_account_id: ACC1, title: "x", scheduled_at: inDays(1), consent: CONSENT }, undefined)).status, 400);   // sin Idempotency-Key
  const other = await call("POST", [], { provider: "zernio", export_id: renders[0], zernio_account_id: ACC1, title: "x", scheduled_at: inDays(1), consent: CONSENT }, "idem-otro-espacio", "publish", { ...ENV(), ZERNIO_WORKSPACE_ID: "00000000-0000-4000-8000-000000000000" });
  assert.equal(other.status, 404);
  assert.equal((await q<{ n: number }>("select count(*)::int n from publications where provider='zernio'"))[0].n, 0);
});

test("publicar y programar: se encola al confirmar, la fecha va en UTC a Zernio, la clave no llega a la subida y el consentimiento queda registrado", async () => {
  calls = []; const when = inDays(2);
  const r = await pub(renders[1], { scheduled_at: when, options: { comment: true, duet: false, stitch: false } }, "idem-programar-1"); assert.equal(r.status, 202);
  const p = (await r.json()) as { publication_id: string; job_id: string }; assert.ok(p.job_id);
  assert.equal((await row(p.publication_id)).state, "queued"); assert.equal((await row(p.publication_id)).provider, "zernio");
  const replay = (await (await pub(renders[1], { scheduled_at: when }, "idem-programar-1")).json()) as { replay: boolean; publication_id: string }; assert.equal(replay.replay, true); assert.equal(replay.publication_id, p.publication_id);
  assert.equal((await pub(renders[1], { scheduled_at: when }, "idem-otra-clave-2")).status, 409, "mismo vídeo y cuenta: duplicado");
  await runPub(p.publication_id);
  const x = await row(p.publication_id); assert.equal(x.state, "scheduled"); assert.match(String(x.zernio_post_id), /^zp_/); assert.equal(x.external_id, p.publication_id);
  assert.equal((x.consent as Record<string, unknown>).express_consent, true); assert.ok((x.consent as Record<string, unknown>).user);
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!; const b = post.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(post.headers["Idempotency-Key"], p.publication_id); assert.equal(b.scheduledFor, new Date(when).toISOString()); assert.equal(b.publishNow, undefined);
  assert.equal(b.tiktokSettings.privacy_level, "PUBLIC_TO_EVERYONE"); assert.equal(b.tiktokSettings.draft, false); assert.equal(b.tiktokSettings.allow_comment, true); assert.equal(b.tiktokSettings.allow_duet, false);
  assert.equal(b.tiktokSettings.express_consent_given, true); assert.equal(b.tiktokSettings.content_preview_confirmed, true); assert.equal(b.platforms.length, 1); assert.equal(b.platforms[0].accountId, ACC1); assert.equal(b.externalId, p.publication_id);
  const put = calls.find((c) => c.method === "PUT")!; assert.equal(put.headers.Authorization, undefined, "la clave de API no se envía al uploadUrl"); assert.equal(put.headers["Content-Type"], "video/mp4");
  assert.ok(calls.filter((c) => c.url.startsWith("https://zernio.com")).every((c) => c.headers.Authorization === "Bearer zk_secret_test_key_123"));
  // Una segunda ejecución no reenvía; y enqueue_due_publications no vuelve a enviar la ya programada en Zernio aunque venza.
  calls = []; await runPub(p.publication_id); assert.equal(calls.length, 0);
  await db.exec(`update publications set scheduled_at = now() - interval '1 minute' where id='${p.publication_id}'`);
  assert.equal(await rpcSvc<number>("enqueue_due_publications"), 0); assert.equal((await row(p.publication_id)).state, "scheduled");
});

test("fecha que vence antes de llamar a Zernio: no se envía (evita una publicación inmediata no deseada)", async () => {
  const r = (await (await pub(renders[2], { scheduled_at: inDays(1) })).json()) as { publication_id: string };
  await db.exec(`update publications set scheduled_at = now() + interval '5 seconds' where id='${r.publication_id}'`); calls = [];
  await runPub(r.publication_id);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0); const x = await row(r.publication_id); assert.equal(x.state, "failed"); assert.equal(x.error_code, "schedule_in_past");
});

test("«Publicar ahora» es una acción explícita: envía publishNow y queda en proceso", async () => {
  calls = []; const r = (await (await pub(renders[3], { publish_now: true, scheduled_at: undefined })).json()) as { publication_id: string }; await runPub(r.publication_id);
  assert.equal(((calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!.body) as { publishNow: boolean }).publishNow, true); assert.equal((await row(r.publication_id)).state, "processing");
});

test("límite de Zernio (429): sigue pendiente con reintento programado y la clave de idempotencia no cambia; 402 detiene el envío sin tarjeta", async () => {
  const r = (await (await pub(renders[4])).json()) as { publication_id: string };
  mode = "rate"; await runPub(r.publication_id); let x = await row(r.publication_id);
  assert.equal(x.state, "queued"); assert.equal(x.error_code, "zernio_hold"); assert.ok(x.retry_at); assert.equal(x.attempts, 1);
  mode = "ok"; await db.exec(`update publications set retry_at = now() - interval '1 second' where id='${r.publication_id}'`);
  assert.equal(await rpcSvc<number>("enqueue_due_publications"), 1);
  calls = []; await runPub(r.publication_id, { attempt: 1 }); x = await row(r.publication_id); assert.equal(x.state, "scheduled");
  assert.equal(calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!.headers["Idempotency-Key"], r.publication_id);
  const p2 = (await (await pub(renders[5])).json()) as { publication_id: string }; mode = "payment"; await runPub(p2.publication_id); mode = "ok";
  const y = await row(p2.publication_id); assert.equal(y.state, "failed"); assert.equal(y.error_code, "zernio_payment");
});

test("resultado indeterminado (red): se reintenta con la misma clave y, pasadas 23 h, no se reenvía sin conciliación", async () => {
  const r = (await (await pub(renders[6])).json()) as { publication_id: string };
  mode = "net"; await runPub(r.publication_id); mode = "ok"; let x = await row(r.publication_id); assert.equal(x.error_code, "zernio_indeterminate"); assert.equal(x.state, "queued");
  await db.exec(`update publications set created_at = now() - interval '25 hours' where id='${r.publication_id}'`); calls = [];
  await runPub(r.publication_id, { attempt: 1 }); x = await row(r.publication_id);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0); assert.equal(x.error_code, "zernio_reconcile"); assert.equal(x.state, "failed");
});

test("cuenta que no admite publicación pública: no se sube nada y se explica el motivo", async () => {
  const r = (await (await pub(renders[7])).json()) as { publication_id: string };
  mode = "no_public"; calls = []; await runPub(r.publication_id); mode = "ok";
  assert.equal(calls.filter((c) => c.method === "PUT" || c.url.endsWith("/posts")).length, 0); assert.equal((await row(r.publication_id)).error_code, "account_cannot_post");
});

test("cancelar propaga a Zernio; si ya estaba publicada se refleja el resultado real", async () => {
  const a = (await (await pub(renders[8])).json()) as { publication_id: string }; await runPub(a.publication_id);
  const c = await call("POST", [a.publication_id, "cancel"], {}); assert.equal(c.status, 200); const cj = (await c.json()) as { job_id?: string }; assert.ok(cj.job_id, "se encola la cancelación en Zernio");
  assert.equal((await row(a.publication_id)).state, "cancelled"); calls = []; await runPub(a.publication_id, { action: "cancel" });
  assert.equal(calls.filter((x) => x.method === "DELETE").length, 1); assert.equal((await row(a.publication_id)).state, "cancelled");
  const b = (await (await pub(renders[9])).json()) as { publication_id: string }; await runPub(b.publication_id);
  await call("POST", [b.publication_id, "cancel"], {}); mode = "published_on_delete_400"; await runPub(b.publication_id, { action: "cancel" }); mode = "ok";
  assert.equal((await row(b.publication_id)).state, "published");
  const d = (await (await pub(renders[10])).json()) as { publication_id: string }; await call("POST", [d.publication_id, "cancel"], {});   // aún sin enviar: no hay nada que borrar en Zernio
  calls = []; await runPub(d.publication_id); assert.equal(calls.filter((x) => x.method === "POST").length, 0, "una publicación cancelada no se envía");
});

test("límite de 15 vídeos por cuenta en 24 h: el 16.º se rechaza con daily_cap y otra cuenta no se ve afectada", async () => {
  const day = Date.parse(inDays(20));
  for (let i = 2; i < 17; i++) assert.equal((await pub(renders[i], { zernio_account_id: ACC2, scheduled_at: new Date(day + i * 60000).toISOString() })).status, 202, `vídeo ${i}`);
  const over = await pub(renders[0], { zernio_account_id: ACC2, scheduled_at: new Date(day + 30 * 60000).toISOString() });
  assert.equal(over.status, 409); assert.equal(((await over.json()) as { error: { code: string } }).error.code, "daily_cap");
  assert.equal((await pub(renders[0], { zernio_account_id: ACC1, scheduled_at: new Date(day + 30 * 60000).toISOString() })).status, 202);
});

test("webhook: firma obligatoria, deduplicado por id de evento, «Publicada · enlace pendiente» hasta recibir url_resolved", async () => {
  const r = (await (await pub(renders[1], { zernio_account_id: ACC2, scheduled_at: inDays(9) }, "idem-webhook-1")).json()) as { publication_id: string }; await runPub(r.publication_id);
  const zp = String((await row(r.publication_id)).zernio_post_id);
  const ev = (id: string, event: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, event, timestamp: new Date().toISOString(), post: { id: zp, status: "published" }, platform: { name: "tiktok", status: "published" }, ...extra });
  const send = (body: string, sig = sign(body)) => handleZernioEvent(rpcSvc as never, ENV(), { body, signature: sig });
  assert.equal((await send(ev("e1", "post.published"), "00")).http, 401); assert.equal((await send(ev("e1", "post.published"), "")).http, 401);
  assert.equal((await handleZernioEvent(rpcSvc as never, { ...ENV(), ZERNIO_WEBHOOK_SECRET: "" }, { body: "{}", signature: "x" })).http, 503);
  assert.equal((await send(ev("e1", "post.published"))).result, "applied"); let x = await row(r.publication_id); assert.equal(x.state, "published"); assert.equal(x.post_url, null);
  assert.equal((await send(ev("e1", "post.published"))).result, "duplicate", "el mismo id de evento no se aplica dos veces");
  const url = "https://www.tiktok.com/@telodedico.music/video/123456789";
  assert.equal((await send(ev("e2", "post.tiktok.url_resolved", { platform: { name: "tiktok", status: "published", publishedUrl: url } }))).result, "applied");
  x = await row(r.publication_id); assert.equal(x.post_url, url); assert.equal(x.state, "published");
  assert.equal((await send(ev("e3", "post.failed", { platform: { name: "tiktok", error: "x" } }))).result, "applied");
  assert.equal((await send(JSON.stringify({ id: "e4", event: "post.published", post: { id: "zp_desconocido" }, platform: { name: "tiktok" } }))).result, "unknown_post");
  assert.equal((await send(JSON.stringify({ id: "e5", event: "post.published", post: { id: zp }, platform: { name: "instagram" } }))).result, "ignored");
  assert.equal(verifySignature("{}", sign("{}"), "whsec_test_123"), true); assert.equal(eventToUpdate({ id: "z", event: "account.disconnected" }), null);
});

test("seguridad de funciones: el worker (service_role) sí; un usuario no puede ejecutar finish_zernio ni zernio_event", async () => {
  const names = ["finish_zernio", "zernio_event", "publication_job", "enqueue_due_publications"];
  const rows = await q<{ n: string; auth: boolean; anon: boolean; svc: boolean }>(`select p.proname n, has_function_privilege('authenticated', p.oid,'execute') auth, has_function_privilege('anon', p.oid,'execute') anon, has_function_privilege('service_role', p.oid,'execute') svc from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in (${names.map((n) => `'${n}'`).join(",")})`);
  assert.equal(rows.length, 4); for (const x of rows) { assert.equal(x.auth, false, x.n); assert.equal(x.anon, false, x.n); assert.equal(x.svc, true, x.n); }
  const cl = await q<{ auth: boolean; anon: boolean }>(`select has_function_privilege('authenticated', p.oid,'execute') auth, has_function_privilege('anon', p.oid,'execute') anon from pg_proc p where p.proname='request_zernio_publication'`);
  assert.deepEqual(cl[0], { auth: true, anon: false });
});
