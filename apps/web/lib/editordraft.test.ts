import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultRange, draftToComposition, compositionToPatch, stepAllowed, parseClock, formatClock, setRange, wordsInRange, type DraftRow } from "./editordraft.ts";

const W = [{ text: "estoy", start: 12.2, end: 12.6, line: 0 }, { text: "contando", start: 12.7, end: 13.3, line: 0 }, { text: "días", start: 40, end: 40.5, line: 1 }];
const row = (o: Partial<DraftRow> = {}): DraftRow => ({ project_id: "p", song_id: "s", mode: "letra", range_start_ms: 0, range_end_ms: null, aspect: "9:16", res: 1080, style: null, preset: null, background: {}, settings: {}, hook: null, message: null, cover: null, ...o });

test("tramo por defecto: 30 s desde un segundo antes de la primera palabra (V3-ED-10)", () => {
  assert.deepEqual(defaultRange(W, 146), { start: 11, end: 41 });
  assert.deepEqual(defaultRange(W, 20), { start: 11, end: 20 });
});
test("borrador ↔ composición: lo guardado vuelve igual al recargar (V3-ED-20/V3-ED-41)", () => {
  const c = draftToComposition(row({ range_start_ms: 10000, range_end_ms: 25000, aspect: "4:5", res: 720, hook: { text: "Título", dur: 15 }, message: { text: "Escúchala", start: 21, end: 25 } }), W, 146);
  assert.deepEqual([c.range.start, c.range.end, c.aspect, c.res, c.hook?.text, c.message?.text], [10, 25, "4:5", 720, "Título", "Escúchala"]);
  const p = compositionToPatch(c);
  assert.deepEqual([p.range_start_ms, p.range_end_ms, p.aspect, p.res], [10000, 25000, "4:5", 720]);
  const again = draftToComposition(row(p as Partial<DraftRow>), W, 146);
  assert.deepEqual([again.range, again.style, again.preset, again.hook, again.message], [c.range, c.style, c.preset, c.hook, c.message]);
});
test("un borrador nuevo (sin tramo) usa el tramo por defecto", () => {
  const c = draftToComposition(row(), W, 146); assert.deepEqual(c.range, { start: 11, end: 41 });
});
test("los fondos guardados se limitan a 20 elementos", () => {
  const c = draftToComposition(row({ background: { kind: "media", items: Array.from({ length: 30 }, (_, i) => ({ ref: `w/media/${i}.mp4`, kind: "video" })) } }), W, 146);
  assert.equal(((compositionToPatch(c).background as { items: unknown[] }).items).length, 20);
});
test("pasos: sin canción solo Audio no; sin letra no hay Letras; tramo sin letra no deja renderizar (V3-ED-18/V3-ED-28)", () => {
  assert.equal(stepAllowed("audio", { hasSong: false, hasWords: false, wordsInRange: 0 }).ok, false);
  assert.equal(stepAllowed("letras", { hasSong: true, hasWords: false, wordsInRange: 0 }).ok, false);
  assert.equal(stepAllowed("estilo", { hasSong: true, hasWords: true, wordsInRange: 0 }).ok, true);
  assert.match(stepAllowed("render", { hasSong: true, hasWords: true, wordsInRange: 0 }).why!, /no tiene letra/);
  assert.equal(wordsInRange(W, { start: 11, end: 20 }), 2);
});
test("tiempos «m:ss.d» (V3-ED-11)", () => {
  assert.equal(parseClock("0:10.0"), 10); assert.equal(parseClock("1:05.5"), 65.5); assert.equal(parseClock("12"), 12); assert.ok(Number.isNaN(parseClock("1:2:3")));
  assert.equal(formatClock(65.5), "1:05.5"); assert.equal(formatClock(10), "0:10.0");
});
test("tramo: el fin se conserva al mover el inicio; mínimo 1 s; dentro de la canción (V3-ED-11)", () => {
  assert.deepEqual(setRange({ start: 0, end: 30 }, { start: 10 }, 146), { start: 10, end: 30 });
  assert.deepEqual(setRange({ start: 10, end: 30 }, { start: 29.5 }, 146), { start: 29.5, end: 30.5 });
  assert.deepEqual(setRange({ start: 10, end: 30 }, { end: 500 }, 146), { start: 10, end: 146 });
});
