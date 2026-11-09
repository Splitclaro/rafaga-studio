import { test } from "node:test";
import assert from "node:assert/strict";
import { briefHash, validateCandidates, windows, overall, type TWord, type RawCandidate } from "./index.ts";

// transcript sintético: 120 palabras a 0.5 s, fin de oración cada 10
const words: TWord[] = Array.from({ length: 120 }, (_, i) => ({ text: `w${i}${(i + 1) % 10 === 0 ? "." : ""}`, start: i * 0.5, end: i * 0.5 + 0.45 }));
const sc = { relevance: 8, hook: 7, standalone: 7, closure: 7 };
const C = (s: number, e: number, extra: Partial<RawCandidate> = {}): RawCandidate => ({ startWord: s, endWord: e, title: `t${s}`, reason: "r", briefFit: "f", scores: sc, ...extra });
const O = { minSec: 15, maxSec: 60, count: 5, hasBrief: true };

test("tiempos derivados del transcript, no del modelo", () => {
  const { accepted } = validateCandidates(words, [C(0, 39)], O);
  assert.equal(accepted[0].startSec, 0);
  assert.equal(accepted[0].endSec, words[39].end);
});
test("rechaza índices inválidos, duración corta/larga y excluidos", () => {
  const r = validateCandidates(words, [C(-1, 10), C(0, 500), C(0, 9), C(0, 119, { startWord: 0 }), C(50, 89, { excluded: true })], O);
  const reasons = r.rejected.map((x) => x.reason).sort();
  assert.deepEqual(reasons, ["duration", "excluded", "indices", "indices"]);
  assert.equal(r.accepted.length, 1); // 0–119 dura 59,95 s: válido
});
test("ajusta el final a fin de oración cercano", () => {
  const { accepted } = validateCandidates(words, [C(0, 36)], O); // 36 -> sube a 39 (w39.)
  assert.equal(accepted[0].endWord, 39);
});
test("deduplica solapes y limita cantidad", () => {
  const r = validateCandidates(words, [C(0, 39), C(5, 44, { scores: { ...sc, relevance: 3 } }), C(60, 99)], { ...O, count: 1 });
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].startWord, 0);
});
test("lista vacía no inventa resultados", () => {
  assert.equal(validateCandidates(words, [], O).accepted.length, 0);
});
test("puntuación determinista y rúbrica sin brief", () => {
  assert.equal(overall(sc, true), overall(sc, true));
  assert.notEqual(overall(sc, true), overall(sc, false));
});
test("briefHash normaliza espacios y distingue briefs", () => {
  assert.equal(briefHash(" a  b "), briefHash("a b"));
  assert.notEqual(briefHash("consejos de venta"), briefHash("historia personal"));
});
test("windows cubren todo con solape", () => {
  const w = windows(words, 30, 8);
  assert.equal(w[0].from, 0);
  assert.equal(w[w.length - 1].to, 119);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].from <= w[i - 1].to);
});
