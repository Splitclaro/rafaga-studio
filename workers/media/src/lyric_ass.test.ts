// libass real con la fuente Inter del catálogo: el texto cae dentro de la caja de su línea y antes de la primera palabra no hay texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateLyricComposition, lyricLayout, lyricAss } from "@rafaga/composition";

const FONTS = new URL("../../../apps/web/public/fonts/caption", import.meta.url).pathname;
const c = validateLyricComposition({ aspect: "9:16", res: 1080, range: { start: 0, end: 3 }, preset: "texto_estatico", seed: 3,
  style: { font: "Inter", weight: 400, size: "S", sizeFine: 1, effect: "none", active: "none", entrance: "none", color: "#FFFFFF", position: { x: 0.5, y: 0.5 } },
  words: [{ text: "Hola", start: 0.2, end: 0.9, line: 0 }, { text: "mundo", start: 0.9, end: 1.6, line: 0 }, { text: "azul", start: 1.6, end: 2.4, line: 0 }] });

/** Fotograma `n` (gris, 1 byte por píxel) de un fondo negro con el ASS dibujado por libass. */
function frame(ass: string, n: number): Buffer {
  const f = join(mkdtempSync(join(tmpdir(), "rafaga-ass-")), "t.ass"); writeFileSync(f, ass);
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=3", "-vf", `subtitles=${f}:fontsdir=${FONTS},select=eq(n\\,${n})`, "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr?.toString().slice(-300)); assert.equal(r.stdout.length, 1080 * 1920);
  return r.stdout;
}
const bbox = (g: Buffer, thr = 128) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, max = 0; for (let y = 0; y < 1920; y++) for (let x = 0; x < 1080; x++) { const v = g[y * 1080 + x]; if (v > max) max = v; if (v > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return { x0, y0, x1, y1, max }; };

test("t = 1,0 s: los píxeles de texto caen dentro de la caja de la línea (+0,25 em) y cubren al menos el 50 % de su ancho; t = 0,1 s: negro", () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  const L = lyricLayout(c), ass = lyricAss(c), line = L.pages[0].lines[0].box, m = L.em * 0.25;
  const b = bbox(frame(ass, 30));
  assert.ok(b.x1 > 0, "hay texto");
  assert.ok(b.x0 >= line.x - m && b.x1 <= line.x + line.w + m, `x ${b.x0}-${b.x1} fuera de ${line.x}..${line.x + line.w}`);
  assert.ok(b.y0 >= line.y - m && b.y1 <= line.y + line.h + m, `y ${b.y0}-${b.y1} fuera de ${line.y}..${line.y + line.h}`);
  assert.ok((b.x1 - b.x0) / line.w >= 0.5, `cubre ${(b.x1 - b.x0) / line.w}`);
  assert.ok(bbox(frame(ass, 3)).max < 16, "antes de la primera palabra no hay texto");
});
