"use client";
import { useMemo } from "react";
import { interpretBrief } from "@rafaga/selection/intent";

const KIND: Record<string, string> = { tips: "consejos", stories: "historias", reactions: "reacciones", demo: "demostraciones", opinion: "opiniones", qa: "preguntas y respuestas" };

/** «Lo que he entendido»: el encargo en lenguaje natural convertido en parámetros verificables (obligatorio vs preferencia). Puro, en el navegador. */
export default function BriefUnderstanding({ text, compact = false }: { text: string; compact?: boolean }) {
  const it = useMemo(() => interpretBrief(text), [text]);
  const words = useMemo(() => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean), [text]);
  const plain = (stem: string) => words.find((w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").startsWith(stem)) ?? stem;
  const show = (stems: string[]) => [...new Set(stems.map(plain).map((w) => w.toLowerCase()))].filter((w) => w.length > 3);
  if (text.trim().length < 12) return null;
  const rows: { k: string; chips: { t: string; hard?: boolean }[]; note?: string }[] = [
    { k: "Cantidad", chips: [{ t: it.count ? `${it.count} cortes` : "los que haya" }], note: it.count ? undefined : "se entregan los momentos que cumplan el encargo" },
    { k: "Duración", chips: [{ t: it.minSec || it.maxSec ? `${it.minSec ?? "—"} – ${it.maxSec ?? "—"} s` : "la del formato" }] },
    ...(it.audience ? [{ k: "Público", chips: [{ t: it.audience }], note: "cada corte debe entenderse solo" }] : []),
    ...(it.kinds.length ? [{ k: "Tipo", chips: it.kinds.map((x) => ({ t: KIND[x] ?? x })) }] : []),
    ...(show(it.focus).length ? [{ k: "Prioriza", chips: show(it.focus).slice(0, 6).map((t) => ({ t })), note: "preferencia" }] : []),
    ...(show(it.must).length ? [{ k: "Debe incluir", chips: show(it.must).map((t) => ({ t, hard: true })), note: "obligatorio" }] : []),
    ...(show(it.exclude).length ? [{ k: "Excluye", chips: show(it.exclude).map((t) => ({ t, hard: true })), note: "obligatorio: nunca aparece" }] : []),
    ...(show(it.soft.map((x) => x.term)).length ? [{ k: "Rebaja", chips: show(it.soft.map((x) => x.term)).map((t) => ({ t })), note: "preferencia suave" }] : []),
    { k: "Final", chips: [{ t: it.wantsPayoff ? "dejar oír el remate" : "cierre natural" }] },
  ];
  return (
    <div className={compact ? "mt-3" : "mt-4"}>
      <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium">Lo que he entendido</span><span className="text-xs text-[var(--muted)]">Director IA · corrige el texto si algo no cuadra</span></div>
      {it.clarify && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{it.clarify}</p>}
      <dl className={`mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)] ${compact ? "text-[13px]" : "text-sm"}`}>
        {rows.map((r) => (
          <div key={r.k} className={`grid grid-cols-[100px_minmax(0,1fr)] gap-3 ${compact ? "py-1.5" : "py-2.5"}`}>
            <dt className="text-[var(--muted)]">{r.k}</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {r.chips.map((c, i) => <span key={i} className={`rounded-full px-2.5 py-0.5 text-[12.5px] ${c.hard ? "bg-[var(--ink)] font-medium text-white" : "border border-[var(--border)]"}`}>{c.t}</span>)}
              {r.note && <span className="text-xs text-[var(--muted)]">{r.note}</span>}
            </dd>
          </div>))}
      </dl>
    </div>
  );
}
