// Benchmark del tramo de render: 1, 10 y 50 clips del MISMO original con el pipeline real del worker
// (ffmpeg 9:16 + subtítulos quemados + sonda + miniatura), a distintos niveles de paralelismo.
// No usa claves ni base de datos: no mide ASR, IA, descarga del original ni subida a Storage (se estiman aparte).
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, statSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { buildAss, buildComposition, ffmpegArgs, styleForRatio, RATIO_SIZE, type Word } from "@rafaga/composition";
import { extractThumb } from "./thumb.ts";

const NS = (process.env.PERF_NS ?? "1,10,50").split(",").map(Number);
const CONC = (process.env.PERF_CONC ?? "1,2,4").split(",").map(Number);
const SRC_MIN = Number(process.env.PERF_SRC_MIN ?? 30), CLIP_SEC = Number(process.env.PERF_CLIP_SEC ?? 40);
const RES = process.env.PERF_RES ?? "1920x1080";
const dir = mkdtempSync(join(tmpdir(), "perf-"));
const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) throw new Error(`${c}: ${r.stderr.slice(-300)}`); return r.stdout; };
const run = (c: string, a: string[]) => new Promise<void>((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "ignore", "pipe"] }); let err = ""; p.stderr.on("data", (d) => (err += d)); p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${c}: ${err.slice(-300)}`)))); });

console.log(`cpus ${cpus().length} · fuente ${SRC_MIN} min ${RES} · clips de ${CLIP_SEC} s`);
let t = Date.now();
sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=${RES}:r=30:d=${SRC_MIN * 60}`, "-f", "lavfi", "-i", `sine=f=220:sample_rate=48000:d=${SRC_MIN * 60}`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", join(dir, "src.mp4")]);
const genMs = Date.now() - t, srcBytes = statSync(join(dir, "src.mp4")).size;
console.log(`fuente generada en ${(genMs / 1000).toFixed(0)} s, ${(srcBytes / 1048576).toFixed(0)} MB`);

// habla sintética: ~2,6 palabras/s
const mkWords = (): Word[] => { const w: Word[] = []; for (let i = 0; i < SRC_MIN * 60 * 2.6; i++) w.push({ text: ["Hoy", "vamos", "a", "ver", "cómo", "producir", "mejor", "tu", "primer", "tema."][i % 10], start: i / 2.6, end: i / 2.6 + 0.3 }); return w; };
const ALL = mkWords();
const results: { n: number; conc: number; total_s: number; first_s: number; per_clip_s: number; clips_per_min: number; mb: number }[] = [];

async function renderOne(i: number, start: number): Promise<{ bytes: number }> {
  const end = start + CLIP_SEC;
  const comp = buildComposition({ words: ALL.filter((w) => w.end > start && w.start < end), startSec: start, endSec: end });
  const ass = join(dir, `c${i}.ass`), out = join(dir, `c${i}.mp4`);
  writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: "Liberation Sans" }, RATIO_SIZE[comp.ratio]));
  await run("ffmpeg", ffmpegArgs(comp, { input: join(dir, "src.mp4"), assPath: ass, output: out }));
  sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]);
  extractThumb(out, join(dir, `t${i}.jpg`));
  const bytes = statSync(out).size; rmSync(out); rmSync(ass);
  return { bytes };
}

for (const n of NS) for (const conc of CONC) {
  const starts = Array.from({ length: n }, (_, i) => Math.min(SRC_MIN * 60 - CLIP_SEC - 1, 15 + i * ((SRC_MIN * 60 - CLIP_SEC - 30) / Math.max(1, n))));
  const t0 = Date.now(); let first = 0, bytes = 0, next = 0, done = 0;
  const worker = async () => { while (next < n) { const i = next++; const r = await renderOne(i, starts[i]); bytes += r.bytes; if (++done === 1) first = Date.now() - t0; } };
  await Promise.all(Array.from({ length: Math.min(conc, n) }, worker));
  const total = (Date.now() - t0) / 1000;
  const row = { n, conc, total_s: +total.toFixed(1), first_s: +(first / 1000).toFixed(1), per_clip_s: +(total / n).toFixed(2), clips_per_min: +((n / total) * 60).toFixed(1), mb: +(bytes / 1048576).toFixed(1) };
  results.push(row); console.log(JSON.stringify(row));
}
const best = (n: number) => results.filter((r) => r.n === n).sort((a, b) => a.total_s - b.total_s)[0];
const md = ["| Clips | Paralelo | Total (s) | Primer clip (s) | s/clip | clips/min | MB |", "|---|---|---|---|---|---|---|", ...results.map((r) => `| ${r.n} | ${r.conc} | ${r.total_s} | ${r.first_s} | ${r.per_clip_s} | ${r.clips_per_min} | ${r.mb} |`)].join("\n");
console.log("\n" + md);
console.log("PERF_RESULT", JSON.stringify({ cpus: cpus().length, source: { min: SRC_MIN, res: RES, mb: +(srcBytes / 1048576).toFixed(0) }, clip_sec: CLIP_SEC, best: NS.map((n) => best(n)), results }));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Benchmark de render (${cpus().length} CPU)\n\n${md}\n`);
rmSync(dir, { recursive: true, force: true });
