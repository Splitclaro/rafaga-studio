// Estado real de un proyecto derivado SOLO de filas de la base de datos (jobs, job_stages, clips).
// Pura y sin depender del orden de entrada: al volver a entrar se recupera el estado verdadero (criterio 2).
export interface JobRow { id: string; status: string; error_code?: string | null; created_at?: string; engine?: string }
export interface StageRowP { stage: string; seq: number; status: string; attempts?: number; started_at?: string | null; finished_at?: string | null; error_code?: string | null }
export interface ClipRowP { id: string; technical_state?: string | null; created_at?: string | null }
export type Phase = "idle" | "queued" | "running" | "done" | "failed" | "cancelled";
export interface ProjectState {
  phase: Phase; currentStage: string | null; done: string[]; failed: { stage: string; error_code: string | null } | null;
  partial: boolean; queued: { reason: "esperando_procesador" | "esperando_etapa_previa" } | null; firstClipAt: string | null; progress: { done: number; total: number };
}

export function deriveProjectState(i: { job: JobRow | null; stages: StageRowP[]; clips: ClipRowP[] }): ProjectState {
  const stages = [...i.stages].sort((a, b) => a.seq - b.seq || a.stage.localeCompare(b.stage));
  const ready = i.clips.filter((c) => (c.technical_state ?? "disponible") === "disponible");
  const firstClipAt = ready.map((c) => c.created_at).filter((x): x is string => !!x).sort()[0] ?? null;
  const done = stages.filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.stage);
  const failedStage = stages.find((s) => s.status === "failed");
  const running = stages.find((s) => s.status === "running");
  const queuedStages = stages.filter((s) => s.status === "queued");
  const inFlight = !!running || queuedStages.length > 0;
  const progress = { done: done.length, total: stages.length };
  const st = i.job?.status ?? null;
  let phase: Phase = "idle";
  if (st === "cancelled") phase = "cancelled";
  else if (st === "failed" || failedStage) phase = "failed";
  else if (st === "done" && !inFlight) phase = "done";
  else if (running) phase = "running";
  else if (inFlight || st === "queued") phase = "queued";
  else if (st) phase = "running";
  const next = running ?? queuedStages[0] ?? null;
  const blocked = phase === "queued" && queuedStages.length > 0 && !running && stages.some((s) => s.seq < (queuedStages[0]?.seq ?? 0) && s.status !== "done" && s.status !== "skipped");
  return {
    phase, currentStage: next?.stage ?? null, done,
    failed: failedStage ? { stage: failedStage.stage, error_code: failedStage.error_code ?? i.job?.error_code ?? null } : st === "failed" ? { stage: "", error_code: i.job?.error_code ?? null } : null,
    partial: ready.length > 0 && inFlight, queued: phase === "queued" ? { reason: blocked ? "esperando_etapa_previa" : "esperando_procesador" } : null,
    firstClipAt, progress,
  };
}

/** Suscripción en tiempo real a los cambios del proyecto (jobs, job_stages, clips). Devuelve la función para cancelar. */
export interface RealtimeLike { channel(name: string): { on(ev: string, f: unknown, cb: () => void): unknown; subscribe(): unknown }; removeChannel(c: unknown): unknown }
export function subscribe(sb: RealtimeLike, projectId: string, onChange: () => void): () => void {
  let ch = sb.channel(`project-${projectId}`);
  for (const table of ["jobs", "job_stages", "clips"]) ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, onChange) as typeof ch;
  const sub = ch.subscribe();
  return () => { sb.removeChannel(sub); };
}
