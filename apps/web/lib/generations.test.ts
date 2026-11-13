// Generaciones: validación, rangos de duración, estimación, reserva idempotente y errores (402/400/409).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { validateParams, estimateUnits, viableCount, DURATION_BUCKETS, CAPTION_DEFAULT } from "./generations.ts";
import { handleGenerations } from "./routes/generations.ts";

let db: PGlite, wsA: string, projectId: string, sourceId: string;
const MIN30 = 30 * 60 * 1000;
const call = (uid: string, slug: string[], body: unknown, idem?: string) => {
  const req = new Request(`https://app/api/generations${slug.length ? `/${slug.join("/")}` : ""}`, { method: "POST", headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: JSON.stringify(body) });
  return handleGenerations(req, slug, { f: fakeSupabaseFetch(db), wake: () => {}, env: {} });
};
const P = (over: Record<string, unknown> = {}) => ({ project_id: projectId, params: { mode: "auto", duration: "30_60", count: 10, range_start_ms: 0, range_end_ms: MIN30, ...over } });
const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n;

before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  await db.exec(`select public.grant_units('${wsA}', 100, 'pruebas', 'grant-gen-0001')`);
  sourceId = (await db.query<{ id: string }>(`insert into sources(workspace_id, kind, status, created_by, duration_ms, width, height) values ('${wsA}','upload','validated','${A}', ${MIN30}, 1920, 1080) returning id`)).rows[0].id;
  projectId = (await db.query<{ id: string }>(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${sourceId}','Gen','${A}') returning id`)).rows[0].id;
});

test("rangos de duración: auto, lt30, 30_60, 60_90 y 90_180 → [10,180], [10,30], [30,60], [60,90], [90,180]", () => {
  assert.deepEqual({ ...DURATION_BUCKETS }, { auto: [10, 180], lt30: [10, 30], "30_60": [30, 60], "60_90": [60, 90], "90_180": [90, 180] });
  const v = validateParams({ duration: "60_90" }, 600);
  assert.ok(v.ok && v.params.min_s === 60 && v.params.max_s === 90);
});

test("estimación: 30 min sin análisis = 36; con análisis = 6; el gancho de 10 clips suma 1", () => {
  assert.equal(estimateUnits({ minutes: 30, hasAnalysis: false }).total, 36);
  assert.equal(estimateUnits({ minutes: 30, hasAnalysis: true }).total, 6);
  const h = estimateUnits({ minutes: 30, hasAnalysis: false, hook: { enabled: true, top_n: 10 } });
  assert.equal(h.hook, 1); assert.equal(h.total, 37);
  assert.equal(viableCount(1800, 60), 30);
});

test("parámetros inválidos → invalid_params con el campo", () => {
  const f = (o: Record<string, unknown>) => { const r = validateParams(o, 600); return r.ok ? null : r.error.field; };
  assert.equal(f({ duration: "5min" }), "duration"); assert.equal(f({ count: 21 }), "count"); assert.equal(f({ mode: "magia" }), "mode");
  assert.equal(f({ range_start_ms: 0, range_end_ms: 999_999_999 }), "range"); assert.equal(f({ caption_style: { color: "rojo" } }), "caption_style.color");
  assert.equal(f({ aspect: "4:3" }), "aspect"); assert.equal(f({ brief: "x".repeat(2001) }), "brief");
  assert.deepEqual(validateParams({ caption_style: {} }, 600).ok && (validateParams({ caption_style: {} }, 600) as { params: { caption_style: unknown } }).params.caption_style, CAPTION_DEFAULT);
});

