// Importación (guarda SSRF, límites, R2 por partes) y publicación (YouTube/TikTok, programación) con fetch, DNS y R2 simulados. Sin red.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { PGlite } from "@electric-sql/pglite";
import { authUrl, SCOPES, PROVIDER_OF } from "@rafaga/providers/oauth";
import { providerConfig, isCap } from "./oauthserver.ts";
import { freshDb, A } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "../../../supabase/tests/fake-supabase.ts";
import { handleIntegrations } from "./routes/integrations.ts";
import { STAGE_IMPLS, TIKTOK_UNAUDITED } from "../../../workers/media/src/stages/integrations.ts";
import type { StageCtx, StageRow } from "../../../workers/media/src/stages/registry.ts";

let db: PGlite, wsA: string, render: string;
const woken: string[] = [];
const NET = { resolve: async (h: string) => (h === "intranet.example.com" ? ["10.0.0.5"] : h === "evil.example.com" ? ["93.184.216.34"] : ["93.184.216.34"]),
  head: async (u: string) => (u.startsWith("https://evil.example.com") ? { status: 302, location: "https://intranet.example.com/x" } : { status: 200, location: null }) };
const call = (method: string, integration: string, rest: string[], body?: unknown, idem?: string) => {
  const req = new Request(`https://app/api/${integration}/${rest.join("/")}`, { method, headers: { Authorization: `Bearer ${tokenFor(A)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return handleIntegrations(req, integration, rest, { f: fakeSupabaseFetch(db), net: NET, wake: (_r, j) => woken.push(j) });
};
const rpcSvc = async <T>(fn: string, a: Record<string, unknown> = {}): Promise<T> => {
  const r = await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(a) });
  const j = await r.json(); if (!r.ok) throw new Error((j as { message: string }).message); return j as T;
};
const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const jobs = async () => (await q<{ n: number }>("select count(*)::int n from jobs"))[0].n;
const row = (params: Record<string, unknown>) => ({ id: "s", params } as unknown as StageRow);
const uploads: { key: string; type: string }[] = [];
const ctxWith = (extra: Partial<StageCtx> = {}): StageCtx => ({ workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "int-")), rpc: rpcSvc as never,
  r2: { download: async (_k: string, dest: string) => { writeFileSync(dest, Buffer.alloc(2048)); }, upload: async (key: string, _f: string, type: string) => { uploads.push({ key, type }); }, remove: async () => {} }, env: {}, ...extra }) as StageCtx;
const open = (headers: Record<string, string>, chunks: Buffer[] = [Buffer.alloc(1000)], status = 200) => async () => ({ status, headers, stream: Readable.from(chunks) as never, finalUrl: "https://cdn.example.com/a.mp4" });

before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${wsA}','upload','validated','${A}') returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','P','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`);
  const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','C') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${wsA}',1,'{}','9:16','single_track','x')`);
  render = await one(`insert into renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind, settings_hash, storage_path, bytes)
    values ('${wsA}','${clip}',1,'9:16',true,'h','ready','mp4','h','${wsA}/${clip}/v1-h.mp4',2048) returning id`);
});

test("enlace: http, IP privada y redirección a un rango privado → 400 {reason} sin crear trabajo", async () => {
  const before = await jobs();
  for (const [url, reason] of [["http://cdn.example.com/a.mp4", "not_https"], ["https://intranet.example.com/a.mp4", "private_address"], ["https://127.0.0.1/a.mp4", "private_address"], ["https://evil.example.com/a.mp4", "redirect_private"]] as const) {
    const r = await call("POST", "import", ["link"], { url }, "import-key-" + reason);
    assert.equal(r.status, 400, url); assert.equal(((await r.json()) as { reason: string }).reason, reason, url);
  }
  assert.equal(await jobs(), before); assert.equal((await q<{ n: number }>("select count(*)::int n from imports"))[0].n, 0);
  assert.equal((await call("POST", "import", ["link"], { url: "https://cdn.example.com/a.mp4" })).status, 400, "sin Idempotency-Key");
  assert.equal((await call("POST", "nada", [], {})).status, 404); assert.equal((await call("POST", "import", ["ftp"], {}, "import-key-ftp1")).status, 404);
});

test("import: supera 4 GiB → too_large y tipo que no es vídeo → unsupported_file, sin escribir en R2", async () => {
  const mk = async (n: string) => { const r = await call("POST", "import", ["link"], { url: `https://cdn.example.com/${n}.mp4` }, `import-key-${n}0`); assert.equal(r.status, 202); return (await r.json()) as { import_id: string }; };
  uploads.length = 0;
  const big = await mk("big");
  await assert.rejects(STAGE_IMPLS.import.run(ctxWith({ deps: { openUrl: open({ "content-length": "4294967297", "content-type": "video/mp4" }) } }), row({ import_id: big.import_id })), { code: "too_large" });
  const html = await mk("html");
  await assert.rejects(STAGE_IMPLS.import.run(ctxWith({ deps: { openUrl: open({ "content-type": "text/html" }) } }), row({ import_id: html.import_id })), { code: "unsupported_file" });
  assert.deepEqual(uploads, []);
  assert.deepEqual((await q<{ state: string; error_code: string }>(`select state, error_code from imports where id in ('${big.import_id}','${html.import_id}') order by error_code`)).map((x) => x.error_code), ["too_large", "unsupported_file"]);
});

