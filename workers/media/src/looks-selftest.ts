// Autoprueba de looks de videolyric en el worker cloud (claves reales, fuentes instaladas en Ubuntu).
// Voz SINTÉTICA recitada (espeak-ng) en español e inglés: valida ASR+alineación+render, NO canto real sobre instrumental.
// Medios: planos generados con FFmpeg (sin derechos de terceros). Los MP4 se publican como artefacto del workflow.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { transcribe } from "@rafaga/providers";
import { escapeFilterPath } from "@rafaga/composition";
import { alignLyrics, parseLyrics, planVariants, LOOKS, resolveLook, varyLook, layoutLyrics, layoutToAss, planShots, lookFfmpegArgs, canvasSize, readMetrics, METRIC_CODEPOINTS, SANS_REGULAR, SANS_BOLD, measure, type TimedWord, type ShotItem } from "@rafaga/lyrics";

const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) throw new Error(`${c}: ${r.stderr.slice(-400)}`); return r.stdout; };
const OUT = process.env.LOOKS_OUT ?? join(process.cwd(), "looks-out"); mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = { note: "voz sintética recitada (espeak-ng), no canto; medios generados" };
const fail: string[] = [];

// 1) La fuente instalada en el worker coincide con la tabla de métricas de la vista previa
for (const [name, file, table] of [["regular", "LiberationSans-Regular.ttf", SANS_REGULAR], ["bold", "LiberationSans-Bold.ttf", SANS_BOLD]] as const) {
  const path = sh("fc-list", [":file"]).split("\n").map((l) => l.split(":")[0]).find((p) => p.endsWith(file));
  if (!path) { fail.push(`fuente ${file} no instalada`); continue; }
  const m = readMetrics(new Uint8Array(readFileSync(path)), METRIC_CODEPOINTS);
  const diff = METRIC_CODEPOINTS.filter((cp) => (m.advance[cp] ?? -1) * (2048 / m.unitsPerEm) !== (table.advance[cp] ?? -1));
  report[`metrics_${name}`] = { path, unitsPerEm: m.unitsPerEm, mismatches: diff.length, sample: diff.slice(0, 10) };
  if (diff.length > 3) fail.push(`métricas ${name}: ${diff.length} diferencias`);
}

// 2) Medios propios generados
const clips: [string, string][] = [
  ["sky.mp4", "gradients=s=1280x720:c0=0x9fc6d6:c1=0x5f8fa8:c2=0xd8c7a0:x0=0:y0=0:x1=0:y1=720:speed=0.02:r=30"],
  ["night.mp4", "gradients=s=1280x720:c0=0x0b0f1e:c1=0x3a2342:c2=0xc8743a:nb_colors=3:speed=0.05:type=radial:r=30"],
  ["dusk.mp4", "gradients=s=1280x720:c0=0xe6a35a:c1=0x6b4a6e:c2=0x1d2433:nb_colors=3:speed=0.03:r=30"],
];
for (const [f, src] of clips) sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `${src},drawbox=y=ih*0.62:h=ih*0.38:color=0x1a1a1a@0.85:t=fill,noise=alls=6:allf=t`, "-t", "10", "-pix_fmt", "yuv420p", join(OUT, f)]);
const items: ShotItem[] = clips.map(([f]) => ({ path: join(OUT, f), kind: "video", duration: 10 }));

// 3) Voz es/en → ASR real → alineación con la letra aportada → render de cada look
async function voice(lang: "es" | "en", file: string) {
  const lyrics = readFileSync(new URL(`../../../tests/fixtures/${file}`, import.meta.url), "utf8");
  const lines = parseLyrics(lyrics);
  writeFileSync(join(OUT, `${lang}.txt`), lines.map((l) => l.text).join(". ") + ".");
  sh("espeak-ng", ["-v", lang, "-s", "125", "-w", join(OUT, `${lang}.wav`), "-f", join(OUT, `${lang}.txt`)]);
  sh("ffmpeg", ["-y", "-v", "error", "-i", join(OUT, `${lang}.wav`), "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", join(OUT, `${lang}.ogg`)]);
  sh("ffmpeg", ["-y", "-v", "error", "-i", join(OUT, `${lang}.wav`), "-c:a", "aac", "-b:a", "192k", join(OUT, `${lang}.m4a`)]);
  const len = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(OUT, `${lang}.m4a`)]));
  const t = Date.now();
  const tr = await transcribe(readFileSync(join(OUT, `${lang}.ogg`)), "audio/ogg", process.env.DEEPGRAM_API_KEY!, lang);
  const words: TimedWord[] = alignLyrics(lines, tr.words);
  return { lyrics, len, words, asr_ms: Date.now() - t, asr: tr.words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" "), matched: words.filter((w) => w.origin === "asr").length, total: words.length };
}
function render(name: string, lookId: string, ratio: string, res: 1080 | 720, audio: string, words: TimedWord[], len: number, seed: number, variation = 0) {
  const look = varyLook(resolveLook(lookId), seed, variation);
  const { W, H } = canvasSize(ratio, res);
  const L = layoutLyrics(words, look, W, H, len);
  const ass = join(OUT, `${name}.ass`); writeFileSync(ass, layoutToAss(L));
  const shots = planShots(items, L.pages, len, look.montage, seed);
  const out = join(OUT, `${name}.mp4`);
  const t = Date.now();
  sh("ffmpeg", lookFfmpegArgs({ look, W, H, len, shots, color: "#111111", seed, audio, ass, out, escape: escapeFilterPath }));
  const ms = Date.now() - t;
  const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration,size", out]));
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(len - 0.5, Math.max(0.5, (L.pages[0]?.end ?? 2) - 0.2))), "-i", out, "-frames:v", "1", out.replace(".mp4", ".png")]);
  const frameHash = createHash("md5").update(sh("ffmpeg", ["-v", "error", "-ss", "1.5", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "96x170", "-"])).digest("hex");
  return { name, look: lookId, ratio, size: `${W}x${H}`, render_ms: ms, seconds: +len.toFixed(2), pages: L.pages.length, shots: shots.map((s) => `${s.start.toFixed(2)}+${s.dur.toFixed(2)}`), probe, frameHash, firstWords: L.words.slice(0, 6).map((w) => `${w.text}@${w.start.toFixed(3)}(${w.x},${w.y})`) };
}

