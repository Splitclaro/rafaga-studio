// Modos Letra / Texto / Portada, ganchos y cambio de modo: misma lógica en la escena y en el ASS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition, lyricSceneAt, lyricAss, lyricLayout, switchLyricMode, FPS } from "./lyricscene.ts";

const WORDS = "uno dos tres cuatro cinco seis".split(" ").map((text, k) => ({ text, start: 1 + k, end: 1.8 + k, line: 0 }));
const base = (o: Record<string, unknown> = {}) => validateLyricComposition({ aspect: "9:16", res: 1080, range: { start: 0, end: 12 }, words: WORDS, seed: 4, ...o });
const csOf = (t: string) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100); };

test("modo texto: solo el mensaje y solo en [5, 9) s, sin palabras de la letra (escena y ASS)", () => {
  const c = base({ mode: "texto", message: { text: "Nuevo single ya disponible", start: 5, end: 9 } });
  for (let k = 0; k < 12 * FPS; k++) { const s = lyricSceneAt(c, k / FPS), on = k >= 150 && k < 270; assert.equal(s.words.length, 0); assert.equal(s.message !== null, on, `k=${k}`); }
  const ev = lyricAss(c).split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(ev.length >= 1 && ev.every((l) => l.startsWith("Dialogue: 2,") && csOf(l.split(",")[1]) === 500 && csOf(l.split(",")[2]) === 900));
});

test("modo portada: título y artista, portada delantera en la primera mitad y trasera en la segunda, zoom 1,00→1,06 en lenta y fijo en estática, letra solo si se activa", () => {
  const cover = { title: "Noche de verano", artist: "Ráfaga", front: "front.jpg", back: "back.jpg", motion: "lenta" };
  const c = base({ mode: "portada", cover }), n = 12 * FPS;
  const a = lyricSceneAt(c, 0).cover!, b = lyricSceneAt(c, (n - 1) / FPS).cover!;
  assert.equal(a.side, "front"); assert.equal(a.image, "front.jpg"); assert.equal(b.side, "back"); assert.equal(b.image, "back.jpg");
  assert.equal(a.zoom, 1); assert.ok(Math.abs(b.zoom - 1.06) < 1e-3); let prev = 1; for (let k = 0; k < n; k += 10) { const z = lyricSceneAt(c, k / FPS).cover!.zoom; assert.ok(z >= prev); prev = z; }
  assert.ok(lyricSceneAt(base({ mode: "portada", cover: { ...cover, motion: "estatica" } }), 6).cover!.zoom === 1);
  const s = lyricSceneAt(c, 3); assert.deepEqual([...new Set(s.overlays.map((o) => o.id))].sort(), ["artist", "title"]); assert.equal(s.words.length, 0);
  assert.equal(lyricSceneAt(base({ mode: "portada", cover: { ...cover, lyrics: true } }), 3.5).words.length > 0, true);
  assert.ok(lyricAss(c).includes("Noche") && lyricAss(c).includes("Ráfaga"));
});

test("switchLyricMode conserva words, style, background, range y seed idénticos", () => {
  const c = base({ message: { text: "Hola", start: 1, end: 3 }, cover: { title: "T" }, style: { font: "Oswald" }, background: { kind: "color", color: "#112233" } });
  for (const m of ["texto", "portada", "letra"] as const) { const t = switchLyricMode(c, m); assert.equal(t.mode, m); for (const k of ["words", "style", "background", "range", "seed"] as const) assert.deepEqual(t[k], c[k]); }
});

test("el gancho solo aparece dentro de su intervalo y en la franja superior (0,12 H), en la escena y en el ASS", () => {
  const c = base({ hook: { text: "No te lo pierdas", start: 2, dur: 3 } }), L = lyricLayout(c);
  for (let k = 0; k < 12 * FPS; k++) { const on = k >= 60 && k < 150; assert.equal(lyricSceneAt(c, k / FPS).hook !== null, on, `k=${k}`); }
  const o = lyricSceneAt(c, 3).overlays.find((x) => x.id === "hook")!; assert.ok(Math.abs(o.box.y + o.box.h / 2 - L.frame.height * 0.12) <= o.box.h, `y ${o.box.y}`);
  const ev = lyricAss(c).split("\n").filter((l) => l.startsWith("Dialogue: 2,") && l.includes("No te lo pierdas")); assert.equal(ev.length, 1); assert.equal(csOf(ev[0].split(",")[1]), 200); assert.equal(csOf(ev[0].split(",")[2]), 500);
});
