// Prueba real del render del worker: fuente 16:9 con audio -> clip 9:16 con subtítulos quemados.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildAss, buildComposition, ffmpegArgs, styleForRatio, RATIO_SIZE, type Ratio } from "../packages/composition/src/index.ts";

const dir = new URL("../.spike/", import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8" }); if (r.status) throw new Error(r.stderr.slice(-500)); return r.stdout; };
sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=20", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", `${dir}src.mp4`]);
const words = Array.from({ length: 30 }, (_, i) => ({ text: i % 9 === 8 ? `palabra${i}.` : `palabra${i}`, start: 5 + i * 0.4, end: 5 + i * 0.4 + 0.38 }));
for (const ratio of ["9:16", "1:1", "16:9"] as Ratio[]) {
  const comp = { ...buildComposition({ words, startSec: 5, endSec: 17 }), ratio };
  const out = `${dir}clip-${ratio.replace(":", "x")}.mp4`;
  writeFileSync(`${dir}r.ass`, buildAss(comp.words, styleForRatio(comp.style, ratio), RATIO_SIZE[ratio]));
  sh("ffmpeg", ffmpegArgs(comp, { input: `${dir}src.mp4`, assPath: `${dir}r.ass`, output: out }));
  const p = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
  const v = p.streams.find((s: any) => s.codec_type === "video"), a = p.streams.find((s: any) => s.codec_type === "audio");
  const dur = Number(p.format.duration);
  const { width, height } = RATIO_SIZE[ratio];
  console.log(ratio, { v: [v.codec_name, v.width, v.height, v.r_frame_rate], a: a?.codec_name, dur });
  if (v.width !== width || v.height !== height || v.r_frame_rate !== "30/1" || a?.codec_name !== "aac" || Math.abs(dur - 12) > 0.1) { console.error("FALLO", ratio); process.exit(1); }
  sh("ffmpeg", ["-y", "-v", "error", "-ss", "3", "-i", out, "-frames:v", "1", "-vf", "scale=-2:480", new URL(`../docs/evidence/render-${ratio.replace(":", "x")}-t3.png`, import.meta.url).pathname]);
}
console.log("OK render en 9:16, 1:1 y 16:9 con audio y duración esperada");
