import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWord, mergeWithNext, setTiming, offsetAll, toSRT, toVTT, editText, styleForRatio } from "./edit.ts";
import { PRESET_IMPACTO, groupWords } from "./subtitles.ts";

const ws = [{ text: "Hola", start: 0, end: 0.5 }, { text: "mundo bonito", start: 0.5, end: 1.5 }, { text: "año.", start: 1.6, end: 2 }];
const valid = (a: { start: number; end: number }[]) => a.every((w, i) => w.end > w.start && (!i || w.start >= a[i - 1].end));

test("corregir texto conserva intervalo (ñ y tildes)", () => {
  const r = editText(ws, 2, "Año.");
  assert.deepEqual([r[2].start, r[2].end, r[2].text], [1.6, 2, "Año."]);
});
test("split reparte el intervalo y merge lo restaura", () => {
  const s = splitWord(ws, 1);
  assert.equal(s.length, 4); assert.ok(valid(s));
  assert.equal(s[1].start, 0.5); assert.equal(s[2].end, 1.5);
  const m = mergeWithNext(s, 1);
  assert.deepEqual(m[1], { text: "mundo bonito", start: 0.5, end: 1.5 });
});
test("setTiming nunca solapa ni invierte", () => {
  const r = setTiming(ws, 1, 0.2, 1.9, 3);
  assert.ok(valid(r)); assert.equal(r[1].start, 0.5); assert.equal(r[1].end, 1.6);
  const z = setTiming(ws, 1, 1.4, 0.1, 3);
  assert.ok(valid(z));
});
test("offset global recorta a los límites del clip", () => {
  const r = offsetAll(ws, 1.5, 3);
  assert.ok(valid(r)); assert.ok(r[r.length - 1].end <= 3);
  const n = offsetAll(ws, -0.7, 3);
  assert.equal(n[0].start, 0);
});
test("SRT/VTT usan los mismos grupos y saltos que el render", () => {
  const srt = toSRT(ws, PRESET_IMPACTO), vtt = toVTT(ws, PRESET_IMPACTO);
  assert.equal(srt.split(" --> ").length - 1, groupWords(ws, PRESET_IMPACTO).length);
  assert.match(srt, /00:00:00,000 --> /); assert.match(vtt, /^WEBVTT/); assert.match(vtt, /00:00:00\.000 --> /);
  assert.ok(srt.includes("año."));
});
test("16:9 permite líneas más anchas", () => {
  assert.ok(styleForRatio(PRESET_IMPACTO, "16:9").maxCharsPerLine > PRESET_IMPACTO.maxCharsPerLine);
});
