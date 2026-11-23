// Render REAL de un videolyric con el motor de Ráfaga (lyricAss + lyricRenderArgs + ffmpeg) con una canción propia, y comprobación con ffprobe.
// Los tiempos de las palabras se reparten de forma uniforme en el tramo: comprueban el motor y el archivo, NO la sincronía real de la canción.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { validateLyricComposition, lyricAss, lyricRenderArgs } from "../packages/composition/src/index.ts";
import { withCta, withFixedTitle, withFades } from "../apps/web/lib/lyrictexts.ts";

const FONTS = new URL("../apps/web/public/fonts/caption", import.meta.url).pathname, SONG = decodeURIComponent(new URL("../.fixtures/01-CRITIKA - CONTANDO DIAS.mp3", import.meta.url).pathname), OUT = new URL("../.fixtures/out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const text = "Estoy contando días para volver a verte y solo tengo miedo a que esa fecha no llegue Y dolerá ver que no estás";
const START = 10, END = 24, ws = text.split(" "), step = (END - START - 1) / ws.length;
const words = ws.map((w, i) => ({ text: w, start: START + 0.5 + i * step, end: START + 0.5 + (i + 1) * step - 0.04, line: Math.floor(i / 6) }));
let c = validateLyricComposition({ aspect: "9:16", res: 720, range: { start: START, end: END }, words, background: { kind: "color", color: "#101828" }, hook: { text: "Contando días", dur: 3 } });
c = withFixedTitle(c, true); c = withCta(c, "Escúchala ya", 3); c = withFades(c, 1, 1);
const ass = OUT + "videolyric.ass", out = OUT + "videolyric-critika.mp4"; writeFileSync(ass, lyricAss(c));
const t0 = Date.now(), r = spawnSync("ffmpeg", lyricRenderArgs(c, { audio: SONG, items: [], ass, fontsDir: FONTS, out }), { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const p = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames,sample_rate:format=duration,size", out], { encoding: "utf8" }).stdout);
console.log(JSON.stringify({ archivo: out, render_ms: Date.now() - t0, ...p }, null, 1));
