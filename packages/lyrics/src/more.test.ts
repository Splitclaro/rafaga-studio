import { test } from "node:test";
import assert from "node:assert/strict";
import { planMore, moreIsCopy, restoreShots, swapShots } from "./more.ts";
import type { Shot, ShotItem } from "./looks.ts";

const items: ShotItem[] = [0, 1, 2, 3].map((i) => ({ path: `/x/${i}.mp4`, kind: "video" as const, duration: 30 }));
const srcs = items.map((_, i) => `ws/c/${i}.mp4`);
const base = { style: "look:a", background: "coleccion", seed: 1000 };
const lockNone = { style: false, background: false, shots: false };

test("todo bloqueado = copia: se rechaza", () => {
  assert.ok(moreIsCopy({ style: true, background: true, shots: true }));
  assert.throws(() => planMore(base, 3, { style: true, background: true, shots: true }, { styles: ["look:a"], backgrounds: ["coleccion"] }, 5), /Desbloquea/);
});
test("estilo bloqueado: todas conservan el estilo y varían el fondo; ninguna repite la combinación base", () => {
  const v = planMore(base, 4, { style: true, background: false, shots: false }, { styles: ["look:a", "look:b"], backgrounds: ["#111111", "#222222", "#333333", "coleccion"] }, 9);
  assert.equal(v.length, 4);
  assert.ok(v.every((x) => x.style === "look:a"));
  assert.ok(v.every((x) => x.background !== "coleccion"));
  assert.deepEqual(v.map((x) => x.index), [1, 2, 3, 4]);
  assert.equal(new Set(v.map((x) => x.seed)).size, 4);
  assert.ok(v.every((x) => x.seed !== base.seed));
});
test("fondo bloqueado y estilos libres: cambian estilos", () => {
  const v = planMore(base, 2, { style: false, background: true, shots: false }, { styles: ["look:a", "look:b", "look:c"], backgrounds: ["x"] }, 3);
  assert.ok(v.every((x) => x.background === "coleccion"));
  assert.ok(v.every((x) => x.style !== "look:a"));
});
test("solo planos libres: misma combinación, semillas distintas", () => {
  const v = planMore(base, 3, { style: true, background: true, shots: false }, { styles: ["look:a"], backgrounds: ["coleccion"] }, 4);
  assert.equal(v.length, 3); assert.equal(new Set(v.map((x) => x.seed)).size, 3);
});
const mk = (): Shot[] => [0, 1, 2].map((i) => ({ item: items[i], start: i * 2, dur: 2, entry: 1 + i }));
test("restoreShots reconstruye por identidad de clip y rechaza si cambió el tramo", () => {
  const saved = mk().map((s, i) => ({ start: s.start, dur: s.dur, entry: s.entry, src: srcs[i] }));
  const r = restoreShots(saved, items, srcs, 6)!;
  assert.deepEqual(r.map((s) => items.indexOf(s.item)), [0, 1, 2]);
  assert.equal(restoreShots(saved, items, srcs, 9), null);
  assert.equal(restoreShots(saved, items, srcs.map((x, i) => (i === 1 ? "borrado" : x)), 6), null, "clip borrado de la colección");
  assert.equal(restoreShots(saved.map((s) => ({ ...s, src: null })), items, srcs, 6), null);
  assert.equal(restoreShots(saved, items, srcs.map(() => "z"), 6), null);
});
test("swapShots cambia solo los planos pedidos, con otro clip distinto de vecinos", () => {
  const base3 = mk(); const { shots, changed } = swapShots(base3, [0], items, 77);
  assert.deepEqual(changed, [0]);
  assert.notEqual(shots[0].item, base3[0].item); assert.notEqual(shots[0].item, base3[1].item);
  assert.equal(shots[1].item, base3[1].item); assert.equal(shots[2].item, base3[2].item);
  assert.equal(shots[0].start, 0); assert.equal(shots[0].dur, 2);
  assert.equal(base3[0].item, items[0], "no muta la entrada");
});
test("swapShots con un solo clip de foto no inventa cambios", () => {
  const ph: ShotItem[] = [{ path: "/p.jpg", kind: "photo" }];
  const r = swapShots([{ item: ph[0], start: 0, dur: 3, entry: 0 }], [0], ph, 1);
  assert.deepEqual(r.changed, []);
});
test("swapShots es reproducible y distinto con otra semilla", () => {
  const a = swapShots(mk(), [1], items, 5), b = swapShots(mk(), [1], items, 5);
  assert.equal(a.shots[1].item, b.shots[1].item); assert.equal(a.shots[1].entry, b.shots[1].entry);
});

// e2e real: el vídeo con un plano cambiado solo difiere en ese plano; la versión «planos fijos» es idéntica en color por plano.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOKS, resolveLook, lookFfmpegArgs, assignShots } from "./looks.ts";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("e2e real: cambiar un plano deja el resto idéntico", { skip: !hasFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), "more-"));
  try {
    const sh = (a: string[]) => { const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...a], { maxBuffer: 1 << 28 }); assert.equal(r.status, 0, r.stderr?.toString()); };
    const cols = ["0xff0000", "0x00ff00", "0x0000ff", "0xffff00"];
    cols.forEach((c, i) => sh(["-f", "lavfi", "-i", `color=c=${c}:s=320x180:r=30:d=12`, "-pix_fmt", "yuv420p", join(dir, `c${i}.mp4`)]));
    sh(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "12", join(dir, "a.m4a")]);
    const its: ShotItem[] = cols.map((_, i) => ({ path: join(dir, `c${i}.mp4`), kind: "video", duration: 12 }));
    const cuts = [0, 3, 6, 9];
    const base = assignShots(its, cuts, 12, 21);
    const { shots: swapped, changed } = swapShots(base, [1], its, 4242);
    assert.deepEqual(changed, [1]);
    const look = resolveLook("diario", { treatment: { desaturate: 0 }, image: { aspect: 16 / 9 } as never });
    const ass = join(dir, "e.ass"); writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: W,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n");
    const render = (shots: Shot[], name: string) => {
      const r = spawnSync("ffmpeg", lookFfmpegArgs({ look, W: 360, H: 640, len: 12, shots, color: "#000000", seed: 1, audio: join(dir, "a.m4a"), ass, out: join(dir, name), escape: (p) => p }));
      assert.equal(r.status, 0, r.stderr?.toString());
      const raw = spawnSync("ffmpeg", ["-v", "error", "-i", join(dir, name), "-vf", "crop=2:2:178:280,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 }).stdout as Buffer;
      return [1.5, 4.5, 7.5, 10.5].map((t) => { const k = Math.round(t * 30) * 12; return [raw[k], raw[k + 1], raw[k + 2]].map((v) => (v > 128 ? 1 : 0)).join(""); });
    };
    const a = render(base, "a.mp4"), b = render(swapped, "b.mp4");
    assert.notEqual(a[1], b[1], "el plano 2 debe cambiar de color");
    for (const i of [0, 2, 3]) assert.equal(a[i], b[i], `el plano ${i + 1} debe quedar igual`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
