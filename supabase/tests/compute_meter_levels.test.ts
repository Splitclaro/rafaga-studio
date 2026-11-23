// Migración 119: el medidor suma el coste fijo y avisa al 70 % / bloquea al 90 %.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./migrate.ts";

let db: PGlite;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
type M = { month_usd: number; stage_usd: number; fixed_usd: number; pct: number; level: string; blocked: boolean };
const meter = async () => (await q<{ m: M }>(`select public.compute_meter() m`))[0].m;
before(async () => {
  ({ db } = (await freshDb()) as unknown as { db: PGlite });
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
});

test("sin coste fijo ni gasto el nivel es ok y no bloquea", async () => {
  const m = await meter(); assert.equal(m.level, "ok"); assert.equal(m.blocked, false); assert.equal(m.fixed_usd, 0);
});
test("el coste fijo se suma al de las etapas: 0,75 USD de 1 → aviso al 70 % sin bloquear", async () => {
  await db.exec(`update platform_settings set value = '0.75' where key='compute_fixed_usd'`);
  const m = await meter(); assert.equal(m.level, "warn"); assert.equal(m.blocked, false); assert.equal(m.pct, 75); assert.equal(m.month_usd, 0.75);
});
test("0,99 USD fijos (el caso real de B-01) → bloqueado al 99 %", async () => {
  await db.exec(`update platform_settings set value = '0.99' where key='compute_fixed_usd'`);
  const m = await meter(); assert.equal(m.level, "blocked"); assert.equal(m.blocked, true); assert.equal(m.pct, 99);
});
test("sin tarifa falla cerrado aunque el gasto sea 0", async () => {
  await db.exec(`update platform_settings set value = '0' where key='compute_fixed_usd'; update platform_settings set value = null where key='modal_rate_card'`);
  const m = await meter(); assert.equal(m.level, "blocked"); assert.equal(m.blocked, true);
});
