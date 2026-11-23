// Exportaciones: versión fijada, reutilización, lote con fallo parcial, acceso ajeno 404, caducidad y renovación.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { viralTemplate } from "@rafaga/composition";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handleExports } from "./routes/exports.ts";

let db: PGlite, wsA: string, c1: string, c2: string;
const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK" };
const woken: string[] = [];
const call = (uid: string, method: string, path: string, body?: unknown, idem?: string) => {
  const req = new Request(`https://app/api/exports${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return handleExports(req, path.split("?")[0].split("/").filter(Boolean), { f: fakeSupabaseFetch(db), env: ENV, wake: (_r, j) => woken.push(j) });
};
const spec = (t = "hablante_seguimiento") => viralTemplate(t as never, "9:16", { duration: 8, fragments: [{ start: 10, end: 18 }] });
const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;

before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const src = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${wsA}','upload','validated','${A}') returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','E','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[{"text":"hola","start":10,"end":11}]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`);
  for (const i of [1, 2]) {
    const id = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','Clip ${i}') returning id`);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${id}','${wsA}',1,'${JSON.stringify(spec())}','9:16','single_track','hablante_seguimiento')`);
    if (i === 1) c1 = id; else c2 = id;
  }
});

const item = (clip: string, extra: Record<string, unknown> = {}) => ({ clip_id: clip, version: 1, aspect: "9:16", burn_subtitles: true, kind: "mp4", ...extra });

test("sin Idempotency-Key → 400; con ella se crea el trabajo, se despierta al worker y un reintento no duplica", async () => {
  assert.equal((await call(A, "POST", "", { items: [item(c1)] })).status, 400);
  const a = await call(A, "POST", "", { items: [item(c1)] }, "export-key-0001"), ja = (await a.json()) as { export_ids: string[]; job_id: string };
  assert.equal(a.status, 202); assert.equal(ja.export_ids.length, 1); assert.equal(woken.length, 1);
  const b = await call(A, "POST", "", { items: [item(c1)] }, "export-key-0001"), jb = (await b.json()) as { job_id: string; replay?: boolean };
  assert.equal(jb.job_id, ja.job_id); assert.equal(woken.length, 1, "el reintento no vuelve a despertar");
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from renders`)).rows[0].n, 1);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from credit_ledger`)).rows[0].n, 0, "exportar no consume unidades");
});

test("misma versión y ajustes reutilizan la exportación; seguir editando no cambia lo pedido", async () => {
  const r = await call(A, "POST", "", { items: [item(c1)] }, "export-key-0002"), j = (await r.json()) as { reused: number; export_ids: string[] };
  assert.equal(j.reused, 1);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${c1}','${wsA}',2,'${JSON.stringify(spec("video_completo"))}','9:16','fit_full','video_completo')`);
  const it = (await db.query<{ r: { version: number; composition: { layout: string } } }>(`select public.export_job_item('${j.export_ids[0]}') r`)).rows[0].r;
  assert.equal(it.version, 1); assert.equal(it.composition.layout, spec().layout);
});

test("lote con ZIP: crea lote y etapas render + zip; si un render falla, finish_batch lo deja partial", async () => {
  const r = await call(A, "POST", "", { items: [item(c1, { aspect: "1:1" }), item(c2)], zip: true }, "export-key-0003"), j = (await r.json()) as { batch_id: string; export_ids: string[] };
  assert.ok(j.batch_id);
  assert.deepEqual((await db.query<{ s: string }>(`select stage s from job_stages js join export_batches b on b.job_id = js.job_id where b.id='${j.batch_id}' order by seq, stage`)).rows.map((x) => x.s), ["render", "render", "zip"]);
  const [ok, bad] = j.export_ids;
  await db.exec(`select public.finish_render('${ok}','ready','${wsA}/x/v1-aaaaaaaaaaaa.mp4','{}'::jsonb,1000,8000,1080,1920,null)`);
  await db.exec(`select public.finish_render('${bad}','failed',null,null,null,null,null,null,'render_failed')`);
  assert.equal((await db.query<{ s: string }>(`select public.finish_batch('${j.batch_id}') s`)).rows[0].s, "partial");
  assert.equal((await db.query<{ s: string }>(`select status s from renders where id='${ok}'`)).rows[0].s, "ready");
  const retry = await call(A, "POST", `/${bad}/retry`, undefined, "retry-key-0001");
  assert.equal(retry.status, 202); assert.equal((await db.query<{ s: string }>(`select status s from renders where id='${bad}'`)).rows[0].s, "queued");
});

test("URL: lista → firmada y marca la primera descarga; ajena → 404 sin firmar; caducada → 410 renovable; renovar re-renderiza sin coste", async () => {
  const r = await call(A, "POST", "", { items: [item(c2, { kind: "srt" })] }, "export-key-0004"), id = ((await r.json()) as { export_ids: string[] }).export_ids[0];
  assert.equal((await call(A, "GET", `/${id}/url`)).status, 409, "aún en cola");
  await db.exec(`select public.finish_render('${id}','ready','${wsA}/${c2}/v1-bbbbbbbbbbbb.srt',null,10,8000,null,null,null)`);
  const ok = await call(A, "GET", `/${id}/url`); assert.equal(ok.status, 200);
  assert.match(((await ok.json()) as { url: string }).url, /X-Amz-Signature/);
  assert.doesNotMatch(((await (await call(A, "GET", `/${id}/url`)).json()) as { url: string }).url, /response-content-disposition/, "sin ?download=1 no fuerza descarga (miniaturas y vista previa)");
  const dl = ((await (await call(A, "GET", `/${id}/url?download=1&name=${encodeURIComponent('Mi "clip"/ñ.mp4')}`)).json()) as { url: string }).url;
  const cd = decodeURIComponent(new URL(dl).searchParams.get("response-content-disposition") ?? "");
  assert.match(cd, /^attachment; filename="[^"\/]+\.mp4"; filename\*=UTF-8''/, "descarga forzada con nombre seguro y extensión .mp4");
  assert.ok(!/["\\/]clip["\\/]/.test(cd.split(";")[1]), "el nombre no conserva comillas ni barras");
  assert.notEqual((await db.query<{ d: string | null }>(`select downloaded_at d from renders where id='${id}'`)).rows[0].d, null);
  assert.equal((await call(B, "GET", `/${id}/url`)).status, 404);
  await db.exec(`update renders set expires_at = now() - interval '1 day' where id='${id}'`);
  assert.equal((await call(A, "GET", `/${id}/url`)).status, 410);
  await db.exec(`update renders set storage_path = null where id='${id}'`);
  const ledger = (await db.query<{ n: number }>(`select count(*)::int n from credit_ledger`)).rows[0].n;
  assert.equal((await call(A, "POST", `/${id}/renew`, undefined, "renew-key-0001")).status, 202);
  assert.equal((await db.query<{ s: string }>(`select status s from renders where id='${id}'`)).rows[0].s, "queued");
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from credit_ledger`)).rows[0].n, ledger);
  assert.equal((await call(B, "POST", "", { items: [item(c1)] }, "export-key-0005")).status, 404);
});
