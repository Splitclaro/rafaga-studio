import { test } from "node:test";
import assert from "node:assert/strict";
import { sequenceFor, lyricFfmpegArgs, bandHeight, DEFAULT_BG } from "./background.ts";

const items = [{ path: "a.mp4", kind: "video" as const }, { path: "b.mp4", kind: "video" as const }, { path: "c.jpg", kind: "photo" as const }];
test("secuencia cubre la duración exacta, reproducible y sin repetir hasta agotar", () => {
  const s = sequenceFor(items, 23, DEFAULT_BG, 9);
  assert.equal(s.length, 5);
  assert.equal(+s.reduce((t, x) => t + x.dur, 0).toFixed(3), 23);
  assert.equal(new Set(s.slice(0, 3).map((x) => x.item.path)).size, 3);
  assert.deepEqual(sequenceFor(items, 23, DEFAULT_BG, 9), s);
  assert.notDeepEqual(sequenceFor(items, 23, DEFAULT_BG, 10).map((x) => x.item.path), s.map((x) => x.item.path));
  assert.equal(sequenceFor(items, 23, { ...DEFAULT_BG, sequence: false }, 1).length, 1);
  assert.ok(sequenceFor(items, 600, DEFAULT_BG, 1).length <= 60);
});
test("args: color sólido y ajustes aplicados al export", () => {
  const a = lyricFfmpegArgs({ W: 1080, H: 1920, len: 10, color: "#112233", segments: [], settings: { ...DEFAULT_BG, bars: 0.2, filter: "noir", dim: 0.4 }, audio: "s.m4a", ass: "l.ass", out: "o.mp4", escape: (p) => p });
  const fc = a[a.indexOf("-filter_complex") + 1];
  assert.ok(a.join(" ").includes("color=c=0x112233"));
  assert.ok(fc.includes("hue=s=0") && fc.includes("black@0.40") && fc.includes("h=192"));
  assert.ok(a.includes("1:a:0"));
});
test("args: segmentos de vídeo y foto concatenados", () => {
  const a = lyricFfmpegArgs({ W: 1080, H: 1080, len: 10, color: "#000000", segments: sequenceFor(items, 10, DEFAULT_BG, 1), settings: DEFAULT_BG, audio: "s.m4a", ass: "l.ass", fontsDir: "/f", out: "o.mp4", escape: (p) => p });
  const fc = a[a.indexOf("-filter_complex") + 1];
  assert.ok(fc.includes("concat=n=2:v=1:a=0") && fc.includes("fontsdir=/f"));
  assert.ok(a.includes("2:a:0"));
});

import { spawnSync } from "node:child_process";
import { FILTERS } from "./background.ts";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("todos los filtros son válidos en FFmpeg real", { skip: !hasFfmpeg }, () => {
  for (const [name, f] of Object.entries(FILTERS)) {
    if (!f) continue;
    const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=0.2", "-vf", f, "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
  }
});

test("banda 16:9 centrada sobre lienzo negro (formato de referencia)", () => {
  assert.equal(bandHeight(1080, 1920, "band"), 608);
  assert.equal(bandHeight(1080, 1920, "full"), 1920);
  assert.equal(bandHeight(1920, 1080, "band"), 1080);
  const a = lyricFfmpegArgs({ W: 1080, H: 1920, len: 10, color: "#000000", segments: sequenceFor(items, 10, DEFAULT_BG, 1), settings: { ...DEFAULT_BG, frame: "band" }, audio: "s.m4a", ass: "l.ass", out: "o.mp4", escape: (p) => p });
  const fc = a[a.indexOf("-filter_complex") + 1];
  assert.ok(fc.includes("scale=1080:608") && fc.includes("pad=1080:1920:0:656:color=black"));
  assert.ok(fc.indexOf("pad=") < fc.indexOf("subtitles="), "la letra se quema sobre el lienzo ya compuesto");
  const full = lyricFfmpegArgs({ W: 1080, H: 1920, len: 10, color: "#000000", segments: sequenceFor(items, 10, DEFAULT_BG, 1), settings: { ...DEFAULT_BG, frame: "full" }, audio: "s.m4a", ass: "l.ass", out: "o.mp4", escape: (p) => p });
  assert.ok(!full.join(" ").includes("pad="));
});
