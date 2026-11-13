import { test } from "node:test";
import assert from "node:assert/strict";
import { mapDbError, errorFor, ERROR_CODES, ERROR_ALIASES, idempotencyKey, fail } from "./api.ts";

test("insufficient_units → 402 con needed y balance", async () => {
  const r = mapDbError({ code: "P0001", message: "insufficient_units", details: JSON.stringify({ needed: 18.3, balance: 4 }) });
  assert.equal(r.status, 402);
  const b = await r.json() as { error: { code: string; message: string }; needed: number; balance: number };
  assert.equal(b.error.code, "insufficient_units"); assert.ok(b.error.message.length > 0);
  assert.equal(b.needed, 18.3); assert.equal(b.balance, 4);
});

test("cada código del catálogo tiene mensaje, trabajo conservado, acción y efecto en el consumo", () => {
  for (const code of Object.keys(ERROR_CODES)) {
    const e = errorFor(code);
    for (const k of ["message", "kept", "action", "consumption"] as const) assert.ok(e[k].trim().length > 0, `${code}.${k}`);
  }
  for (const alias of Object.keys(ERROR_ALIASES)) assert.equal(errorFor(alias).code, "unsupported_file");
  assert.equal(Object.keys(ERROR_CODES).length >= 14, true);
});

test("errores genéricos de base de datos", async () => {
  assert.equal(mapDbError({ code: "P0002", message: "not_found" }).status, 404);
  assert.equal(mapDbError({ code: "42501", message: "forbidden" }).status, 403);
  assert.equal(mapDbError({ code: "23505", message: "duplicate key" }).status, 409);
  assert.equal(mapDbError({ code: "XX000", message: "boom" }).status, 500);
});

test("Idempotency-Key válida o null", () => {
  const req = (k?: string) => new Request("https://x/a", { method: "POST", headers: k ? { "Idempotency-Key": k } : {} });
  assert.equal(idempotencyKey(req("abcdefgh-1234")), "abcdefgh-1234");
  assert.equal(idempotencyKey(req("corta")), null);
  assert.equal(idempotencyKey(req()), null);
  assert.equal(idempotencyKey(req("con espacio dentro")), null);
});

test("fail usa el estado del catálogo", () => {
  assert.equal(fail("quota_exceeded").status, 507);
  assert.equal(fail("compute_budget_exhausted").status, 429);
});
