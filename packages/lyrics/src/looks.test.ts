import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOKS, resolveLook, imageRect, layoutLyrics, frameState, layoutToAss, assFrameTime, planShots, lookFfmpegArgs, treatmentFilters, varyLook, measure, canvasSize, type LyricLook } from "./looks.ts";
import type { TimedWord } from "./index.ts";

const W = (text: string, start: number, end: number, line: number): TimedWord => ({ text, start, end, line, confidence: 1, origin: "asr" });
const song: TimedWord[] = [W("Do", 0.5, 0.8, 0), W("we", 1.0, 1.2, 0), W("live,", 1.3, 2.4, 0), W("or", 2.6, 2.8, 0), W("just", 2.9, 3.3, 0), W("survive", 3.4, 4.9, 1), W("tonight", 7.0, 7.6, 2)];

test("los tres looks son distintos en composición, no solo de nombre", () => {
  const [a, b, c] = ["archivo", "diario", "panoramico"].map((k) => LOOKS[k]);
  assert.notEqual(a.image.aspect, b.image.aspect); assert.notEqual(b.image.aspect, c.image.aspect);
  assert.equal(a.text.maxLines, 1); assert.equal(b.text.maxLines, 2); assert.equal(c.text.weight, 700);
  assert.ok(treatmentFilters(a.treatment, 1).some((f) => f.startsWith("noise")), "archivo lleva grano VHS");
  assert.ok(!treatmentFilters(b.treatment, 1).some((f) => f.startsWith("noise") || f.startsWith("rgbashift")), "diario sin textura analógica");
  for (const l of [a, b, c]) { assert.equal(l.text.color, "#FFFFFF"); assert.equal(l.text.case, "lower"); }
});

test("rectángulo de imagen: conserva aspecto, banda en vertical y pantalla completa en su lienzo nativo", () => {
  const a = imageRect(LOOKS.archivo, 1440, 1080);
  assert.deepEqual(a, { x: 0, y: 0, w: 1440, h: 1080 });
  const c = imageRect(LOOKS.panoramico, 1080, 1920);
  assert.equal(c.w, 1080); assert.ok(Math.abs(c.w / c.h - 2.3) < 0.02); assert.ok(Math.abs((c.y + c.h / 2) / 1920 - 0.383) < 0.01);
  const b = imageRect(LOOKS.diario, 1920, 1080); // lienzo más ancho que la imagen: columna, sin estirar
  assert.equal(b.h, 1080); assert.ok(Math.abs(b.w / b.h - 1.25) < 0.01);
});

test("layout: posiciones fijas, sin reflow al revelar y páginas que caben en el bloque", () => {
  const { W: w, H: h } = canvasSize("9:16");
  const L = layoutLyrics(song, LOOKS.diario, w, h, 9);
  const img = L.image;
  for (const p of L.words) {
    assert.ok(p.x >= img.x && p.x + measure(p.text, p.em, 400) <= img.x + img.w + 1, `${p.text} dentro de la imagen`);
    assert.ok(p.y >= img.y && p.y + p.em <= img.y + img.h, `${p.text} vertical dentro de la imagen`);
  }
  // misma palabra, misma posición durante toda su vida
  const at1 = frameState(L, 1.05).map((s) => s.word), at2 = frameState(L, 2.0).map((s) => s.word);
  assert.deepEqual(at1.map((x) => x.text), ["do", "we"]);
  assert.deepEqual(at2.slice(0, 2).map((x) => [x.x, x.y]), at1.map((x) => [x.x, x.y]));
  // silencio instrumental (5.5–7 s): sin letra inventada
  assert.equal(frameState(L, 6.2).length, 0);
  // palabra sostenida: «survive» (3.4–4.9) sigue visible al final de su nota
  assert.ok(frameState(L, 4.85).some((s) => s.word.text === "survive"));
});

test("flujo: por grupo y por frase", () => {
  const g = layoutLyrics(song, resolveLook("diario", { flow: { reveal: "phrase" } }), 1080, 1920, 9);
  assert.equal(frameState(g, 0.55).length, g.words.filter((w) => w.page === 0).length);
  const gr = layoutLyrics(song, resolveLook("diario", { flow: { reveal: "group", groupSize: 2 } }), 1080, 1920, 9);
  assert.deepEqual(frameState(gr, 0.55).map((s) => s.word.text), ["do", "we"]);
});

