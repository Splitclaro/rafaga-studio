import { test } from "node:test";
import assert from "node:assert/strict";
import { contextTail, toAbs, insideContext, isDuplicate, freshCandidates, overlapRatio, liveLatency } from "./livectx.ts";

test("cola de contexto: nunca más de la mitad de la ventana anterior y 0 si no hay", () => {
  assert.equal(contextTail(null), 0); assert.equal(contextTail(6), 0); assert.equal(contextTail(120), 30); assert.equal(contextTail(40), 20);
});
test("un momento que cruza dos ventanas queda dentro de la segunda gracias al contexto", () => {
  // ventana 1: 0–120 s; ventana 2 empieza con 30 s de cola → su fuente arranca en el segundo 90 de la sesión
  const absStart2 = 120 - 30, cross = { start: 20, end: 55 };   // 110–145 s absolutos: empieza en la ventana 1 y acaba en la 2
  assert.deepEqual(toAbs(absStart2, cross), { start: 110, end: 145 });
  assert.equal(insideContext(cross, 30), false, "no se descarta: termina fuera del contexto");
});
test("lo que cae entero en el contexto se descarta (ya era de la ventana anterior)", () => {
  assert.equal(insideContext({ start: 2, end: 25 }, 30), true);
  const { fresh, dropped } = freshCandidates([{ start: 2, end: 25 }, { start: 40, end: 80 }], { absStart: 90, skipBefore: 30, delivered: [] });
  assert.equal(fresh.length, 1); assert.equal(dropped[0].why, "contexto");
});
test("sin duplicados tras reconexión o reproceso: mismo momento en tiempo absoluto = descartado", () => {
  const delivered = [{ start: 110, end: 145 }];
  assert.equal(isDuplicate({ start: 112, end: 146 }, delivered), true);
  assert.equal(isDuplicate({ start: 150, end: 190 }, delivered), false);
  assert.ok(overlapRatio({ start: 0, end: 10 }, { start: 8, end: 20 }) === 0.2);
  const r = freshCandidates([{ start: 22, end: 57 }, { start: 70, end: 100 }], { absStart: 90, skipBefore: 30, delivered });
  assert.deepEqual(r.fresh, [{ start: 70, end: 100 }]); assert.equal(r.dropped[0].why, "duplicado");
});
test("latencia en segundos desde el final del momento hasta el clip reproducible", () => {
  assert.equal(liveLatency(1000, 46_000), 45); assert.equal(liveLatency(5000, 1000), 0);
});

// e2e real: la cola de la ventana anterior se antepone con ffmpeg (-sseof, copia) y la fuente resultante dura cola + ventana
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { concatWindow } from "./hlsconcat.ts";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("e2e real: ventana con contexto = cola de la anterior + ventana nueva, reproducible", { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-"));
  try {
    const run = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a]); assert.equal(r.status, 0, r.stderr?.toString()); };
    const mk = (name: string, col: string, d: number) => run(["-f", "lavfi", "-i", `color=c=${col}:s=320x180:r=25:d=${d}`, "-f", "lavfi", "-i", `sine=f=440:d=${d}`, "-c:v", "libx264", "-g", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, name)]);
    mk("w1.mp4", "red", 60); mk("w2.mp4", "blue", 60);
    const T = contextTail(60); assert.equal(T, 30);
    run(["-sseof", `-${T}`, "-i", join(dir, "w1.mp4"), "-c", "copy", join(dir, "tail.mp4")]);
    const c = concatWindow([join(dir, "tail.mp4"), join(dir, "w2.mp4")], join(dir, "ctx.mp4"), join(dir, "l.txt"));
    const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "ctx.mp4")]).stdout.toString());
    assert.ok(Math.abs(dur - 90) < 2.5, `duración ${dur} (esperada ≈ 90 s: 30 s de cola + 60 s)`); assert.ok(c.bytes > 0);
    // primer tramo = rojo (cola de w1), último = azul (w2)
    const px = (t: number) => { const o = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", join(dir, "ctx.mp4"), "-frames:v", "1", "-vf", "crop=2:2:160:90,format=rgb24", "-f", "rawvideo", "-"]).stdout as Buffer; return [o[0], o[2]]; };
    const a = px(5), b = px(80); assert.ok(a[0] > 150 && a[1] < 100, `rojo esperado ${a}`); assert.ok(b[1] > 150 && b[0] < 100, `azul esperado ${b}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
