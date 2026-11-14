// Controles añadidos desde LyricTune: cursiva, espaciado entre letras y duración de la entrada. Vista previa y exportación leen los mismos valores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition, lyricLayout, lyricAss } from "./lyricscene.ts";
import { validateCaptionStyle } from "./style.ts";

const base = (style: Record<string, unknown> = {}) => validateLyricComposition({ range: { start: 0, end: 6 }, words: [{ text: "Hola", start: 0.2, end: 0.8, line: 0 }, { text: "mundo", start: 0.9, end: 1.6, line: 0 }, { text: "bonito", start: 1.7, end: 2.4, line: 0 }], style: { rafagaStyle: 2, ...style } });

test("validateCaptionStyle: cursiva, tracking y entranceMs se validan y se acotan; sin ellos el estilo no cambia", () => {
  const s = validateCaptionStyle({ rafagaStyle: 2, italic: true, tracking: 9, entranceMs: 99999 });
  assert.equal(s.italic, true); assert.equal(s.tracking, 0.3); assert.equal(s.entranceMs, 2000);
  const d = validateCaptionStyle({ rafagaStyle: 2 }); assert.equal(d.italic, undefined); assert.equal(d.tracking, undefined); assert.equal(d.entranceMs, undefined);
});
test("el espaciado entre letras ensancha las palabras en el diseño y se exporta como Spacing de ASS", () => {
  const a = lyricLayout(base()), b = lyricLayout(base({ tracking: 0.1 }));
  assert.ok(b.word[0].box.w > a.word[0].box.w, "la palabra mide más con espaciado");
  const ass = lyricAss(base({ tracking: 0.1 })), line = ass.split("\n").find((l) => l.startsWith("Style: W,"))!.split(",");
  assert.ok(Number(line[13]) > 0, `Spacing ${line[13]}`);   // campos: Name,Fontname,Fontsize,Primary,Secondary,Outline,Back,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing
});
test("la cursiva sale como Italic=-1 en ASS y la duración de entrada cambia las etiquetas de animación", () => {
  const line = (c: ReturnType<typeof base>) => lyricAss(c).split("\n").find((l) => l.startsWith("Style: W,"))!.split(",");
  assert.equal(line(base({ italic: true }))[8], "-1"); assert.equal(line(base())[8], "0");
  assert.notEqual(lyricAss(base({ entranceMs: 1500 })), lyricAss(base({ entranceMs: 200 })));
});
