import test from "node:test";
import assert from "node:assert/strict";
import { detectCuts, mergeCuts, mapTime, retimeWords, keepExpr, keptLength, cutEndAt, isFiller } from "./cuts.ts";
import type { Word } from "./subtitles.ts";

const W = (text: string, start: number, end: number): Word => ({ text, start, end });

test("detecta pausas largas con margen y no toca las cortas", () => {
  const words = [W("hola", 0.2, 0.6), W("a", 0.7, 0.9), W("todos", 3.0, 3.4), W("fin", 3.5, 3.9)];
  const p = detectCuts(words, 6);
  assert.equal(p.silences, 2);                       // hueco 0.9→3.0 y final 3.9→6
  assert.deepEqual(p.cuts[0], { s: 1.05, e: 2.85 });
  assert.deepEqual(p.cuts[1], { s: 4.05, e: 5.85 });
});
test("hesitaciones: sí «eh/mmm», no palabras con contenido", () => {
  for (const t of ["eh", "ehh", "mmm", "em", "ehm", "Eh,", "uh"]) assert.ok(isFiller(t), t);
  for (const t of ["hola", "bien", "este", "pues", "em-pezar"]) assert.ok(!isFiller(t), t);
  const p = detectCuts([W("hola", 0, 0.4), W("eh", 0.45, 0.8), W("mundo", 0.85, 1.3)], 1.4, { minGap: 5 });
  assert.equal(p.fillers, 1); assert.deepEqual(p.cuts, [{ s: 0.45, e: 0.8 }]);
});
test("mergeCuts fusiona, ordena y recorta", () => {
  assert.deepEqual(mergeCuts([{ s: 3, e: 4 }, { s: 1, e: 2 }, { s: 1.9, e: 3 }, { s: -1, e: 0.01 }, { s: 9, e: 99 }], 10), [{ s: 1, e: 4 }, { s: 9, e: 10 }]);
});
test("mapTime y retimeWords desplazan y descartan lo cortado", () => {
  const cuts = [{ s: 1, e: 2 }, { s: 4, e: 5 }];
  assert.equal(mapTime(0.5, cuts), 0.5); assert.equal(mapTime(3, cuts), 2); assert.equal(mapTime(6, cuts), 4); assert.equal(mapTime(1.5, cuts), 1);
  const out = retimeWords([W("a", 0, 0.5), W("b", 1.2, 1.6), W("c", 2.5, 3), W("d", 5.5, 6)], cuts);
  assert.deepEqual(out.map((w) => [w.text, w.start, w.end]), [["a", 0, 0.5], ["c", 1.5, 2], ["d", 3.5, 4]]);
  assert.equal(keptLength(10, cuts), 8);
});
test("expresión de ffmpeg y salto de vista previa usan la misma lista", () => {
  const cuts = [{ s: 1, e: 2 }, { s: 4, e: 5.5 }];
  assert.equal(keepExpr(cuts), "not(between(t,1.000,2.000)+between(t,4.000,5.500))");
  assert.equal(cutEndAt(1.2, cuts), 2); assert.equal(cutEndAt(2, cuts), null); assert.equal(cutEndAt(4.2, cuts), 5.5);
});
test("sin palabras no hay cortes", () => { assert.deepEqual(detectCuts([], 10), { cuts: [], silences: 0, fillers: 0, removedSec: 0 }); });
