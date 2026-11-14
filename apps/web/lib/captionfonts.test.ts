// Catálogo de fuentes del contenido generado: familias, licencias, métricas re-derivadas del archivo, cobertura del español y medidas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CAPTION_FONTS, FALLBACK_FAMILY, SPANISH_CODEPOINTS, fontFor, coversText, resolveFamilyForText, measureText } from "@rafaga/composition";
import { readMetrics, METRIC_CODEPOINTS } from "@rafaga/lyrics";

const DIR = new URL("../public/fonts/caption/", import.meta.url);
const FAMILIES = ["Inter", "Roboto", "Playfair Display", "Oswald", "Pacifico", "Bebas Neue", "Montserrat", "Raleway", "Space Mono", "Dancing Script", "Righteous", "Anton", "Lobster", "Nunito", "Abril Fatface"];

test("las 15 familias están, con licencia OFL-1.1 o Apache-2.0 y URL https; Bootzy TM y Liberation Sans son de sistema y sin archivo", () => {
  for (const f of FAMILIES) {
    const e = CAPTION_FONTS.filter((x) => x.family === f); assert.ok(e.length, f);
    for (const x of e) { assert.ok(["OFL-1.1", "Apache-2.0"].includes(x.licence), `${f} ${x.licence}`); assert.match(x.licenceUrl ?? "", /^https:\/\//); assert.equal(x.source, "google-fonts"); assert.ok(x.file && x.sha256 && x.bytes > 10_000); }
  }
  for (const f of ["Bootzy TM", "Liberation Sans"]) { const e = CAPTION_FONTS.filter((x) => x.family === f); assert.ok(e.length, f); assert.ok(e.every((x) => x.source === "sistema" && x.file === null)); }
  const files = CAPTION_FONTS.flatMap((x) => (x.file ? [x.file] : [])); assert.equal(new Set(files).size, files.length, "sin archivos duplicados");
});

test("cada archivo existe, su sha256 coincide y readMetrics da los mismos anchos de avance que el catálogo", () => {
  for (const f of CAPTION_FONTS) {
    if (!f.file) continue;
    const b = new Uint8Array(readFileSync(new URL(f.file, DIR)));
    assert.equal(createHash("sha256").update(b).digest("hex"), f.sha256, f.file); assert.equal(b.length, f.bytes);
    const m = readMetrics(b, METRIC_CODEPOINTS); assert.deepEqual(m.advance, f.advance, f.file); assert.equal(m.unitsPerEm, f.unitsPerEm);
  }
});

test("cobertura del español: spanish y missing coinciden con lo que hay en cada fuente; un glifo que falta manda a Inter", () => {
  for (const f of CAPTION_FONTS) {
    const missing = SPANISH_CODEPOINTS.filter((c) => !(c in f.advance));
    if (f.source === "google-fonts") { assert.deepEqual(f.missing, missing, f.family); assert.equal(f.spanish, missing.length === 0); }
  }
  assert.equal(resolveFamilyForText("Bebas Neue", 400, "¿Qué ñandú?"), CAPTION_FONTS.every((f) => f.family !== "Bebas Neue" || f.spanish) ? "Bebas Neue" : FALLBACK_FAMILY);
  assert.equal(resolveFamilyForText("Anton", 400, "Hola ★"), FALLBACK_FAMILY, "un glifo que la fuente no tiene → Inter");
  assert.equal(resolveFamilyForText("Anton", 400, "Hola"), "Anton"); assert.equal(resolveFamilyForText("Fuente Inventada", 400, "Hola"), FALLBACK_FAMILY);
  assert.equal(coversText(fontFor("Inter", 400), "á é ñ ¿ ¡"), true);
});

test("measureText es determinista y un texto más largo mide más que su prefijo; el peso elige el archivo más cercano", () => {
  for (const [fam, w] of [["Inter", 400], ["Oswald", 700], ["Pacifico", 400], ["Liberation Sans", 400]] as const) {
    const a = measureText("Llueve sobre Madrid", fam, w, 64), b = measureText("Llueve sobre Madrid", fam, w, 64);
    assert.equal(a, b); assert.ok(measureText("Llueve sobre Madrid", fam, w, 64) > measureText("Llueve", fam, w, 64));
  }
  assert.equal(fontFor("Inter", 600).weight, 700); assert.equal(fontFor("Inter", 300).weight, 400); assert.ok(measureText("Hola", "Bootzy TM", 700, 48) > 0, "sin tabla propia, usa Inter");
  assert.ok(measureText("Mundo", "Inter", 700, 48) > measureText("Mundo", "Inter", 400, 48), "la negrita es más ancha");
});
