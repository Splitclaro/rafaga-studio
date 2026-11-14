// Editor de sincronización (estado puro): marcar manteniendo, velocidad, deshacer exacto y palabras dudosas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWithAnchors, parseLyrics, type SyncWord } from "@rafaga/lyrics";
import { initEditor, holdStart, holdEnd, tap, setRate, nudge, resize, insert, remove, undo, redo, doubtfulIndexes, toPayload, applyMarks } from "./synceditor.ts";

const base = (): SyncWord[] => alignWithAnchors(parseLyrics("a b c d e f"), "a b c d e f".split(" ").map((text, k) => ({ text, start: k * 1, end: k * 1 + 0.5 }))).words;

test("mantener de 10,00 s a 10,80 s fija la palabra actual en start 10 / end 10,8, manual, y avanza", () => {
  let s = initEditor(base());
  s = holdEnd(holdStart(s, 10), 10.8);
  assert.equal(s.words[0].start, 10); assert.equal(s.words[0].end, 10.8); assert.equal(s.words[0].manual, true); assert.equal(s.cursor, 1);
  assert.equal(s.words[1].manual, false); assert.equal(holdEnd(s, 11), s, "sin mantener no hace nada");
  const t = tap(s, 12); assert.equal(t.words[1].start, 12); assert.equal(t.cursor, 2);
});

test("la velocidad 0,5 y 0,75 se guarda y los tiempos marcados siguen siendo segundos de la canción", () => {
  for (const r of [0.5, 0.75] as const) {
    let s = setRate(initEditor(base()), r); assert.equal(s.rate, r);
    s = holdEnd(holdStart(s, 3.2), 3.9); assert.equal(s.words[0].start, 3.2); assert.equal(s.words[0].end, 3.9);
  }
});

test("mover, redimensionar, insertar y borrar se deshacen al estado idéntico; las palabras no afectadas conservan tiempos y manual", () => {
  const s0 = initEditor(base());
  for (const op of [(s: typeof s0) => nudge(s, 2, 0.1), (s: typeof s0) => resize(s, 3, "end", 3.4), (s: typeof s0) => insert(s, 2, "nueva"), (s: typeof s0) => remove(s, 1)]) {
    const s1 = op(s0); assert.notDeepEqual(s1.words, s0.words);
    const back = undo(s1); assert.deepEqual(back.words, s0.words); assert.deepEqual(back.cursor, s0.cursor);
    assert.deepEqual(redo(back).words, s1.words);
  }
  const m = nudge(s0, 2, 0.1);
  assert.ok(m.words.every((w, i) => i === 2 || w === s0.words[i]) && m.words[2].manual);
  const two = nudge(m, 4, -0.1); assert.deepEqual(undo(two).words, m.words);
});

test("doubtfulIndexes devuelve las palabras con confianza < 0,5 (las manuales ya no)", () => {
  const w = base().map((x, i) => ({ ...x, confidence: i === 1 || i === 4 ? 0.2 : 1 }));
  assert.deepEqual(doubtfulIndexes(w), [1, 4]);
  const s = nudge(initEditor(w), 1, 0.01); assert.deepEqual(doubtfulIndexes(s.words), [4]);
});

test("toPayload y applyMarks", () => {
  const s = applyMarks(initEditor(base()), [{ start: 1, end: 1.4 }, { start: 2, end: null }]);
  assert.equal(s.words[0].manual, true); assert.equal(s.words[1].end, 2.3); assert.equal(s.words[2].manual, false);
  const p = toPayload(s, 3); assert.equal(p.base_revision, 3); assert.equal(p.words.length, 6); assert.deepEqual(Object.keys(p.words[0]).sort(), ["confidence", "flags", "line", "manual", "occurrence", "origin", "start", "end", "text"].sort());
});