test("ASS: tiempos al frame, \\an7 con posición fija y escape del texto", () => {
  const L = layoutLyrics([...song, W("{\\b1}x", 8, 8.4, 3)], LOOKS.archivo, 1440, 1080, 9);
  const ass = layoutToAss(L);
  assert.ok(ass.includes("\\an7\\pos(") && !ass.includes("{\\b1}x"));
  // libass muestra un evento en el frame k si k/30 >= inicio: el floor al centisegundo conserva el frame exacto
  for (let k = 1; k < 300; k++) {
    const cs = Number(assFrameTime(k / 30).split(":")[2]);
    const sec = Math.floor(k / 30 / 60) * 60 + cs; // < 60 s
    assert.ok(k / 30 + 1e-9 >= sec && (k - 1) / 30 < sec, `frame ${k}`);
  }
});

test("montaje: cortes en frases, sin repetir clip consecutivo, cubre la duración", () => {
  const items = [{ path: "a", kind: "video" as const, duration: 20 }, { path: "b", kind: "video" as const, duration: 3 }, { path: "c", kind: "photo" as const }];
  const L = layoutLyrics(song, LOOKS.diario, 1080, 1920, 12);
  const s = planShots(items, L.pages, 12, LOOKS.diario.montage, 4);
  assert.equal(+s.reduce((t, x) => t + x.dur, 0).toFixed(2), 12);
  for (let i = 1; i < s.length; i++) assert.notEqual(s[i].item.path, s[i - 1].item.path);
  assert.ok(s.every((x) => x.dur <= LOOKS.diario.montage.maxShot + 0.01));
  assert.ok(s.some((x) => L.pages.some((p) => Math.abs(p.start - x.start) < 0.04 && x.start > 0)), "al menos un corte cae en un cambio de frase");
  assert.deepEqual(planShots(items, L.pages, 12, LOOKS.diario.montage, 4), s, "reproducible con la misma semilla");
});

test("overrides acotados y variantes distintas", () => {
  const l = resolveLook("archivo", { text: { size: 9, x: -3 }, treatment: { grain: 7 } } as never);
  assert.equal(l.text.size, 0.3); assert.equal(l.text.x, 0); assert.equal(l.treatment.grain, 1);
  const v1 = varyLook(LOOKS.diario, 1, 1), v2 = varyLook(LOOKS.diario, 2, 1);
  assert.notDeepEqual([v1.text.x, v1.image.offsetX], [v2.text.x, v2.image.offsetX]);
  assert.deepEqual(varyLook(LOOKS.diario, 1, 1), v1);
  assert.throws(() => resolveLook("nope"));
});

// --- Prueba real con FFmpeg/libass: misma palabra en el mismo frame y en la misma posición que la vista previa
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("export real: aparición en el frame exacto y posición de la palabra", { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), "look-"));
  try {
    const look: LyricLook = resolveLook("diario", { treatment: { desaturate: 0 } });
    const w = 360, h = 640, len = 2;
    const words = [W("hola", 0.5, 0.9, 0), W("mundo", 1.0, 1.6, 0)];
    const L = layoutLyrics(words, look, w, h, len);
    writeFileSync(join(dir, "l.ass"), layoutToAss(L));
    spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-t", "2", join(dir, "a.m4a")]);
    const args = lookFfmpegArgs({ look, W: w, H: h, len, shots: [], color: "#000000", seed: 1, audio: join(dir, "a.m4a"), ass: join(dir, "l.ass"), out: join(dir, "o.mp4"), escape: (p) => p });
    const r = spawnSync("ffmpeg", args); assert.equal(r.status, 0, r.stderr?.toString());
    spawnSync("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "o.mp4"), "-f", "rawvideo", "-pix_fmt", "gray", join(dir, "o.raw")]);
    const raw = readFileSync(join(dir, "o.raw")), fs = w * h;
    assert.equal(raw.length / fs, 60, "60 frames a 30 fps");
    const bright = (k: number, x0: number, y0: number, x1: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (raw[k * fs + y * w + x] > 180) n++; return n; };
    const [p1, p2] = L.words;
    const box = (p: typeof p1) => [Math.max(0, p.x - 2), Math.max(0, p.y - 2), Math.min(w, p.x + Math.ceil(measure(p.text, p.em, 400)) + 2), Math.min(h, p.y + Math.ceil(p.em * 1.2))] as const;
    assert.equal(bright(14, ...box(p1)), 0, "frame 14: aún no");
    assert.ok(bright(15, ...box(p1)) > 20, "frame 15 (0,5 s): visible");
    assert.equal(bright(29, ...box(p2)), 0); assert.ok(bright(30, ...box(p2)) > 20, "frame 30 (1,0 s)");
    // nada fuera de las cajas previstas en el frame 40 (ambas visibles)
    let outside = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inBox = [p1, p2].some((p) => { const [a, b, c, d] = box(p); return x >= a && x < c && y >= b && y < d; });
      if (!inBox && raw[40 * fs + y * w + x] > 180) outside++;
    }
    assert.ok(outside < 15, `píxeles de texto fuera de la posición prevista: ${outside}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
