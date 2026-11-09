// Spike de fidelidad: renderiza un fixture sintético con subtítulos ASS por palabra
// y comprueba, frame a frame, que la palabra activa cambia en el frame esperado
// (misma función activeWordAt que usará el preview). Uso: node scripts/spike-subs.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildAss, groupWords, activeWordAt, PRESET_IMPACTO, type Word } from "../packages/composition/src/subtitles.ts";

const FPS = 30;
const W_OUT = 1080, H_OUT = 1920;
const out = new URL("../.spike/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// Palabras con tiempos conocidos (fixture sintético propio, ES con acentos y ñ).
const words: Word[] = [
  { text: "Mañana", start: 0.0, end: 0.5 }, { text: "empieza", start: 0.5, end: 1.0 },
  { text: "tu", start: 1.0, end: 1.2 }, { text: "canción", start: 1.2, end: 1.9 },
  { text: "número", start: 1.9, end: 2.4 }, { text: "uno.", start: 2.4, end: 3.0 },
];
const dur = 3.2;
const ass = buildAss(words, PRESET_IMPACTO, { width: W_OUT, height: H_OUT });
writeFileSync(`${out}fixture.ass`, ass);

const run = (cmd: string, args: string[], opts: { encoding?: "buffer" } = {}) => {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} falló: ${r.stderr?.toString().slice(-600)}`);
  return r;
};

// Export: fondo gris oscuro sintético + tono, ASS quemado. Argumentos separados, sin shell.
const mp4 = `${out}fixture.mp4`;
run("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", `color=c=0x303640:s=${W_OUT}x${H_OUT}:r=${FPS}:d=${dur}`,
  "-f", "lavfi", "-i", `sine=frequency=440:duration=${dur}`,
  "-vf", `subtitles=${out}fixture.ass`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-shortest", mp4,
]);

// Decodifica frames reducidos y localiza los píxeles lima (color activo #B5F36D).
const sw = 270, sh = 480;
const raw = run("ffmpeg", ["-v", "error", "-i", mp4, "-vf", `scale=${sw}:${sh}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" }).stdout as Buffer;
const frameSize = sw * sh * 3;
const nFrames = Math.floor(raw.length / frameSize);
const lime = (r: number, g: number, b: number) => g > 200 && r > 140 && r < 220 && b < 160 && g - b > 80;

// Firma por frame: (línea, columna media) de los píxeles lima → identifica la palabra.
const sig: (string | null)[] = [];
for (let f = 0; f < nFrames; f++) {
  let n = 0, sx = 0, sy = 0;
  const base = f * frameSize;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = base + (y * sw + x) * 3;
    if (lime(raw[i], raw[i + 1], raw[i + 2])) { n++; sx += x; sy += y; }
  }
  sig.push(n > 30 ? `${Math.round(sy / n / 8)}:${Math.round(sx / n / 6)}` : null);
}

// Esperado por frame con la MISMA función que usará el preview.
const groups = groupWords(words, PRESET_IMPACTO);
const expected = (f: number): string => {
  const t = f / FPS;
  for (const g of groups) { const a = activeWordAt(g, t); if (a >= 0) return `g${groups.indexOf(g)}w${a}`; }
  return "none";
};
// Transiciones esperadas vs. observadas (cambio de firma).
const expTrans: number[] = [], obsTrans: number[] = [];
for (let f = 1; f < nFrames; f++) {
  if (expected(f) !== expected(f - 1)) expTrans.push(f);
  if (sig[f] !== sig[f - 1]) obsTrans.push(f);
}
const maxDiff = Math.max(...expTrans.map((e, i) => Math.abs(e - (obsTrans[i] ?? 1e9))));
console.log({ nFrames, expTrans, obsTrans, maxDiffFrames: maxDiff });
if (expTrans.length !== obsTrans.length || maxDiff > 1) {
  console.error("FALLO: desfase preview/export > 1 frame");
  process.exit(1);
}
console.log("OK: transiciones de palabra activa dentro de ±1 frame");
