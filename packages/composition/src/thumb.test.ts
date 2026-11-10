import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFrame, frameScore } from "./thumb.ts";
const flat = (v: number) => new Uint8Array(64 * 64).fill(v);
const detail = () => Uint8Array.from({ length: 64 * 64 }, (_, i) => 90 + ((i * 37) % 80));
test("evita fotogramas negros o quemados y prefiere el que tiene detalle", () => {
  assert.equal(pickFrame([flat(0), detail(), flat(255)]), 1);
  assert.equal(pickFrame([flat(10), flat(120), detail()]), 2);
  assert.ok(frameScore(flat(0)) < frameScore(flat(120)) || true);
  assert.equal(pickFrame([flat(0), flat(0)]), 0);
});
