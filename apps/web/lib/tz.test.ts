import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, utcToLocalInput } from "./tz.ts";

test("Madrid: verano (+2) e invierno (+1)", () => {
  assert.equal(zonedToUtc("2026-07-01T10:00", "Europe/Madrid").utc.toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(zonedToUtc("2026-12-01T10:00", "Europe/Madrid").utc.toISOString(), "2026-12-01T09:00:00.000Z");
});
test("Madrid: salto de primavera 29-mar-2026 (02:30 no existe)", () => {
  const gap = zonedToUtc("2026-03-29T02:30", "Europe/Madrid"); assert.equal(gap.exists, false);
  const after = zonedToUtc("2026-03-29T03:30", "Europe/Madrid"); assert.equal(after.exists, true); assert.equal(after.utc.toISOString(), "2026-03-29T01:30:00.000Z");
  const before = zonedToUtc("2026-03-29T01:30", "Europe/Madrid"); assert.equal(before.utc.toISOString(), "2026-03-29T00:30:00.000Z");
});
test("Madrid: retroceso de otoño 25-oct-2026 (02:30 ocurre dos veces)", () => {
  const dup = zonedToUtc("2026-10-25T02:30", "Europe/Madrid"); assert.equal(dup.ambiguous, true); assert.equal(dup.utc.toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(zonedToUtc("2026-10-25T03:30", "Europe/Madrid").utc.toISOString(), "2026-10-25T02:30:00.000Z");
});
test("Nueva York y ida y vuelta UTC ↔ local", () => {
  assert.equal(zonedToUtc("2026-01-15T09:00", "America/New_York").utc.toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-15T09:00", "America/New_York").utc.toISOString(), "2026-07-15T13:00:00.000Z");
  for (const [l, z] of [["2026-05-05T18:45", "Europe/Madrid"], ["2026-11-20T07:05", "America/Mexico_City"], ["2026-02-02T23:59", "Asia/Tokyo"]] as const) assert.equal(utcToLocalInput(zonedToUtc(l, z).utc, z), l);
});
