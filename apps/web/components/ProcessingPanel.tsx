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
  const list = [...stages].sort((a, b) => a.seq - b.seq || a.stage.localeCompare(b.stage));
  return (
    <section aria-live="polite" aria-label="Estado del procesamiento" className="card mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{s.phase === "done" ? "Listo" : s.phase === "failed" ? "Se detuvo" : s.phase === "cancelled" ? "Cancelado" : s.phase === "queued" ? "En cola" : s.currentStage ? LABEL[s.currentStage] ?? s.currentStage : "Procesando"}</div>
        <div className="mono text-sm text-[var(--muted)] tnum">{s.progress.done}/{s.progress.total} etapas{s.partial ? " · ya hay clips utilizables" : ""}</div>
      </div>
      {(s.phase === "queued" || s.phase === "running") && (
        <p className="mt-2 text-sm text-[var(--muted)]">{eta ? `Tiempo estimado: entre ${fmt(eta.p50_s)} y ${fmt(eta.p90_s)}.` : "Aún no se puede calcular el tiempo: todavía no hay suficientes datos de procesos anteriores."}</p>
      )}
      {s.queued && <p className="mt-2 text-sm text-[var(--muted)]">{QUEUE_REASON[s.queued.reason]}</p>}
      <ol className="mt-4 divide-y hairline rounded-xl border hairline" aria-label="Etapas del proceso">
        {list.map((x) => (
          <li key={x.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${x.status === "running" ? "bg-[var(--accent-soft)]" : ""}`}>
            <span className={x.status === "pending" || x.status === "queued" ? "text-[var(--muted)]" : "font-medium"}>{LABEL[x.stage] ?? x.stage}</span>
            <span className="ml-auto text-xs text-[var(--muted)]">{x.status === "done" ? "Completada" : x.status === "skipped" ? "Reutilizada" : x.status === "running" ? (x.attempts && x.attempts > 1 ? `En curso · intento ${x.attempts}` : "En curso") : x.status === "failed" ? "Falló" : x.status === "cancelled" ? "Cancelada" : "Pendiente"}</span>
          </li>
        ))}
      </ol>
      {s.failed && <p role="alert" className="mt-3 text-sm">⚠ {s.failed.error_code ? `Código: ${s.failed.error_code}. ` : ""}Se conserva todo lo ya hecho; puedes reintentar solo lo que falló.</p>}
    </section>
  );
}
