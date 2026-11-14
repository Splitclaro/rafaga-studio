// Estilo v2 y motor de escena de letra: validación, conversión a SubtitleStyle, presets, diseño, escena ↔ ASS por fotograma y planos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCaptionStyle, captionStyleBytes, captionToSubtitleStyle, captionFromSubtitleStyle, surpriseCaption, BEHAVIOUR_PRESETS, DEFAULT_CAPTION, CAPTION_FAMILIES } from "./style.ts";
import { validateStyle } from "./style.ts";
import { buildAss, PRESET_LETRA } from "./subtitles.ts";
import { validateLyricComposition, lyricLayout, lyricSceneAt, lyricTimeline, lyricAss, lyricShots, lyricFrameSize, shakeOffset, FPS, type LyricComposition } from "./lyricscene.ts";

const KEYS = ["active", "activeColor", "case", "color", "effect", "entrance", "entranceBy", "font", "position", "rafagaStyle", "size", "sizeFine", "weight"];
const NAMES = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce".split(" ");
const WORDS = NAMES.map((text, k) => ({ text, start: 0.5 + k * 0.6, end: 0.5 + k * 0.6 + 0.5, line: Math.floor(k / 4) }));
const comp = (o: Record<string, unknown> = {}): LyricComposition => validateLyricComposition({ aspect: "9:16", res: 1080, range: { start: 0, end: 9 }, words: WORDS, preset: "frase_palabra_activa", seed: 5, ...o });

test("validateCaptionStyle: fuera de rango, estilo v1 y basura dan un estilo v2 válido con los 9 controles y menos de 4000 bytes", () => {
  const bad = validateCaptionStyle({ rafagaStyle: 2, font: "Fuente Inventada", weight: 999, color: "rojo", sizeFine: 9, position: { x: 7, y: -3 }, effect: "x", entrance: 5, size: "XL" });
  assert.deepEqual(Object.keys(bad).sort(), KEYS);
  assert.equal(bad.font, CAPTION_FAMILIES[0]); assert.equal(bad.weight, 700); assert.equal(bad.color, DEFAULT_CAPTION.color); assert.equal(bad.sizeFine, 1.6); assert.ok(bad.position.x <= 0.9 && bad.position.y >= 0.1); assert.equal(bad.size, "M");
  for (const raw of [PRESET_LETRA, null, 42, "x", [], { rafagaStyle: 1 }]) { const s = validateCaptionStyle(raw); assert.deepEqual(Object.keys(s).sort(), KEYS); assert.ok(captionStyleBytes(s) < 4000); assert.deepEqual(validateCaptionStyle(s), s, "idempotente"); }
  assert.equal(validateCaptionStyle(PRESET_LETRA).rafagaStyle, 2);
});

test("captionToSubtitleStyle da un SubtitleStyle que buildAss acepta y que validateStyle deja igual", () => {
  for (const seed of [1, 2, 3, 4]) {
    const v2 = surpriseCaption(seed), st = captionToSubtitleStyle(v2);
    assert.deepEqual(validateStyle(st), st);
    const ass = buildAss([{ text: "Hola", start: 0, end: 0.5 }, { text: "mundo", start: 0.5, end: 1 }], st, { width: 1080, height: 1920 });
    assert.match(ass, /Dialogue:/);
  }
  assert.equal(captionFromSubtitleStyle(validateStyle({ ...PRESET_LETRA, bold: true })).weight, 700);
});

test("BEHAVIOUR_PRESETS tiene los 5 presets con todos sus campos; surpriseCaption es reproducible y válido", () => {
  assert.deepEqual(Object.keys(BEHAVIOUR_PRESETS).sort(), ["entrada_deslizada", "escritura_progresiva", "frase_palabra_activa", "palabra_a_palabra", "texto_estatico"]);
  for (const p of Object.values(BEHAVIOUR_PRESETS)) { assert.ok(p.unit && p.group.words >= 1 && p.group.lines >= 1 && p.active && p.entrance && p.exit); assert.equal(typeof p.durationMs, "number"); }
  assert.deepEqual(surpriseCaption(42), surpriseCaption(42)); assert.deepEqual(validateCaptionStyle(surpriseCaption(42)), surpriseCaption(42)); assert.notDeepEqual(surpriseCaption(1), surpriseCaption(2));
});

