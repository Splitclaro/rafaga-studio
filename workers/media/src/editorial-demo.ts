// Demo editorial reproducible: la MISMA entrevista con tres encargos distintos → intervalos, razones y MP4 exportados (con subtítulos sincronizados).
// La voz es sintética (tono): lo que se demuestra es la selección, el corte y la exportación, no el reconocimiento de voz.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAss, buildComposition, ffmpegArgs, styleForRatio, RATIO_SIZE, type Word } from "@rafaga/composition";
import { interpretBrief, editorialCandidates, padBounds, INTERVIEW, buildTranscript } from "@rafaga/selection";

const OUT = process.env.DEMO_OUT ?? "/tmp/rafaga-demo"; mkdirSync(OUT, { recursive: true });
const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status) throw new Error(`${c}: ${r.stderr.slice(-300)}`); return r.stdout; };
const W = buildTranscript(INTERVIEW), total = Math.ceil(W[W.length - 1].end + 2);
sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=1280x720:r=25:d=${total}`, "-f", "lavfi", "-i", `sine=f=220:d=${total}`, "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(OUT, "fuente.mp4")]);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
const BRIEFS = [
  { id: "A-consejos", text: "Consejos prácticos para principiantes, de 15 a 40 segundos." },
  { id: "B-historias", text: "Historias personales con un giro. Evita su vida privada y excluye el patrocinador." },
  { id: "C-ejemplo", text: "Quiero cinco cortes para gente que no conoce al artista. Prioriza las historias detrás de sus canciones, evita hablar de su vida privada y deja que se escuche el remate de cada historia." },
];
const report: Record<string, unknown>[] = []; let md = "# Demo editorial: una fuente, tres encargos\n\nFuente: entrevista de prueba (22 frases, ~" + total + " s). Los cortes se exportan a 9:16 con subtítulos quemados.\n";
for (const b of BRIEFS) {
  const it = interpretBrief(b.text);
  const cands = editorialCandidates(W, it, { minSec: it.minSec ?? 12, maxSec: it.maxSec ?? 60, count: it.count ?? 3, briefText: b.text });
  md += `\n## ${b.id}\n**Encargo:** ${b.text}\n\n**Interpretado:** ${JSON.stringify({ count: it.count, minSec: it.minSec, maxSec: it.maxSec, kinds: it.kinds, exclude: it.exclude, payoff: it.wantsPayoff, audience: it.audience })}\n\n`;
  const picks = cands.slice(0, it.count ?? 3);
  if (!picks.length) md += "_Sin momentos que cumplan el encargo (no se inventa relleno)._\n";
  picks.forEach((c, k) => {
    const pb = padBounds(W, c.startWord, c.endWord), words = W.filter((w) => w.end > pb.startSec && w.start < pb.endSec) as Word[];
    const comp = buildComposition({ words, startSec: pb.startSec, endSec: pb.endSec });
    const ass = join(OUT, `${b.id}-${k + 1}.ass`), out = join(OUT, `${b.id}-${k + 1}.mp4`);
    writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: "Liberation Sans" }, RATIO_SIZE[comp.ratio]));
    sh("ffmpeg", ffmpegArgs(comp, { input: join(OUT, "fuente.mp4"), assPath: ass, output: out }));
    const pr = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height:format=duration", out]));
    const text = W.slice(c.startWord, c.endWord + 1).map((w) => w.text).join(" ");
    md += `### Corte ${k + 1} — ${c.title}\n- Origen: **${mmss(pb.startSec)}–${mmss(pb.endSec)}** (${(pb.endSec - pb.startSec).toFixed(1)} s) · exportado: ${pr.streams.map((s: { codec_name: string }) => s.codec_name).join("+")} ${pr.streams[0].width}×${pr.streams[0].height}, ${Number(pr.format.duration).toFixed(1)} s\n- Razón: ${c.reason}\n- Puntuación editorial (estimación, no predicción): relevancia ${c.scores.relevance} · gancho ${c.scores.hook} · autonomía ${c.scores.standalone} · cierre ${c.scores.closure}\n- Texto: «${text}»\n- Archivo: \`${b.id}-${k + 1}.mp4\`\n\n`;
    report.push({ brief: b.id, k: k + 1, start: pb.startSec, end: pb.endSec, dur_exported: Number(pr.format.duration), reason: c.reason });
  });
}
writeFileSync(join(OUT, "EDITORIAL_DEMO.md"), md); writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(md);
