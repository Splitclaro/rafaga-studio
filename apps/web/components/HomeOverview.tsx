"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { STAGE } from "../lib/projects";
import { isActive, type Row } from "./ProjectList";

/** Avance aproximado por etapa del pipeline (no es un porcentaje medido). */
const STEP: Record<string, number> = { queued: 4, validating: 10, extracting: 20, transcribing: 40, selecting: 60, tracking: 70, rendering: 85 };
type Counts = { pending: number; changes: number; approved: number };

/** Panel lateral de Inicio: lo que se está procesando y lo que espera revisión. Datos reales del espacio. */
export default function HomeOverview({ rows }: { rows: Row[] | null }) {
  const [c, setC] = useState<Counts | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clips").select("review_status").eq("discarded", false).limit(2000);
      const l = (data ?? []) as { review_status: string }[];
      setC({ pending: l.filter((x) => x.review_status === "pending").length, changes: l.filter((x) => x.review_status === "changes_requested").length, approved: l.filter((x) => x.review_status === "approved").length });
    })();
  }, []);
  const active = rows?.filter((p) => isActive(p.status)) ?? [];
  const queuedOnly = active.length > 0 && active.every((p) => p.status === "queued");

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="ov-curso" className="card p-4">
        <h2 id="ov-curso" className="text-[17px]">En curso</h2>
        {!rows && <div className="skeleton mt-3 h-12" />}
        {rows && !active.length && <p className="mt-2 text-sm text-[var(--muted)]">Nada procesándose ahora mismo.</p>}
        <ul className="mt-1">
          {active.slice(0, 4).map((p, i) => (
            <li key={p.id} className={`flex flex-col gap-1.5 py-3 ${i ? "border-t hairline" : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm"><Link href={`/app/p/${p.id}`} className="min-w-0 truncate font-semibold hover:underline">{p.name}</Link><span className="shrink-0 text-xs text-[var(--muted)]">{STAGE[p.status!] ?? p.status}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#E8ECF7]" role="progressbar" aria-label={`Etapa: ${STAGE[p.status!] ?? p.status}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={STEP[p.status!] ?? 5}>
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#1D4FFF,#4F7BFF)] transition-[width] duration-700" style={{ width: `${STEP[p.status!] ?? 5}%` }} />
              </div>
            </li>
          ))}
        </ul>
        {queuedOnly && <p className="text-xs text-[var(--muted)]">En cola: el procesador arranca solo en unos minutos.</p>}
      </section>

      <section aria-labelledby="ov-rev" className="card p-4">
        <h2 id="ov-rev" className="text-[17px]">Pendiente de revisar</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {([["Sin revisar", c?.pending], ["Con cambios pedidos", c?.changes], ["Aprobados", c?.approved]] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between"><dt className="text-[var(--muted)]">{k}</dt><dd className="tnum font-semibold">{v ?? "·"}</dd></div>
          ))}
        </dl>
        <Link href="/app/entregas" className="btn btn-ghost mt-4 w-full !border-[var(--accent)] !text-[var(--accent)]">Abrir revisión y entregas</Link>
      </section>
    </div>
  );
}
