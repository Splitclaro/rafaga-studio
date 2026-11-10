import { test } from "node:test";
import assert from "node:assert/strict";
import { trimClip, clampEdge, type TrimState } from "./trim.ts";
import type { Word } from "./subtitles.ts";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });
// clip de 10 s a 100–110 en la fuente; palabras relativas
const clip: TrimState = { startSec: 100, endSec: 110, words: [w("uno", 0.5, 1), w("dos", 3, 3.5), w("tres", 6, 6.5), w("cuatro", 9, 9.8)], broll: [{ path: "p", kind: "photo", start: 2, dur: 3 }] };
const src = [w("antes", 98, 98.6), w("uno", 100.5, 101), w("dos", 103, 103.5), w("tres", 106, 106.5), w("cuatro", 109, 109.8), w("despues", 111, 111.6), w("lejos", 130, 131)];

test("recortar por delante re-relativiza palabras y B-roll", () => {
  const r = trimClip(clip, 102, 110, 600);
  assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.words.map((x) => [x.text, x.start, x.end]), [["dos", 1, 1.5], ["tres", 4, 4.5], ["cuatro", 7, 7.8]]);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.broll, [{ path: "p", kind: "photo", start: 0, dur: 3 }]);   // 2–5 s pasa a 0–3 s
});
test("recortar por detrás descarta lo que queda fuera y recorta B-roll", () => {
  const r = trimClip(clip, 100, 106.2, 600);
  assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.words.map((x) => x.text), ["uno", "dos"]);   // «tres» (6–6,5) solo tiene 0,2 de 0,5 s dentro: fuera
  assert.deepEqual(r.broll, [{ path: "p", kind: "photo", start: 2, dur: 3 }]);
});
test("una palabra cortada por la mitad se conserva solo si queda al menos la mitad", () => {
  const a = trimClip(clip, 100, 106.3, 600); const b = trimClip(clip, 100, 106.1, 600);
  assert.ok(a.ok && b.ok); if (!a.ok || !b.ok) return;
  assert.ok(a.words.some((x) => x.text === "tres")); assert.ok(!b.words.some((x) => x.text === "tres"));
  assert.equal(a.words.find((x) => x.text === "tres")!.end, 6.3);
});
test("ampliar rellena solo las zonas nuevas con la transcripción y no duplica lo editado", () => {
  const edited: TrimState = { ...clip, words: clip.words.map((x) => (x.text === "dos" ? { ...x, text: "DOS editado" } : x)) };
  const r = trimClip(edited, 98, 112, 600, src);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.added, 2);   // «antes» y «despues»; «lejos» queda fuera del tramo
  assert.ok(r.words.some((x) => x.text === "DOS editado"), "conserva la edición");
  assert.equal(r.words.filter((x) => /^dos/i.test(x.text)).length, 1, "no duplica");
  assert.deepEqual(r.words.map((x) => x.text), ["antes", "uno", "DOS editado", "tres", "cuatro", "despues"]);
  assert.equal(r.words[0].start, 0); assert.equal(r.words[1].start, 2.5);
});
test("límites: mínimo, máximo y fuente", () => {
  assert.equal(trimClip(clip, 100, 102, 600).ok, false);
  assert.equal(trimClip(clip, 100, 200, 600).ok, false);
  const r = trimClip(clip, 100, 130, 108);   // el fin se acota a la duración de la fuente
  assert.ok(r.ok && r.endSec === 108);
  assert.equal(trimClip(clip, NaN, 110, 600).ok, false);
});
test("recorte idéntico no cambia nada", () => {
  const r = trimClip(clip, 100, 110, 600);
  assert.ok(r.ok); if (!r.ok) return;
  assert.deepEqual(r.words, clip.words); assert.equal(r.dropped, 0); assert.equal(r.added, 0);
  assert.deepEqual(r.broll, clip.broll);
});
test("clampEdge respeta mínimo, máximo, fuente y la otra punta", () => {
  assert.equal(clampEdge("start", 109, 100, 110, 600), 107);
  assert.equal(clampEdge("start", -5, 100, 110, 600), 20);   // máx 90 s de clip → inicio ≥ 20
  assert.equal(clampEdge("end", 101, 100, 110, 600), 103);
  assert.equal(clampEdge("end", 500, 100, 110, 150), 150);
  assert.equal(clampEdge("end", 500, 100, 110, 600), 190);
});

// e2e real: el export de un clip recortado sale del tramo nuevo de la fuente y dura lo que marca el recorte
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComposition, ffmpegArgs } from "./composition.ts";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("e2e real: export tras recortar usa el tramo y la duración nuevos", { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), "trim-"));
  try {
    const run = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { maxBuffer: 1 << 27 }); assert.equal(r.status, 0, r.stderr?.toString()); };
    // fuente 20 s: rojo 0–10 s, azul 10–20 s, con audio
    run(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "sine=f=440:d=20", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-map", "2:a", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, "src.mp4")]);
    const ass = join(dir, "e.ass"); writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: W,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
    const base = buildComposition({ words: [], startSec: 2, endSec: 12 });
    const r = trimClip({ startSec: base.startSec, endSec: base.endSec, words: base.words }, 8, 18, 20);
    assert.ok(r.ok); if (!r.ok) return;
    const comp = { ...base, startSec: r.startSec, endSec: r.endSec, words: r.words, layout: "fit" as const, burnSubtitles: false };
    const args = ffmpegArgs(comp, { input: join(dir, "src.mp4"), assPath: ass, output: join(dir, "out.mp4"), escape: (p: string) => p } as never);
    const x = spawnSync("ffmpeg", args, { maxBuffer: 1 << 27 }); assert.equal(x.status, 0, x.stderr?.toString());
    const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "out.mp4")]).stdout.toString());
    assert.ok(Math.abs(dur - 10) < 0.2, `duración ${dur}`);
    const px = (t: number) => { const o = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", join(dir, "out.mp4"), "-frames:v", "1", "-vf", "crop=2:2:540:960,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 }).stdout as Buffer; return [o[0], o[1], o[2]]; };
    const early = px(0.5), late = px(5);   // fuente 8,5 s = rojo; fuente 13 s = azul
    assert.ok(early[0] > 150 && early[2] < 100, `rojo esperado ${early}`);
    assert.ok(late[2] > 150 && late[0] < 100, `azul esperado ${late}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