test("import válido: sube a R2, registra el objeto y la fuente queda lista para validate/mezzanine/proxy", async () => {
  uploads.length = 0;
  const r = await call("POST", "import", ["link"], { url: "https://cdn.example.com/ok.mp4", name: "Mi enlace" }, "import-key-ok-01");
  const b = (await r.json()) as { import_id: string; job_id: string; source_id: string }; assert.equal(r.status, 202); assert.ok(woken.includes(b.job_id));
  assert.deepEqual((await q<{ stage: string }>(`select stage from job_stages where job_id='${b.job_id}' order by seq`)).map((x) => x.stage), ["import", "validate", "mezzanine", "proxy"]);
  const out = await STAGE_IMPLS.import.run(ctxWith({ deps: { openUrl: open({ "content-length": "1000", "content-type": "video/mp4" }) } }), row({ import_id: b.import_id }));
  assert.equal(out.output.bytes, 1000);
  const [s] = await q<{ status: string; storage_path: string; bytes: string }>(`select status, storage_path, bytes from sources where id='${b.source_id}'`);
  assert.equal(s.status, "uploaded"); assert.deepEqual(uploads, [{ key: s.storage_path, type: "video/mp4" }]);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from storage_objects where key='${s.storage_path}'`))[0].n, 1);
  const again = await call("POST", "import", ["link"], { url: "https://cdn.example.com/ok.mp4" }, "import-key-ok-01");
  assert.equal(((await again.json()) as { replay: boolean }).replay, true);
});

const connect = async (provider: string, token = "token-de-prueba-123456") => db.exec(`insert into oauth_connections(workspace_id, provider, scopes, access_token, status, created_by) values ('${wsA}','${provider}','{}','${token}','connected','${A}') on conflict (workspace_id, provider) do nothing`);
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

test("YouTube: privacidad elegida (private por defecto) y private_pending_review si la respuesta la deja en privado", async () => {
  await connect("google");
  const sent: { privacyStatus?: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("uploadType=resumable")) { sent.push((JSON.parse(String(init!.body)) as { status: { privacyStatus: string } }).status); return new Response(null, { status: 200, headers: { location: "https://up.example.com/u1" } }); }
    return json({ id: "yt-vid-1", status: { privacyStatus: "private" } });
  }) as unknown as typeof fetch;
  const def = await call("POST", "publish", [], { export_id: render, platform: "youtube", title: "Mi clip" }, "publish-key-yt-1");
  const d = (await def.json()) as { publication_id: string; state: string }; assert.equal(def.status, 202); assert.equal(d.state, "queued");
  assert.equal((await q<{ privacy: string }>(`select privacy from publications where id='${d.publication_id}'`))[0].privacy, "private");
  let o = await STAGE_IMPLS.publish.run(ctxWith({ fetch: f }), row({ publication_id: d.publication_id }));
  assert.equal(sent[0].privacyStatus, "private"); assert.equal(o.output.state, "published");
  const pub = await call("POST", "publish", [], { export_id: render, platform: "youtube", title: "Público", privacy: "public" }, "publish-key-yt-2");
  const p = (await pub.json()) as { publication_id: string };
  o = await STAGE_IMPLS.publish.run(ctxWith({ fetch: f }), row({ publication_id: p.publication_id }));
  assert.equal(sent[1].privacyStatus, "public"); assert.equal(o.output.state, "private_pending_review");
  assert.equal((await q<{ state: string; external_id: string }>(`select state, external_id from publications where id='${p.publication_id}'`))[0].state, "private_pending_review");
  assert.equal((await call("POST", "publish", [], { export_id: render, platform: "youtube", title: "x", privacy: "SELF_ONLY" }, "publish-key-yt-3")).status, 400);
});

test("TikTok sin auditar → requiere_auditoria y el privacy_level enviado es uno de privacy_level_options", async () => {
  await connect("tiktok");
  const levels: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("creator_info")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
    if (String(url).includes("video/init")) { levels.push((JSON.parse(String(init!.body)) as { post_info: { privacy_level: string } }).post_info.privacy_level); return json({ error: { code: TIKTOK_UNAUDITED, message: "x" } }, 403); }
    throw new Error("no debería llamarse " + url);
  }) as unknown as typeof fetch;
  const r = await call("POST", "publish", [], { export_id: render, platform: "tiktok", title: "TT", privacy: "PUBLIC_TO_EVERYONE" }, "publish-key-tt-1");
  const p = (await r.json()) as { publication_id: string };
  const o = await STAGE_IMPLS.publish.run(ctxWith({ fetch: f }), row({ publication_id: p.publication_id }));
  assert.equal(o.output.state, "requiere_auditoria"); assert.deepEqual(levels, ["SELF_ONLY"]);
  const [s] = await q<{ state: string; error_message: string }>(`select state, error_message from publications where id='${p.publication_id}'`);
  assert.equal(s.state, "requiere_auditoria"); assert.match(s.error_message, /auditor/i);
});

test("TikTok con cuenta auditada: init FILE_UPLOAD, PUT y status/fetch hasta PUBLISH_COMPLETE", async () => {
  const seen: string[] = [];
  const f = (async (url: string) => {
    const u = String(url); seen.push(u.split("/").slice(-2, -1)[0] ?? u);
    if (u.includes("creator_info")) return json({ data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] }, error: { code: "ok" } });
    if (u.includes("video/init")) return json({ data: { publish_id: "pub1", upload_url: "https://upload.example.com/tt" }, error: { code: "ok" } });
    if (u.includes("upload.example.com")) return new Response(null, { status: 201 });
    return json({ data: { status: "PUBLISH_COMPLETE" } });
  }) as unknown as typeof fetch;
  const r = await call("POST", "publish", [], { export_id: render, platform: "tiktok", title: "TT2", privacy: "PUBLIC_TO_EVERYONE" }, "publish-key-tt-2");
  const o = await STAGE_IMPLS.publish.run(ctxWith({ fetch: f }), row({ publication_id: ((await r.json()) as { publication_id: string }).publication_id }));
  assert.equal(o.output.state, "published"); assert.equal(o.output.external_id, "pub1");
});

test("programada a futuro: queda en scheduled sin llamar a la plataforma hasta que enqueue_due_publications() la encuentra vencida", async () => {
  const before = await jobs();
  const r = await call("POST", "publish", [], { export_id: render, platform: "youtube", title: "Luego", scheduled_at: new Date(Date.now() + 3600_000).toISOString() }, "publish-key-sch-1");
  const p = (await r.json()) as { publication_id: string; state: string; job_id: string | null };
  assert.equal(p.state, "scheduled"); assert.equal(p.job_id, null); assert.equal(await jobs(), before);
  assert.equal(await rpcSvc<number>("enqueue_due_publications"), 0);
  await db.exec(`update publications set scheduled_at = now() - interval '1 minute' where id = '${p.publication_id}'`);
  assert.equal(await rpcSvc<number>("enqueue_due_publications"), 1);
  const [s] = await q<{ state: string; job_id: string | null }>(`select state, job_id from publications where id='${p.publication_id}'`);
  assert.equal(s.state, "queued"); assert.ok(s.job_id); assert.equal(await jobs(), before + 1);
  assert.equal(await rpcSvc<number>("enqueue_due_publications"), 0, "no se encola dos veces");
});

test("conexión: publish_youtube usa GOOGLE_* y youtube.upload; publish_tiktok usa TIKTOK_CLIENT_KEY y video.publish", async () => {
  assert.deepEqual(SCOPES.publish_youtube, ["https://www.googleapis.com/auth/youtube.upload"]); assert.deepEqual(SCOPES.publish_tiktok, ["video.publish"]);
  assert.match(authUrl("tiktok", { clientId: "ck1", redirectUri: "https://app/cb", scopes: SCOPES.publish_tiktok, state: "s", challenge: "c" }), /client_key=ck1.*scope=video\.publish/);
  const env = process.env, saved = { ...env };
  Object.assign(env, { GOOGLE_CLIENT_ID: "gid-1234", GOOGLE_CLIENT_SECRET: "gsec-1234", TIKTOK_CLIENT_KEY: "tkey-1234", TIKTOK_CLIENT_SECRET: "tsec-1234" });
  try {
    for (const [cap, id, scope, param] of [["publish_tiktok", "tkey-1234", "video.publish", "client_key"], ["publish_youtube", "gid-1234", "https://www.googleapis.com/auth/youtube.upload", "client_id"]] as const) {
      assert.ok(isCap(cap)); const provider = PROVIDER_OF[cap], cfg = providerConfig(provider);
      assert.equal(cfg?.clientId, id);
      const u = new URL(authUrl(provider, { clientId: cfg!.clientId, redirectUri: "https://app/cb", scopes: SCOPES[cap], state: "st", challenge: "ch" }));
      assert.equal(u.searchParams.get(param), id); assert.equal(u.searchParams.get("scope"), scope);
    }
  } finally { for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; } }
});
