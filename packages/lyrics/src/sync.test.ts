// Sincronización: anclas manuales, banderas, estribillos e instrumentales, ediciones palabra a palabra y la canción de demostración.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLyrics } from "./index.ts";
import { alignWithAnchors, resyncKeepingManual, insertWord, deleteWord, nudgeWord, resizeWord, transcriptionProposal, DEMO_SONG, DEMO_AUDIO_EXPR, importLyrics, type AsrWord, type SyncWord } from "./sync.ts";

const asrOf = (words: string[], gap = 1, dur = 0.4, shift = 0): AsrWord[] => words.map((text, k) => ({ text, start: +(k * gap + shift).toFixed(3), end: +(k * gap + shift + dur).toFixed(3) }));
const increasing = (w: SyncWord[]) => w.every((x, i) => x.end > x.start && (i === 0 || x.start >= w[i - 1].end - 1e-9));

test("resyncKeepingManual: 3 palabras manuales no se mueven y las demás se recalculan", () => {
  const text = "uno dos tres cuatro cinco seis siete ocho nueve diez", lines = parseLyrics(text), ws = text.split(" ");
  const first = alignWithAnchors(lines, asrOf(ws)).words;
  const prev = first.map((w, i) => ([2, 5, 8].includes(i) ? { ...w, manual: true, start: w.start + 0.05, end: w.end + 0.05 } : w));
  const out = resyncKeepingManual(prev, lines, asrOf(ws, 1, 0.4, 0.2)).words;
  for (const i of [2, 5, 8]) { assert.equal(out[i].start, prev[i].start); assert.equal(out[i].end, prev[i].end); assert.equal(out[i].manual, true); }
  assert.ok([0, 1, 3, 4, 6, 7, 9].every((i) => Math.abs(out[i].start - (i + 0.2)) < 1e-6), "las demás siguen al nuevo ASR");
  assert.ok(increasing(out));
});

test("alignWithAnchors: mismas palabras y orden que la letra; banderas por confianza e interpolación; extras = ASR sin pareja", () => {
  const lines = parseLyrics("hola mundo esto es una prueba de canción");
  const asr: AsrWord[] = [{ text: "hola", start: 0, end: 0.4 }, { text: "eh", start: 0.5, end: 0.8 }, { text: "mundo", start: 1, end: 1.4 }, { text: "esta", start: 2, end: 2.4 }, { text: "es", start: 3, end: 3.4 },
    { text: "una", start: 4, end: 4.4 }, { text: "prueba", start: 5, end: 5.4 }, { text: "cancion", start: 7, end: 7.4 }];
  const r = alignWithAnchors(lines, asr);
  assert.deepEqual(r.words.map((w) => w.text), "hola mundo esto es una prueba de canción".split(" "));
  for (const w of r.words) { assert.equal(w.flags.includes("doubtful"), w.confidence < 0.5); assert.equal(w.flags.includes("not_heard"), w.origin === "interpolated"); }
  assert.ok(r.words.some((w) => w.flags.includes("not_heard")), "alguna palabra no se oyó");
  assert.ok(r.extras.some((e) => e.text === "eh")); assert.ok(increasing(r.words));
});

test("estribillo repetido, tramo instrumental de más de 4 s, vocalizaciones y palabras sostenidas", () => {
  const lines = parseLyrics("la casa azul\noh yeah\nla casa azul");
  const asr: AsrWord[] = [["la", 0, 0.4], ["casa", 0.5, 0.9], ["azul", 1, 2.8], ["oh", 3, 3.4], ["yeah", 3.5, 4], ["la", 9, 9.4], ["casa", 9.5, 9.9], ["azul", 10, 10.4]].map(([text, start, end]) => ({ text: text as string, start: start as number, end: end as number }));
  const r = alignWithAnchors(lines, asr);
  assert.deepEqual(r.words.map((w) => w.occurrence), [1, 1, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(r.instrumentals, [{ start: 4, end: 9 }]);
  assert.equal(r.words[0].start, 0); assert.equal(r.words[5].start, 9, "tiempos independientes por repetición");
  assert.ok(r.words[3].flags.includes("vocalisation") && r.words[4].flags.includes("vocalisation"));
  assert.ok(r.words[2].flags.includes("sustained")); assert.ok(!r.words[0].flags.includes("sustained"));
});

test("insertWord, deleteWord, nudgeWord y resizeWord: solo la palabra editada cambia (manual), los tiempos siguen creciendo", () => {
  const base = alignWithAnchors(parseLyrics("a b c d e f"), asrOf("a b c d e f".split(" "), 1, 0.5)).words;
  const ins = insertWord(base, 2, "nueva"); assert.equal(ins.length, 7); assert.equal(ins[2].manual, true); assert.ok(increasing(ins));
  assert.ok(ins.filter((_, i) => i !== 2).every((w, i) => w === base[i]) && ins.filter((w) => w.manual).length === 1);
  const del = deleteWord(base, 3); assert.equal(del.length, 5); assert.ok(del.every((w, i) => w === base[i < 3 ? i : i + 1]));
  const n1 = nudgeWord(base, 1, 0.2); assert.equal(n1[1].manual, true); assert.ok(Math.abs(n1[1].start - (base[1].start + 0.2)) < 1e-9);
  const r1 = resizeWord(n1, 4, "end", 4.9);                                   // pide pasar a la palabra siguiente: se recorta en su inicio
  assert.equal(r1[4].manual, true); assert.ok(r1[4].end <= base[5].start + 1e-9);
  assert.equal(r1[1], n1[1], "lo corregido antes no cambia"); assert.deepEqual(r1.filter((w) => w.manual).map((w) => w.text), ["b", "e"]);
  assert.ok(increasing(r1));
  const tight = nudgeWord(base, 2, 5); assert.ok(tight[2].end <= base[3].start + 1e-9, "no pasa a la vecina");
});

test("transcriptionProposal: texto por líneas y palabras sin tocar nada; importLyrics lee TXT", () => {
  const p = transcriptionProposal([{ text: "hola", start: 0, end: 0.4 }, { text: "mundo.", start: 0.5, end: 0.9 }, { text: "adiós", start: 2, end: 2.4 }]);
  assert.equal(p.text, "hola mundo.\nadiós"); assert.equal(p.words.length, 3);
  assert.deepEqual(importLyrics("uno dos\n\ntres").lines.map((l) => l.text), ["uno dos", "tres"]);
});

test("DEMO_SONG: 12 palabras manuales, crecientes y dentro de 24 s; audio sintético de 24 s", () => {
  assert.equal(DEMO_SONG.words.length, 12); assert.ok(DEMO_SONG.words.every((w, k) => w.manual && w.start === 2 * k && w.end === 2 * k + 1.2));
  assert.ok(increasing(DEMO_SONG.words)); assert.ok(DEMO_SONG.words.at(-1)!.end <= DEMO_SONG.duration); assert.match(DEMO_AUDIO_EXPR, /d=24$/);
  assert.equal(DEMO_SONG.lyrics.split("\n").length, 4);
});
