// Etapa de exportación: textos (SRT/VTT/TXT), editores profesionales y un render MP4 real H.264/yuv420p con clave fijada a la versión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { viralTemplate } from "@rafaga/composition";
import { buildEDL, buildFCPXML, buildXMEML, exportKey, textOutput, STAGE_IMPLS, type ExportItem } from "./stages/export.ts";
import type { StageCtx, StageRow } from "./stages/registry.ts";

const comp = viralTemplate("hablante_seguimiento", "9:16", { duration: 6, fragments: [{ start: 1, end: 3 }, { start: 5, end: 9 }] });
const words = [{ text: "hola", start: 1, end: 1.5 }, { text: "mundo", start: 1.5, end: 2.2 }, { text: "adiós", start: 5.2, end: 6 }];
const item = (kind: string): ExportItem => ({ render_id: "r1", workspace_id: "ws", clip_id: "clip", version: 3, kind, aspect: "9:16", burn: true, composition: comp, source_id: "src", title: "Mi clip", words, hash: "ab".repeat(32), batch_id: null });

test("clave fijada a versión+huella; SRT/VTT/TXT con el texto del clip", () => {
  assert.equal(exportKey(item("mp4")), "ws/clip/v3-abababababab.mp4");
  assert.match(textOutput(item("srt")), /-->/); assert.match(textOutput(item("vtt")), /^WEBVTT/); assert.match(textOutput(item("txt")), /hola mundo/);
});
test("EDL, FCPXML y xmeml: un evento por fragmento conservado", () => {
  const edl = buildEDL("Mi clip", comp); assert.equal((edl.match(/^\d{3} /gm) ?? []).length, 2); assert.match(edl, /00:00:01:00 00:00:03:00 00:00:00:00 00:00:02:00/);
  assert.equal((buildFCPXML("Mi clip", comp, "a.mp4").match(/<asset-clip /g) ?? []).length, 2);
  assert.equal((buildXMEML("Mi clip", comp, "a.mp4").match(/<clipitem /g) ?? []).length, 2);
  assert.match(buildFCPXML("A & B <x>", comp, "a.mp4"), /A &amp; B &lt;x&gt;/);
});
test("render real: MP4 H.264/yuv420p 1080×1920 subido a la clave de la versión y registrado con finish_render", async () => {
  const dir = mkdtempSync(join(tmpdir(), "exp-")), src = join(dir, "src", "mezzanine.mp4");
  spawnSync("mkdir", ["-p", join(dir, "src")]);
  const g = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=1280x720:r=30:d=10", "-f", "lavfi", "-i", "sine=f=440:d=10", "-shortest", "-pix_fmt", "yuv420p", src]);
  assert.equal(g.status, 0, "ffmpeg debe estar disponible");
  const uploads: string[] = [], calls: { fn: string; a: Record<string, unknown> }[] = [];
  const ctx = { workerId: "w", componentVersions: {}, log: () => {}, tmpDir: dir,
    r2: { download: async () => {}, upload: async (k: string, f: string) => { uploads.push(k); assert.ok(existsSync(f)); }, remove: async () => {} },
    rpc: async (fn: string, a: Record<string, unknown> = {}) => { calls.push({ fn, a }); if (fn === "export_job_item") return item("mp4"); if (fn === "source_info") return { id: "src", workspace_id: "ws", storage_path: "ws/src/m.mp4", bytes: 1, duration_ms: 10000, has_audio: true }; return null; } } as unknown as StageCtx;
  const out = await STAGE_IMPLS.render.run(ctx, { id: "s", params: { render_id: "r1" } } as unknown as StageRow);
  assert.deepEqual(uploads, ["ws/clip/v3-abababababab.mp4"]); assert.equal(out.output.width, 1080); assert.equal(out.output.height, 1920);
  const fin = calls.find((c) => c.fn === "finish_render")!.a; assert.equal(fin.p_status, "ready"); assert.equal(fin.p_path, "ws/clip/v3-abababababab.mp4");
  void writeFileSync;
});
test("un render fallido marca solo su fila como failed y propaga el código", async () => {
  const calls: string[] = [];
  const ctx = { workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "exp-")),
    r2: { download: async () => { throw new Error("no"); }, upload: async () => {}, remove: async () => {} },
    rpc: async (fn: string) => { calls.push(fn); if (fn === "export_job_item") return item("mp4"); if (fn === "source_info") return null; return null; } } as unknown as StageCtx;
  await assert.rejects(STAGE_IMPLS.render.run(ctx, { id: "s", params: { render_id: "r1" } } as unknown as StageRow), /no existe/);
  assert.ok(calls.includes("finish_render"));
});
