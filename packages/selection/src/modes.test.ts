import { test } from "node:test";
import assert from "node:assert/strict";
import type { TWord } from "./index.ts";
import { MODES, MODE_IDS, qualityFilters, scoreAll, editorialScore, EDITORIAL_WEIGHTS, minSecFor, shortfall, startsWithUnresolved } from "./modes.ts";

// Transcript propio de esta prueba (≈4 min, habla escasa con pausas largas entre bloques). No se exporta.
const SENTS = [
  "Hoy te cuento tres errores que cometí al montar mi estudio en casa.",                       // 0 gancho
  "El primero fue comprar equipo caro sin saber si de verdad lo necesitaba.",                  // 1
  "Mi consejo es empezar con lo básico y mejorar poco a poco, así que ahorra primero.",        // 2 consejo + conclusión
  "Eso lo aprendí demasiado tarde.",                                                           // 3 empieza con «Eso»
  "Pero ella me dijo que no hacía falta gastar tanto dinero.",                                 // 4 empieza con «ella»
  "¿Sabes cuál fue el peor error de todos?",                                                   // 5 pregunta
  "Gastar 2000 euros en un micrófono que ni siquiera sabía usar bien todavía.",                // 6 respuesta con cifra
  "La verdad es que la sala suena fatal.",                                                     // 7
  "Nada de lo que hay en esta lista tiene sentido por sí solo.",                               // 8 plano
  "Nada de lo que hay en esta lista tiene sentido por sí solo.",                               // 9 idéntico (empate)
];
const words: TWord[] = []; const first: number[] = [];
{ let t = 0; for (const [i, s] of SENTS.entries()) { first.push(words.length); for (const w of s.split(" ")) { words.push({ text: w, start: +t.toFixed(2), end: +(t + 0.34).toFixed(2) }); t += 0.38; } t += i % 3 === 2 ? 6 : 1.2; } }
const span = (i: number, j: number) => ({ startWord: first[i], endWord: (first[j + 1] ?? words.length) - 1 });

test("MODES: los 7 modos con prompt, filtros y modelo (null en destacados y manual)", () => {
  assert.deepEqual([...MODE_IDS].sort(), ["automatico", "destacados", "educativo", "historia", "manual", "por_tema", "pregunta_respuesta"]);
  for (const id of MODE_IDS) { assert.ok(MODES[id].promptId.length > 0); assert.ok(Array.isArray(MODES[id].filters)); }
  assert.equal(MODES.destacados.model, null); assert.equal(MODES.manual.model, null); assert.equal(MODES.automatico.model, "editorial");
});

test("filtros de calidad: mitad de frase, referencia sin antecedente, sin cierre y solape >50 %", () => {
  const A = span(0, 2), B = { startWord: first[1] + 3, endWord: span(1, 2).endWord }, C = span(3, 3), C2 = span(4, 4);
  const D = { startWord: first[5], endWord: first[6] + 3 }, E = span(0, 1), F = span(5, 6);
  const { kept, dropped } = qualityFilters(words, [A, B, C, C2, D, E, F], { score: (c) => scoreAll(words, [c])[0].score.overall });
  const keptKeys = kept.map((c) => c.startWord).sort((a, b) => a - b);
  assert.deepEqual(keptKeys, [A.startWord, F.startWord].sort((a, b) => a - b));
  const why = new Map(dropped.map((d) => [d.candidate.startWord, d.reason]));
  assert.equal(why.get(B.startWord), "sentence_start"); assert.equal(why.get(C.startWord), "unresolved_reference");
  assert.equal(why.get(C2.startWord), "unresolved_reference"); assert.equal(why.get(D.startWord), "closure"); assert.equal(why.get(E.startWord), "overlap");
  assert.equal(startsWithUnresolved([{ text: "El", start: 0, end: 1 }, { text: "perro", start: 1, end: 2 }], 0), false, "el artículo no cuenta");
  assert.equal(startsWithUnresolved([{ text: "Él", start: 0, end: 1 }, { text: "dijo", start: 1, end: 2 }], 0), true);
});

test("puntuación: cinco motivos 0–1 con texto, overall 0–100, orden esperado, empates sin alterar y sin «viral»", () => {
  assert.equal(Math.round(Object.values(EDITORIAL_WEIGHTS).reduce((a, b) => a + b, 0) * 100), 100);
  const good = span(5, 6), weak = span(8, 8);
  const [g] = scoreAll(words, [good], { brief: "errores y consejos del estudio" }), [w] = scoreAll(words, [weak], { brief: "errores y consejos del estudio" });
  for (const k of ["gancho", "desarrollo", "valor", "afinidad", "calidad_tecnica"] as const) { assert.ok(g.score.reasons[k].score >= 0 && g.score.reasons[k].score <= 1); assert.ok(g.score.reasons[k].text.length > 0); }
  assert.ok(g.score.overall >= 0 && g.score.overall <= 100); assert.ok(g.score.overall > w.score.overall, `${g.score.overall} vs ${w.score.overall}`);
  const order = scoreAll(words, [weak, good]); assert.equal(order[0].startWord, good.startWord);
  const t1 = span(8, 8), t2 = span(9, 9);
  const tied = scoreAll(words, [t1, t2]);
  assert.equal(tied[0].score.overall, tied[1].score.overall);
  assert.equal(tied[0].score.overall, editorialScore(words, t1).overall, "el empate no altera la nota");
  assert.ok(tied.every((x) => typeof x.score.notes.difference === "string" && x.score.notes.difference.length > 0));
  const all = scoreAll(words, [good, weak, t1, t2]);
  for (const c of all) for (const r of Object.values(c.score.reasons)) assert.doesNotMatch(r.text, /viral/i);
});

test("minSecFor: 70 % del objetivo entre el mínimo del rango y 3 s bajo el máximo", () => {
  assert.equal(minSecFor({ min: 10, max: 30 }, 30), 21);
  assert.equal(minSecFor({ min: 30, max: 60 }, 45), 32);
  assert.equal(minSecFor({ min: 30, max: 60 }), 30);
  assert.equal(minSecFor({ min: 10, max: 15 }, 90), 12);
});

test("shortfall: entrega menos con explicación; 0 → no_moments; sin pedido o cumplido → null", () => {
  assert.deepEqual(shortfall(10, 3, ["a", "b"]), { code: "shortfall", requested: 10, delivered: 3, reasons: ["a", "b"] });
  assert.equal(shortfall(10, 0, ["x"])!.code, "no_moments");
  assert.equal(shortfall(null, 3, []), null); assert.equal(shortfall(3, 3, []), null);
});
