// Autoprueba Lyric Studio (nube, claves reales). Voz SINTÉTICA recitada (espeak-ng): valida tubería, NO canto real.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, groupsFrom, escapeFilterPath, PRESETS, RATIO_SIZE, styleForRatio } from "@rafaga/composition";
import { transcribe } from "@rafaga/providers";
import { alignLyrics, parseLyrics, planVariants, type TimedWord } from "@rafaga/lyrics";

const sh = (c: string, a: string[]) => { const r = spawnSync(c, a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) throw new Error(`${c}: ${r.stderr.slice(-300)}`); return r.stdout; };
const dir = mkdtempSync(join(tmpdir(), "ly-"));
const lyricsFile = new URL("../../../tests/fixtures/letra-prueba.txt", import.meta.url).pathname;
const lyrics = readFileSync(lyricsFile, "utf8");
const spoken = parseLyrics(lyrics).map((l) => l.text).join(". ") + ".";
writeFileSync(join(dir, "t.txt"), spoken);
sh("espeak-ng", ["-v", "es", "-s", "120", "-w", join(dir, "v.wav"), "-f", join(dir, "t.txt")]);
sh("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "v.wav"), "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", join(dir, "a.ogg")]);
sh("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "v.wav"), "-c:a", "aac", join(dir, "seg.m4a")]);
const len = Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "seg.m4a")]));
const out: Record<string, unknown> = { note: "voz sintética recitada, no canto", seconds: len };
let t = Date.now();
const tr = await transcribe(readFileSync(join(dir, "a.ogg")), "audio/ogg", process.env.DEEPGRAM_API_KEY!, "es");
out.asr_ms = Date.now() - t; out.asr_text = tr.words.map((w) => w.text).join(" ");
const words: TimedWord[] = alignLyrics(parseLyrics(lyrics), tr.words);
out.aligned = words.map((w) => `${w.text}@${w.start.toFixed(2)}-${w.end.toFixed(2)}${w.origin === "interpolated" ? "*" : ""}`).join(" ");
out.matched = words.filter((w) => w.origin === "asr").length; out.interpolated = words.filter((w) => w.origin === "interpolated").length;
out.keepsOriginalText = words.map((w) => w.text).join(" ") === parseLyrics(lyrics).flatMap((l) => l.words).join(" ");
const plan = planVariants(3, ["Impacto", "Karaoke"], ["#111111", "#1E3A8A"], 42);
out.plan = plan.variants.map((v) => `${v.index}:${v.style}/${v.background}`);
const byLine = new Map<number, TimedWord[]>(); for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w]);
const renders: unknown[] = [];
for (const v of plan.variants) {
  const { width: W, height: H } = RATIO_SIZE["9:16"];
  const eff = styleForRatio({ ...PRESETS[v.style], y: 0.5, fontName: "Liberation Sans" }, "9:16");
  writeFileSync(join(dir, "l.ass"), buildAss(words, { ...eff, maxLines: 3 }, { width: W, height: H }, groupsFrom([...byLine.values()], eff.maxCharsPerLine)));
  t = Date.now();
  sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x${v.background.slice(1)}:s=${W}x${H}:r=30:d=${len}`, "-i", join(dir, "seg.m4a"), "-vf", `subtitles=${escapeFilterPath(join(dir, "l.ass"))},format=yuv420p`,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "superfast", "-tune", "stillimage", "-c:a", "aac", "-shortest", join(dir, `v${v.index}.mp4`)]);
  const p = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height:format=duration", join(dir, `v${v.index}.mp4`)]));
  renders.push({ variant: v.index, render_ms: Date.now() - t, streams: p.streams.map((s: { codec_name: string; width?: number; height?: number }) => [s.codec_name, s.width, s.height].filter(Boolean).join(" ")), duration: p.format.duration });
}
out.renders = renders;
const json = JSON.stringify(out, null, 2);
console.log(json);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Autoprueba Lyric Studio\n```json\n" + json + "\n```\n");
