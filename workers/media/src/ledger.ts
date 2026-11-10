// Registro de consumo de IA y comprobación de cuota (servicio): cada trabajo anota sus líneas de coste; las cuotas se evalúan con código, no con IA.
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkQuota, mergeLimits, DEFAULT_GLOBAL, type Line, type Limits, type Usage, type Request } from "@rafaga/providers";

export async function recordUsage(sb: SupabaseClient, o: { ws: string; projectId?: string | null; jobId?: string | null; lines: Line[]; paid?: boolean }) {
  if (!o.lines.length) return;
  const rows = o.lines.map((l) => ({ workspace_id: o.ws, project_id: o.projectId ?? null, job_id: o.jobId ?? null, kind: l.kind, provider: l.provider, model: l.model, units: l.units, cost_usd: l.costUsd, billed_usd: o.paid ? l.costUsd : 0, measured: l.measured, note: l.note ?? null }));
  const { error } = await sb.from("ai_usage").insert(rows);
  if (error) console.error("ledger:", error.message);   // contabilizar nunca debe tumbar un trabajo que ya ha salido bien
}
export async function loadLimits(sb: SupabaseClient, ws: string): Promise<Limits> {
  const { data } = await sb.from("workspace_ai_limits").select("limits").eq("workspace_id", ws).maybeSingle();
  return mergeLimits(data?.limits);
}
export async function loadUsage(sb: SupabaseClient, ws: string): Promise<Usage> {
  const now = Date.now(), wk = new Date(now - 7 * 864e5).toISOString(), day = new Date(now - 864e5).toISOString(), month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [w, g, m] = await Promise.all([
    sb.from("ai_usage").select("units").eq("workspace_id", ws).eq("kind", "stt").gte("created_at", wk),
    sb.from("ai_usage").select("units").eq("kind", "stt").gte("created_at", day),
    sb.from("ai_usage").select("cost_usd,billed_usd").eq("workspace_id", ws).gte("created_at", month),
  ]);
  const sec = (rows: { units: { seconds?: number } }[] | null) => (rows ?? []).reduce((s, r) => s + (r.units?.seconds ?? 0), 0) / 60;
  return { weekSourceMinutes: sec(w.data as never), dayGlobalSttMinutes: sec(g.data as never), monthCostUsd: (m.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0), monthBilledUsd: (m.data ?? []).reduce((s, r) => s + Number(r.billed_usd), 0), activeJobs: 0 };
}
/** Lanza un error permanente y claro si la petición no cabe en la cuota; devuelve un aviso si se acerca al límite. */
export async function enforceQuota(sb: SupabaseClient, ws: string, req: Request): Promise<string | null> {
  const [lim, use] = await Promise.all([loadLimits(sb, ws), loadUsage(sb, ws)]);
  const q = checkQuota(lim, use, req, { daily_stt_minutes: Number(process.env.GLOBAL_DAILY_STT_MINUTES) || DEFAULT_GLOBAL.daily_stt_minutes });
  if (!q.ok) throw Object.assign(new Error(q.reason), { permanent: true, code: `quota_${q.code}` });
  return q.warn;
}
