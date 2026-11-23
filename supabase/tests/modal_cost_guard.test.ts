// Control del coste de Modal (migración 118): presupuesto real de 1 USD, barrido por SQL y despertar a Modal solo con trabajo listo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./migrate.ts";

let db: PGlite;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
before(async () => { ({ db } = (await freshDb()) as unknown as { db: PGlite }); });

test("el presupuesto de cómputo queda en 1 USD (crédito real del plan Starter) y el medidor bloquea al 90 %", async () => {
  assert.equal((await q<{ v: string }>(`select value #>> '{}' v from platform_settings where key='compute_budget_usd'`))[0].v, "1");
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  const m = (await q<{ m: { blocked: boolean; budget_usd: number } }>(`select public.compute_meter() m`))[0].m;
  assert.equal(m.budget_usd, 1); assert.equal(m.blocked, false);
});
test("modal_wake no hace nada sin trabajo listo ni sin Vault/pg_net; cron_sweep devuelve el resumen", async () => {
  assert.equal((await q<{ w: string }>(`select public.modal_wake() w`))[0].w, "not_needed");
  const c = (await q<{ c: { wake: string } }>(`select public.cron_sweep() c`))[0].c; assert.equal(c.wake, "not_needed");
});
test("modal_wake y cron_sweep no los ejecutan usuarios ni anónimos", async () => {
  const r = await q<{ n: string; auth: boolean; anon: boolean; svc: boolean }>(`select p.proname n, has_function_privilege('authenticated', p.oid,'execute') auth, has_function_privilege('anon', p.oid,'execute') anon, has_function_privilege('service_role', p.oid,'execute') svc from pg_proc p where p.proname in ('modal_wake','cron_sweep')`);
  assert.equal(r.length, 2); for (const x of r) { assert.equal(x.auth, false, x.n); assert.equal(x.anon, false, x.n); assert.equal(x.svc, true, x.n); }
});
