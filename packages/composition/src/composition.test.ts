import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposition, ffmpegArgs, escapeFilterPath } from "./composition.ts";

const words = [{ text: "a", start: 9.5, end: 10.2 }, { text: "b", start: 10.2, end: 11 }, { text: "c", start: 30, end: 31 }];
test("palabras relativas al clip tras recortar", () => {
  const c = buildComposition({ words, startSec: 10, endSec: 20 });
  assert.deepEqual(c.words.map((w) => [w.text, w.start, w.end]), [["a", 0, 0.2], ["b", 0.2, 1]]);
});
test("intervalo inválido lanza", () => assert.throws(() => buildComposition({ words, startSec: 5, endSec: 5 })));
test("args de ffmpeg: sin shell, rutas escapadas, duración exacta", () => {
  const c = buildComposition({ words, startSec: 10, endSec: 20 });
  const a = ffmpegArgs(c, { input: "in.mp4", assPath: "/tmp/we:ird,'x.ass", output: "o.mp4" });
  assert.ok(a.includes("-t") && a[a.indexOf("-t") + 1] === "10");
  assert.ok(a.join(" ").includes("we\\:ird\\,\\'x.ass"));
});
test("escapeFilterPath", () => assert.equal(escapeFilterPath("a:b,c"), "a\\:b\\,c"));

import { spawnSync } from "node:child_process";
const ff = spawnSync("ffmpeg", ["-version"]).status === 0;
test("layouts fill/fit/blur y B-roll producen vídeo válido con FFmpeg real", { skip: !ff }, () => {
  const d = "/tmp/rafaga-layout-test/"; spawnSync("mkdir", ["-p", d]);
  const run = (a: string[]) => { const r = spawnSync("ffmpeg", a, { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr.slice(-300)); };
  run(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=6", "-f", "lavfi", "-i", "sine=d=6", "-shortest", "-c:v", "libx264", "-c:a", "aac", `${d}s.mp4`]);
  run(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x400:d=1", "-frames:v", "1", `${d}b.png`]);
  for (const layout of ["blur", "fill", "fit"] as const) for (const ratio of ["9:16", "4:5", "1:1", "16:9"] as const) {
    const c = { ...buildComposition({ words: [{ text: "hola", start: 0, end: 1 }], startSec: 1, endSec: 5, ratio }), layout, burnSubtitles: false, crop: { x: 0.2 } };
    run(ffmpegArgs(c, { input: `${d}s.mp4`, assPath: "", output: `${d}o-${layout}-${ratio.replace(":", "x")}.mp4`, broll: [{ local: `${d}b.png`, kind: "photo", start: 1, dur: 1.5 }] }));
    const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", `${d}o-${layout}-${ratio.replace(":", "x")}.mp4`], { encoding: "utf8" }).stdout.split("\n")[0];
    const { width, height } = { "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 } }[ratio];
    assert.equal(p, `${width},${height}`);
  }
});
