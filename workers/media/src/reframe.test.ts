// e2e real: vídeo 16:9 con una cara real que cruza el cuadro → detección (OpenCV) → trayectoria → export 9:16 → la cara sigue dentro.
// Necesita ffmpeg y Python con opencv-python-headless (PYTHONPATH/PYTHON_BIN opcionales); si no están, se omite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildComposition, ffmpegArgs } from "@rafaga/composition";
import { scanFaces, reframePath } from "./reframe.ts";

const py = process.env.PYTHON_BIN ?? "python3";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hasCv = spawnSync(py, ["-c", "import cv2; cv2.CascadeClassifier"]).status === 0;
const FACE = fileURLToPath(new URL("../fixtures/face.jpg", import.meta.url));

test("e2e real: el reencuadre automático mantiene la cara dentro del 9:16", { skip: !hasFfmpeg || !hasCv, timeout: 180000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "reframe-"));
  try {
    const run = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { maxBuffer: 1 << 27 }); assert.equal(r.status, 0, r.stderr?.toString()); };
    // la cara cruza de izquierda a derecha en 12 s (lienzo 1280x720)
    run(["-f", "lavfi", "-i", "color=c=0x305070:s=1280x720:r=15:d=12", "-loop", "1", "-i", FACE, "-filter_complex", "[1:v]scale=360:-1[f];[0:v][f]overlay=x='60+(1280-360-120)*t/12':y=200:shortest=1,format=yuv420p", "-t", "12", join(dir, "src.mp4")]);
    run(["-f", "lavfi", "-i", "sine=f=300:d=12", "-i", join(dir, "src.mp4"), "-map", "1:v", "-map", "0:a", "-c:v", "copy", "-c:a", "aac", join(dir, "src2.mp4")]);
    const scan = scanFaces(join(dir, "src2.mp4"), 0, 12);
    const path = reframePath(scan, 9 / 16, 12, "follow");
    assert.equal(path.mode, "follow"); assert.ok(path.coverage > 0.7, `cobertura ${path.coverage}`);
    assert.ok(path.kf.length >= 3 && path.kf.length < 40, `${path.kf.length} keyframes`);
    assert.ok(path.kf[path.kf.length - 1].x > path.kf[0].x + 0.4, "la ventana acompaña el desplazamiento");

    const ass = join(dir, "e.ass"); writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: W,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
    const base = buildComposition({ words: [], startSec: 0, endSec: 12 });
    const render = (reframe: boolean, out: string) => {
      const comp = { ...base, layout: "fill" as const, burnSubtitles: false, crop: { x: 0.5 }, ...(reframe ? { reframe: { kf: path.kf } } : {}) };
      const x = spawnSync("ffmpeg", ffmpegArgs(comp, { input: join(dir, "src2.mp4"), assPath: ass, output: join(dir, out), escape: (p: string) => p } as never), { maxBuffer: 1 << 27 });
      assert.equal(x.status, 0, x.stderr?.toString());
      return scanFaces(join(dir, out), 0, 12);   // el mismo detector sobre el RESULTADO
    };
    const withAuto = render(true, "auto.mp4"), fixed = render(false, "fixed.mp4");
    const seen = (s: typeof withAuto) => s.samples.filter((x) => x.faces.length).length / s.samples.length;
    const auto = seen(withAuto), stat = seen(fixed);
    if (process.env.DEBUG_REFRAME) console.log(JSON.stringify({ coverage: path.coverage, kf: path.kf.length, first: path.kf[0], last: path.kf[path.kf.length - 1], auto, stat }));
    assert.ok(auto >= 0.75, `con reencuadre la cara se ve en ${(auto * 100).toFixed(0)} % de las muestras`);
    assert.ok(auto > stat + 0.25, `el encuadre fijo central la pierde (${(stat * 100).toFixed(0)} % vs ${(auto * 100).toFixed(0)} %)`);
    // y no está pegada al borde: la cara detectada queda en el tercio central-ish del cuadro 9:16
    const xs = withAuto.samples.flatMap((s) => s.faces.map((f) => f.cx)); xs.sort((a, b) => a - b);
    assert.ok(xs[Math.floor(xs.length * 0.1)] > 0.15 && xs[Math.floor(xs.length * 0.9)] < 0.85, `cara cerca del borde: ${xs[0]}..${xs[xs.length - 1]}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("e2e real: un clip que NO empieza en 0 usa tiempos relativos al clip (t del filtro = t del clip)", { skip: !hasFfmpeg || !hasCv, timeout: 180000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "reframe2-"));
  try {
    const run = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { maxBuffer: 1 << 27 }); assert.equal(r.status, 0, r.stderr?.toString()); };
    run(["-f", "lavfi", "-i", "color=c=0x305070:s=1280x720:r=15:d=14", "-loop", "1", "-i", FACE, "-filter_complex", "[1:v]scale=360:-1[f];[0:v][f]overlay=x='60+(1280-360-120)*t/14':y=200:shortest=1,format=yuv420p", "-t", "14", join(dir, "src.mp4")]);
    const START = 4, END = 12, LEN = END - START;
    const scan = scanFaces(join(dir, "src.mp4"), START, LEN);
    const path = reframePath(scan, 9 / 16, LEN, "follow");
    assert.equal(path.mode, "follow");
    const ass = join(dir, "e.ass"); writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: W,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
    const comp = { ...buildComposition({ words: [], startSec: START, endSec: END }), layout: "fill" as const, burnSubtitles: false, reframe: { kf: path.kf } };
    const x = spawnSync("ffmpeg", ffmpegArgs(comp, { input: join(dir, "src.mp4"), assPath: ass, output: join(dir, "o.mp4"), escape: (p: string) => p } as never), { maxBuffer: 1 << 27 });
    assert.equal(x.status, 0, x.stderr?.toString());
    const out = scanFaces(join(dir, "o.mp4"), 0, LEN);
    const seen = out.samples.filter((s) => s.faces.length).length / out.samples.length;
    assert.ok(seen >= 0.75, `la cara se ve en ${(seen * 100).toFixed(0)} % del clip recortado`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
