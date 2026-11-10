import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTitle, splitSentences } from "./title.ts";

const text = "Bueno, pues entonces hoy quiero hablaros de algo. El primer error que cometí fue no hablar con clientes antes de construir el producto. Me equivoqué por completo.";

test("sin enfoque: frase autónoma, sin muletillas y solo con palabras del texto", () => {
  const t = suggestTitle(text);
  assert.ok(!/^(bueno|pues|entonces)/i.test(t), t);
  assert.ok(t.split(" ").length <= 10);
  const bag = new Set(text.toLowerCase().replace(/[.,]/g, "").split(/\s+/));
  for (const w of t.toLowerCase().replace(/[.,]/g, "").split(/\s+/)) assert.ok(bag.has(w), `palabra inventada: ${w}`);
});
test("con enfoque: elige la frase que encaja con el objetivo", () => {
  assert.match(suggestTitle(text, "errores al hablar con clientes"), /error|clientes/i);
  assert.match(suggestTitle("Hoy hablamos del tiempo. Para vender más debes entender a tus clientes desde el primer día. Gracias por venir.", "vender a clientes"), /vender|clientes/i);
});
test("no termina en palabra vacía ni en puntuación y empieza en mayúscula", () => {
  const t = suggestTitle("Pensaba que mi idea era tan buena que se vendería sola y nadie podría competir con ella nunca.");
  assert.ok(!/[.,;:]$/.test(t)); assert.match(t[0], /[A-ZÁÉÍÓÚÑ]/);
  assert.ok(!/\b(de|la|que|y|en|con)$/i.test(t), t);
});
test("pregunta: conserva la apertura y el cierre", () => {
  assert.equal(suggestTitle("¿Por qué fracasan tantas empresas nuevas? Nadie lo sabe."), "¿Por qué fracasan tantas empresas nuevas?");
});
test("texto vacío o muy corto no rompe", () => {
  assert.equal(suggestTitle(""), ""); assert.ok(suggestTitle("Hola.").length > 0);
  assert.deepEqual(splitSentences("Uno. Dos? Tres!"), ["Uno.", "Dos?", "Tres!"]);
});
