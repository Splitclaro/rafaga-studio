import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { partName, PART_BYTES, previewArgs, fetchOriginal } from "./source.ts";

test("nombres de parte con relleno", () => { assert.equal(partName("w/s/original", 0), "w/s/original.part000"); assert.equal(partName("w/s/original", 12), "w/s/original.part012"); });
test("ventana de vista previa: ±90 s acotada al vídeo", () => {
  const a = previewArgs("in", "out", 30, 70, 600); assert.equal(a.offset, 0); assert.ok(a.args.includes("160.000"));
  const b = previewArgs("in", "out", 300, 340, 360); assert.equal(b.offset, 210); assert.ok(b.args.includes("150.000"));
});

test("fetchOriginal une las partes byte a byte y reproduce el archivo original", async () => {
  const d = mkdtempSync(join(tmpdir(), "src-"));
  const orig = join(d, "orig.mp4");
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", orig]);
  assert.equal(r.status, 0);
  const buf = readFileSync(orig), size = 9000;   // partes pequeñas para la prueba
  const parts = Math.ceil(buf.length / size);
  const store = new Map<string, Buffer>(); for (let i = 0; i < parts; i++) store.set(partName("w/s1/original", i), buf.subarray(i * size, (i + 1) * size));
  const sb = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { parts } }) }) }) }),
    storage: { from: () => ({ download: async (p: string) => (store.has(p) ? { data: new Blob([store.get(p)!]), error: null } : { data: null, error: { message: "no existe" } }) }) },
  };
  const out = join(d, "in");
  await fetchOriginal(sb as never, "w/s1/original", out);
  assert.equal(statSync(out).size, buf.length);
  assert.equal(createHash("sha256").update(readFileSync(out)).digest("hex"), createHash("sha256").update(buf).digest("hex"));
  const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" });
  assert.ok(Math.abs(Number(p.stdout) - 4) < 0.2);
  assert.ok(PART_BYTES < 50 * 1024 * 1024);
});

test("R2: descarga en streaming con URL firmada y caché por fuente", async () => {
  const { downloadR2 } = await import("./source.ts");
  const d = mkdtempSync(join(tmpdir(), "r2-"));
  const data = Buffer.alloc(3 * 1024 * 1024, 7);
  let asked = "";
  await downloadR2({ accountId: "acc", accessKeyId: "K", secretAccessKey: "S", bucket: "b" }, "w/s/original", join(d, "x"), (async (u: string) => { asked = u; return new Response(data); }) as unknown as typeof fetch);
  assert.equal(statSync(join(d, "x")).size, data.length);
  assert.match(asked, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/b\/w\/s\/original\?/);
  assert.match(asked, /X-Amz-Signature=[0-9a-f]{64}/);
});
