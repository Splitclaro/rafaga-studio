import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLyrics, alignLyrics, lyricsFromAsr, planVariants } from "./index.ts";

test("importa LRC/SRT/VTT/TXT a líneas", () => {
  assert.deepEqual(parseLyrics("[00:01.00]Hola corazón\n[00:03.20]bailamos").map((l) => l.text), ["Hola corazón", "bailamos"]);
  assert.deepEqual(parseLyrics("1\n00:00:01,000 --> 00:00:02,000\nUna línea\n\n2\n00:00:03,000 --> 00:00:04,000\nOtra").map((l) => l.text), ["Una línea", "Otra"]);
  assert.deepEqual(parseLyrics("WEBVTT\n\n00:01.000 --> 00:02.000\n<v A>Canto</v>").map((l) => l.text), ["Canto"]);
});
test("alineación respeta la letra aportada y toma tiempos del ASR", () => {
  const lines = parseLyrics("Mañana te veré\notra vez, mi amor");
  const asr = [{ text: "manana", start: 1, end: 1.4 }, { text: "te", start: 1.4, end: 1.5 }, { text: "vere", start: 1.5, end: 2 }, { text: "uh", start: 2.2, end: 2.4 }, { text: "otra", start: 3, end: 3.3 }, { text: "vez", start: 3.3, end: 3.6 }, { text: "amor", start: 3.9, end: 4.5 }];
  const a = alignLyrics(lines, asr);
  assert.deepEqual(a.map((w) => w.text), ["Mañana", "te", "veré", "otra", "vez,", "mi", "amor"]); // texto original, no el del ASR
  assert.equal(a[0].start, 1); assert.equal(a[6].end, 4.5);
  const mi = a[5]; assert.equal(mi.origin, "interpolated"); assert.ok(mi.start >= a[4].end && mi.end <= a[6].start);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].start >= a[i - 1].end);
  assert.equal(a[3].line, 1);
});
test("sin letra: líneas por pausas", () => {
  const w = lyricsFromAsr([{ text: "a", start: 0, end: 0.3 }, { text: "b", start: 0.4, end: 0.6 }, { text: "c", start: 2, end: 2.3 }]);
  assert.deepEqual(w.map((x) => x.line), [0, 0, 1]);
});
test("plan de variantes: exactamente N, reproducible y avisa de repeticiones", () => {
  const p = planVariants(10, ["Impacto", "Limpio"], ["#000000", "#1E3A8A", "#7F1D1D"], 7);
  assert.equal(p.variants.length, 10); assert.equal(p.distinct, 6); assert.equal(p.repeats, 4);
  assert.deepEqual(planVariants(10, ["Impacto", "Limpio"], ["#000000", "#1E3A8A", "#7F1D1D"], 7), p);
  const first6 = new Set(p.variants.slice(0, 6).map((v) => v.style + v.background));
  assert.equal(first6.size, 6);
  assert.equal(planVariants(50, ["a"], ["b"]).variants.length, 50);
  assert.throws(() => planVariants(0, ["a"], ["b"]));
});
