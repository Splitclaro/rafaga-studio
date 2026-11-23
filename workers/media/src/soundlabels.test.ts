import test from "node:test";
import assert from "node:assert/strict";
import { dropSoundLabels } from "./stages/analysis.ts";

const w = (text: string, start: number, end = start + 0.4) => ({ text, start, end });

test("etiqueta suelta al inicio («Música» tras 3 s de silencio) se retira", () => {
  const r = dropSoundLabels([w("Música", 0, 1), w("Hola", 4.2), w("a", 4.7), w("todos", 5)]);
  assert.deepEqual(r.words.map((x) => x.text), ["Hola", "a", "todos"]);
  assert.equal(r.dropped.length, 1);
});
test("«[Aplausos]», «(risas)» y «♪» se retiran siempre, aunque estén pegadas al habla", () => {
  const r = dropSoundLabels([w("Gracias", 0), w("[Aplausos]", 0.5), w("(risas)", 0.9), w("♪", 1.2), w("seguimos", 1.5)]);
  assert.deepEqual(r.words.map((x) => x.text), ["Gracias", "seguimos"]);
});
test("«música» dentro de una frase se conserva", () => {
  const r = dropSoundLabels([w("Me", 0), w("encanta", 0.4), w("la", 0.8), w("música", 1.2), w("clásica", 1.6)]);
  assert.equal(r.words.length, 5); assert.equal(r.dropped.length, 0);
});
test("conserva tiempos y orden de las demás palabras", () => {
  const input = [w("Música", 0, 0.8), w("Uno", 3), w("dos", 3.5)];
  const r = dropSoundLabels(input);
  assert.deepEqual(r.words, [input[1], input[2]]);
});
