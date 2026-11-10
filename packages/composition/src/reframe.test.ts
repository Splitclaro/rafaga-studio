import { test } from "node:test";
import assert from "node:assert/strict";
import { planReframe, xAt, cropXExpr, visibleFraction, focusOf, type FaceSample, type FaceBox } from "./reframe.ts";

const SRC = 16 / 9, TGT = 9 / 16, WF = visibleFraction(SRC, TGT);   // ≈ 0.316 del ancho
const face = (cx: number, size = 0.1): FaceBox => ({ cx, cy: 0.4, w: size * 0.56, h: size, s: 10 });
const series = (n: number, dt: number, f: (t: number) => FaceBox[]): FaceSample[] => Array.from({ length: n }, (_, i) => ({ t: i * dt, faces: f(i * dt) }));
const ev = (expr: string, t: number) => new Function("iff", "lt", "t", `return ${expr.replace(/\bif\(/g, "iff(")}`)((c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a < b ? 1 : 0), t) as number;
// ventana visible (izquierda..derecha) para un crop.x
const win = (x: number) => { const L = x * (1 - WF); return [L, L + WF]; };

test("fracción visible 16:9 → 9:16", () => assert.ok(Math.abs(WF - 0.3164) < 0.001));
test("cara fija: encuadre constante y la cara dentro de la ventana", () => {
  const p = planReframe(series(30, 1 / 3, () => [face(0.7)]), { srcAspect: SRC, targetAspect: TGT, len: 10 });
  assert.equal(p.mode, "follow"); assert.ok(p.kf.length <= 3);
  const [l, r] = win(xAt(p.kf, 5)); assert.ok(0.7 > l && 0.7 < r);
  assert.equal(p.coverage, 1);
});
test("cara que se desplaza: la ventana la sigue y no la pierde tras asentarse", () => {
  const p = planReframe(series(60, 1 / 3, (t) => [face(0.25 + (0.5 * t) / 20)]), { srcAspect: SRC, targetAspect: TGT, len: 20 });
  let lost = 0; for (let t = 0; t <= 20; t += 0.25) { const c = 0.25 + (0.5 * t) / 20, [l, r] = win(xAt(p.kf, t)); if (c < l || c > r) lost++; }
  assert.equal(lost, 0, `fuera de cuadro en ${lost} instantes`);
  assert.ok(p.kf.length < 40);
});
test("la velocidad de paneo está limitada (sin tirones)", () => {
  const p = planReframe(series(40, 0.25, (t) => [face(t < 5 ? 0.3 : 0.45)]), { srcAspect: SRC, targetAspect: TGT, len: 10, maxPanPerSec: 0.6 });
  let worst = 0; for (let t = 0.1; t < 10; t += 0.1) worst = Math.max(worst, Math.abs(xAt(p.kf, t) - xAt(p.kf, t - 0.1)) * (1 - WF) / 0.1);
  assert.ok(worst <= 0.6 * WF * 1.15, `velocidad ${worst.toFixed(3)} > ${(0.6 * WF).toFixed(3)}`);
});
test("corte a otra persona (salto sostenido): salta en vez de recorrer todo el plano", () => {
  const p = planReframe(series(48, 0.25, (t) => [face(t < 6 ? 0.2 : 0.85)]), { srcAspect: SRC, targetAspect: TGT, len: 12 });
  const [l, r] = win(xAt(p.kf, 7)); assert.ok(0.85 > l && 0.85 < r, "ya sigue a la segunda persona 1 s después del corte");
});
test("falso positivo aislado no mueve el encuadre", () => {
  const p = planReframe(series(40, 0.25, (t) => (Math.abs(t - 5) < 0.01 ? [face(0.95)] : [face(0.5)])), { srcAspect: SRC, targetAspect: TGT, len: 10 });
  for (let t = 0; t <= 10; t += 0.25) { const [l, r] = win(xAt(p.kf, t)); assert.ok(0.5 > l && 0.5 < r); }
});
test("varias caras: sigue a la principal y no oscila por tamaños parecidos", () => {
  const p = planReframe(series(40, 0.25, (t) => [face(0.3, 0.12 + 0.005 * Math.sin(t * 5)), face(0.75, 0.115 - 0.005 * Math.sin(t * 5))]), { srcAspect: SRC, targetAspect: TGT, len: 10 });
  const xs = [0, 2, 4, 6, 8, 10].map((t) => xAt(p.kf, t)); assert.ok(Math.max(...xs) - Math.min(...xs) < 0.05, `oscila: ${xs}`);
});
test("modo grupo centra a dos personas cercanas", () => {
  const p = planReframe(series(20, 0.25, () => [face(0.45), face(0.55)]), { srcAspect: SRC, targetAspect: TGT, len: 5, mode: "group" });
  const [l, r] = win(xAt(p.kf, 2)); assert.ok(0.45 > l && 0.55 < r);
});
test("sin caras o poca cobertura: encuadre fijo y se explica", () => {
  const p = planReframe(series(30, 1 / 3, () => []), { srcAspect: SRC, targetAspect: TGT, len: 10, fallbackX: 0.4 });
  assert.equal(p.mode, "static"); assert.deepEqual(p.kf, [{ t: 0, x: 0.4 }]); assert.match(p.note!, /caras|muestras/i);
  const few = planReframe(series(30, 1 / 3, (t) => (t < 1 ? [face(0.5)] : [])), { srcAspect: SRC, targetAspect: TGT, len: 10 });
  assert.equal(few.mode, "static");
});
test("vídeo que ya cabe (vertical a vertical): no hay recorte", () => {
  const p = planReframe(series(10, 0.3, () => [face(0.5)]), { srcAspect: 9 / 16, targetAspect: 9 / 16, len: 3 });
  assert.equal(p.mode, "static"); assert.match(p.note!, /cabe/);
});
test("cropXExpr coincide con xAt en toda la trayectoria", () => {
  const kf = [{ t: 0, x: 0.2 }, { t: 2, x: 0.2 }, { t: 4.5, x: 0.7 }, { t: 6, x: 0.55 }, { t: 9, x: 0.55 }];
  for (const t of [0, 1, 2, 3, 4.5, 5, 6, 7.5, 9, 12]) assert.ok(Math.abs(ev(cropXExpr(kf), t) - xAt(kf, t)) < 1e-3, `t=${t}`);
  assert.equal(cropXExpr([{ t: 0, x: 0.3 }]), "0.3");
});
test("focusOf: sin caras null; estabilidad con prev", () => {
  assert.equal(focusOf([], WF, "follow", null), null);
  assert.equal(focusOf([face(0.3, 0.1), face(0.7, 0.105)], WF, "follow", 0.3), 0.3);
});