const es = await voice("es", "letra-prueba.txt");
const en = await voice("en", "letra-prueba-en.txt");
report.voice = { es: { len: es.len, asr_ms: es.asr_ms, matched: `${es.matched}/${es.total}`, asr: es.asr }, en: { len: en.len, asr_ms: en.asr_ms, matched: `${en.matched}/${en.total}`, asr: en.asr } };
report.renders = [
  render("A-archivo-4x3-1080-es", "archivo", "4:3", 1080, join(OUT, "es.m4a"), es.words, es.len, 11),
  render("A-archivo-9x16-1080-es", "archivo", "9:16", 1080, join(OUT, "es.m4a"), es.words, es.len, 11),
  render("B-diario-9x16-1080-es", "diario", "9:16", 1080, join(OUT, "es.m4a"), es.words, es.len, 12),
  render("C-panoramico-9x16-1080-en", "panoramico", "9:16", 1080, join(OUT, "en.m4a"), en.words, en.len, 13),
  render("C-panoramico-9x16-720-en", "panoramico", "9:16", 720, join(OUT, "en.m4a"), en.words, en.len, 13),
];

// 4) Fidelidad temporal en el worker: palabra visible exactamente desde su frame (fondo liso, fuente instalada)
{
  const look = resolveLook("diario", { treatment: { desaturate: 0 } });
  const w = 360, h = 640, len = 2;
  const words: TimedWord[] = [{ text: "hola", start: 0.5, end: 0.9, line: 0, confidence: 1, origin: "asr" }, { text: "mundo", start: 1.0, end: 1.6, line: 0, confidence: 1, origin: "asr" }];
  const L = layoutLyrics(words, look, w, h, len);
  writeFileSync(join(OUT, "fx.ass"), layoutToAss(L));
  sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", join(OUT, "fx.m4a")]);
  sh("ffmpeg", lookFfmpegArgs({ look, W: w, H: h, len, shots: [], color: "#000000", seed: 1, audio: join(OUT, "fx.m4a"), ass: join(OUT, "fx.ass"), out: join(OUT, "fx.mp4"), escape: escapeFilterPath }));
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", join(OUT, "fx.mp4"), "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 28 }).stdout;
  const fs = w * h;
  const lit = (k: number, p: (typeof L.words)[number]) => { let n = 0; const x1 = Math.min(w, p.x + Math.ceil(measure(p.text, p.em, 400)) + 2), y1 = Math.min(h, p.y + Math.ceil(p.em * 1.2)); for (let y = Math.max(0, p.y - 2); y < y1; y++) for (let x = Math.max(0, p.x - 2); x < x1; x++) if (raw[k * fs + y * w + x] > 180) n++; return n; };
  const [a, b] = L.words;
  const r = { frames: raw.length / fs, w1_f14: lit(14, a), w1_f15: lit(15, a), w2_f29: lit(29, b), w2_f30: lit(30, b) };
  report.frameFidelity = r;
  if (!(r.w1_f14 === 0 && r.w1_f15 > 20 && r.w2_f29 === 0 && r.w2_f30 > 20)) fail.push(`fidelidad de frame: ${JSON.stringify(r)}`);
}

// 5) Lote de 10 variantes: reparto exacto entre los tres looks y fotogramas distintos
{
  const plan = planVariants(10, ["look:archivo", "look:diario", "look:panoramico"], ["coleccion"], 7);
  const t = Date.now();
  const rs = plan.variants.map((v) => render(`lote-${String(v.index).padStart(2, "0")}-${v.style.slice(5)}`, v.style.slice(5), "9:16", 720, join(OUT, "es.m4a"), es.words.filter((x) => x.start < 6), Math.min(6, es.len), v.seed, 0.6));
  const dist: Record<string, number> = {}; for (const v of plan.variants) dist[v.style] = (dist[v.style] ?? 0) + 1;
  const distinct = new Set(rs.map((r) => r.frameHash)).size;
  report.batch = { n: plan.variants.length, distribution: dist, distinctFrames: distinct, total_ms: Date.now() - t, per_video_ms: rs.map((r) => r.render_ms) };
  if (plan.variants.length !== 10) fail.push("el lote no tiene 10 vídeos");
  if (distinct < 10) fail.push(`variantes idénticas: ${10 - distinct}`);
}

report.fail = fail;
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Looks selftest\n```json\n" + JSON.stringify({ ...report, renders: (report.renders as { name: string; render_ms: number; size: string }[]).map((r) => [r.name, r.size, r.render_ms]) }, null, 1).slice(0, 60000) + "\n```\n");
if (fail.length) { console.error("FALLOS:", fail); process.exit(1); }
