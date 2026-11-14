// El vídeo nunca se deforma: dentro de la banda de una plantilla se ajusta con su proporción real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planLayout } from "./layouts.ts";
import { toLegacyComposition } from "./layouts.ts";

const comp = (band: { x: number; y: number; w: number; h: number }) => ({ v: 2, aspect: "9:16", layout: "fit_full", band, duration: 10, fragments: [{ start: 0, end: 10 }], subtitles: { enabled: false, box: { x: 0, y: 0.7, w: 1, h: 0.1 } }, audio: { volume: 1 } }) as never;

for (const [name, w, h] of [["4:3 (988×720)", 988, 720], ["16:9", 1920, 1080], ["vertical 9:16", 1080, 1920], ["cuadrado", 1000, 1000]] as const) {
  test(`planLayout conserva la proporción del origen ${name} dentro de la banda`, () => {
    const p = planLayout(comp({ x: 0, y: 0.3418, w: 1, h: 0.3164 }), w, h);
    assert.ok(Math.abs(p.video.w / p.video.h - w / h) < 0.02, `proporción ${(p.video.w / p.video.h).toFixed(3)} vs ${(w / h).toFixed(3)}`);
    assert.ok(p.video.w <= p.frame.w && p.video.h <= p.frame.h && p.video.x >= 0 && p.video.y >= 0);
    assert.ok(p.video.w % 2 === 0 && p.video.h % 2 === 0, "dimensiones pares");
  });
}
void toLegacyComposition;
