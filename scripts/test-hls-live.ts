// Prueba con emisión HLS REAL y progresiva: FFmpeg publica segmentos en tiempo real, se corta y reinicia la fuente a mitad,
// y la captura debe: bajar solo segmentos nuevos, no unir a través del hueco y producir ventanas MP4 válidas.
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHls, concatWindow, type Fetcher } from "../packages/providers/src/index.ts";

const root = mkdtempSync(join(tmpdir(), "live-")), srv = join(root, "srv"), cap = join(root, "cap");
spawnSync("mkdir", ["-p", srv]);
const server = http.createServer((q, r) => { const f = join(srv, (q.url ?? "").split("?")[0]); if (!existsSync(f)) { r.statusCode = 404; return r.end(); } r.end(readFileSync(f)); }).listen(0);
const port = (server.address() as { port: number }).port;
const fetchLocal: Fetcher = (url) => new Promise((res, rej) => http.get(url, (r) => { const c: Buffer[] = []; r.on("data", (d) => c.push(d)); r.on("end", () => res({ status: r.statusCode ?? 0, contentType: String(r.headers["content-type"] ?? ""), body: Buffer.concat(c), finalUrl: url })); }).on("error", rej));

let n = 0;
const startFfmpeg = () => spawn("ffmpeg", ["-v", "error", "-re", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25", "-f", "lavfi", "-i", "sine=frequency=440", "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", "-c:a", "aac",
  "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments+discont_start", "-hls_start_number_source", "generic", "-start_number", String(n * 100), "-hls_segment_filename", join(srv, "s%d.ts"), join(srv, "live.m3u8")], { stdio: "ignore" });
let ff = startFfmpeg();
const t0 = Date.now(), wins: { seconds: number; reason: string; mp4: string; bytes: number }[] = [];
setTimeout(() => { ff.kill("SIGKILL"); setTimeout(() => { n = 1; ff = startFfmpeg(); }, 6000); }, 22000);      // la fuente se cae 6 s y vuelve con otra numeración

const stats = await captureHls({
  fetch: fetchLocal, url: `http://127.0.0.1:${port}/live.m3u8`, dir: cap, windowSeconds: 12, minWindowSeconds: 4, maxSeconds: 600, shouldStop: async () => Date.now() - t0 > 52000,
  onWindow: async (w) => { const mp4 = join(root, `w${wins.length}.mp4`); const c = concatWindow(w.files, mp4, join(root, `l${wins.length}.txt`)); wins.push({ seconds: w.seconds, reason: w.reason, mp4, bytes: c.bytes }); },
});
ff.kill("SIGKILL"); server.close();
const probes = wins.map((w) => { const o = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type:format=duration", w.mp4], { encoding: "utf8" }).stdout); return { ...w, mp4: undefined, duration: Number(o.format.duration), streams: o.streams.map((s: { codec_type: string }) => s.codec_type).sort().join("+") }; });
console.log(JSON.stringify({ stats, windows: probes }, null, 1));
const bad = probes.filter((p) => p.streams !== "audio+video" || Math.abs(p.duration - p.seconds) > 2.5);
if (!probes.length || bad.length) { console.error("FALLO: ventanas inválidas", bad); process.exit(1); }
if (stats.windows < 3) { console.error("FALLO: se esperaban ≥3 ventanas"); process.exit(1); }
console.log(`OK: ${stats.windows} ventanas válidas, ${stats.gaps} hueco(s), ${stats.reconnects} reconexión(es)`);
