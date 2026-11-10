"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Limits = { weekly_source_minutes: number; batch_clips: number; active_jobs: number; live_minutes: number; monthly_budget_usd: number; warn_at: number; extra_variants_week: number; extra_languages_week: number };
type Summary = { week_source_minutes: number; limits: Limits; can_edit_limits: boolean; month_cost_usd?: number; month_billed_usd?: number; month_measured_usd?: number; month_by_kind?: Record<string, number> };
const LABELS: [keyof Limits, string, string][] = [["weekly_source_minutes", "Minutos de fuente por semana", "min"], ["batch_clips", "Clips por lote", ""], ["live_minutes", "Minutos por directo", "min"], ["monthly_budget_usd", "Presupuesto mensual de pago", "USD"], ["extra_variants_week", "Variantes extra por semana", ""], ["extra_languages_week", "Idiomas adicionales por semana", ""]];
const KIND: Record<string, string> = { stt: "Transcripción", llm: "IA editorial", vision: "Visión", render: "Render", storage: "Almacenamiento", transfer: "Descargas" };

/** Consumo de la semana frente a los límites; los responsables ven además el coste (a tarifa de pago, también en nivel gratuito) y pueden ajustar límites. */
export default function AiUsage() {
  const [s, setS] = useState<Summary | null>(null), [draft, setDraft] = useState<Partial<Limits>>({}), [msg, setMsg] = useState<string | null>(null);
  const load = async () => { const { data, error } = await supabase.rpc("ai_usage_summary"); if (error) return setMsg(error.message); setS(data as Summary); setDraft({}); };
  useEffect(() => { load(); }, []);
  async function save() {
    setMsg(null);
    const { error } = await supabase.rpc("set_ai_limits", { p: draft });
    if (error) return setMsg(error.message.includes("out_of_range") ? "Ese valor supera el tope permitido." : error.message.includes("invalid") ? "Valor no válido." : error.message);
    setMsg("Límites guardados."); load();
  }
  if (!s) return <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm"><div className="skeleton h-24" /></section>;
  const used = s.week_source_minutes, lim = s.limits.weekly_source_minutes, pct = Math.min(100, (used / lim) * 100);
  return (
    <section aria-label="Consumo y límites" className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
      <h2 className="font-medium">Consumo de esta semana</h2>
      <div className="mt-2 flex items-center gap-3"><span className="tnum">{used.toFixed(0)} de {lim} min de fuente</span><div className="h-1.5 max-w-xs flex-1 rounded-full bg-[var(--hover)]"><div className={`h-full rounded-full ${pct >= s.limits.warn_at * 100 ? "bg-[#111]" : "bg-[#777]"}`} style={{ width: `${pct}%` }} /></div></div>
      {pct >= s.limits.warn_at * 100 && <p role="status" className="mt-1 text-xs text-[var(--muted)]">Te acercas al límite semanal. Lo ya transcrito se reutiliza y no vuelve a contar.</p>}
      {s.can_edit_limits && typeof s.month_cost_usd === "number" && (
        <div className="mt-4 border-t border-[var(--border)] pt-3"><h3 className="font-medium">Coste del mes</h3>
          <p className="tnum mt-1">{s.month_cost_usd.toFixed(2)} USD a tarifa de pago · {(s.month_billed_usd ?? 0).toFixed(2)} USD cobrados realmente <span className="text-[var(--muted)]">(en el nivel gratuito no se cobra nada)</span></p>
          <p className="text-xs text-[var(--muted)]">Medido: {(s.month_measured_usd ?? 0).toFixed(2)} USD · estimado: {(s.month_cost_usd - (s.month_measured_usd ?? 0)).toFixed(2)} USD. {Object.entries(s.month_by_kind ?? {}).map(([k, v]) => `${KIND[k] ?? k} ${Number(v).toFixed(2)}`).join(" · ")}</p>
          <h3 className="mt-4 font-medium">Límites del espacio</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{LABELS.map(([k, l, u]) => (
            <label key={k} className="block"><span className="text-xs">{l}{u ? ` (${u})` : ""}</span><input type="number" min={0} value={draft[k] ?? s.limits[k]} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} className="input tnum mt-1" /></label>))}</div>
          <div className="mt-3 flex items-center gap-3"><button onClick={save} disabled={!Object.keys(draft).length} className="btn btn-primary !py-1.5 !text-xs disabled:opacity-40">Guardar límites</button>{msg && <span role="status" className="text-xs text-[var(--muted)]">{msg}</span>}</div>
        </div>)}
    </section>
  );
}
