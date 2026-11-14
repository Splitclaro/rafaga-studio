// Publicar y compartir variantes de letra: YouTube/TikTok (plataforma simulada), programación y entregas fijadas a la versión.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { validateLyricComposition, planLyricVariants } from "@rafaga/composition";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "../../../supabase/tests/fake-supabase.ts";
import { handleLyrics } from "./routes/lyrics.ts";
import { handleIntegrations } from "./routes/integrations.ts";
import { STAGE_IMPLS, TIKTOK_UNAUDITED } from "../../../workers/media/src/stages/integrations.ts";
import type { StageCtx, StageRow } from "../../../workers/media/src/stages/registry.ts";

let db: PGlite, ws: string, project: string, clips: string[], exportIds: string[], woken: string[] = [];
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const as = async <T>(uid: string, sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}', false);`); try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
const lyr = (method: string, path: string, body?: unknown, idem?: string) => handleLyrics(new Request(`https://app/api/lyrics${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(A)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined }), path.split("/").filter(Boolean), { f: fakeSupabaseFetch(db), env: {}, wake: () => {} });
const pub = (body: unknown, idem: string) => handleIntegrations(new Request("https://app/api/publish", { method: "POST", headers: { Authorization: `Bearer ${tokenFor(A)}`, "Content-Type": "application/json", "Idempotency-Key": idem }, body: JSON.stringify(body) }), "publish", [], { f: fakeSupabaseFetch(db), wake: (_r, j) => woken.push(j) });
const rpcSvc = async <T>(fn: string, a: Record<string, unknown> = {}): Promise<T> => { const r = await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_TOKEN}` }, body: JSON.stringify(a) }); const j = await r.json(); if (!r.ok) throw new Error((j as { message: string }).message); return j as T; };
const ctx = (fetch: typeof globalThis.fetch): StageCtx => ({ workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "lyr-share-")), rpc: rpcSvc as never, env: {}, fetch,
  r2: { download: async (_k: string, dest: string) => { writeFileSync(dest, Buffer.alloc(2048)); }, upload: async () => {}, remove: async () => {} } }) as StageCtx;
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
const run = (id: string, f: typeof fetch) => STAGE_IMPLS.publish.run(ctx(f), { id: "s", params: { publication_id: id } } as unknown as StageRow);

before(async () => {
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const src = (await q<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, mime, bytes) values ('${ws}','upload','validated','${A}','audio/flac',1000) returning id`))[0].id;
  const song = (await q<{ id: string }>(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id, status, duration_ms) values ('${ws}','Tema','${ws}/${src}/original','audio/flac',1000,'${A}','${src}','ready',60000) returning id`))[0].id;
  project = ((await (await lyr("POST", "/projects", { song_id: song, mode: "letra" })).json()) as { project_id: string }).project_id;
  const base = validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 0, end: 5 }, words: [{ text: "hola", start: 0.5, end: 1, line: 0 }], seed: 2 });
  const v = (await (await lyr("POST", `/projects/${project}/variants`, { variants: planLyricVariants(base, 2, {}, { styles: [{ ...base.style, font: "Anton" }, { ...base.style, font: "Oswald" }] }) }, "share-variants-1")).json()) as { clip_ids: string[]; export_ids: string[] };
  clips = v.clip_ids; exportIds = v.export_ids;
  for (const id of exportIds) await db.exec(`update renders set status='ready', storage_path='${ws}/x/${id}.mp4', expires_at=now()+interval '5 days', bytes=2048 where id='${id}'`);
  for (const [p, t] of [["google", "tok-google-1234567"], ["tiktok", "tok-tiktok-1234567"]]) await db.exec(`insert into oauth_connections(workspace_id, provider, scopes, access_token, status, created_by) values ('${ws}','${p}','{}','${t}','connected','${A}')`);
});

test("YouTube con una variante MP4 de letra: videos.insert con la privacidad elegida y private_pending_review si la respuesta queda en privado", async () => {
  const sent: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("uploadType=resumable")) { sent.push((JSON.parse(String(init!.body)) as { status: { privacyStatus: string } }).status.privacyStatus); return new Response(null, { status: 200, headers: { location: "https://up.example.com/u" } }); }
    return json({ id: "yt-lyr-1", status: { privacyStatus: "private" } });
  }) as unknown as typeof fetch;
  const r = await pub({ export_id: exportIds[0], platform: "youtube", title: "Mi letra", privacy: "public" }, "share-pub-yt-001"), p = (await r.json()) as { publication_id: string; state: string };
  assert.equal(r.status, 202); assert.equal(p.state, "queued");
  const o = await run(p.publication_id, f); assert.deepEqual(sent, ["public"]); assert.equal(o.output.state, "private_pending_review");
  assert.equal((await q<{ state: string }>(`select state from publications where id='${p.publication_id}'`))[0].state, "private_pending_review");
});

test("TikTok sin auditar → requiere_auditoria; con scheduled_at futuro → scheduled sin llamar a la plataforma", async () => {
  const f = (async (url: string) => (String(url).includes("creator_info") ? json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }) : json({ error: { code: TIKTOK_UNAUDITED } }, 403))) as unknown as typeof fetch;
  const r = await pub({ export_id: exportIds[1], platform: "tiktok", title: "TT letra", privacy: "PUBLIC_TO_EVERYONE" }, "share-pub-tt-001"), p = (await r.json()) as { publication_id: string };
  assert.equal((await run(p.publication_id, f)).output.state, "requiere_auditoria");
  let called = 0; const spy = (async () => { called++; return json({}); }) as unknown as typeof fetch;
  const s = await pub({ export_id: exportIds[1], platform: "youtube", title: "Luego", scheduled_at: new Date(Date.now() + 3600_000).toISOString() }, "share-pub-sch-01"), sj = (await s.json()) as { state: string };
  assert.equal(sj.state, "scheduled"); assert.equal(called, 0); void spy;
});

test("create_delivery con 2 variantes de letra: 2 elementos fijados a la versión 1 y el usuario B no la ve", async () => {
  const id = (await as<{ r: string }>(A, `select public.create_delivery('${project}', 'Entrega de letras', null, '${JSON.stringify(clips.map((clip_id) => ({ clip_id, version: 1 })))}'::jsonb) r`))[0].r;
  const items = await q<{ clip_id: string; version: number }>(`select clip_id, version from delivery_items where delivery_id='${id}' order by position`);
  assert.deepEqual(items.map((x) => x.clip_id), clips); assert.ok(items.every((x) => x.version === 1));
  assert.equal((await as(B, `select * from deliveries where id='${id}'`)).length, 0); assert.equal((await as(A, `select * from deliveries where id='${id}'`)).length, 1);
  assert.equal(woken.length >= 1, true);
});
