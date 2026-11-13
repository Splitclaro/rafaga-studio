import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveProjectState, type StageRowP } from "./progress.ts";

const stages: StageRowP[] = [
  { stage: "prepare", seq: 1, status: "done" }, { stage: "transcribe", seq: 2, status: "running" }, { stage: "scenes", seq: 2, status: "queued" },
  { stage: "select", seq: 5, status: "queued" },
];
const shuffle = <T,>(a: T[], k: number) => a.map((x, i) => [x, (i * 7 + k * 13) % 11] as const).sort((p, q) => p[1] - q[1]).map((p) => p[0]);

test("criterio 2: mismo estado con las filas en cualquier orden; parcial con clip disponible y etapas en curso", () => {
  const clips = [{ id: "c1", technical_state: "disponible", created_at: "2026-11-13T10:00:00Z" }, { id: "c2", technical_state: "preparando", created_at: "2026-11-13T09:00:00Z" }];
  const base = deriveProjectState({ job: { id: "j", status: "running" }, stages, clips });
  for (let k = 0; k < 6; k++) assert.deepEqual(deriveProjectState({ job: { id: "j", status: "running" }, stages: shuffle(stages, k), clips: shuffle(clips, k) }), base);
  assert.equal(base.phase, "running"); assert.equal(base.currentStage, "transcribe"); assert.equal(base.partial, true);
  assert.equal(base.firstClipAt, "2026-11-13T10:00:00Z"); assert.deepEqual(base.progress, { done: 1, total: 4 }); assert.equal(base.queued, null);
});

test("en cola sin ninguna etapa corriendo → queued con motivo", () => {
  const s = deriveProjectState({ job: { id: "j", status: "queued" }, stages: [{ stage: "validate", seq: 1, status: "queued" }, { stage: "mezzanine", seq: 2, status: "queued" }], clips: [] });
  assert.equal(s.phase, "queued"); assert.deepEqual(s.queued, { reason: "esperando_procesador" }); assert.equal(s.partial, false); assert.equal(s.currentStage, "validate");
});

test("terminado, fallido y cancelado", () => {
  assert.equal(deriveProjectState({ job: { id: "j", status: "done" }, stages: [{ stage: "validate", seq: 1, status: "done" }, { stage: "proxy", seq: 2, status: "skipped" }], clips: [] }).phase, "done");
  const f = deriveProjectState({ job: { id: "j", status: "failed", error_code: "job_stalled" }, stages: [{ stage: "transcribe", seq: 1, status: "failed", error_code: "transcription_failed" }], clips: [] });
  assert.equal(f.phase, "failed"); assert.deepEqual(f.failed, { stage: "transcribe", error_code: "transcription_failed" });
  assert.equal(deriveProjectState({ job: { id: "j", status: "cancelled" }, stages: [], clips: [] }).phase, "cancelled");
  assert.equal(deriveProjectState({ job: null, stages: [], clips: [] }).phase, "idle");
});
