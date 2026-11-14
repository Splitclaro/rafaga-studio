import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition } from "@rafaga/composition";
import { validateLyricSettings, FILTER_OPTIONS, filterByClass, officialCollections, settingsToComposition, orientationOf, OFFICIAL_EMPTY } from "./lyricsettings.ts";

test("validateLyricSettings acota recorte, oscurecer, intervalo y tamaño fino, y descarta filtros desconocidos", () => {
  const s = validateLyricSettings({ crop: 1.4, dim: 0.95, interval: 0.5, sizeFine: 2, filter: "Midnight" });
  assert.deepEqual([s.crop, s.dim, s.interval, s.sizeFine, s.filter], [1, 0.8, 2, 1.6, "none"]);
  assert.equal(validateLyricSettings(null).filter, "none");
});
test("los filtros son exactamente none, noche, super8, bn y vapor, sin etiquetas de otras herramientas", () => {
  assert.deepEqual(FILTER_OPTIONS.map(([id]) => id), ["none", "noche", "super8", "bn", "vapor"]);
  for (const [, label] of FILTER_OPTIONS) assert.ok(!["Midnight", "Noir", "Vaporwave"].includes(label));
});
test("filterByClass exige todos los filtros elegidos y deriva la orientación de ancho y alto", () => {
  const items = [{ id: 1, category: "ciudad", motion: "lento", mood: "calma", width: 1080, height: 1920 }, { id: 2, category: "ciudad", motion: "rapido", mood: "calma", width: 1920, height: 1080 }, { id: 3, category: "mar", motion: "lento", mood: "calma", width: 1000, height: 1000 }];
  assert.deepEqual(filterByClass(items, { category: "ciudad" }).map((i) => i.id), [1, 2]); assert.deepEqual(filterByClass(items, { category: "ciudad", motion: "lento", orientation: "vertical" }).map((i) => i.id), [1]);
  assert.deepEqual(filterByClass(items, { orientation: "cuadrado" }).map((i) => i.id), [3]); assert.equal(orientationOf(1920, 1080), "horizontal"); assert.equal(filterByClass(items, {}).length, 3);
});
test("officialCollections: sin oficiales → empty con el texto que explica cómo marcar uno propio", () => {
  const r = officialCollections([{ official: false }, { official: null }]); assert.deepEqual(r.items, []); assert.equal(r.empty, OFFICIAL_EMPTY); assert.match(r.empty!, /oficial/);
  assert.equal(officialCollections([{ official: true }]).empty, null);
});
test("settingsToComposition cambia solo background y settings", () => {
  const c = validateLyricComposition({ words: [{ text: "a", start: 0, end: 1, line: 0 }], style: { font: "Oswald" }, range: { start: 0, end: 5 }, seed: 9 });
  const t = settingsToComposition(c, validateLyricSettings({ crop: 0.5, filter: "noche", interval: 6 }));
  for (const k of ["words", "style", "range", "seed"] as const) assert.deepEqual(t[k], c[k]);
  assert.equal(t.settings.filter, "noche"); assert.equal(t.background.interval, 6);
});
