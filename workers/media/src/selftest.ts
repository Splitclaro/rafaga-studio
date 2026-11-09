// Autoprueba en la nube con claves reales: voz sintética propia (espeak-ng) → Deepgram → Anthropic con 3 briefs → render.
// No escribe en la base de datos. Resultado en JSON (stdout) y en el resumen del workflow.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, buildComposition, ffmpegArgs, type Word } from "@rafaga/composition";
import { transcribe, proposeClips } from "@rafaga/providers";
import { validateCandidates, windows, transcriptText, lexicalCandidates, LEXICAL_VERSION, type RawCandidate } from "@rafaga/selection";

const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) throw new Error(`${c}: ${r.stderr.slice(-300)}`); return r.stdout; };
const dir = mkdtempSync(join(tmpdir(), "st-"));
const guion = new URL("../../../tests/fixtures/podcast-guion.txt", import.meta.url).pathname;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const out: Record<string, unknown> = { model: MODEL };

out.first_words = "";
sh("espeak-ng", ["-v", "es", "-s", "150", "-w", join(dir, "v.wav"), "-f", guion]);
sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x20242c:s=1280x720:r=25", "-i", join(dir, "v.wav"), "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", join(dir, "src.mp4")]);
sh("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "src.mp4"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", join(dir, "a.ogg")]);
out.source_seconds = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "src.mp4")]));

let t = Date.now();
const tr = await transcribe(readFileSync(join(dir, "a.ogg")), "audio/ogg", process.env.DEEPGRAM_API_KEY!, "auto");
out.asr_ms = Date.now() - t; out.language = tr.language; out.words = tr.words.length; out.first_words = tr.words.slice(0, 25).map((w) => w.text).join(" ");
const words = tr.words;
const idx = (re: RegExp) => words.findIndex((w) => re.test(w.text.toLowerCase()));
const sponsorFrom = idx(/patrocinad/), storyFrom = idx(/segunda/);
out.markers = { sponsorFrom, storyFrom, sponsorSec: words[sponsorFrom]?.start, storySec: words[storyFrom]?.start };

const briefs = {
  ventas: "Consejos de venta para principiantes. Excluye la parte del patrocinador.",
  historia: "La historia personal del invitado.",
  sin_coincidencia: "Recetas de cocina vegana y nutrición deportiva.",
};
const results: Record<string, unknown> = {};
for (const [k, brief] of Object.entries(briefs)) {
  t = Date.now();
  let raw: RawCandidate[] = [];
  let selector = MODEL, fallbackReason: string | null = null;
  try {
    for (const w of windows(words, 600, 45)) raw.push(...(await proposeClips({ key: process.env.ANTHROPIC_API_KEY ?? "", model: MODEL, brief, windowText: transcriptText(words, w.from, w.to), target: "20s (máx 60s)" })));
  } catch (e) { fallbackReason = (e as Error).message.slice(0, 160); selector = LEXICAL_VERSION; raw = lexicalCandidates(words, brief, { minSec: 12, maxSec: 60, count: 3 }); }
  const { accepted, rejected } = validateCandidates(words, raw, { minSec: 12, maxSec: 60, count: 3, hasBrief: true });
  results[k] = { selector, fallbackReason, selection_ms: Date.now() - t, raw: raw.length, rejected: rejected.map((r) => r.reason),
    accepted: accepted.map((c) => ({ start: +c.startSec.toFixed(2), end: +c.endSec.toFixed(2), title: c.title, briefFit: c.briefFit, overall: c.overall,
      overlapsSponsor: sponsorFrom >= 0 && c.startWord <= sponsorFrom + 25 && c.endWord >= sponsorFrom })) };
}
out.briefs = results;

const first = (results.ventas as { accepted: { start: number; end: number }[] }).accepted[0];
if (first) {
  const comp = buildComposition({ words: words as Word[], startSec: first.start, endSec: first.end });
  writeFileSync(join(dir, "c.ass"), buildAss(comp.words, { ...comp.style, fontName: "Liberation Sans" }, { width: 1080, height: 1920 }));
  t = Date.now();
  sh("ffmpeg", ffmpegArgs(comp, { input: join(dir, "src.mp4"), assPath: join(dir, "c.ass"), output: join(dir, "clip.mp4") }));
  out.render_ms = Date.now() - t;
  out.render_probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height:format=duration", join(dir, "clip.mp4")]));
}
const json = JSON.stringify(out, null, 2);
console.log(json);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Autoprueba\n```json\n" + json + "\n```\n");
