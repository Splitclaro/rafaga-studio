import test from "node:test";
import assert from "node:assert/strict";
import { speakerStats, speakerRuns, defaultSpeakerX, planSpeakerReframe, sanitizeCam, buildComposition } from "./index.ts";
import type { Word } from "./subtitles.ts";

const W = (text: string, start: number, end: number, speaker?: number): Word => ({ text, start, end, ...(speaker === undefined ? {} : { speaker }) });
const talk: Word[] = [W("hola", 0, 1, 0), W("qué", 1.1, 2, 0), W("tal", 2.1, 3, 0), W("bien", 3.6, 4.6, 1), W("gracias", 4.7, 6, 1), W("y", 6.1, 6.3, 0), W("tú", 6.4, 7.5, 1), W("pues", 7.6, 9, 1)];

test("estadísticas por hablante", () => {
  const s = speakerStats(talk);
  assert.deepEqual(s.map((x) => x.speaker), [0, 1]);
  assert.ok(Math.abs(s.reduce((t, x) => t + x.share, 0) - 1) < 1e-9);
  assert.deepEqual(speakerStats([W("a", 0, 1)]), []);
});
test("tramos: una interjección breve no cambia de plano", () => {
  const r = speakerRuns(talk);
  assert.deepEqual(r.map((x) => x.speaker), [0, 1]);       // «y» (0,2 s) se funde con el tramo anterior
  assert.equal(r[1].end, 9);
});
test("trayectoria: cambia en la pausa, mantiene el plano y es monótona", () => {
  const x = defaultSpeakerX([0, 1]);
  assert.deepEqual(x, { 0: 0.2, 1: 0.8 });
  const kf = planSpeakerReframe(talk, x, 10);
  assert.deepEqual([kf[0].t, kf[0].x], [0, 0.2]);
  for (let i = 1; i < kf.length; i++) assert.ok(kf[i].t > kf[i - 1].t, "tiempos crecientes");
  const move = kf.filter((k, i) => i && k.x !== kf[i - 1].x);
  assert.equal(move.length, 1); assert.ok(move[0].t > 3 && move[0].t < 3.8);   // en la pausa 3,0–3,6
  assert.equal(kf[kf.length - 1].t, 10);
});
test("sin diarización no hay trayectoria", () => { assert.deepEqual(planSpeakerReframe([W("a", 0, 1)], { 0: 0.5 }, 5), []); });
test("la composición conserva el hablante de cada palabra", () => {
  const c = buildComposition({ words: talk, startSec: 0, endSec: 10 });
  assert.equal(c.words[3].speaker, 1);
});
test("región de cámara siempre válida", () => {
  assert.deepEqual(sanitizeCam(undefined), { w: 0.3, h: 0.3, x: 0.7, y: 0.7 });
  const c = sanitizeCam({ x: 0.95, y: -1, w: 0.4, h: 5 });
  assert.ok(c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001 && c.x >= 0 && c.y >= 0);
});
