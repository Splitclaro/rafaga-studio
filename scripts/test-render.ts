// Prueba real del render del worker: fuente 16:9 con audio -> clip 9:16 con subtítulos quemados.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildAss, buildComposition, ffmpegArgs } from "../packages/composition/src/index.ts";

const dir = new URL("../.spike/", import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8" }); if (r.status) throw new Error(r.stderr.slice(-500)); return r.stdout; };
sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=20", "-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", `${dir}src.mp4`]);
const words = Array.from({ length: 30 }, (_, i) => ({ text: i % 9 === 8 ? `palabra${i}.` : `palabra${i}`, start: 5 + i * 0.4, end: 5 + i * 0.4 + 0.38 }));
const comp = buildComposition({ words, startSec: 5, endSec: 17 });
writeFileSync(`${dir}r.ass`, buildAss(comp.words, comp.style, { width: 1080, height: 1920 }));
sh("ffmpeg", ffmpegArgs(comp, { input: `${dir}src.mp4`, assPath: `${dir}r.ass`, output: `${dir}clip.mp4` }));
const p = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", `${dir}clip.mp4`]));
const v = p.streams.find((s: any) => s.codec_type === "video"), a = p.streams.find((s: any) => s.codec_type === "audio");
const dur = Number(p.format.duration);
console.log({ v: [v.codec_name, v.width, v.height, v.r_frame_rate, v.pix_fmt], a: a?.codec_name, dur });
const fail = (m: string) => { console.error("FALLO:", m); process.exit(1); };
if (v.codec_name !== "h264" || v.width !== 1080 || v.height !== 1920) fail("dimensiones/codec");
if (v.r_frame_rate !== "30/1") fail("fps");
if (!a || a.codec_name !== "aac") fail("audio");
if (Math.abs(dur - 12) > 0.1) fail(`duración ${dur}`);
console.log("OK render 9:16 con audio y duración esperada");
