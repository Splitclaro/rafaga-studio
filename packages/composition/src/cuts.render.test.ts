import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegArgs, buildComposition } from "./index.ts";

const has = spawnSync("ffmpeg", ["-version"]).status === 0;
test("el export con cortes dura lo esperado y el audio y el vídeo coinciden", { skip: !has }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cuts-"));
  try {
    const src = join(dir, "s.mp4"), out = join(dir, "o.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=14", "-f", "lavfi", "-i", "sine=f=440:duration=14", "-shortest", "-c:v", "libx264", "-c:a", "aac", src]);
    for (const layout of ["blur", "fill", "fit", "split"] as const) {
      const c = { ...buildComposition({ words: [], startSec: 1, endSec: 11 }), burnSubtitles: false, layout, cam: { x: 0.65, y: 0.6, w: 0.3, h: 0.35 }, cuts: [{ s: 2, e: 5 }, { s: 8, e: 9 }] };
      execFileSync("ffmpeg", ffmpegArgs(c, { input: src, assPath: join(dir, "x.ass"), output: out, mainHasAudio: true }));
      const p = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
      const v = p.streams.find((s: { codec_type: string }) => s.codec_type === "video"), a = p.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
      assert.equal(v.width, 1080); assert.equal(v.height, 1920);
      assert.ok(Math.abs(Number(v.duration) - 6) < 0.2, `${layout} vídeo ${v.duration}`);
      assert.ok(Math.abs(Number(a.duration) - 6) < 0.2, `${layout} audio ${a.duration}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
