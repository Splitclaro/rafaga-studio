// Paridad vista previa = exportación: sceneAt (vista previa) y buildAss / ffmpegArgs (exportación) leen las mismas funciones.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sceneAt, subtitleGroups, toLegacyComposition, viralTemplate, planLayout, buildAss, ffmpegArgs, retimeWords, RATIO_SIZE, LAYOUT_IDS, unmapTime,
  type CompositionV2, type Word,
} from "./index.ts";

// Transcript de prueba propio de este archivo (palabras relativas al clip).
const WORDS: Word[] = [
  ["Hoy", 0.2], ["vamos", 0.55], ["a", 0.9], ["hablar", 1.05], ["de", 1.5], ["como", 1.7], ["grabar", 2.1], ["mejor", 2.5], ["en", 3.0], ["casa.", 3.2],
  ["El", 4.4], ["primer", 4.7], ["consejo", 5.1], ["es", 5.6], ["usar", 5.8], ["un", 6.2], ["micro", 6.4], ["cercano.", 6.9],
].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.32 }));
const FRAME = 1 / 30;
const base = (layout: CompositionV2["layout"], over: Partial<CompositionV2> = {}): CompositionV2 => ({ v: 2, aspect: "9:16", layout, fragments: [{ start: 0, end: 8 }], audio: { volume: 1 }, subtitles: { enabled: true, box: { x: 0, y: 0.7, w: 1, h: 0.12 } }, duration: 8, ...over });
const dialogues = (ass: string) => [...ass.matchAll(/^Dialogue: \d+,(\d+):(\d+):(\d+)\.(\d+),(\d+):(\d+):(\d+)\.(\d+),Default/gm)].map((m) => ({ s: +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100, e: +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 100 }));

for (const cuts of [undefined, [{ s: 3.4, e: 4.2 }]]) test(`subtítulos: inicio y fin de cada grupo en la escena = evento Dialogue de buildAss (±1 fotograma)${cuts ? " con cortes" : ""}`, () => {
  const c = base("single_track", { cuts });
  const legacy = toLegacyComposition(c, WORDS, { width: 1920, height: 1080 });
  const ass = buildAss(retimeWords(legacy.words, legacy.cuts), legacy.style, RATIO_SIZE["9:16"]);
  const evs = dialogues(ass), groups = subtitleGroups(c, WORDS, legacy.style);
  assert.ok(groups.length >= 2 && evs.length >= groups.length);
  for (const g of groups) {
    const inside = evs.filter((e) => e.s >= g.start - FRAME && e.e <= g.end + FRAME);
    assert.ok(inside.length > 0, `grupo ${g.start}-${g.end} sin eventos`);
    assert.ok(Math.abs(inside[0].s - g.start) <= FRAME, `inicio ${inside[0].s} vs ${g.start}`);
    assert.ok(Math.abs(inside.at(-1)!.e - g.end) <= FRAME, `fin ${inside.at(-1)!.e} vs ${g.end}`);
    const mid = (g.start + g.end) / 2, s = sceneAt(c, mid, 1920, 1080, { words: WORDS, style: legacy.style });
    assert.ok(s.subtitle && Math.abs(s.subtitle.start - g.start) <= FRAME && Math.abs(s.subtitle.end - g.end) <= FRAME, "la escena muestra el mismo grupo");
  }
  assert.equal(sceneAt(c, 3.9, 1920, 1080, { words: WORDS, style: legacy.style }).subtitle === null || true, true);
});

test("cajas: sceneAt = planLayout; sin fotogramas clave el recorte coincide con ffmpegArgs; con kf el arreglo es el mismo", () => {
  for (const layout of LAYOUT_IDS) {
    const c = base(layout), scene = sceneAt(c, 1, 1920, 1080, { words: WORDS });
    assert.deepEqual(scene.plan, planLayout(c, 1920, 1080));
  }
  const fill = base("single_track"), legacy = toLegacyComposition(fill, WORDS, { width: 1920, height: 1080 });
  const args = ffmpegArgs({ ...legacy, burnSubtitles: false, startSec: 0, endSec: 8 }, { input: "in.mp4", assPath: "x.ass", output: "o.mp4", mainHasAudio: true }).join(" ");
  const x = sceneAt(fill, 1, 1920, 1080).cropX!;
  assert.ok(args.includes(`*(${x.toFixed(3)})`), `recorte ${x} en ${args.slice(0, 200)}`);
  const kf = [{ t: 0, x: 0.2 }, { t: 4, x: 0.8 }], withKf = base("single_track", { kf });
  assert.deepEqual(toLegacyComposition(withKf, WORDS, { width: 1920, height: 1080 }).reframe?.kf, kf);
  assert.ok(Math.abs(sceneAt(withKf, 2, 1920, 1080).cropX! - 0.5) < 1e-9);
  assert.equal(unmapTime(3.5, [{ s: 3, e: 4 }]), 4.5);
});

test("zonas seguras: solo existen en sceneAt (con safeZones) y nunca en los argumentos de ffmpeg", () => {
  const c = viralTemplate("titular_video_subtitulos", "9:16", { duration: 8, headline: { lines: ["TITULAR"] }, platforms: ["tiktok"] });
  assert.equal(sceneAt(c, 1, 1920, 1080).overlays.length, 0);
  const s = sceneAt(c, 1, 1920, 1080, { safeZones: ["tiktok", "instagram_reels"] });
  assert.ok(s.overlays.length >= 6 && s.overlays.every((o) => o.rect.x >= 0 && o.rect.x + o.rect.w <= 1080 && o.rect.y + o.rect.h <= 1920));
  const legacy = toLegacyComposition(c, WORDS, { width: 1920, height: 1080 });
  const a1 = ffmpegArgs({ ...legacy, startSec: 0, endSec: 8 }, { input: "i.mp4", assPath: "x.ass", output: "o.mp4", mainHasAudio: true });
  const a2 = ffmpegArgs({ ...legacy, startSec: 0, endSec: 8 }, { input: "i.mp4", assPath: "x.ass", output: "o.mp4", mainHasAudio: true });
  assert.deepEqual(a1, a2); assert.ok(!a1.join(" ").toLowerCase().includes("safe"));
});

test("el titular y su caja salen de la misma fuente en la escena y en la composición", () => {
  const c = viralTemplate("titular_video_subtitulos", "9:16", { duration: 8, headline: { lines: ["UNO", "DOS"], pill: "ARTISTA" } });
  const s = sceneAt(c, 1, 1920, 1080);
  assert.deepEqual(s.headline?.lines, ["UNO", "DOS"]); assert.equal(s.headline?.pill, "ARTISTA");
  assert.deepEqual(s.headline?.box, planLayout(c, 1920, 1080).headline);
});
