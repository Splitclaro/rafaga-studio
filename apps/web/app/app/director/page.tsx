"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { interpretBrief } from "@rafaga/selection/intent";
import { supabase } from "../../../lib/supabase";

const KIND: Record<string, string> = { tips: "consejos", stories: "historias", reactions: "reacciones", demo: "demostraciones", opinion: "opiniones", qa: "preguntas y respuestas" };
const EXAMPLES = [
  "Consejos prácticos para principiantes, de 30 a 60 segundos.",
  "Historias personales con un giro. Evita su vida privada y excluye el patrocinador.",
  "Quiero cinco cortes para gente que no conoce al artista. Prioriza las historias detrás de sus canciones, evita hablar de su vida privada y deja que se escuche el remate de cada historia.",
];
type Usage = { week_source_minutes: number; limits: { weekly_source_minutes: number; batch_clips: number } };

/** Director IA: el encargo en tus palabras, y lo que Ráfaga ha entendido antes de empezar (obligatorio vs preferencia). */
export default function Director() {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLES[2]);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => { supabase.rpc("ai_usage_summary").then(({ data }) => setUsage(data && typeof data === "object" && "limits" in (data as object) ? (data as Usage) : null)); }, []);
  const it = useMemo(() => interpretBrief(text), [text]);
  // Las raíces internas se muestran como la palabra que escribiste (y se omiten las demasiado cortas)
  const words = useMemo(() => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean), [text]);
  const plain = (stem: string) => words.find((w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").startsWith(stem)) ?? stem;
  const show = (stems: string[]) => [...new Set(stems.map(plain).map((w) => w.toLowerCase()))].filter((w) => w.length > 3);
  const rows: { k: string; chips: { t: string; hard?: boolean }[]; note?: string }[] = [
    { k: "Cantidad", chips: [{ t: it.count ? `${it.count} cortes` : "los que haya" }], note: it.count ? undefined : "se entregan los momentos que cumplan el encargo" },
    { k: "Duración", chips: [{ t: it.minSec || it.maxSec ? `${it.minSec ?? "—"} – ${it.maxSec ?? "—"} s` : "la del formato" }] },
    ...(it.audience ? [{ k: "Público", chips: [{ t: it.audience }], note: "cada corte debe entenderse solo" }] : []),
    ...(it.kinds.length ? [{ k: "Tipo", chips: it.kinds.map((x) => ({ t: KIND[x] ?? x })) }] : []),
    ...(it.focus.length ? [{ k: "Prioriza", chips: show(it.focus).slice(0, 6).map((t) => ({ t })), note: "preferencia" }] : []),
    ...(it.must.length ? [{ k: "Debe incluir", chips: show(it.must).map((t) => ({ t, hard: true })), note: "obligatorio" }] : []),
    ...(it.exclude.length ? [{ k: "Excluye", chips: show(it.exclude).map((t) => ({ t, hard: true })), note: "obligatorio: nunca aparece" }] : []),
    ...(it.soft.length ? [{ k: "Rebaja", chips: show(it.soft.map((x) => x.term)).map((t) => ({ t })), note: "preferencia suave" }] : []),
    { k: "Final", chips: [{ t: it.wantsPayoff ? "dejar oír el remate" : "cierre natural" }] },
  ];
  const left = usage ? Math.max(0, usage.limits.weekly_source_minutes - usage.week_source_minutes) : null;
  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 md:px-8">
      <Link href="/app" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">← Inicio</Link>
      <h1 className="mt-2 text-4xl tracking-tight">Cuéntale al Director qué buscas.</h1>
      <p className="mt-2 max-w-[62ch] text-base text-[var(--muted)]">Escribe como se lo dirías a un editor. Antes de empezar verás lo que ha entendido.</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <label htmlFor="brief" className="text-sm font-medium">¿Qué momentos quieres encontrar?</label>
          <textarea id="brief" value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))} rows={5} className="input mt-2 text-base leading-relaxed" />
          <div className="mt-2 flex flex-wrap gap-2">{EXAMPLES.map((x, i) => <button key={i} type="button" onClick={() => setText(x)} className="chip">{["Consejos", "Historias", "Encargo completo"][i]}</button>)}</div>

          <h2 className="mt-10 text-lg">Lo que he entendido</h2>
          {it.clarify && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{it.clarify}</p>}
          <dl className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {rows.map((r) => (
              <div key={r.k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-[var(--muted)]">{r.k}</dt>
                <dd className="flex flex-wrap items-center gap-1.5">
                  {r.chips.map((c, i) => <span key={i} className={`rounded-full px-2.5 py-0.5 text-[13px] ${c.hard ? "bg-[#0F172A] font-medium text-white" : "border hairline"}`}>{c.t}</span>)}
                  {r.note && <span className="text-xs text-[var(--muted)]">{r.note}</span>}
                </dd>
              </div>))}
          </dl>
          <p className="mt-4 max-w-[62ch] text-sm text-[var(--muted)]">No inventa frases que nadie dijo ni promete viralidad: cada corte lleva su razón y su intervalo para comprobarlo. Si solo encuentra tres momentos buenos de cinco, entrega tres.</p>
        </section>

        <aside className="h-fit lg:sticky lg:top-20">
          <div className="card p-5">
            <h2 className="text-base">Antes de empezar</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--muted)]">Clips por lote</dt><dd className="tnum font-medium">hasta {usage?.limits.batch_clips ?? 10}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--muted)]">Minutos libres esta semana</dt><dd className="tnum font-medium">{left === null ? "—" : `${left.toFixed(0)} de ${usage?.limits.weekly_source_minutes}`}</dd></div>
            </dl>
            {usage && <div className="mt-3 h-1 rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (usage.week_source_minutes / usage.limits.weekly_source_minutes) * 100)}%` }} /></div>}
            <p className="mt-3 text-xs text-[var(--muted)]">Lo ya transcrito se reutiliza: cambiar el encargo no vuelve a contar.</p>
            <button onClick={() => router.push(`/app?brief=${encodeURIComponent(text)}`)} disabled={!text.trim()} className="btn btn-primary mt-4 w-full">Usar este encargo</button>
            <Link href="/app/ajustes" className="mt-3 block text-center text-xs text-[var(--muted)] underline">Consumo y límites</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