test("lyricLayout: cajas pares dentro del fotograma, líneas ≤ 0,84 W y una página por palabra en palabra_a_palabra", () => {
  for (const aspect of ["9:16", "4:5", "1:1", "16:9"] as const) for (const preset of Object.keys(BEHAVIOUR_PRESETS) as (keyof typeof BEHAVIOUR_PRESETS)[]) {
    const c = comp({ aspect, preset, style: { size: "L" } }), L = lyricLayout(c), { width, height } = lyricFrameSize(c);
    assert.deepEqual(L.frame, { width, height });
    for (const w of Object.values(L.word)) { const b = w.box; assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width + 2 && b.y + b.h <= height, `${aspect}/${preset} ${JSON.stringify(b)}`); assert.ok(b.x % 2 === 0 && b.y % 2 === 0 && b.w % 2 === 0 && b.h % 2 === 0); }
    for (const pg of L.pages) for (const ln of pg.lines) assert.ok(ln.box.w <= width * 0.84 + 4, `${aspect}/${preset} línea ${ln.box.w}`);
  }
  assert.equal(lyricLayout(comp({ preset: "palabra_a_palabra" })).pages.length, 12);
  assert.equal(lyricFrameSize({ aspect: "9:16", res: 720 }).width, 720);
});

/** Palabras visibles por fotograma según los eventos del ASS (misma regla de centésimas que libass). */
function assVisible(ass: string, c: LyricComposition, k: number) {
  const cs = (t: string) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100); }, now = Math.floor((k / FPS) * 100 + 1e-6), out = new Set<number>(), pos: Record<number, string> = {};
  for (const l of ass.split("\n").filter((x) => x.startsWith("Dialogue: 1,"))) {
    const f = l.split(","), text = l.replace(/^[^{]*\{[^}]*\}/, "");
    if (cs(f[1]) <= now && now < cs(f[2])) { const i = NAMES.indexOf(text); out.add(i); pos[i] = /\\pos\((-?\d+),(-?\d+)\)|\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(l)!.slice(1).filter(Boolean).join(","); }
  }
  void c; return { out, pos };
}
test("escena y ASS muestran las mismas palabras en cada fotograma (typewriter, activa subrayada/caja, sacudida)", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["typewriter por palabra", { preset: "escritura_progresiva" }], ["activa underline", { style: { active: "underline" } }], ["activa box", { style: { active: "box" } }],
    ["sacudida", { settings: { shake: true } }], ["typewriter por línea", { style: { entrance: "typewriter", entranceBy: "line" } }], ["palabra a palabra", { preset: "palabra_a_palabra" }], ["entrada deslizada", { preset: "entrada_deslizada" }],
  ];
  for (const [name, o] of cases) {
    const c = comp(o), L = lyricLayout(c), TL = lyricTimeline(c, L), ass = lyricAss(c);
    for (let k = 0; k < Math.ceil(c.duration * FPS); k++) {
      const scene = lyricSceneAt(c, k / FPS, L, TL), a = assVisible(ass, c, k);
      assert.deepEqual([...a.out].sort((x, y) => x - y), scene.words.map((w) => w.index).sort((x, y) => x - y), `${name} fotograma ${k}`);
    }
  }
});

test("lyricAss ancla cada palabra con \\an7\\pos(x,y) en su caja (más la sacudida) y fija tiempos al fotograma", () => {
  const c = comp({ preset: "texto_estatico", style: { active: "none", entrance: "none" } }), L = lyricLayout(c), ass = lyricAss(c), ev = ass.split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
  assert.equal(ev.length, c.words.length);
  for (const l of ev) { const i = NAMES.indexOf(l.replace(/^[^{]*\{[^}]*\}/, "")), m = /\\an7\\pos\((\d+),(\d+)\)/.exec(l)!; assert.deepEqual([+m[1], +m[2]], [L.word[i].box.x, L.word[i].box.y]); }
  const sh = comp({ settings: { shake: true } }), s0 = lyricSceneAt(sh, 1.0);
  assert.ok(s0.words.length > 0 && Math.abs(s0.shake.dx) <= 3 && Math.abs(s0.shake.dy) <= 3 && Number.isInteger(s0.shake.dx));
  assert.deepEqual(shakeOffset(4, 9), shakeOffset(4, 9));
  assert.match(ass, /Style: W,Inter,/); assert.match(ass, /WrapStyle: 2/);
});

test("lyricShots: reproducible por semilla, cubre la duración y respeta el orden fijo", () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ ref: `m${i}`, kind: "image" as const }));
  const c = comp({ background: { kind: "media", items, interval: 2, order: "aleatorio" } }), a = lyricShots(c), b = lyricShots(c);
  assert.deepEqual(a, b); assert.equal(a.at(-1)!.end, c.duration); assert.ok(a.every((s, i) => i === 0 || s.start === a[i - 1].end));
  assert.deepEqual(lyricShots(comp({ background: { kind: "media", items, interval: 3, order: "fijo" } })).map((s) => s.item), [0, 1, 2]);
  assert.notDeepEqual(lyricShots(comp({ seed: 99, background: { kind: "media", items, interval: 2, order: "aleatorio" } })), a);
  assert.deepEqual(lyricShots(comp()), []);
});
