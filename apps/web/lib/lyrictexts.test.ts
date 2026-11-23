import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition, lyricSceneAt, lyricAss } from "@rafaga/composition";
import { withCta, withFixedTitle, withFades } from "./lyrictexts.ts";

const WORDS = [{ text: "hola", start: 11, end: 11.5, line: 0 }, { text: "mundo", start: 12, end: 12.5, line: 0 }, { text: "adiós", start: 38, end: 38.6, line: 1 }];
const base = () => validateLyricComposition({ aspect: "9:16", range: { start: 10, end: 40 }, words: WORDS });
const FPS = 30;

test("CTA: aparece solo en los últimos N s del tramo, en el fotograma exacto, y el texto vacío la quita", () => {
  const c = withCta(base(), "Escúchalo ya en Spotify", 4);
  assert.deepEqual(c.message, { text: "Escúchalo ya en Spotify", start: 36, end: 40 });
  for (let k = 0; k < 30 * FPS; k++) assert.equal(lyricSceneAt(c, k / FPS).message !== null, k >= 26 * FPS, `k=${k}`);
  assert.equal(withCta(c, "  ", 4).message, null);
});
test("CTA: segundos acotados a 1–15 y nunca más que el vídeo", () => {
  assert.equal(withCta(base(), "x", 99).message!.start, 25); assert.equal(withCta(base(), "x", 0).message!.start, 39);
});
test("título fijo: el gancho dura todo el vídeo y sale en el ASS de exportación (misma fuente que la escena)", () => {
  const c = withFixedTitle({ ...base(), hook: { text: "Mi canción nueva", dur: 3 } }, true);
  assert.equal(c.hook!.dur, 30);
  for (const t of [0, 14.9, 29.9]) assert.equal(lyricSceneAt(c, t).overlays.some((o) => o.id === "hook"), true, `t=${t}`);
  assert.match(lyricAss(c), /Mi canción nueva/);
  assert.equal(withFixedTitle({ ...base(), hook: { text: "x", dur: 3 } }, false).hook!.dur, 3);
});
test("fundidos de audio: se acotan a 0–5 s y quedan en la composición", () => {
  const c = withFades(base(), 9, -2); assert.deepEqual([c.settings.fadeIn, c.settings.fadeOut], [5, 0]);
  assert.deepEqual([validateLyricComposition(c).settings.fadeIn, validateLyricComposition(c).settings.fadeOut], [5, 0]);
});

test("el título fijo sobrevive a validateLyricComposition (el gancho admite hasta 600 s)", () => {
  const c = validateLyricComposition(withFixedTitle({ ...base(), hook: { text: "T", dur: 3 } }, true));
  assert.equal(c.hook!.dur, 30);
});
