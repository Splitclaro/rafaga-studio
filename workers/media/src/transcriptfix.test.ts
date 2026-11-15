import { test } from "node:test";
import assert from "node:assert/strict";
import { correctWords, plausibleFix } from "./transcriptfix.ts";
import type { TWord } from "@rafaga/selection";

const W = (t: string, i: number): TWord => ({ text: t, start: i, end: i + 0.5 });
test("plausibleFix: acepta tildes, mayúsculas y homófonos cercanos; rechaza cambios de palabra o con espacios", () => {
  assert.ok(plausibleFix("cancion", "canción")); assert.ok(plausibleFix("madrid", "Madrid.")); assert.ok(plausibleFix("aver", "haber"));
  assert.ok(!plausibleFix("hola", "adiós")); assert.ok(!plausibleFix("hola", "hola que tal")); assert.ok(!plausibleFix("hola", ""));
});
test("correctWords: corrige texto sin tocar tiempos ni número de palabras", async () => {
  const ws = ["hola", "me", "llamo", "pedro", "y", "vivo", "en", "madrid"].map(W);
  const r = await correctWords(ws, async () => JSON.stringify({ t: ["Hola,", "me", "llamo", "Pedro", "y", "vivo", "en", "Madrid."] }));
  assert.equal(r.words.length, ws.length); assert.deepEqual(r.words.map((w) => w.text), ["Hola,", "me", "llamo", "Pedro", "y", "vivo", "en", "Madrid."]);
  assert.deepEqual(r.words.map((w) => [w.start, w.end]), ws.map((w) => [w.start, w.end])); assert.equal(r.changed, 3);
});
test("correctWords: respuesta de longitud distinta, JSON roto, palabras inventadas o error → se conserva el original", async () => {
  const ws = ["uno", "dos", "tres"].map(W);
  for (const resp of [JSON.stringify({ t: ["Uno"] }), "no es json", JSON.stringify({ t: ["Uno", "ocho cosas", "Tres"] })]) {
    const r = await correctWords(ws, async () => resp);
    assert.deepEqual(r.words.map((w) => w.text).filter((_, i) => i !== 0 && i !== 2), ["dos"]);   // «dos» nunca cambia a «ocho cosas»
  }
  const e = await correctWords(ws, async () => { throw new Error("429"); }); assert.deepEqual(e.words.map((w) => w.text), ["uno", "dos", "tres"]); assert.equal(e.failed, 1);
});
test("correctWords: procesa por lotes con contexto y concurrencia", async () => {
  const ws = Array.from({ length: 300 }, (_, i) => W(`p${i}`, i)); let calls = 0;
  const r = await correctWords(ws, async (_s, u) => { calls++; const n = (JSON.parse(u) as { tokens: string[] }).tokens.length; return JSON.stringify({ t: Array.from({ length: n }, (_, k) => (JSON.parse(u) as { tokens: string[] }).tokens[k]) }); }, { batch: 100 });
  assert.equal(calls, 3); assert.equal(r.batches, 3); assert.equal(r.failed, 0); assert.equal(r.changed, 0);
});

import { snapToVocabulary } from "./transcriptfix.ts";
test("snapToVocabulary: escribe el término de marca exacto, conserva puntuación y tiempos, y no toca palabras distintas", () => {
  const w = [{ text: "rafaga,", start: 0, end: 0.4 }, { text: "Samuel", start: 0.4, end: 0.8 }, { text: "samueliyo.", start: 0.8, end: 1.2 }, { text: "casa", start: 1.2, end: 1.5 }, { text: "ráfagas", start: 1.5, end: 1.9 }];
  const r = snapToVocabulary(w as never, ["Ráfaga", "Samueliyo", "Ráfaga Studio", "Sol"]);
  assert.deepEqual(r.words.map((x) => x.text), ["Ráfaga,", "Samuel", "Samueliyo.", "casa", "Ráfaga"]);
  assert.deepEqual(r.words.map((x) => [x.start, x.end]), w.map((x) => [x.start, x.end])); assert.equal(r.changed, 3);
  assert.equal(snapToVocabulary(w as never, []).changed, 0);
});
