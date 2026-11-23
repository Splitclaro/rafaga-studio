// Línea de tiempo del editor avanzado: edición (dividir, quitar, recortar, reordenar), escena en un instante y render REAL con ffmpeg.
// El archivo exportado se comprueba con ffprobe y fotogramas: orden de planos, corte, audio y texto superpuesto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyTimeline, addMedia, addText, splitAt, removeItem, trimItem, reorder, timelineAt, timelineDuration, validateTimeline, timelineAss, timelineFfmpegArgs, type TimelineDoc } from "./timeline.ts";

const FONTS = new URL("../../../apps/web/public/fonts/caption", import.meta.url).pathname;
const src = (id: string, duration = 4) => ({ kind: "media_item" as const, id, media: "video" as const, duration });
const vid = (d: TimelineDoc) => (d.tracks.find((t) => t.kind === "video")!.items as { id: string; at: number; in: number; out: number }[]);

test("añadir medios los coloca uno tras otro; dividir, quitar (cerrando hueco), recortar y reordenar", () => {
  let d = emptyTimeline();
  d = addMedia(d, "video", src("rojo"), { itemId: "a", in: 0, out: 2 });
  d = addMedia(d, "video", src("verde"), { itemId: "b", in: 1, out: 3 });
  d = addMedia(d, "video", src("azul"), { itemId: "c", in: 0, out: 2 });
  assert.deepEqual(vid(d).map((x) => [x.id, x.at]), [["a", 0], ["b", 2], ["c", 4]]); assert.equal(timelineDuration(d), 6);
  d = splitAt(d, "b", 3, "b2");
  assert.deepEqual(vid(d).map((x) => [x.id, x.at, x.in, x.out]), [["a", 0, 0, 2], ["b", 2, 1, 2], ["b2", 3, 2, 3], ["c", 4, 0, 2]]);
  d = removeItem(d, "b2");
  assert.deepEqual(vid(d).map((x) => [x.id, x.at]), [["a", 0], ["b", 2], ["c", 3]]); assert.equal(timelineDuration(d), 5);
  d = trimItem(d, "a", { in: 0.5 });
  assert.deepEqual(vid(d).find((x) => x.id === "a"), { ...vid(d).find((x) => x.id === "a")!, in: 0.5, out: 2 });
  d = reorder(d, "c", 0);
  assert.deepEqual(vid(d).map((x) => [x.id, x.at]), [["c", 0], ["a", 2], ["b", 3.5]]);
});

test("escena en un instante: plano, tiempo de la fuente y textos activos (vista previa = exportación)", () => {
  let d = addMedia(emptyTimeline(), "video", src("rojo"), { itemId: "a", in: 1, out: 3 });
  d = addText(d, { at: 0.5, dur: 1, text: "Hola", itemId: "t" });
  const s = timelineAt(d, 1.2);
  assert.equal(s.video?.id, "a"); assert.equal(s.video?.srcTime, 2.2); assert.deepEqual(s.texts.map((x) => x.text), ["Hola"]);
  assert.equal(timelineAt(d, 1.6).texts.length, 0); assert.equal(timelineAt(d, 2.5).video, null);
  assert.match(timelineAss(d, "9:16"), /Dialogue: 0,0:00:00\.50,0:00:01\.50,T,.*\\pos\(540,1536\).*Hola/);
});

test("documento inválido: se descartan elementos rotos y se evitan solapes", () => {
  const d = validateTimeline({ tracks: [{ id: "v", kind: "video", items: [{ id: "x", src: { kind: "media_item", id: "m" }, at: 0, in: 0, out: 2 }, { id: "y", src: { kind: "media_item", id: "n" }, at: 1, in: 0, out: 2 }, { id: "z", src: { kind: "otro", id: "q" } }] }] });
  assert.deepEqual(vid(d).map((x) => [x.id, x.at]), [["x", 0], ["y", 2]]);
  assert.deepEqual(validateTimeline(null).tracks.map((t) => t.kind), ["video", "text", "audio"]);
});

test("render real: orden de planos, corte, audio y texto superpuesto en el archivo final", () => {
  assert.equal(spawnSync("ffmpeg", ["-version"]).status, 0, "ffmpeg es obligatorio");
  const dir = mkdtempSync(join(tmpdir(), "tl-")), mk = (name: string, color: string, args: string[] = []) => {
    const f = join(dir, `${name}.mp4`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x240:r=30:d=4`, ...args, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(args.length ? ["-c:a", "aac", "-shortest"] : []), f]);
    assert.equal(r.status, 0, String(r.stderr)); return f;
  };
  const rojo = mk("rojo", "red", ["-f", "lavfi", "-i", "sine=f=440:d=4"]), verde = mk("verde", "green"), azul = mk("azul", "blue", ["-f", "lavfi", "-i", "sine=f=880:d=4"]);
  const musica = join(dir, "musica.m4a"); assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=6", "-c:a", "aac", musica]).status, 0);
  let d = emptyTimeline();
  d = addMedia(d, "video", src("verde"), { itemId: "a", in: 0, out: 1 });
  d = addMedia(d, "video", src("rojo"), { itemId: "b", in: 0, out: 2 });
  d = addMedia(d, "video", src("azul"), { itemId: "c", in: 0, out: 1 });
  d = splitAt(d, "b", 2, "b2"); d = removeItem(d, "b2");          // corte: el rojo queda en 1 s
  d = reorder(d, "c", 0);                                            // orden final: azul, verde, rojo
  d = addText(d, { at: 0, dur: 3, text: "RÁFAGA", itemId: "t" });
  d = addMedia(d, "audio", { kind: "song", id: "musica", media: "audio" }, { itemId: "m", in: 0, out: 3 });
  assert.equal(timelineDuration(d), 3);
  const ass = join(dir, "t.ass"), out = join(dir, "out.mp4"); writeFileSync(ass, timelineAss(d, "9:16"));
  const r = spawnSync("ffmpeg", timelineFfmpegArgs(d, "9:16", { files: { rojo, verde, azul, musica }, hasAudio: { verde: false }, ass, fontsDir: FONTS, out, scale: 1 / 3 }), { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", out], { encoding: "utf8" }).stdout);
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video"), a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  assert.deepEqual([v.codec_name, v.width, v.height, a?.codec_name], ["h264", 360, 640, "aac"]);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1, `duración ${probe.format.duration}`);
  const px = (t: number, x: number, y: number) => { const o = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]); return [...o.stdout].slice(0, 3); };
  const dom = (p: number[]) => (p[0] > 150 && p[1] < 100 && p[2] < 100 ? "rojo" : p[1] > 90 && p[0] < 100 && p[2] < 100 ? "verde" : p[2] > 150 && p[0] < 100 ? "azul" : `otro(${p})`);
  assert.deepEqual([dom(px(0.5, 20, 20)), dom(px(1.5, 20, 20)), dom(px(2.5, 20, 20))], ["azul", "verde", "rojo"], "orden de planos y corte");
  const txt = px(1, 180, 512), base = px(1, 20, 512);
  assert.notDeepEqual(txt, base, "el texto superpuesto cambia los píxeles en su caja");
  const vol = (from: number) => { const o = spawnSync("ffmpeg", ["-v", "info", "-ss", String(from), "-t", "0.5", "-i", out, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }); return Number(/mean_volume: (-?[\d.]+)/.exec(o.stderr)?.[1] ?? -99); };
  assert.ok(vol(0.2) > -40 && vol(1.2) > -40 && vol(2.2) > -40, "hay audio en los tres tramos (plano y música)");
});
