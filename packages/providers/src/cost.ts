// Coste por trabajo y cuotas. Las tarifas son CONFIGURABLES y están marcadas con la fecha en que se anotaron: hay que verificarlas en la cuenta antes de fiarse.
// Se registra el coste a tarifa de pago incluso mientras se use el nivel gratuito (billed = 0), para saber cuánto costaría.
export type UsageKind = "stt" | "llm" | "vision" | "render" | "storage" | "transfer";
export interface Tariffs {
  asOf: string;
  stt: Record<string, number>;                        // USD por hora de audio
  llm: Record<string, { in: number; out: number }>;   // USD por millón de tokens
  vision: Record<string, { in: number; out: number; perImage?: number }>;
  renderPerMin: number;                               // USD por minuto de worker (estimación)
  storagePerGbMonth: number; transferPerGb: number;
}
export const DEFAULT_TARIFFS: Tariffs = {
  asOf: "2026-11-10 (anotadas de memoria de las páginas públicas; PENDIENTE de verificar en la cuenta)",
  stt: { "whisper-large-v3-turbo": 0.04, "whisper-large-v3": 0.111, "nova-3": 0.258 },
  llm: { "llama-3.3-70b-versatile": { in: 0.59, out: 0.79 }, "claude-sonnet-5-5": { in: 3, out: 15 } },
  vision: { "meta-llama/llama-4-scout-17b-16e-instruct": { in: 0.11, out: 0.34 } },
  renderPerMin: 0.008, storagePerGbMonth: 0.021, transferPerGb: 0.09,
};
export function loadTariffs(json: string | undefined): Tariffs {
  if (!json) return DEFAULT_TARIFFS;
  try { const o = JSON.parse(json) as Partial<Tariffs>; return { ...DEFAULT_TARIFFS, ...o, stt: { ...DEFAULT_TARIFFS.stt, ...o.stt }, llm: { ...DEFAULT_TARIFFS.llm, ...o.llm }, vision: { ...DEFAULT_TARIFFS.vision, ...o.vision } }; } catch { return DEFAULT_TARIFFS; }
}
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
export interface Line { kind: UsageKind; provider: string; model: string; units: Record<string, number>; costUsd: number; measured: boolean; note?: string }
export const sttLine = (t: Tariffs, provider: string, model: string, seconds: number, measured = true): Line => ({ kind: "stt", provider, model, units: { seconds: Math.round(seconds) }, costUsd: r6((Math.max(0, seconds) / 3600) * (t.stt[model] ?? 0)), measured, ...(t.stt[model] == null ? { note: "tarifa desconocida" } : {}) });
export const llmLine = (t: Tariffs, provider: string, model: string, tokensIn: number, tokensOut: number, measured = true): Line => { const p = t.llm[model]; return { kind: "llm", provider, model, units: { tokens_in: tokensIn, tokens_out: tokensOut }, costUsd: r6(p ? (tokensIn * p.in + tokensOut * p.out) / 1e6 : 0), measured, ...(p ? {} : { note: "tarifa desconocida" }) }; };
export const visionLine = (t: Tariffs, provider: string, model: string, frames: number, tokensIn: number, tokensOut: number, measured = true): Line => { const p = t.vision[model]; return { kind: "vision", provider, model, units: { frames, tokens_in: tokensIn, tokens_out: tokensOut }, costUsd: r6(p ? (tokensIn * p.in + tokensOut * p.out) / 1e6 + frames * (p.perImage ?? 0) : 0), measured, ...(p ? {} : { note: "tarifa desconocida" }) }; };
export const renderLine = (t: Tariffs, ms: number): Line => ({ kind: "render", provider: "github-actions", model: "ffmpeg", units: { ms: Math.round(ms) }, costUsd: r6((ms / 60000) * t.renderPerMin), measured: false, note: "estimado: tiempo de worker × tarifa por minuto (público = gratis, privado = cuota incluida)" });
export const storageLine = (t: Tariffs, bytes: number, months = 1): Line => ({ kind: "storage", provider: "supabase", model: "storage", units: { bytes }, costUsd: r6((bytes / 1073741824) * t.storagePerGbMonth * months), measured: false, note: "estimado: 1 mes de almacenamiento" });
export const transferLine = (t: Tariffs, bytes: number): Line => ({ kind: "transfer", provider: "supabase", model: "egress", units: { bytes }, costUsd: r6((bytes / 1073741824) * t.transferPerGb), measured: false, note: "estimado: una descarga de cada pieza" });
export function summarize(lines: Line[], opts: { clipsApproved?: number; clips?: number } = {}) {
  const total = r6(lines.reduce((s, l) => s + l.costUsd, 0)), measured = r6(lines.filter((l) => l.measured).reduce((s, l) => s + l.costUsd, 0));
  const byKind = lines.reduce<Record<string, number>>((a, l) => ((a[l.kind] = r6((a[l.kind] ?? 0) + l.costUsd)), a), {});
  return { total, measured, estimated: r6(total - measured), byKind, perClip: opts.clips ? r6(total / opts.clips) : null, perApprovedClip: opts.clipsApproved ? r6(total / opts.clipsApproved) : null };
}