test("criterio 6: 3 peticiones con la misma clave → 1 generación, 1 trabajo y 1 reserva, mismo cuerpo; otra petición con la misma clave → 409", async () => {
  const bodies: string[] = [];
  for (let i = 0; i < 3; i++) { const r = await call(A, [], P(), "gen-idem-000001"); assert.equal(r.status, 202); bodies.push(JSON.stringify(await r.json())); }
  assert.equal(new Set(bodies).size, 1);
  assert.equal(await count("generations"), 1);
  assert.equal(await count("jobs"), 1);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from credit_ledger where kind='reserve'`)).rows[0].n, 1);
  const g = (await db.query<{ requested_count: number; units_reserved: string }>(`select requested_count, units_reserved from generations`)).rows[0];
  assert.equal(g.requested_count, 10); assert.equal(Number(g.units_reserved), 36);
  const conflict = await call(A, [], P({ count: 5 }), "gen-idem-000001");
  assert.equal(conflict.status, 409); assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "idempotency_conflict");
});

test("saldo insuficiente → 402 con needed y balance, sin escribir generación, trabajo ni movimiento", async () => {
  const before = { g: await count("generations"), j: await count("jobs"), l: await count("credit_ledger"), a: await count("analyses") };
  await db.exec(`select public.grant_units('${wsA}', 0.01, 'ajuste', 'grant-gen-0002')`);
  const bal = Number((await db.query<{ b: string }>(`select balance b from credit_accounts where workspace_id='${wsA}'`)).rows[0].b);
  await db.exec(`update credit_accounts set balance = 5 where workspace_id='${wsA}'`);     // simula un saldo bajo (solo en la prueba)
  const before2 = await count("credit_ledger");
  const r = await call(A, [], P({ range_end_ms: MIN30, count: 3 }), "gen-poor-0000001");
  assert.equal(r.status, 402);
  const b = (await r.json()) as { error: { code: string }; needed: number; balance: number };
  assert.equal(b.error.code, "insufficient_units"); assert.equal(Number(b.needed), 36); assert.equal(Number(b.balance), 5);
  assert.deepEqual({ g: await count("generations"), j: await count("jobs"), a: await count("analyses") }, { g: before.g, j: before.j, a: before.a });
  assert.equal(await count("credit_ledger"), before2);
  await db.exec(`update credit_accounts set balance = ${bal} where workspace_id='${wsA}'`);
});

test("estimación: sin análisis total 36, con análisis reutilizable 6; eta null con pocas muestras y calculada con ≥5; viable_count", async () => {
  const r = await call(A, ["estimate"], P({ hook: { enabled: true, top_n: 10 } }));
  const b = (await r.json()) as { units: { total: number; hook: number }; eta: unknown; reusable_analysis: boolean; viable_count: number; requested_count: number; balance: number };
  assert.equal(b.units.total, 37); assert.equal(b.units.hook, 1); assert.equal(b.eta, null); assert.equal(b.reusable_analysis, false);
  assert.equal(b.viable_count, 60); assert.equal(b.requested_count, 10); assert.ok(b.balance > 0);
  // análisis hecho y reutilizable
  const tid = (await db.query<{ id: string }>(`select id from transcripts limit 1`)).rows[0].id;
  await db.exec(`update analyses set status='done', range_start_ms=0, range_end_ms=${MIN30}, transcript_id='${tid}', component_versions='{"asr_model":"whisper-large-v3-turbo"}'`);
  const r2 = (await (await call(A, ["estimate"], P())).json()) as { units: { total: number }; reusable_analysis: boolean };
  assert.equal(r2.reusable_analysis, true); assert.equal(r2.units.total, 6);
  // ≥5 muestras de cada etapa → eta calculada
  for (const st of ["candidates", "select", "compose", "previews", "checks"]) for (let i = 0; i < 5; i++) {
    const j = (await db.query<{ id: string }>(`insert into jobs(workspace_id, kind, status, idempotency_key, params, engine) values ('${wsA}','generation','done','seed-${st}-${i}','{"source_minutes":10}','v2') returning id`)).rows[0].id;
    await db.exec(`insert into job_stages(workspace_id, job_id, stage, seq, status, started_at, finished_at) values ('${wsA}','${j}','${st}',1,'done', now() - interval '20 seconds', now() - interval '10 seconds')`);
  }
  const r3 = (await (await call(A, ["estimate"], P())).json()) as { eta: { p50_s: number; p90_s: number } | null };
  assert.ok(r3.eta && r3.eta.p50_s > 0 && r3.eta.p90_s >= r3.eta.p50_s, JSON.stringify(r3.eta));
});

test("parámetros inválidos → 400; fuente sin validar → 409 source_not_ready; otro usuario → 404", async () => {
  const bad = await call(A, [], P({ count: 99 }), "gen-bad-00000001");
  assert.equal(bad.status, 400); assert.equal(((await bad.json()) as { error: { field: string } }).error.field, "count");
  assert.equal((await call(A, [], { project_id: projectId, params: { range_end_ms: 99_999_999_999 } }, "gen-bad-00000002")).status, 400);
  await db.exec(`update sources set status='uploaded' where id='${sourceId}'`);
  const nr = await call(A, [], P(), "gen-notready-0001");
  assert.equal(nr.status, 409); assert.equal(((await nr.json()) as { error: { code: string } }).error.code, "source_not_ready");
  await db.exec(`update sources set status='validated' where id='${sourceId}'`);
  assert.equal((await call(B, [], P(), "gen-other-000001")).status, 404);
  assert.equal((await call(A, [], P())).status, 400, "sin Idempotency-Key");
});
