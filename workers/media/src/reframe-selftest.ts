// Autoprueba del reencuadre en el worker de la nube: cara real (fixture) que cruza el cuadro → OpenCV → trayectoria → export 9:16 → la cara sigue dentro.
// No usa claves ni datos de usuarios.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildComposition, ffmpegArgs } from "@rafaga/composition";
import { scanFaces, reframePath } from "./reframe.ts";

const FACE = fileURLToPath(new URL("../fixtures/face.jpg", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "reframe-st-"));
const fail: string[] = [];
const run = (c: string, a: string[]) => { const r = spawnSync(c, a, { maxBuffer: 1 << 27 }); if (r.status !== 0) throw new Error(`${c}: ${r.stderr?.toString().slice(0, 300)}`); return r; };
try {
  console.log("python", spawnSync(process.env.PYTHON_BIN ?? "python3", ["-c", "import cv2;print(cv2.__version__)"]).stdout.toString().trim());
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x305070:s=1280x720:r=15:d=12", "-loop", "1", "-i", FACE, "-filter_complex", "[1:v]scale=360:-1[f];[0:v][f]overlay=x='60+(1280-360-120)*t/12':y=200:shortest=1,format=yuv420p", "-t", "12", join(dir, "src.mp4")]);
  const t0 = Date.now(); const scan = scanFaces(join(dir, "src.mp4"), 0, 12); const scanMs = Date.now() - t0;
  const path = reframePath(scan, 9 / 16, 12, "follow");
  const ass = join(dir, "e.ass"); writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: W,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
  const base = buildComposition({ words: [], startSec: 0, endSec: 12 });
  const seen = (reframe: boolean) => {
    const comp = { ...base, layout: "fill" as const, burnSubtitles: false, crop: { x: 0.5 }, ...(reframe ? { reframe: { kf: path.kf } } : {}) } as never;
    const out = join(dir, reframe ? "a.mp4" : "f.mp4");
    run("ffmpeg", ffmpegArgs(comp, { input: join(dir, "src.mp4"), assPath: ass, output: out, escape: (p: string) => p } as never));
    const s = scanFaces(out, 0, 12); return s.samples.filter((x) => x.faces.length).length / s.samples.length;
  };
  const auto = seen(true), fixed = seen(false);
  const report = { opencv: true, scan_ms: scanMs, samples: scan.samples.length, coverage: path.coverage, keyframes: path.kf.length, first_x: path.kf[0].x, last_x: path.kf[path.kf.length - 1].x, face_visible_auto: auto, face_visible_fixed_center: fixed };
  console.log("REFRAME_SELFTEST", JSON.stringify(report));
  if (path.mode !== "follow") fail.push(`modo ${path.mode}`);
  if (auto < 0.75) fail.push(`cara visible solo ${(auto * 100).toFixed(0)} % con reencuadre`);
  if (auto <= fixed + 0.25) fail.push("el reencuadre no mejora al encuadre central fijo");
} catch (e) { fail.push((e as Error).message); }
finally { rmSync(dir, { recursive: true, force: true }); }
if (fail.length) { console.error("FALLOS:", fail.join(" | ")); process.exit(1); }
console.log("reframe-selftest OK");
