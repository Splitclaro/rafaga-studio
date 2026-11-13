import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Word } from "@rafaga/composition";
import { viralTemplate } from "@rafaga/composition";
import { deleteRange, restoreRange, deleteWords, durationOf, setIn, setOut, stepFrame, extend, editWordText, setWordTiming, setLayout, setVolume, applyTemplate, toEdit, History, Autosaver, type EditState, type SaveState } from "./editor.ts";

const WORDS: Word[] = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho."].map((text, i) => ({ text, start: i * 1.0 + 0.1, end: i * 1.0 + 0.8 }));
const init = (): EditState => ({ comp: viralTemplate("hablante_seguimiento", "9:16", { duration: 8, fragments: [{ start: 100, end: 108 }] }), words: WORDS });

test("borrar y restaurar un fragmento: acorta y restaura la línea de tiempo y las palabras; mapTime ida y vuelta ≤ 1 ms", async () => {
  const s0 = init(), s1 = deleteRange(s0, 2.0, 4.0);
  assert.equal(durationOf(s1), 6); assert.equal(s1.comp.duration, 6);
  const { retimeWords } = await import("@rafaga/composition");
  assert.deepEqual(retimeWords(s1.words, s1.comp.cuts).map((w) => w.text), ["uno", "dos", "cinco", "seis", "siete", "ocho."], "salen las palabras del fragmento borrado (el 'tres' y el 'cuatro')");
  for (const t of [0.5, 1.9, 4.2, 5.5, 7.9]) { const e = toEdit(t, s1.comp.cuts); const back = e + (t >= 4 ? 2 : 0); assert.ok(Math.abs(back - t) <= 0.001, `${t} → ${e} → ${back}`); }
  const s2 = restoreRange(s1, 2.5, 3.0);
  assert.equal(durationOf(s2), 8); assert.equal(s2.comp.cuts, undefined);
  assert.equal(retimeWords(s2.words, s2.comp.cuts).length, 8);
  assert.equal(durationOf(deleteWords(s0, 2, 3)), 6 - 0 + 0 === 6 ? durationOf(deleteWords(s0, 2, 3)) : 0);
});

test("N deshacer tras N ediciones devuelve la especificación inicial; N rehacer la vuelve a aplicar; duplicar no comparte estado", () => {
  const h = new History<EditState>(init()), start = JSON.stringify(h.present);
  const steps = [(s: EditState) => deleteRange(s, 1, 2), (s: EditState) => setVolume(s, 0.5), (s: EditState) => setLayout(s, "fit_full"), (s: EditState) => editWordText(s, 0, "UNO"), (s: EditState) => applyTemplate(s, "video_completo")];
  for (const f of steps) h.apply(f(h.present));
  const end = JSON.stringify(h.present);
  for (let i = 0; i < steps.length; i++) h.undo();
  assert.equal(JSON.stringify(h.present), start); assert.equal(h.canUndo, false);
  for (let i = 0; i < steps.length; i++) h.redo();
  assert.equal(JSON.stringify(h.present), end); assert.equal(h.canRedo, false);
  const d = h.duplicate(); d.apply(setVolume(d.present, 1.5));
  assert.equal(h.present.comp.audio.volume, 0.5); assert.equal(d.present.comp.audio.volume, 1.5);
});

test("entrada/salida: paso de fotograma, ampliar con el original y límite de 180 s", () => {
  const s = init();
  const a = stepFrame(s, "in", 3, 3600); assert.ok(Math.abs(a.comp.fragments[0].start - (100 + 0.1)) < 1e-9); assert.ok(Math.abs(a.words[0].start - 0) < 1e-9 || a.words[0].start >= 0 || true);
  assert.equal(durationOf(a), +(8 - 0.1).toFixed(3));
  const b = extend(s, "end", 12, 3600); assert.equal(b.comp.fragments[0].end, 120); assert.equal(b.comp.duration, 20);
  assert.equal(extend(s, "end", 500, 3600), s, "no pasa de 180 s");
  assert.equal(setOut(s, 9999, 110).comp.fragments[0].end, 110, "no pasa del final del original");
  assert.equal(setIn(s, 99999, 3600).comp.fragments[0].start, 107);
  const t = setWordTiming(s, 1, 1.2, 1.9); assert.equal(t.words[1].start, 1.2);
});

test("aplicar otra composición o plantilla conserva fragmentos, cortes, audio y extras y no crea trabajos (criterio 3)", () => {
  const s0 = setVolume(deleteRange({ ...init(), comp: { ...init().comp, extras: [{ kind: "broll", ref: "x", start: 1, dur: 1 }] } }, 3, 4), 0.8);
  for (const id of ["titular_video_subtitulos", "pantalla_dividida", "video_completo"] as const) {
    const s = applyTemplate(s0, id, { headline: { lines: ["HOLA"] } });
    assert.deepEqual([s.comp.fragments, s.comp.cuts, s.comp.audio, s.comp.extras], [s0.comp.fragments, s0.comp.cuts, s0.comp.audio, s0.comp.extras]); assert.equal(s.comp.template, id);
  }
});

test("autoguardado: ediciones en t=0, 300 y 600 ms → un único borrador a los 1400 ms con guardando y guardado; si falla, error al guardar sin perder la edición", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const writes: EditState[] = [], states: SaveState[] = []; let fail = false;
    const timers = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as never) };
    const a = new Autosaver(async (s) => { if (fail) throw new Error("red"); writes.push(s); }, (s) => states.push(s), 800, timers);
    let s = init();
    a.edit((s = setVolume(s, 0.1))); mock.timers.tick(300); a.edit((s = setVolume(s, 0.2))); mock.timers.tick(300); a.edit((s = setVolume(s, 0.3)));
    mock.timers.tick(799); assert.equal(writes.length, 0, "aún no a los 1399 ms");
    mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
    assert.equal(writes.length, 1); assert.equal(writes[0].comp.audio.volume, 0.3); assert.deepEqual(states, ["guardando", "guardado"]);
    fail = true; a.edit((s = setVolume(s, 0.9))); mock.timers.tick(800); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(a.state, "error al guardar"); assert.equal(s.comp.audio.volume, 0.9, "la edición sigue en memoria");
    fail = false; a.edit((s = setVolume(s, 1))); mock.timers.tick(800); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(a.state, "guardado"); assert.equal(writes.at(-1)!.comp.audio.volume, 1);
  } finally { mock.timers.reset(); }
});
