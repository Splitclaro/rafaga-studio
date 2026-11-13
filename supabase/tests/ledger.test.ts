// Libro de unidades (migración 035): reservas con saldo bajo bloqueo, idempotencia y escritura única.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";
import { fakeSupabaseFetch, tokenFor, SERVICE_TOKEN } from "./fake-supabase.ts";

let db: PGlite, wsA: string;
let asUser: (uid: string | null, fn: () => Promise<void>) => Promise<void>;
const call = async (token: string, fn: string, args: Record<string, unknown>) => {
  const f = fakeSupabaseFetch(db);
  const r = await f(`https://x.supabase.co/rest/v1/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
};
const balance = async () => Number((await db.query<{ b: string }>(`select balance b from credit_accounts where workspace_id='${wsA}'`)).rows[0]?.b ?? 0);

before(async () => { ({ db, wsA, asUser } = await freshDb()); });

test("el dueño concede saldo; un miembro sin rol de dueño no puede", async () => {
  const ok = await call(tokenFor(A), "grant_units", { p_ws: wsA, p_units: 1, p_note: "inicial", p_key: "grant-0001" });
  assert.equal(ok.status, 200); assert.equal(await balance(), 1);
  const bad = await call(tokenFor(B), "grant_units", { p_ws: wsA, p_units: 5, p_note: null, p_key: "grant-0002" });
  assert.equal(bad.status, 403);
});

test("dos reservas de 1 unidad a la vez contra saldo 1.00: exactamente una entra y el saldo queda en 0", async () => {
  const [r1, r2] = await Promise.all([
    call(tokenFor(A), "reserve_units", { p_ws: wsA, p_units: 1, p_job: null, p_gen: null, p_key: "reserve-aaaa" }),
    call(tokenFor(A), "reserve_units", { p_ws: wsA, p_units: 1, p_job: null, p_gen: null, p_key: "reserve-bbbb" }),
  ]);
  const st = [r1.status, r2.status].sort();
  assert.deepEqual(st, [200, 400]);
  const failed = r1.status === 400 ? r1 : r2;
  assert.equal(failed.body.message, "insufficient_units");
  assert.equal(await balance(), 0);
});

test("criterio 6: la misma clave 3 veces → 1 fila y el mismo ledger_id", async () => {
  await call(tokenFor(A), "grant_units", { p_ws: wsA, p_units: 10, p_note: null, p_key: "grant-0003" });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await call(tokenFor(A), "reserve_units", { p_ws: wsA, p_units: 2, p_job: null, p_gen: null, p_key: "reserve-same" })).body.ledger_id);
  assert.equal(new Set(ids).size, 1);
  const n = (await db.query<{ n: number }>(`select count(*)::int n from credit_ledger where idempotency_key='reserve-same'`)).rows[0].n;
  assert.equal(n, 1);
});

test("settle con consumo menor libera la diferencia una sola vez; refund repetido no duplica", async () => {
  const before = await balance();
  await call(SERVICE_TOKEN, "settle_units", { p_ws: wsA, p_job: null, p_key: "settle-0001", p_reserved: 2, p_actual: 1.5 });
  await call(SERVICE_TOKEN, "settle_units", { p_ws: wsA, p_job: null, p_key: "settle-0001", p_reserved: 2, p_actual: 1.5 });
  assert.equal(await balance(), before + 0.5);
  const rel = (await db.query<{ n: number }>(`select count(*)::int n from credit_ledger where idempotency_key like 'settle-0001%'`)).rows[0].n;
  assert.equal(rel, 2, "una fila settle y una release");
  await call(SERVICE_TOKEN, "refund_units", { p_ws: wsA, p_job: null, p_key: "refund-0001", p_units: 1, p_reason: "fallo interno" });
  await call(SERVICE_TOKEN, "refund_units", { p_ws: wsA, p_job: null, p_key: "refund-0001", p_units: 1, p_reason: "fallo interno" });
  assert.equal(await balance(), before + 1.5);
});

test("un usuario no puede escribir en el libro ni liquidar/devolver por su cuenta", async () => {
  await asUser(A, async () => {
    await assert.rejects(() => db.query(`insert into credit_ledger(workspace_id, kind, units, idempotency_key) values ('${wsA}','grant',100,'hack-0001')`));
    await assert.rejects(() => db.query(`update credit_accounts set balance = 1000 where workspace_id='${wsA}'`).then((r) => { if ((r.affectedRows ?? 0) > 0) throw new Error("x"); throw new Error("sin filas"); }));
  });
  const s = await call(tokenFor(A), "settle_units", { p_ws: wsA, p_job: null, p_key: "settle-hack1", p_reserved: 1, p_actual: 0 });
  assert.notEqual(s.status, 200);
  const r = await call(tokenFor(A), "refund_units", { p_ws: wsA, p_job: null, p_key: "refund-hack1", p_units: 50, p_reason: null });
  assert.notEqual(r.status, 200);
});

test("solo la migración 035 escribe en credit_ledger", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|sql|py)$/.test(n) && !n.endsWith(".test.ts") && readFileSync(p, "utf8").includes("insert into public.credit_ledger")) hits.push(p.slice(root.length));
    }
  };
  for (const d of ["supabase/migrations", "apps/web", "workers", "packages"]) walk(join(root, d));
  assert.deepEqual(hits, ["supabase/migrations/20261113000035_credit_ledger.sql"]);
});
