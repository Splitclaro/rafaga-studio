"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { STAGE } from "../../../lib/projects";

type J = { status: string; created_at: string; updated_at: string; metrics: Record<string, number> | null };
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

export default function Analitica() {
  const [jobs, setJobs] = useState<J[] | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => { supabase.from("jobs").select("status,created_at,updated_at,metrics").order("created_at", { ascending: false }).limit(200).then(({ data }) => { setJobs((data ?? []) as J[]); setAt(new Date()); }); }, []);
  if (!jobs) return <main className="mx-auto max-w-5xl px-4 py-8 md:px-8 text-[var(--muted)]">Cargando…</main>;
  const by = (s: string) => jobs.filter((j) => j.status === s).length;
  const done = jobs.filter((j) => j.status === "done" && j.metrics);
  const m = (k: string) => avg(done.map((j) => j.metrics?.[k]).filter((v): v is number => typeof v === "number"));
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">Analítica</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Métricas internas de generación de tu workspace (últimos 200 trabajos). Actualizado: {at?.toLocaleString("es")}. Las métricas sociales (vistas, alcance) requieren conexiones autorizadas y aún no están disponibles: no se muestran estimaciones.</p>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Trabajos", jobs.length], [STAGE.done, by("done")], [STAGE.failed, by("failed")], ["En curso", jobs.filter((j) => !["done", "failed", "cancelled"].includes(j.status)).length]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-sm text-[var(--muted)]">{k}</div><div className="tnum text-2xl font-semibold">{v}</div></div>))}
      </section>
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="font-medium">Tiempos medios (trabajos completados)</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {[["Transcripción", m("asr_ms")], ["Selección de momentos", m("selection_ms")], ["Primer clip (desde inicio del trabajo)", m("first_clip_ms")], ["Lote completo", m("all_clips_ms")]].map(([k, v]) => (
            <div key={k as string} className="flex justify-between border-b border-[var(--border)] py-1"><dt>{k}</dt><dd className="tnum">{sec(v as number | null)}</dd></div>))}
        </dl>
        {!done.length && <p className="mt-3 text-sm text-[var(--muted)]">Aún no hay trabajos completados para calcular tiempos.</p>}
      </section>
    </main>
  );
}
