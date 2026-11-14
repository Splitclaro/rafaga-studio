"use client";
// Procesamiento v2: etapas reales (job_stages), estado derivado de la base de datos, «En cola» con motivo y estimación honesta.
// Solo aparece si el proyecto tiene algún trabajo v2; para el resto no renderiza nada (la vista v1 no cambia).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { deriveProjectState, subscribe, type JobRow, type StageRowP, type ClipRowP } from "../lib/progress";

const LABEL: Record<string, string> = {
  validate: "Validando el archivo", mezzanine: "Preparando el vídeo", proxy: "Creando la copia ligera", prepare: "Extrayendo el audio", transcribe: "Transcribiendo",
  scenes: "Detectando escenas", speakers: "Identificando hablantes", candidates: "Buscando momentos", select: "Seleccionando", compose: "Componiendo",
  previews: "Preparando previsualizaciones", checks: "Comprobando resultados", render: "Renderizando", zip: "Preparando la descarga", import: "Importando", publish: "Publicando", translate: "Traduciendo",
};
const QUEUE_REASON = { esperando_procesador: "Esperando a que el procesador esté libre. Tu trabajo sigue en el servidor aunque cierres la pestaña.", esperando_etapa_previa: "Esperando a que termine la etapa anterior." } as const;
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

export default function ProcessingPanel({ projectId }: { projectId: string }) {
  const [job, setJob] = useState<(JobRow & { params?: { source_minutes?: number } }) | null | undefined>(undefined);
  const [stages, setStages] = useState<(StageRowP & { id: string })[]>([]);
  const [clips, setClips] = useState<ClipRowP[]>([]);
  const [eta, setEta] = useState<{ p50_s: number; p90_s: number } | null>(null);

  const load = useCallback(async () => {
    const { data: j, error } = await supabase.from("jobs").select("id,status,error_code,created_at,engine,params").eq("project_id", projectId).eq("engine", "v2").order("created_at", { ascending: false }).limit(1);
    if (error || !j?.length) { setJob(null); return; }
    const jb = j[0] as JobRow & { params?: { source_minutes?: number } };
    setJob(jb);
    const [{ data: st }, { data: cs }] = await Promise.all([
      supabase.from("job_stages").select("id,stage,seq,status,attempts,started_at,finished_at,error_code").eq("job_id", jb.id),
      supabase.from("clips").select("id,technical_state,created_at").eq("project_id", projectId).eq("discarded", false),
    ]);
    setStages((st ?? []) as (StageRowP & { id: string })[]); setClips((cs ?? []) as ClipRowP[]);
    const mins = Number(jb.params?.source_minutes ?? 0);
    if (mins > 0 && st?.length) { const r = await supabase.rpc("stage_eta", { p_minutes: mins, p_stages: [...new Set(st.map((x) => x.stage))] }); setEta((r.data as { p50_s: number; p90_s: number } | null) ?? null); }
  }, [projectId]);

  useEffect(() => { load(); return subscribe(supabase as never, projectId, load); }, [load, projectId]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);   // respaldo si el canal en tiempo real se corta
  if (!job) return null;

  const s = deriveProjectState({ job, stages, clips });
  // Progreso como línea de tiempo en 4 hitos: no se enseñan los pasos internos del proceso.
  const MILESTONES = ["Preparando tu vídeo", "Entendiendo el contenido", "Creando tus clips", "Últimos retoques"];
  const macro = (st: string) => (["validate", "mezzanine", "proxy", "prepare"].includes(st) ? 0 : ["transcribe", "scenes", "speakers"].includes(st) ? 1 : ["candidates", "select", "compose"].includes(st) ? 2 : ["previews", "checks"].includes(st) ? 3 : 2);
  const total = Math.max(1, s.progress.total), pct = s.phase === "done" ? 100 : Math.min(99, Math.round((100 * s.progress.done) / total));
  const current = s.phase === "done" ? 4 : Math.max(0, ...stages.filter((x) => x.status === "running" || x.status === "done" || x.status === "skipped").map((x) => macro(x.stage)));
  return (
    <section aria-live="polite" aria-label="Estado del procesamiento" className="card mt-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{s.phase === "done" ? "Tus clips están listos" : s.phase === "failed" ? "Se detuvo" : s.phase === "cancelled" ? "Cancelado" : s.phase === "queued" ? "En cola" : "Creando tus clips"}</div>
        <div className="tnum text-sm text-[var(--muted)]">{s.phase === "failed" || s.phase === "cancelled" ? "" : `${pct} %`}{s.partial && s.phase !== "done" ? " · ya hay clips para revisar" : ""}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
        <div className="h-full rounded-full bg-[var(--ink)] transition-all duration-700" style={{ width: `${pct}%` }} /></div>
      <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Línea de tiempo">
        {MILESTONES.map((m, i) => { const done = i < current, now = i === current && s.phase !== "done" && s.phase !== "failed" && s.phase !== "cancelled";
          return <li key={m} className="text-center"><span aria-hidden className={`mx-auto mb-1.5 block h-3 w-3 rounded-full border ${done || s.phase === "done" ? "border-[var(--ink)] bg-[var(--ink)]" : now ? "border-[var(--ink)] bg-white ring-4 ring-[var(--accent-soft)]" : "border-[var(--border-2)] bg-white"}`} />
            <span className={`block text-xs leading-tight ${done || now || s.phase === "done" ? "font-medium" : "text-[var(--muted)]"}`}>{m}</span></li>; })}
      </ol>
      {(s.phase === "queued" || s.phase === "running") && (
        <p className="mt-4 text-sm text-[var(--muted)]">{eta ? `Tiempo estimado: entre ${fmt(eta.p50_s)} y ${fmt(eta.p90_s)}. ` : ""}Puedes cerrar la pestaña: el proceso sigue en el servidor.</p>
      )}
      {s.queued && <p className="mt-2 text-sm text-[var(--muted)]">{QUEUE_REASON[s.queued.reason]}</p>}
      {s.failed && <p role="alert" className="mt-3 text-sm">⚠ Algo falló. Se conserva todo lo ya hecho; puedes reintentar solo lo que falló.</p>}
    </section>
  );
}
