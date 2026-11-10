// Render de los tres looks con medios generados (sin derechos de terceros) y tiempos de letra conocidos.
// Uso: node scripts/render-looks.ts <dir_salida> [audio.m4a] [words.json]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LOOKS, layoutLyrics, layoutToAss, planShots, lookFfmpegArgs, canvasSize, type TimedWord } from "../packages/lyrics/src/index.ts";

const out = process.argv[2] ?? "/tmp/looks"; mkdirSync(out, { recursive: true });
const sh = (args: string[]) => { const r = spawnSync("ffmpeg", args); if (r.status !== 0) throw new Error(r.stderr.toString()); };
const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
// Medios propios: tres planos sintéticos (degradados en movimiento, con cielo/horizonte y luces)
const clips = [
  ["sky.mp4", "gradients=s=1280x720:c0=0x9fc6d6:c1=0x5f8fa8:c2=0xd8c7a0:x0=0:y0=0:x1=0:y1=720:speed=0.02:r=30"],
  ["night.mp4", "gradients=s=1280x720:c0=0x0b0f1e:c1=0x3a2342:c2=0xc8743a:nb_colors=3:speed=0.05:type=radial:r=30"],
  ["dusk.mp4", "gradients=s=1280x720:c0=0xe6a35a:c1=0x6b4a6e:c2=0x1d2433:nb_colors=3:speed=0.03:r=30"],
];
for (const [f, src] of clips) if (!existsSync(join(out, f))) sh(["-y", "-v", "error", "-f", "lavfi", "-i", `${src},drawbox=y=ih*0.62:h=ih*0.38:color=0x1a1a1a@0.85:t=fill,noise=alls=6:allf=t`, "-t", "8", "-pix_fmt", "yuv420p", join(out, f)]);
const items = clips.map(([f]) => ({ path: join(out, f), kind: "video" as const, duration: 8 }));
const len = 10;
const W = (text: string, start: number, end: number, line: number): TimedWord => ({ text, start, end, line, confidence: 1, origin: "asr" });
const words: TimedWord[] = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : [
  W("Todavía", 0.4, 0.9, 0), W("te", 1.0, 1.15, 0), W("busco", 1.2, 2.2, 0), W("en", 2.6, 2.75, 1), W("la", 2.8, 2.95, 1), W("ciudad", 3.0, 4.4, 1),
  W("y", 5.2, 5.3, 2), W("no", 5.4, 5.6, 2), W("sé", 5.7, 6.6, 2), W("volver", 7.2, 9.0, 3),
];
const audio = process.argv[3] ?? join(out, "silence.m4a");
if (!process.argv[3]) sh(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=220:d=10", "-af", "volume=0.05", "-c:a", "aac", audio]);
const report: Record<string, unknown>[] = [];
for (const id of ["archivo", "diario", "panoramico"]) {
  for (const ratio of [LOOKS[id].canvas.ratio, ...(LOOKS[id].canvas.ratio === "9:16" ? [] : ["9:16"])]) {
    const look = LOOKS[id]; const { W: w, H: h } = canvasSize(ratio, 720);
    const L = layoutLyrics(words, look, w, h, len);
    const ass = join(out, `${id}-${ratio.replace(":", "x")}.ass`); writeFileSync(ass, layoutToAss(L));
    const shots = planShots(items, L.pages, len, look.montage, 3);
    const file = join(out, `${id}-${ratio.replace(":", "x")}.mp4`);
    const t = Date.now();
    sh(lookFfmpegArgs({ look, W: w, H: h, len, shots, color: "#111111", seed: 3, audio, ass, out: file, escape: esc }));
    const ms = Date.now() - t;
    sh(["-y", "-v", "error", "-ss", "3.9", "-i", file, "-frames:v", "1", file.replace(".mp4", ".png")]);
    report.push({ id, ratio, size: `${w}x${h}`, image: L.image, em: L.em, pages: L.pages.length, shots: shots.map((s) => [s.start, s.dur]), render_ms: ms });
  }
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.map((r) => [r.id, r.ratio, r.render_ms])));
