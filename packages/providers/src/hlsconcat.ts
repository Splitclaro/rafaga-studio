import { spawnSync } from "node:child_process";
import { writeFileSync, statSync } from "node:fs";

/** Une segmentos TS de una ventana en un MP4. Si supera `maxBytes` (límite de almacenamiento) se recodifica más ligero. */
export function concatWindow(files: string[], out: string, listPath: string, maxBytes = 45 * 1024 * 1024): { bytes: number; reencoded: boolean } {
  writeFileSync(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const run = (args: string[]) => { const r = spawnSync("ffmpeg", args, { encoding: "utf8" }); if (r.status) throw new Error(`ffmpeg: ${r.stderr.slice(-300)}`); };
  run(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", out]);
  let bytes = statSync(out).size, reencoded = false;
  if (bytes > maxBytes) {
    run(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-vf", "scale=-2:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out]);
    bytes = statSync(out).size; reencoded = true;
  }
  return { bytes, reencoded };
}
