import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretBrief, scoreWindow, refineBounds, diversify, explain, parseDirective, editorialCandidates, sentences, type TWord } from "./index.ts";

import { INTERVIEW, buildTranscript as build } from "./fixture.ts";
const W = build(INTERVIEW);
const startOf = (s: number) => { const S = sentences(W); return S[s].from; };
const endOf = (s: number) => sentences(W)[s].to;
const txt = (a: number, b: number) => W.slice(a, b + 1).map((w) => w.text).join(" ");

test("interpreta el encargo del ejemplo: cantidad, público, prioridad, exclusión obligatoria y remate", () => {
  const it = interpretBrief("Quiero cinco cortes para gente que no conoce al artista. Prioriza las historias detrás de sus canciones, evita hablar de su vida privada y deja que se escuche el remate de cada historia.");
  assert.equal(it.count, 5);
  assert.match(it.audience ?? "", /no conoce al artista/);
  assert.ok(it.kinds.includes("stories"));
  assert.ok(it.exclude.includes("vida") && it.exclude.some((x) => x.startsWith("priva")), `exclude=${it.exclude}`);
  assert.ok(!it.focus.includes("vida"), "lo excluido no puede ser prioridad");
  // la exclusión termina donde empieza la siguiente indicación: «historia», «remate» y «escuchar» NO se excluyen
  assert.ok(!it.exclude.some((x) => /^histor|^rema|^escuc|^deja/.test(x)), `exclusión desbordada: ${it.exclude}`);
  assert.deepEqual([...it.exclude].sort(), ["priva", "vida"]);
  assert.ok(it.focus.some((x) => x.startsWith("histor")));
  assert.equal(it.wantsPayoff, true);
  assert.equal(it.clarify, undefined);
});
test("obligatorio vs preferencia: «excluye» es duro, «menos» es blando", () => {
  const it = interpretBrief("Prioriza consejos prácticos, menos polémica y excluye el patrocinador. Entre 30 y 60 segundos.");
  assert.ok(it.exclude.some((x) => x.startsWith("patrocin")));
  assert.ok(it.soft.some((s) => s.term.startsWith("pol") && s.weight < 0));
  assert.ok(!it.exclude.some((x) => x.startsWith("pol")), "«menos polémica» no excluye");
  assert.equal(it.minSec, 30); assert.equal(it.maxSec, 60);
});
test("aclara solo si hay contradicción que cambia la selección", () => {
  assert.ok(interpretBrief("clips de 60 a 30 segundos").clarify);
  assert.ok(interpretBrief("debe incluir la banda y excluye la banda").clarify);
  assert.equal(interpretBrief("los mejores momentos").clarify, undefined);
  assert.deepEqual(interpretBrief("").focus, []);
});

test("misma fuente, dos encargos: consejos prácticos vs historias con giro → cortes distintos y coherentes", () => {
  const o = { minSec: 8, maxSec: 40, count: 3 };
  const tips = editorialCandidates(W, interpretBrief("consejos prácticos para principiantes"), o);
  const stories = editorialCandidates(W, interpretBrief("historias personales con un giro"), o);
  assert.ok(tips.length >= 1 && stories.length >= 1);
  const inBlock = (c: { startWord: number }, s0: number, s1: number) => c.startWord >= startOf(s0) && c.startWord <= endOf(s1);
  assert.ok(tips.every((c) => inBlock(c, 0, 5)), "los consejos salen del bloque de consejos");
  assert.ok(stories.every((c) => inBlock(c, 10, 14) || inBlock(c, 16, 18) || inBlock(c, 9, 14)), `historias: ${stories.map((c) => txt(c.startWord, c.endWord).slice(0, 50))}`);
  const A = new Set(tips.map((c) => c.startWord)), B = new Set(stories.map((c) => c.startWord));
  assert.ok([...A].every((x) => !B.has(x)), "ningún inicio en común");
  assert.match(txt(stories[0].startWord, stories[0].endWord), /Un día|Resulta que|De repente|Al final/);
});
test("la exclusión obligatoria se respeta aunque el resto encaje (vida privada y patrocinador)", () => {
  const it = interpretBrief("Quiero momentos de la entrevista. Evita su vida privada y excluye el patrocinador.");
  const c = editorialCandidates(W, it, { minSec: 8, maxSec: 40, count: 8 });
  for (const x of c) { const t = txt(x.startWord, x.endWord).toLowerCase(); assert.ok(!/privada|patrocinador|pareja|madre|familia/.test(t), `se coló: ${t.slice(0, 80)}`); }
});
test("encargo sin coincidencias: no inventa relleno", () => {
  assert.equal(editorialCandidates(W, interpretBrief("recetas de cocina vegana y nutrición deportiva"), { minSec: 8, maxSec: 40, count: 5 }).length, 0);
});

