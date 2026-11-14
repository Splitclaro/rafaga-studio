// Ciclo de vida: candidatos a purga, purga con R2 simulado y cuota, papelera/restauración, resumen de uso y métricas de producto.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "../../../supabase/tests/fake-supabase.ts";
import { purge } from "./stages/purge.ts";
import { main } from "./stage.ts";
import type { Rpc } from "./stages/registry.ts";

let db: PGlite, ws: string;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
const rpcAs = async (token: string, fn: string, a: Record<string, unknown> = {}) => {
  if (fn === "purge_candidates") {   // función que devuelve tabla: PostgREST entrega un array; el simulador solo la primera fila
    await db.exec("set role service_role");
    try { return { ok: true, status: 200, message: undefined, data: (await db.query(`select * from public.purge_candidates(${Number(a.p_limit ?? 500)})`)).rows as never }; } finally { await db.exec("reset role"); }
  }
  const r = await fakeSupabaseFetch(db)(`https://x/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(a) });
  const j = await r.json(); return { ok: r.ok, status: r.status, data: j as never, message: (j as { message?: string }).message };
};
const svc: Rpc = (async (fn: string, a: Record<string, unknown> = {}) => { const r = await rpcAs(SERVICE_TOKEN, fn, a); if (!r.ok) throw new Error(r.message); return r.data; }) as Rpc;
const obj = (key: string, kind: string, bytes: number, extra: { project?: string; source?: string; expires?: string } = {}) =>
  db.exec(`insert into storage_objects(workspace_id, key, bytes, kind, project_id, source_id, expires_at) values ('${ws}','${ws}/${key}',${bytes},'${kind}',${extra.project ? `'${extra.project}'` : "null"},${extra.source ? `'${extra.source}'` : "null"},${extra.expires ? `'${extra.expires}'` : "null"})`);
let projOk: string, srcOk: string, projTrash: string, srcTrash: string;

before(async () => {
  ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const mk = async (name: string) => { const s = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${ws}','upload','validated','${A}') returning id`);
    const p = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${ws}','${s}','${name}','${A}') returning id`); return [s, p]; };
  [srcOk, projOk] = await mk("Vivo"); [srcTrash, projTrash] = await mk("Papelera");
  await obj("ok/original", "original", 1000, { project: projOk, source: srcOk });
  await obj("ok/mezzanine.mp4", "mezzanine", 400, { project: projOk, source: srcOk });
  await obj("ok/proxy.mp4", "proxy", 100, { project: projOk, source: srcOk });
  await obj("ok/exp-old.mp4", "export", 50, { project: projOk, expires: "2020-01-01" });
  await obj("ok/exp-new.mp4", "export", 60, { project: projOk, expires: "2999-01-01" });
  await obj("tr/mezzanine.mp4", "mezzanine", 300, { project: projTrash, source: srcTrash });
  await obj("tr/proxy.mp4", "proxy", 80, { project: projTrash, source: srcTrash });
});

test("purge_candidates: original con mezzanine, exportaciones vencidas y papelera vencida; nunca proxy ni mezzanine de un proyecto vivo", async () => {
  const keys = async () => ((await rpcAs(SERVICE_TOKEN, "purge_candidates", { p_limit: 100 })).data as { key: string; reason: string }[]).map((c) => c.key.replace(`${ws}/`, "")).sort();
  assert.deepEqual(await keys(), ["ok/exp-old.mp4", "ok/original"]);
  await db.exec(`update projects set deleted_at = now() - interval '31 days', purge_at = now() - interval '1 day' where id = '${projTrash}'`);
  assert.deepEqual(await keys(), ["ok/exp-old.mp4", "ok/original", "tr/mezzanine.mp4", "tr/proxy.mp4"]);
});

test("purge borra en el R2 simulado (404 cuenta como borrado), llama a mark_purged y la cuota baja exactamente en sus bytes", async () => {
  const before = Number((await rpcAs(SERVICE_TOKEN, "storage_used", { p_ws: ws })).data);
  const removed: string[] = [];
  const r2 = { download: async () => {}, upload: async () => {}, remove: async (ks: string[]) => { removed.push(...ks); } };
  const out = await purge(svc, { r2 });
  assert.equal(out.purged, 4); assert.equal(out.bytes, 1000 + 50 + 300 + 80);
  assert.equal(removed.length, 4);
  assert.equal(Number((await rpcAs(SERVICE_TOKEN, "storage_used", { p_ws: ws })).data), before - 1430);
  assert.equal((await q<{ n: number }>("select count(*)::int n from storage_objects where purged_at is not null"))[0].n, 4);
  assert.equal((await purge(svc, { r2 })).purged, 0, "segunda pasada: nada que hacer");
});

test("si el borrado en R2 falla, nada se marca como purgado (se reintenta)", async () => {
  await obj("ok/exp-old2.mp4", "export", 70, { project: projOk, expires: "2020-01-01" });
  const r2 = { download: async () => {}, upload: async () => {}, remove: async () => { throw new Error("R2 caído"); } };
  await assert.rejects(purge(svc, { r2 }), /R2 caído/);
  assert.equal((await q<{ n: number }>("select count(*)::int n from storage_objects where key like '%exp-old2%' and purged_at is null"))[0].n, 1);
  await purge(svc, { r2: { download: async () => {}, upload: async () => {}, remove: async () => {} } });
});

