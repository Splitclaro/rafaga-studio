// Miniatura real de un clip: 3 candidatos (20/40/60 %) y se elige el que no es negro y tiene más detalle.
import { spawnSync } from "node:child_process";
import { pickFrame } from "@rafaga/composition";

export function extractThumb(video: string, outJpg: string): { at: number } {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" });
  const dur = Number(probe.stdout.trim()) || 3;
  const times = [0.2, 0.4, 0.6].map((f) => Math.max(0.2, Math.min(dur - 0.1, dur * f)));
  const grays = times.map((t) => {
    const r = spawnSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=96:-2", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 22 });
    return new Uint8Array(r.stdout ?? []);
  });
  const at = times[pickFrame(grays)];
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", outJpg]);
  if (r.status !== 0) throw new Error(`miniatura: ${r.stderr?.toString().slice(-200)}`);
  return { at };
}
