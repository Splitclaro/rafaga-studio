import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition, ffmpegArgs, sanitizeLogo } from "./composition.ts";

test("logo: valores acotados y posición por defecto", () => {
  assert.deepEqual(sanitizeLogo({ position: "zz" as never, scale: 9, opacity: -1, margin: 1 }), { position: "tr", scale: 0.4, opacity: 0.1, margin: 0.15 });
});

const has = spawnSync("ffmpeg", ["-version"]).status === 0;
test("export real con logo, intro sin audio y outro foto: duración, audio continuo y logo en su esquina", { skip: !has }, () => {
  const d = mkdtempSync(join(tmpdir(), "brand-"));
  const sh = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a]); assert.equal(r.status, 0, r.stderr?.toString()); };
  try {
    sh(["-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-shortest", "-pix_fmt", "yuv420p", join(d, "src.mp4")]);
    sh(["-f", "lavfi", "-i", "color=c=0x0000ff:s=320x180:r=25:d=2", "-pix_fmt", "yuv420p", join(d, "intro.mp4")]);
    sh(["-f", "lavfi", "-i", "color=c=0x00ff00:s=200x200", "-frames:v", "1", join(d, "outro.png")]);
    sh(["-f", "lavfi", "-i", "color=c=0xffffff:s=100x100", "-frames:v", "1", join(d, "logo.png")]);
    writeFileSync(join(d, "c.ass"), "[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
    const comp = { ...buildComposition({ words: [], startSec: 1, endSec: 3, ratio: "9:16" }), layout: "fit" as const, burnSubtitles: false };
    const args = ffmpegArgs(comp, { input: join(d, "src.mp4"), assPath: join(d, "c.ass"), output: join(d, "o.mp4"),
      logo: { local: join(d, "logo.png"), position: "tr", scale: 0.2, opacity: 1, margin: 0.05 },
      intro: { local: join(d, "intro.mp4"), kind: "video", dur: 1.5, hasAudio: false }, outro: { local: join(d, "outro.png"), kind: "photo", dur: 1, hasAudio: false } });
    const r = spawnSync("ffmpeg", args); assert.equal(r.status, 0, r.stderr?.toString());
    const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", join(d, "o.mp4")]).stdout.toString());
    const dur = Number(probe.format.duration);
    assert.ok(Math.abs(dur - 4.5) < 0.15, `duración ${dur}`);
    const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video"), a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    assert.equal(v.width, 1080); assert.equal(v.height, 1920); assert.ok(a, "pista de audio presente");
    // fotograma del clip (t=2.5): logo blanco en la esquina superior derecha; intro (t=0.5) sin logo y azul
    const frame = (t: number) => spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", join(d, "o.mp4"), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 }).stdout as Buffer;
    const px = (b: Buffer, x: number, y: number) => [b[(y * 1080 + x) * 3], b[(y * 1080 + x) * 3 + 1], b[(y * 1080 + x) * 3 + 2]];
    const m = Math.round(1080 * 0.05), lw = 216;
    const clip = frame(2.5);
    assert.ok(px(clip, 1080 - m - lw / 2, m + lw / 2).every((c) => c > 230), "logo en la esquina");
    assert.ok(px(clip, m + 10, m + 10).every((c) => c < 60), "esquina opuesta sin logo");
    const intro = frame(0.5);
    assert.ok(px(intro, 540, 960)[2] > 200 && px(intro, 540, 960)[0] < 40, "intro azul");
    assert.ok(px(frame(4.2), 540, 960)[1] > 200, "outro verde");
    // audio: el tono del clip existe y la intro es silencio
    const vol = (t: number, l: number) => spawnSync("ffmpeg", ["-v", "info", "-ss", String(t), "-t", String(l), "-i", join(d, "o.mp4"), "-af", "volumedetect", "-vn", "-f", "null", "-"]).stderr.toString().match(/mean_volume: (-?[\d.]+)/)?.[1];
    assert.ok(Number(vol(0.2, 1)) < -60, `intro en silencio (${vol(0.2, 1)})`);
    assert.ok(Number(vol(2, 1)) > -30, `clip con audio (${vol(2, 1)})`);
    void readFileSync;
  } finally { rmSync(d, { recursive: true, force: true }); }
});
