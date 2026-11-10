import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBrief, composeBrief, lexicalBrief, BRIEF_MAX_TOTAL } from "./brief.ts";
import { lexicalCandidates } from "./lexical.ts";
import type { TWord } from "./index.ts";

test("normaliza: recorta, limpia caracteres de control y devuelve null si está vacío", () => {
  assert.equal(normalizeBrief({}), null); assert.equal(normalizeBrief({ objective: "   " }), null);
  const b = normalizeBrief({ objective: "  Promocionar\n el  estribillo <b>", tone: "x".repeat(500), foo: "no" })!;
  assert.equal(b.objective, "Promocionar el estribillo b"); assert.equal(b.tone!.length, 80); assert.ok(!("foo" in b));
});
test("compone un texto con todas las secciones y respeta el máximo", () => {
  const t = composeBrief({ objective: "Promocionar el estribillo del single", audience: "jóvenes de 18 a 25", topics: "estribillo, noche", must_include: "la artista", tone: "Cercano", cta: "Escucha el single", language: "Español", avoid: "el patrocinador, la intro" });
  for (const x of ["Promocionar el estribillo del single.", "Público: jóvenes", "Temas prioritarios: estribillo, noche.", "Debe aparecer: la artista.", "Tono: Cercano.", "Llamada a la acción: Escucha el single.", "Idioma: Español.", "Evita el patrocinador, la intro."]) assert.ok(t.includes(x), x);
  assert.ok(composeBrief({ objective: "a".repeat(1000), topics: "b".repeat(300), audience: "c".repeat(200), must_include: "d".repeat(300), avoid: "e".repeat(300), cta: "f".repeat(200) }).length <= BRIEF_MAX_TOTAL);
});
test("el brief léxico NO incluye público, tono ni llamada a la acción", () => {
  const l = lexicalBrief({ objective: "Errores al vender", audience: "estudiantes universitarios", tone: "Divertido", cta: "Suscríbete ya", avoid: "patrocinador" });
  assert.ok(/errores/i.test(l) && /Evita patrocinador/.test(l)); assert.ok(!/universitarios|divertido|suscr/i.test(l));
});
test("el brief estructurado cambia realmente la selección sin IA (misma fuente, dos objetivos)", () => {
  const text = "El primer error al vender fue no hablar con clientes. Cometí ese error durante meses sin darme cuenta. Eso me costó mucho dinero. Por otro lado la receta de la tarta lleva harina y huevos y azúcar. Mezcla la harina con los huevos despacio hasta que quede suave y luego hornea la tarta durante una hora. Gracias por ver el vídeo hasta el final.";
  const words: TWord[] = []; let t = 0; for (const w of text.split(" ")) { words.push({ text: w, start: t, end: t + 0.35 }); t += 0.4; }
  const a = lexicalCandidates(words, lexicalBrief({ objective: "errores al vender a clientes" }), { minSec: 5, maxSec: 30, count: 2 });
  const b = lexicalCandidates(words, lexicalBrief({ objective: "receta de tarta con harina y huevos" }), { minSec: 5, maxSec: 30, count: 2 });
  assert.ok(a.length && b.length);
  assert.ok(words.slice(a[0].startWord, a[0].endWord + 1).map((w) => w.text).join(" ").match(/error|clientes|vender/i));
  assert.ok(words.slice(b[0].startWord, b[0].endWord + 1).map((w) => w.text).join(" ").match(/tarta|harina|huevos/i));
  const ex = lexicalCandidates(words, lexicalBrief({ objective: "dinero y errores", avoid: "receta tarta harina" }), { minSec: 5, maxSec: 30, count: 3 });
  for (const c of ex) assert.ok(!words.slice(c.startWord, c.endWord + 1).map((w) => w.text).join(" ").match(/tarta|harina/i), "la exclusión se respeta");
});
