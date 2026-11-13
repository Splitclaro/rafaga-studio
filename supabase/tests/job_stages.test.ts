// Motor de etapas (migración 036): reclamo exclusivo y ordenado, arrendamientos, barrido, idempotencia y presupuesto de cómputo.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A } from "./migrate.ts";

let db: PGlite, wsA: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const enqueue = async (key: string, stages: unknown[]) =>
  (await q<{ r: { job_id: string; replay: boolean; units_reserved: string } }>(
    `select public.enqueue_job($1, 'generation', $2::jsonb, $3, '{}'::jsonb, null, null) r`, [wsA, JSON.stringify(stages), key]))[0].r;

before(async () => {
  ({ db, wsA } = await freshDb());
  // Tarifa de PRUEBA (no son precios reales): permite encolar.
  await db.exec(`update platform_settings set value = '{"usd_per_core_s": 0.001, "usd_per_gib_s": 0.0001}' where key = 'modal_rate_card'`);
  await db.exec(`select public.grant_units('${wsA}', 100, 'pruebas', 'grant-tests-0001')`);
});
beforeEach(async () => { await db.exec(`update job_stages set status='done' where status in ('queued','running')`); });

test("claim_stage: una sola etapa reclamable → un solo ganador, attempts=1 y arrendamiento ~90 s; respeta el orden por seq", async () => {
  const { job_id } = await enqueue("job-order-0001", [{ stage: "prepare", seq: 1, units: 0 }, { stage: "transcribe", seq: 2, units: 3 }]);
  const [a, b] = await Promise.all([q(`select * from public.claim_stage('w1')`), q(`select * from public.claim_stage('w2')`)]);
  const got = [...a, ...b] as { stage: string; attempts: number; job_id: string }[];
  assert.equal(got.length, 1); assert.equal(got[0].stage, "prepare"); assert.equal(got[0].attempts, 1);
  const lease = (await q<{ s: number }>(`select extract(epoch from lease_until - now())::float s from job_stages where job_id=$1 and stage='prepare'`, [job_id]))[0].s;
  assert.ok(lease > 85 && lease <= 95, `lease ${lease}`);
  assert.equal((await q(`select * from public.claim_stage('w3')`)).length, 0, "transcribe espera a que prepare termine");
  const sid = (await q<{ id: string }>(`select id from job_stages where job_id=$1 and stage='prepare'`, [job_id]))[0].id;
  const winner = got[0] as unknown as { worker_id: string };
  await q(`select public.finish_stage($1, $2, 'done', '{}'::jsonb, null, 1, 1, null, null)`, [sid, winner.worker_id]);
  const next = await q<{ stage: string }>(`select * from public.claim_stage('w3')`);
  assert.equal(next[0].stage, "transcribe");
});

test("sweep_stale reencola mientras attempts < 3 y al tercer vencimiento falla con job_stalled y devuelve una vez", async () => {
  const bal0 = Number((await q<{ b: string }>(`select balance b from credit_accounts where workspace_id=$1`, [wsA]))[0].b);
  const { job_id } = await enqueue("job-stall-0001", [{ stage: "transcribe", seq: 1, units: 4 }]);
  for (let i = 1; i <= 3; i++) {
    const c = await q<{ attempts: number }>(`select * from public.claim_stage('w')`);
    assert.equal(c[0].attempts, i);
    await db.exec(`update job_stages set lease_until = now() - interval '1 second' where job_id='${job_id}'`);
    const r = (await q<{ r: { requeued: number; failed: number } }>(`select public.sweep_stale() r`))[0].r;
    if (i < 3) assert.equal(r.requeued, 1); else assert.equal(r.failed, 1);
  }
  const j = (await q<{ status: string; error_code: string }>(`select status, error_code from jobs where id=$1`, [job_id]))[0];
  assert.deepEqual(j, { status: "failed", error_code: "job_stalled" });
  const refunds = (await q<{ n: number }>(`select count(*)::int n from credit_ledger where job_id=$1 and kind='refund'`, [job_id]))[0].n;
  assert.equal(refunds, 1);
  const bal1 = Number((await q<{ b: string }>(`select balance b from credit_accounts where workspace_id=$1`, [wsA]))[0].b);
  assert.equal(bal1, bal0, "la reserva se devolvió entera");
});

test("enqueue_job idempotente: 3 llamadas → 1 trabajo, 1 reserva y el mismo job_id; output > 8 KB se rechaza", async () => {
  const st = [{ stage: "select", seq: 1, units: 1.5 }];
  const ids = [await enqueue("job-idem-0001", st), await enqueue("job-idem-0001", st), await enqueue("job-idem-0001", st)].map((r) => r.job_id);
  assert.equal(new Set(ids).size, 1);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from jobs where idempotency_key='job-idem-0001'`))[0].n, 1);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from credit_ledger where idempotency_key='reserve:job-idem-0001'`))[0].n, 1);
  await assert.rejects(() => db.query(`update job_stages set output = jsonb_build_object('x', repeat('a', 9000)) where job_id=$1`, [ids[0]]));
});

test("presupuesto de cómputo: sin tarifa o al 90 % no se encola nada", async () => {
  const before = (await q<{ n: number }>(`select count(*)::int n from jobs`))[0].n;
  await db.exec(`update platform_settings set value = null where key = 'modal_rate_card'`);
  await assert.rejects(() => enqueue("job-norate-001", [{ stage: "select", seq: 1, units: 0 }]), /compute_rate_card_missing/);
  await db.exec(`update platform_settings set value = '{"usd_per_core_s": 0.001, "usd_per_gib_s": 0.0001}' where key = 'modal_rate_card'`);
  await db.exec(`insert into ai_usage(workspace_id, kind, provider, model, units, cost_usd, billed_usd, measured) values ('${wsA}','compute','modal','x','{}', 27, 0, false)`);
  await assert.rejects(() => enqueue("job-budget-001", [{ stage: "select", seq: 1, units: 0 }]), /compute_budget_exhausted/);
  assert.equal((await q<{ n: number }>(`select count(*)::int n from jobs`))[0].n, before);
  await db.exec(`delete from ai_usage where provider='modal' and cost_usd = 27`);
});

test("claim_job heredado nunca toma trabajos v2", async () => {
  await db.exec(`update jobs set status='done' where status <> 'done'`);
  await enqueue("job-v2only-001", [{ stage: "select", seq: 1, units: 0 }]);
  await db.exec(`update jobs set kind='detect' where idempotency_key='job-v2only-001'`);
  assert.equal((await q(`select * from public.claim_job()`)).length, 0);
});

test("cancel_job antes de empezar devuelve las unidades y conserva lo hecho", async () => {
  const { job_id } = await enqueue("job-cancel-001", [{ stage: "prepare", seq: 1, units: 0 }, { stage: "transcribe", seq: 2, units: 2 }]);
  const c = await q<{ id: string; worker_id: string }>(`select * from public.claim_stage('wc')`);
  await q(`select public.finish_stage($1, 'wc', 'done', '{}'::jsonb, null, 1, 1, null, null)`, [c[0].id]);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
  const r = (await q<{ r: { kept: string[]; refunded_units: number } }>(`select public.cancel_job($1) r`, [job_id]))[0].r;
  await db.exec("reset role;");
  assert.deepEqual(r.kept, ["prepare"]); assert.equal(Number(r.refunded_units), 2);
  assert.equal((await q<{ status: string }>(`select status from jobs where id=$1`, [job_id]))[0].status, "cancelled");
});
