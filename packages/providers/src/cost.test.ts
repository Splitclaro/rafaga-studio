import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARIFFS, loadTariffs, sttLine, llmLine, visionLine, renderLine, summarize, mergeLimits, checkQuota, reserveLiveChunk, DEFAULT_LIMITS, HARD_CAPS, type Usage } from "./cost.ts";

const T = DEFAULT_TARIFFS;
test("coste de transcripción por hora de audio y modelo", () => {
  assert.equal(sttLine(T, "groq", "whisper-large-v3-turbo", 3600).costUsd, 0.04);
  assert.equal(sttLine(T, "groq", "whisper-large-v3", 1800).costUsd, 0.0555);
  assert.equal(sttLine(T, "x", "modelo-nuevo", 3600).note, "tarifa desconocida");
});
test("coste LLM, visión y render; lo medido y lo estimado se distinguen", () => {
  const llm = llmLine(T, "groq", "llama-3.3-70b-versatile", 100_000, 5_000);
  assert.equal(llm.costUsd, 0.06295); assert.equal(llm.measured, true);
  assert.ok(visionLine(T, "groq", "meta-llama/llama-4-scout-17b-16e-instruct", 6, 6000, 500).costUsd > 0);
  const r = renderLine(T, 120_000); assert.equal(r.measured, false); assert.equal(r.costUsd, 0.016);
  const s = summarize([sttLine(T, "groq", "whisper-large-v3-turbo", 3600), llm, r], { clips: 10, clipsApproved: 4 });
  assert.equal(s.total, 0.11895); assert.equal(s.measured, 0.10295); assert.equal(s.estimated, 0.016);
  assert.equal(s.perClip, 0.011895); assert.equal(s.perApprovedClip, 0.029738);   // lo que importa: coste por clip APROBADO
});
test("tarifas configurables por entorno sin perder las demás", () => {
  const t = loadTariffs(JSON.stringify({ stt: { "whisper-large-v3-turbo": 0.05 } }));
  assert.equal(t.stt["whisper-large-v3-turbo"], 0.05); assert.equal(t.stt["whisper-large-v3"], 0.111);
  assert.equal(loadTariffs("{no json").renderPerMin, T.renderPerMin);
});
test("límites: valores por defecto de la beta y topes duros", () => {
  assert.deepEqual([DEFAULT_LIMITS.weekly_source_minutes, DEFAULT_LIMITS.batch_clips, DEFAULT_LIMITS.active_jobs, DEFAULT_LIMITS.live_minutes], [120, 10, 1, 60]);
  const l = mergeLimits({ weekly_source_minutes: 999999, batch_clips: -3, live_minutes: "90", basura: 1 });
  assert.equal(l.weekly_source_minutes, HARD_CAPS.weekly_source_minutes); assert.equal(l.batch_clips, 10); assert.equal(l.live_minutes, 90);
});
const U: Usage = { weekSourceMinutes: 30, dayGlobalSttMinutes: 100, monthBilledUsd: 0, monthCostUsd: 1, activeJobs: 0 };
test("comprobación previa: cada límite da su motivo y conserva el progreso", () => {
  const l = DEFAULT_LIMITS;
  assert.equal(checkQuota(l, U, { sourceMinutes: 50, clips: 10 }).ok, true);
  assert.equal(checkQuota(l, U, { sourceMinutes: 100 }).code, "weekly_minutes");
  assert.match(checkQuota(l, U, { sourceMinutes: 100 }).reason, /progreso/);
  assert.equal(checkQuota(l, { ...U, activeJobs: 1 }, {}).code, "active_jobs");
  assert.equal(checkQuota(l, U, { clips: 11 }).code, "batch_clips");
  assert.equal(checkQuota(l, U, { liveMinutes: 90 }).code, "live_minutes");
  assert.equal(checkQuota(l, { ...U, dayGlobalSttMinutes: 390 }, { sourceMinutes: 20 }).code, "global_daily");
  assert.equal(checkQuota(l, { ...U, weekExtraVariants: 30 }, { extraVariants: 1 }).code, "variants");
  assert.equal(checkQuota(l, { ...U, weekExtraLanguages: 6 }, { extraLanguages: 1 }).code, "languages");
});
test("el presupuesto mensual solo bloquea el gasto de pago, y avisa antes de agotarse", () => {
  assert.equal(checkQuota(DEFAULT_LIMITS, { ...U, monthBilledUsd: 25 }, { sourceMinutes: 5 }).ok, true, "en nivel gratuito no se factura");
  assert.equal(checkQuota(DEFAULT_LIMITS, { ...U, monthBilledUsd: 25 }, { sourceMinutes: 5, paid: true }).code, "monthly_budget");
  assert.match(checkQuota(DEFAULT_LIMITS, { ...U, monthBilledUsd: 17 }, { paid: true }).warn ?? "", /presupuesto/);
  assert.match(checkQuota(DEFAULT_LIMITS, { ...U, weekSourceMinutes: 80 }, { sourceMinutes: 20 }).warn ?? "", /minutos semanales/);
});
test("directo: reserva por tramos y aviso antes del límite", () => {
  const a = reserveLiveChunk(DEFAULT_LIMITS, U, 10, 0); assert.equal(a.grant, 10); assert.equal(a.warn, null);
  const b = reserveLiveChunk(DEFAULT_LIMITS, U, 10, 45); assert.equal(b.grant, 10); assert.match(b.warn ?? "", /Quedan 5 min/);
  const c = reserveLiveChunk(DEFAULT_LIMITS, U, 10, 55); assert.equal(c.grant, 5);
  const d = reserveLiveChunk(DEFAULT_LIMITS, U, 10, 60); assert.equal(d.grant, 0); assert.match(d.reason ?? "", /conservan/);
  assert.equal(reserveLiveChunk(DEFAULT_LIMITS, { ...U, weekSourceMinutes: 115 }, 10, 0).grant, 5, "la cuota semanal también acota el directo");
});
