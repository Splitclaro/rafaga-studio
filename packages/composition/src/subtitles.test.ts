import { test } from "node:test";
import assert from "node:assert/strict";
import { activeIntervals, activeWordAt, buildAss, escapeAss, groupWords, normalizeWords, PRESET_IMPACTO, type Word } from "./subtitles.ts";

const W = (text: string, start: number, end: number): Word => ({ text, start, end });
const sample: Word[] = [
  W("Hola", 0.0, 0.4), W("a", 0.4, 0.5), W("todos,", 0.5, 1.0),
  W("esta", 1.2, 1.5), W("es", 1.5, 1.7), W("la", 1.7, 1.8), W("canción", 1.8, 2.4), W("del", 2.4, 2.6), W("año.", 2.6, 3.2),
];

test("normaliza: sin duración negativa ni solape", () => {
  const n = normalizeWords([W("a", 1, 0.5), W("b", 0.9, 1.2)]);
  for (let i = 0; i < n.length; i++) {
    assert.ok(n[i].end > n[i].start);
    if (i) assert.ok(n[i].start >= n[i - 1].end);
  }
});

test("agrupa por puntuación y máximo de palabras", () => {
  const g = groupWords(sample, PRESET_IMPACTO);
  assert.ok(g.length >= 2);
  for (const grp of g) {
    assert.ok(grp.words.length <= PRESET_IMPACTO.maxWordsPerGroup);
    assert.ok(grp.lines.length <= PRESET_IMPACTO.maxLines);
  }
});

test("palabra activa cambia en el inicio real de cada palabra", () => {
  const [g] = groupWords(sample, PRESET_IMPACTO);
  assert.equal(activeWordAt(g, 0.0), 0);
  assert.equal(activeWordAt(g, 0.39), 0);
  assert.equal(activeWordAt(g, 0.4), 1);
  assert.equal(activeWordAt(g, 0.5), 2);
  assert.equal(activeWordAt(g, g.end), -1);
});

test("intervalos activos cubren el grupo sin solapes", () => {
  for (const g of groupWords(sample, PRESET_IMPACTO)) {
    const iv = activeIntervals(g);
    assert.equal(iv[0].start, g.start);
    assert.equal(iv[iv.length - 1].end, g.end);
    for (let i = 1; i < iv.length; i++) assert.equal(iv[i].start, iv[i - 1].end);
  }
});

test("acentos y ñ se conservan; texto malicioso queda neutralizado", () => {
  const ass = buildAss([W("canción", 0, 1), W("{\\an8}año}", 1, 2), W("a\nb", 2, 3)], { ...PRESET_IMPACTO, uppercase: false }, { width: 1080, height: 1920 });
  assert.ok(ass.includes("canción"));
  assert.ok(ass.includes("año"));
  assert.ok(!/\{\\an8\}/.test(ass));
  assert.equal(escapeAss("a{b}c\\d\ne"), "a(b)c＼d e");
});

test("ASS: resolución y WrapStyle fijados", () => {
  const ass = buildAss(sample, PRESET_IMPACTO, { width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /WrapStyle: 2/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:00\.40/);
});

import { PRESET_LETRA, PRESET_LETRA_SUAVE, caseOf } from "./subtitles.ts";
test("formato Letra: minúsculas, sin contorno, palabras futuras invisibles pero en su sitio", () => {
  const ass = buildAss([W("Bajo", 0, 0.5), W("la", 0.5, 0.7), W("Luna.", 0.7, 1.2)], PRESET_LETRA, { width: 1080, height: 1920 });
  assert.match(ass, /Bootzy TM/);
  const first = ass.split("\n").find((l) => l.startsWith("Dialogue: 0,0:00:00.00"))!;
  assert.ok(first.includes("bajo") && first.includes("{\\alpha&HFF&}la") && first.includes("{\\alpha&HFF&}luna."), first);
  assert.equal(caseOf(PRESET_LETRA, "Mañana"), "mañana");
  const dim = buildAss([W("a", 0, 0.5), W("b", 0.5, 1)], PRESET_LETRA_SUAVE, { width: 1080, height: 1920 });
  assert.match(dim, /\\alpha&HA0&}b/);
});
