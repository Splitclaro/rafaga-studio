import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBeats, beatsReliable } from "./beats.ts";

const SR = 22050;
function rng(seed: number) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
/** Pista sintética: bombo (seno que cae) en cada pulso + hi-hat en corcheas + ruido de fondo. */
function track(bpm: number, secs: number, opt: { offset?: number; swing?: boolean; noise?: number } = {}) {
  const x = new Float32Array(Math.floor(SR * secs)), r = rng(7), period = 60 / bpm, truth: number[] = [];
  for (let t = opt.offset ?? 0.3; t < secs - 0.2; t += period) {
    truth.push(t); const s = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.12; i++) { const k = s + i; if (k < x.length) x[k] += Math.sin(2 * Math.PI * (110 - 60 * i / (SR * 0.12)) * (i / SR)) * Math.exp(-i / (SR * 0.04)) * 0.9; }
    const h = Math.floor((t + period / 2) * SR);
    for (let i = 0; i < SR * 0.03; i++) { const k = h + i; if (k < x.length) x[k] += (r() - 0.5) * Math.exp(-i / (SR * 0.01)) * 0.35; }
  }
  for (let i = 0; i < x.length; i++) x[i] += (r() - 0.5) * (opt.noise ?? 0.02);
  return { x, truth };
}
const nearest = (b: number, truth: number[]) => Math.min(...truth.map((t) => Math.abs(t - b)));

for (const bpm of [96, 120, 140]) {
  test(`detecta ${bpm} BPM y coloca los beats sobre los golpes (±70 ms)`, () => {
    const { x, truth } = track(bpm, 32);
    const r = detectBeats(x, SR);
    // A tempos altos puede devolver el pulso a la mitad (ambigüedad musical legítima: sus beats siguen cayendo sobre golpes reales)
    assert.ok(Math.abs(r.bpm - bpm) <= 2.5 || (bpm >= 130 && Math.abs(r.bpm - bpm / 2) <= 2.5), `bpm ${r.bpm}`); assert.ok(beatsReliable(r), `confianza ${r.confidence}`);
    const errs = r.beats.slice(2, -2).map((b) => nearest(b, truth));
    const ok = errs.filter((e) => e < 0.07).length / errs.length;
    assert.ok(ok > 0.9, `solo ${(ok * 100).toFixed(0)} % de beats alineados`);
  });
}
test("ruido sin pulso: confianza baja (no se presenta como «al ritmo»)", () => {
  const r2 = rng(3), x = Float32Array.from({ length: SR * 30 }, () => (r2() - 0.5) * 0.5);
  const r = detectBeats(x, SR); assert.ok(!beatsReliable(r), `confianza ${r.confidence}, bpm ${r.bpm}`);
});
test("silencio y audio muy corto no rompen", () => {
  assert.equal(detectBeats(new Float32Array(SR * 30), SR).bpm, 0);
  assert.equal(detectBeats(new Float32Array(SR), SR).beats.length, 0);
});
test("es determinista", () => { const { x } = track(100, 20); assert.deepEqual(detectBeats(x, SR), detectBeats(x, SR)); });
