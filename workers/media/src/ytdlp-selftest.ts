// Autoprueba en la nube: ¿puede el worker (GitHub Actions) descargar un vídeo público de YouTube por enlace?
// Mide tiempo, tamaño y propiedades del archivo, y prueba la descarga de solo un tramo. No toca Supabase.
import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ytdlp } from "./source.ts";

const URLS = (process.env.YT_TEST_URLS ?? "https://www.youtube.com/watch?v=aqz-KE-bpKQ").split(",");
const dir = mkdtempSync(join(tmpdir(), "ytdlp-"));
const probe = (f: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", f], { encoding: "utf8" }).stdout);
const v = spawnSync("yt-dlp", ["--version"], { encoding: "utf8" });
console.log("yt-dlp", v.stdout.trim() || v.error?.message);
let fails = 0;
for (const [i, url] of URLS.entries()) {
  for (const section of [[30, 75] as [number, number], undefined]) {
    const out = join(dir, `v${i}${section ? "-tramo" : ""}.mp4`); const t = Date.now();
    try {
      ytdlp(url, out, { section });
      const p = probe(out); const vs = p.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      console.log(JSON.stringify({ url, section: section ?? "completo", ok: existsSync(out), seconds: (Date.now() - t) / 1000, mb: +(statSync(out).size / 1048576).toFixed(1), duration: +Number(p.format.duration).toFixed(1), video: `${vs?.codec_name} ${vs?.width}x${vs?.height}`, audio: p.streams.some((s: { codec_type: string }) => s.codec_type === "audio") }));
    } catch (e) { fails++; console.log(JSON.stringify({ url, section: section ?? "completo", ok: false, seconds: (Date.now() - t) / 1000, error: (e as Error).message })); }
  }
}
process.exit(fails ? 1 : 0);
