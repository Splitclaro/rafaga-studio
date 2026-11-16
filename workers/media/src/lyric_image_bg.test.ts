// Fondos de foto y efectos de cámara en el render de letra. Fixtures generados con ffmpeg (nada depende de archivos locales).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateLyricComposition, lyricRenderArgs, lyricAss } from "@rafaga/composition";

const FONTS = new URL("../../../apps/web/public/fonts/caption", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "rafaga-img-"));
const ff = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
const photo = join(tmp, "foto.jpg"), song = join(tmp, "cancion.wav");
ff(["-f", "lavfi", "-i", "testsrc2=s=720x1280:d=1", "-frames:v", "1", "-q:v", "3", photo]);       // JPG de rango completo, como las fotos de una colección
ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=4", song]);
const comp = (extra: Record<string, unknown> = {}) => validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 0, end: 2 }, words: [{ text: "Hola", start: 0.2, end: 1, line: 0 }], preset: "texto_estatico", seed: 7, style: { active: "none", entrance: "none" },
  background: { kind: "media", items: [{ ref: "a", kind: "image" }], interval: 3, fit: "fill" }, ...extra });
function render(c: ReturnType<typeof comp>, name: string) {
  const ass = join(tmp, `${name}.ass`), out = join(tmp, `${name}.mp4`); writeFileSync(ass, lyricAss(c));
  const r = spawnSync("ffmpeg", lyricRenderArgs(c, { audio: song, items: [photo], ass, fontsDir: FONTS, out }), { encoding: "utf8" });
  assert.equal(r.status, 0, `${name}: ${r.stderr.slice(-300)}`);
  return spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim();
}

// Regresión: las fotos JPG como fondo daban yuvj420p y la comprobación del worker rechazaba la variante.
test("un fondo JPG (rango completo) produce MP4 H.264 yuv420p estándar, no yuvj420p", () => { assert.equal(render(comp(), "base"), "720,1280,yuv420p"); });

test("los efectos de cámara nuevos (cine 16 mm, VHS, cámara de noche, gran angular) renderizan MP4 H.264 yuv420p del tamaño esperado", () => {
  for (const filter of ["cine16", "vhs", "camara_noche", "gran_angular"]) assert.equal(render(comp({ settings: { filter }, preset: "tres_palabras" }), `f-${filter}`), "720,1280,yuv420p", filter);
});
