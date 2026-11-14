import { test } from "node:test";
import assert from "node:assert/strict";
import { pointerToPosition, keyNudge, clampCrop, loopTime, restart, nextVariantSeed } from "./lyricpreview.ts";

const F = { width: 1080, height: 1920 };
test("arrastrar fuera del lienzo y mover con flechas guardan posición normalizada en [0,1] con pasos de 0,01", () => {
  assert.deepEqual(pointerToPosition(-50, 5000, F), { x: 0, y: 1 }); assert.deepEqual(pointerToPosition(540, 960, F), { x: 0.5, y: 0.5 });
  let p = { x: 0.995, y: 0.004 }; p = keyNudge(p, "ArrowRight"); p = keyNudge(p, "ArrowUp"); assert.deepEqual(p, { x: 1, y: 0 });
  assert.deepEqual(keyNudge({ x: 0.5, y: 0.5 }, "ArrowLeft"), { x: 0.49, y: 0.5 }); assert.deepEqual(keyNudge({ x: 0.5, y: 0.5 }, "ArrowDown", true), { x: 0.5, y: 0.55 });
  assert.equal(clampCrop(1.7), 1); assert.equal(clampCrop(-3), 0); assert.equal(clampCrop(0.456), 0.46);
});
test("bucle, reiniciar y otra variante", () => {
  assert.equal(loopTime(12.1, 12, true), 0); assert.equal(loopTime(5, 12, true), 5); assert.equal(loopTime(13, 12, false), 12); assert.equal(restart(), 0);
  const s = nextVariantSeed(7); assert.notEqual(s, 7); assert.equal(nextVariantSeed(7), s); assert.ok(Number.isInteger(s) && s > 0);
});
