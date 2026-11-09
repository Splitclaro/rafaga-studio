import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyle, importStyle, exportStyle, surpriseStyle } from "./style.ts";
import { buildAss, PRESET_LETRA } from "./subtitles.ts";

test("validateStyle limita valores y descarta basura/inyección", () => {
  const s = validateStyle({ fontName: "Arial}{\\an8", fontSize: 9999, primary: "red", active: "#abcdef", outlineWidth: -5, y: 5, maxLines: 99, highlight: "evil", uppercase: true, lowercase: true });
  assert.equal(s.fontName, PRESET_LETRA.fontName); assert.equal(s.fontSize, 200); assert.equal(s.primary, PRESET_LETRA.primary);
  assert.equal(s.active, "#ABCDEF"); assert.equal(s.outlineWidth, 0); assert.equal(s.y, 0.92); assert.equal(s.maxLines, 3); assert.equal(s.highlight, "reveal"); assert.equal(s.uppercase, false);
});
test("importar/exportar con esquema versionado", () => {
  const t = exportStyle("Mi estilo", { ...PRESET_LETRA, fontSize: 90 });
  const r = importStyle(t); assert.equal(r?.name, "Mi estilo"); assert.equal(r?.style.fontSize, 90);
  assert.equal(importStyle("{}"), null); assert.equal(importStyle("no json"), null);
});
test("Sorpréndeme: reproducible, válido y renderizable en ASS", () => {
  assert.deepEqual(surpriseStyle(5, "Bootzy TM"), surpriseStyle(5, "Bootzy TM"));
  assert.notDeepEqual(surpriseStyle(5, "Bootzy TM"), surpriseStyle(6, "Bootzy TM"));
  for (let i = 0; i < 50; i++) { const s = surpriseStyle(i, "Bootzy TM"); assert.ok(s.y >= 0.1 && s.y <= 0.92 && s.fontSize >= 32); buildAss([{ text: "hola", start: 0, end: 1 }], s, { width: 1080, height: 1920 }); }
});
