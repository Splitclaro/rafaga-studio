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

import { lexicalCandidates, parseBrief } from "./lexical.ts";
const say = (t: string, t0: number) => t.split(" ").map((x, i) => ({ text: x, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35 }));
const pod = [
  ...say("Hoy hablamos de ventas. El error más común al vender es no escuchar al cliente. Haz tres preguntas sobre su problema antes de proponer. Así el precio deja de ser la objeción principal y vender se vuelve ayudar.", 0),
  ...say("Ahora el patrocinador. Este episodio está patrocinado por una marca de café de especialidad con descuento para ti y para tu familia entera.", 20),
  ...say("Mi invitado creció en un pueblo de Galicia y se mudó solo a Madrid sin dinero. Durmió dos años en el sofá de un amigo. Hoy recuerda aquel sofá como su mejor comienzo.", 40),
].map((w, i, a) => (i && w.start < a[i - 1].end ? { ...w, start: a[i - 1].end } : w));
test("parseBrief separa exclusiones", () => {
  const p = parseBrief("Consejos de venta. Evita el patrocinador.");
  assert.ok(p.exclude.some((x) => x.startsWith("patrocin")));
  assert.ok(!p.want.some((x) => x.startsWith("patrocin")));
});
test("selector léxico: briefs distintos → selecciones distintas y exclusión respetada", () => {
  const o = { minSec: 6, maxSec: 25, count: 1, hasBrief: true };
  const v = validateCandidates(pod, lexicalCandidates(pod, "Consejos para vender y escuchar al cliente. Excluye el patrocinador.", o), o).accepted;
  const h = validateCandidates(pod, lexicalCandidates(pod, "La historia del invitado en Galicia y Madrid.", o), o).accepted;
  assert.ok(v.length && h.length);
  assert.ok(v[0].endSec <= 20.5, "ventas dentro del primer bloque");
  assert.ok(h[0].startSec >= 40, "historia dentro del tercer bloque");
  const none = lexicalCandidates(pod, "Recetas de cocina vegana", o);
  assert.equal(none.length, 0, "sin coincidencias no inventa");
});
test("selector léxico no premia ventanas largas: dos enfoques sobre el guion real eligen tramos distintos", () => {
  const txt = "Hola a todos, bienvenidos al podcast de emprendedores. Hoy hablamos de 2 cosas muy distintas. Primero, consejos de venta para principiantes. El error más común al vender es hablar de tu producto en lugar de escuchar al cliente. Antes de proponer nada, haz tres preguntas sobre su problema. Cuando entiendes el problema, el precio deja de ser la objeción principal. Si solo recuerdas una cosa, que sea esta: vender es ayudar a decidir, no convencer a la fuerza. Ahora una pausa para el patrocinador. Este episodio está patrocinado por una marca de café de especialidad. Usa el código podcast para obtener un 10% de descuento en tu primer pedido. Gracias por apoyar el programa. Y pasamos a la segunda parte, la historia personal de nuestro invitado. Mi invitado creció en un pueblo pequeño de Galicia, y a los 18 años se mudó solo a Madrid sin dinero. Durante 2 años durmió en el sofá de un amigo y trabajó de camarero por las noches. Una madrugada, cansado, decidió que iba a montar su propia empresa. Hoy, 10 años después, recuerda aquel sofá como el mejor comienzo posible. Eso es todo por hoy.";
  const ws = say(txt, 0);
  const o = { minSec: 12, maxSec: 45, count: 1, hasBrief: true };
  const sponsorAt = ws.findIndex((w) => /patrocinad/.test(w.text));
  const v = validateCandidates(ws, lexicalCandidates(ws, "Consejos de venta para principiantes. Excluye la parte del patrocinador.", o), o).accepted[0];
  const h = validateCandidates(ws, lexicalCandidates(ws, "La historia personal del invitado.", o), o).accepted[0];
  assert.ok(v && h);
  assert.ok(v.endWord < sponsorAt, "ventas termina antes del patrocinador");
  assert.ok(h.startWord > sponsorAt, "historia empieza después del patrocinador");
});