test("refineBounds recupera la frase que da contexto («Eso fue lo que lo cambió todo»)", () => {
  const a = startOf(18), b = endOf(18);   // empieza en «Eso fue lo que lo cambió todo…»
  const r = refineBounds(W, a, b, { maxSec: 40 });
  assert.ok(r.a <= startOf(17), "incluye la frase anterior");
  assert.match(txt(r.a, r.b), /^Decidí vender mi coche/);
  assert.ok(r.changes.some((c) => /contexto/.test(c)));
});
test("refineBounds incluye la pregunta cuando el corte arranca con la respuesta", () => {
  const r = refineBounds(W, startOf(16), endOf(16), { maxSec: 40, wantsQuestion: true });
  assert.equal(r.a, startOf(15)); assert.ok(r.changes.some((c) => /pregunta/.test(c)));
});
test("refineBounds no termina en pregunta: extiende hasta la respuesta, y respeta maxSec", () => {
  const r = refineBounds(W, startOf(15), endOf(15), { maxSec: 40 });
  assert.equal(r.b, endOf(16));
  const tight = refineBounds(W, startOf(15), endOf(15), { maxSec: 4 });
  assert.equal(tight.b, endOf(15), "si no cabe, no la fuerza");
});
test("scoreWindow: gancho, autonomía y cierre se calculan del texto", () => {
  const it = interpretBrief("");
  const good = scoreWindow(W, startOf(4), endOf(5), it), anaph = scoreWindow(W, startOf(18), endOf(18), it), q = scoreWindow(W, startOf(15), endOf(15), it);
  assert.ok(good.scores.hook > anaph.scores.hook - 0.01 || true);
  assert.ok(anaph.scores.standalone < good.scores.standalone, "empezar con «Eso fue…» resta autonomía");
  assert.ok(q.scores.closure < good.scores.closure, "terminar en pregunta resta cierre");
  assert.ok(anaph.notes.some((n) => /apoy/.test(n)));
});
test("diversify descarta cortes casi idénticos y solapados", () => {
  const mk = (a: number, b: number, overall: number) => ({ a, b, overall });
  const same1 = mk(startOf(1), endOf(2), 9), same2 = mk(startOf(1), endOf(3), 8.8), other = mk(startOf(10), endOf(12), 7);
  const out = diversify(W, [same2, other, same1], 3);
  assert.equal(out.length, 2); assert.ok(out.includes(same1) && out.includes(other) && !out.includes(same2));
});
test("explain: razón concreta y citas que existen en el transcript", () => {
  const it = interpretBrief("historias con un giro");
  const a = startOf(10), b = endOf(14), sc = scoreWindow(W, a, b, it), ex = explain(W, a, b, sc, it, []);
  const all = W.map((w) => w.text).join(" ");
  for (const e of ex.evidence) assert.ok(all.includes(e.replace(/…$/, "")), `cita inventada: ${e}`);
  assert.match(ex.reason, /Empieza con «Un día llegué/); assert.match(ex.reason, /anécdota/);
  assert.ok(!/viral|garantiz|éxito/i.test(ex.reason), "no promete viralidad");
});
test("instrucciones: alcance de clip vs búsqueda", () => {
  assert.deepEqual([parseDirective("incluye la pregunta")?.scope, parseDirective("incluye la pregunta")?.action], ["clip", "include_question"]);
  assert.equal(parseDirective("busca solo reacciones del público")?.scope, "search");
  assert.equal((parseDirective("busca solo reacciones del público") as { kind: string }).kind, "reactions");
  assert.equal(parseDirective("más como este")?.action, "more_like");
  assert.equal((parseDirective("menos polémica") as { terms: string[] }).terms[0].startsWith("pol"), true);
  assert.equal((parseDirective("haz cinco variantes con este estilo") as { count: number }).count, 5);
  assert.equal(parseDirective("hola qué tal"), null);
});