// ───────── cuotas ─────────
export interface Limits { weekly_source_minutes: number; batch_clips: number; active_jobs: number; live_minutes: number; monthly_budget_usd: number; warn_at: number; extra_variants_week: number; extra_languages_week: number }
export const DEFAULT_LIMITS: Limits = { weekly_source_minutes: 120, batch_clips: 10, active_jobs: 1, live_minutes: 60, monthly_budget_usd: 20, warn_at: 0.8, extra_variants_week: 30, extra_languages_week: 6 };
export const HARD_CAPS: Limits = { weekly_source_minutes: 3000, batch_clips: 50, active_jobs: 5, live_minutes: 240, monthly_budget_usd: 5000, warn_at: 1, extra_variants_week: 500, extra_languages_week: 50 };
/** Límite global de la plataforma compatible con la cuota real del proveedor (Groq gratuito: ~7200 s de audio/hora y 28800 s/día para whisper-large-v3-turbo; verificar en la cuenta). */
export const DEFAULT_GLOBAL = { daily_stt_minutes: 400 };
export function mergeLimits(raw: unknown): Limits {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, out = { ...DEFAULT_LIMITS } as Record<string, number>;
  for (const k of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) { const v = Number(o[k]); if (Number.isFinite(v) && v >= 0) out[k] = Math.min(v, HARD_CAPS[k]); }
  return out as unknown as Limits;
}
export interface Usage { weekSourceMinutes: number; dayGlobalSttMinutes: number; monthBilledUsd: number; monthCostUsd: number; activeJobs: number; weekExtraVariants?: number; weekExtraLanguages?: number }
export interface Request { sourceMinutes?: number; clips?: number; paid?: boolean; liveMinutes?: number; extraVariants?: number; extraLanguages?: number }
export type QuotaCode = "ok" | "weekly_minutes" | "batch_clips" | "active_jobs" | "live_minutes" | "global_daily" | "monthly_budget" | "variants" | "languages";
export function checkQuota(l: Limits, u: Usage, r: Request, g = DEFAULT_GLOBAL): { ok: boolean; code: QuotaCode; reason: string; warn: string | null } {
  const bad = (code: QuotaCode, reason: string) => ({ ok: false, code, reason, warn: null });
  if (u.activeJobs >= l.active_jobs) return bad("active_jobs", `Ya hay ${u.activeJobs} trabajo(s) en curso en tu espacio (límite ${l.active_jobs}). Espera a que termine.`);
  if ((r.clips ?? 0) > l.batch_clips) return bad("batch_clips", `Un lote admite hasta ${l.batch_clips} clips y has pedido ${r.clips}.`);
  if (r.liveMinutes != null && r.liveMinutes > l.live_minutes) return bad("live_minutes", `Un directo admite hasta ${l.live_minutes} min por sesión.`);
  const sm = r.sourceMinutes ?? 0;
  if (u.weekSourceMinutes + sm > l.weekly_source_minutes) return bad("weekly_minutes", `Esta fuente (${sm.toFixed(0)} min) superaría tus ${l.weekly_source_minutes} min semanales (llevas ${u.weekSourceMinutes.toFixed(0)}). El progreso y lo ya transcrito se conservan.`);
  if (u.dayGlobalSttMinutes + sm > g.daily_stt_minutes) return bad("global_daily", "La plataforma ha llegado hoy al límite de transcripción de la beta. Vuelve a intentarlo mañana; tu proyecto queda guardado.");
  if ((u.weekExtraVariants ?? 0) + (r.extraVariants ?? 0) > l.extra_variants_week) return bad("variants", `Has alcanzado el límite semanal de variantes (${l.extra_variants_week}).`);
  if ((u.weekExtraLanguages ?? 0) + (r.extraLanguages ?? 0) > l.extra_languages_week) return bad("languages", `Has alcanzado el límite semanal de idiomas adicionales (${l.extra_languages_week}).`);
  if (r.paid && u.monthBilledUsd >= l.monthly_budget_usd) return bad("monthly_budget", `Presupuesto mensual agotado (${l.monthly_budget_usd.toFixed(2)} USD). Ajusta el presupuesto en Configuración para seguir.`);
  const used = (u.weekSourceMinutes + sm) / l.weekly_source_minutes, bud = r.paid ? u.monthBilledUsd / l.monthly_budget_usd : 0;
  const warn = used >= l.warn_at ? `Has usado el ${Math.round(used * 100)} % de tus minutos semanales.` : bud >= l.warn_at ? `Has gastado el ${Math.round(bud * 100)} % del presupuesto mensual.` : null;
  return { ok: true, code: "ok", reason: "", warn };
}
/** Directo: reserva por tramos. Devuelve cuántos minutos se pueden reservar ahora y si hay que avisar. */
export function reserveLiveChunk(l: Limits, u: Usage, chunkMin: number, usedLiveMin: number): { grant: number; warn: string | null; reason: string | null } {
  const left = Math.max(0, Math.min(l.live_minutes - usedLiveMin, l.weekly_source_minutes - u.weekSourceMinutes));
  const grant = Math.min(chunkMin, left);
  const warn = left - grant <= chunkMin && left > 0 ? `Quedan ${(left - grant).toFixed(0)} min de cuota tras este tramo: el directo se detendrá al agotarlos.` : null;
  return { grant, warn, reason: grant <= 0 ? "Cuota agotada: se conservan los clips ya entregados." : null };
}