test("--purge sin R2 configurado sale con 1 y no marca nada", async () => {
  await obj("ok/exp-old3.mp4", "export", 10, { project: projOk, expires: "2020-01-01" });
  const errs: string[] = [];
  assert.equal(await main(["--purge"], { rpc: svc, env: {}, out: () => {}, err: (s) => errs.push(s) }), 1);
  assert.match(errs.join(""), /not_configured/);
  assert.equal((await q<{ n: number }>("select count(*)::int n from storage_objects where key like '%exp-old3%' and purged_at is null"))[0].n, 1);
});

test("papelera: purge_at = deleted_at + 30 días; restaurar antes de esa fecha devuelve el proyecto con sus clips y versiones", async () => {
  const [s, p] = [await one(`insert into sources(workspace_id, kind, status, created_by) values ('${ws}','upload','validated','${A}') returning id`), null as string | null];
  const pid = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${ws}','${s}','Restaurable','${A}') returning id`); void p;
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${ws}','${s}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${ws}','${pid}','${tid}','r','m') returning id`);
  const clip = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${ws}','${pid}','${gen}','C') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${clip}','${ws}',1,'{}','9:16','single_track','x')`);
  const t = await rpcAs(tokenFor(A), "trash_project", { p_project: pid }); assert.ok(t.ok);
  const [row] = await q<{ days: number }>(`select round(extract(epoch from purge_at - deleted_at) / 86400)::int days from projects where id='${pid}'`);
  assert.equal(row.days, 30);
  assert.equal((await rpcAs(tokenFor(B), "restore_project", { p_project: pid })).status, 404);
  assert.ok((await rpcAs(tokenFor(A), "restore_project", { p_project: pid })).ok);
  const [back] = await q<{ deleted_at: string | null; purge_at: string | null }>(`select deleted_at, purge_at from projects where id='${pid}'`);
  assert.equal(back.deleted_at, null); assert.equal(back.purge_at, null);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from clip_versions where clip_id='${clip}'`))[0].n, 1);
});

test("storage_summary: uso, cuota de 10 GiB, saldo, cómputo y caducidades; el usuario B recibe not_found", async () => {
  await db.exec(`select public.grant_units('${ws}', 5, 'pruebas', 'grant-life-0001')`);
  const r = await rpcAs(tokenFor(A), "storage_summary", { p_ws: ws }); assert.ok(r.ok);
  const s = r.data as { used_bytes: number; quota_bytes: number; units_balance: number; compute: { budget_usd: number }; expiring: { key: string }[] };
  assert.equal(s.quota_bytes, 10737418240); assert.equal(Number(s.units_balance), 5); assert.ok("budget_usd" in s.compute);
  assert.ok(s.used_bytes >= 0); assert.ok(s.expiring.some((e) => e.key.includes("exp-new")));
  const b = await rpcAs(tokenFor(B), "storage_summary", { p_ws: ws }); assert.equal(b.status, 404);
});

test("product_metrics: cinco campos, solo generaciones v2, cada descarga repetida una sola vez", async () => {
  const s = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${ws}','upload','validated','${A}') returning id`);
  const pid = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${ws}','${s}','M','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${ws}','${s}','[]') returning id`);
  const g = async () => one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${ws}','${pid}','${tid}','r','m') returning id`);
  const g1 = await g(); await g();
  const hist = await g();   // generación sin trabajo v2: no cuenta
  void hist;
  await db.exec(`insert into jobs(workspace_id, kind, status, engine, generation_id, project_id, created_by, idempotency_key) values ('${ws}','generation','done','v2','${g1}','${pid}','${A}','metrics-job-0001')`);
  const clips: string[] = [];
  for (const st of ["aprobado", "aprobado", "pendiente", "descartado"]) {
    const c = await one(`insert into clips(workspace_id, project_id, generation_id, title, editorial_state) values ('${ws}','${pid}','${g1}','C','${st}') returning id`);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${c}','${ws}',1,'{}','9:16','single_track','x')`); clips.push(c);
  }
  await db.exec(`insert into renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind, settings_hash, downloaded_at) values
    ('${ws}','${clips[0]}',1,'9:16',true,'a','ready','mp4','a', now()), ('${ws}','${clips[0]}',1,'9:16',false,'b','ready','mp4','b', now()), ('${ws}','${clips[1]}',1,'9:16',true,'c','ready','mp4','c', now())`);
  const r = await rpcAs(tokenFor(A), "product_metrics", { p_ws: ws, p_from: "2020-01-01T00:00:00Z", p_to: "2999-01-01T00:00:00Z" }); assert.ok(r.ok, r.message);
  const m = r.data as Record<string, unknown>;
  for (const k of ["first_approved_s", "acceptance_rate", "active_correction_s", "second_variant_s", "approved_downloaded_per_creator"]) assert.ok(k in m, k);
  assert.equal(Number(m.acceptance_rate), 0.5);                       // 2 aprobados de 4, solo la generación v2
  assert.equal(Number(m.approved_downloaded_per_creator), 2);         // 2 clips distintos, aunque el primero tenga 2 descargas
  assert.equal((await rpcAs(tokenFor(B), "product_metrics", { p_ws: ws, p_from: "2020-01-01T00:00:00Z", p_to: "2999-01-01T00:00:00Z" })).status, 404);
});
