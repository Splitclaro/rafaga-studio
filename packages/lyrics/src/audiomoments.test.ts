import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { audioMoments, audioMomentsFromPcm } from "./audiomoments.ts";

const HOP = 0.5;
// 0-40 s tranquilo (0,08), 40-75 s alto (1,0), 75-110 s tranquilo, 110-140 s alto
const env = Array.from({ length: 280 }, (_, i) => { const t = i * HOP; return (t >= 40 && t < 75) || t >= 110 ? 1 : 0.08; });
test("encuentra la subida tras la pausa e incluye la preparación", () => {
  const m = audioMoments(env, { minSec: 15, maxSec: 40, count: 3, prepSec: 8 });
  assert.ok(m.length >= 2);
  const first = m.find((x) => Math.abs(x.start - 32) < 2.5)!; assert.ok(first, `momentos: ${JSON.stringify(m.map((x) => [x.start, x.end]))}`);
  assert.equal(first.kind, "drop"); assert.match(first.why[0], /sube ×/); assert.match(first.why[1], /preparación/);
  assert.ok(first.end - first.start >= 15 && first.end - first.start <= 40);
  assert.ok(m.find((x) => Math.abs(x.start - 102) < 2.5), "segunda subida a los 110 s");
});
test("no se solapan y respetan la duración", () => {
  const m = audioMoments(env, { count: 5 });
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) assert.ok(m[i].end <= m[j].start || m[j].end <= m[i].start);
  for (const x of m) assert.ok(x.end - x.start <= 40.01);
});
test("audio plano o muy corto: sin momentos inventados", () => {
  assert.deepEqual(audioMoments(new Array(300).fill(0.5), { count: 3 }).filter((x) => x.kind === "drop"), []);
  assert.deepEqual(audioMoments([0.5, 0.5], {}), []);
});
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("e2e real: audio sintético (pasaje tranquilo → entrada de bombo con bajo) → el momento incluye la entrada", { skip: !hasFfmpeg }, () => {
  // 0-30 s: tono suave; 30-60 s: bombo fuerte a 120 BPM + bajo
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=330:sample_rate=22050:d=30", "-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(90-50*mod(t,0.5)/0.5)*mod(t,0.5))*exp(-mod(t,0.5)*12)+0.3*sin(2*PI*55*t)':s=22050:d=30", "-filter_complex", "[0:a]volume=0.08[a];[a][1:a]concat=n=2:v=0:a=1", "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr?.toString());
  const b = r.stdout as Buffer; const pcm = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  const m = audioMomentsFromPcm(pcm, 22050, { minSec: 15, maxSec: 35, count: 2, prepSec: 8 });
  assert.ok(m.length >= 1 && m[0].kind === "drop", JSON.stringify(m));
  assert.ok(m[0].start >= 18 && m[0].start <= 26 && m[0].end > 30 && m[0].end <= 60, `momento ${m[0].start}-${m[0].end}`);
});
