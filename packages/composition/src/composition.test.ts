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
