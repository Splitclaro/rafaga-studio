import { test } from "node:test";
import assert from "node:assert/strict";
import { rmsEnvelope, topMoments, repeatedLineSpans, peaks } from "./moments.ts";

// Señal sintética: 0–40 s suave, 40–70 s fuerte (estribillo), 70–110 s suave, 110–140 s fuerte.
const sr = 8000;
const pcm = new Float32Array(sr * 150);
for (let i = 0; i < pcm.length; i++) { const t = i / sr; const loud = (t >= 40 && t < 70) || (t >= 110 && t < 140); pcm[i] = Math.sin(2 * Math.PI * 220 * t) * (loud ? 0.9 : 0.15); }
test("rmsEnvelope y peaks", () => {
  const env = rmsEnvelope(pcm, sr, 0.5);
  assert.equal(env.length, 300);
  assert.ok(env[100] > env[10] * 4);
  assert.equal(peaks(pcm, 100).length, 100);
});
test("topMoments devuelve 3 tramos sin solape sobre las partes fuertes", () => {
  const m = topMoments(rmsEnvelope(pcm, sr, 0.5), { len: 25, k: 3, duration: 150 });
  assert.equal(m.length, 3);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) assert.ok(m[a].end <= m[b].start || m[b].end <= m[a].start, "sin solape");
  assert.ok(m[0].start >= 36 && m[0].end <= 74 || (m[0].start >= 106 && m[0].end <= 144), `primero en estribillo: ${JSON.stringify(m[0])}`);
});
test("la repetición de versos sube la puntuación del tramo que la contiene", () => {
  const env = rmsEnvelope(pcm, sr, 0.5);
  const words = ["voy", "a", "bailar", "contigo"].flatMap((t, i) => [0, 1].map((rep) => ({ text: t, start: rep * 60 + 100 + i, end: rep * 60 + 100.9 + i, line: rep })));
  const rep = repeatedLineSpans(words);
  assert.ok(rep.length >= 2);
  const base = topMoments(env, { len: 25, k: 3, duration: 150 }), withRep = topMoments(env, { len: 25, k: 3, duration: 150, repeated: rep });
  assert.equal(withRep.length, 3);
  assert.ok(base.every((x) => x.why.length >= 1));
});
test("canción más corta que el tramo pedido: se devuelve entera con aviso", () => {
  const m = topMoments(rmsEnvelope(pcm.subarray(0, sr * 10), sr, 0.5), { len: 30 });
  assert.equal(m.length, 1); assert.match(m[0].why[0], /más corta/);
});
