"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Run = { ran_at: string; enqueued: number; orphaned: number; pending: number; worker_alive: boolean; dispatch: string };
const ago = (d?: string) => { if (!d) return "nunca"; const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 90 ? `hace ${s} s` : s < 5400 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`; };

/** Estado real del programador (pg_cron) y del worker, leído de la base de datos. */
export default function OpsStatus({ compact = false }: { compact?: boolean }) {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [beat, setBeat] = useState<string | undefined>();
  const [lastDispatch, setLastDispatch] = useState<string | undefined>();
  useEffect(() => {
    const load = async () => {
      const [{ data: r }, { data: b }, { data: d }] = await Promise.all([
        supabase.from("scheduler_runs").select("ran_at,enqueued,orphaned,pending,worker_alive,dispatch").order("ran_at", { ascending: false }).limit(1),
        supabase.from("worker_heartbeats").select("seen_at").order("seen_at", { ascending: false }).limit(1),
        supabase.from("scheduler_runs").select("ran_at,dispatch").or("dispatch.eq.not_configured,dispatch.eq.dispatched,dispatch.like.error*").order("ran_at", { ascending: false }).limit(1),
      ]);
      setRun((r?.[0] as Run) ?? null); setBeat(b?.[0]?.seen_at); setLastDispatch((d?.[0] as Run | undefined)?.dispatch);
    };
    load(); const t = setInterval(load, 30000); return () => clearInterval(t);
  }, []);
  if (run === undefined) return <div className="skeleton h-16" />;
  const schedOk = !!run && Date.now() - new Date(run.ran_at).getTime() < 3 * 60_000;
  const alive = !!beat && Date.now() - new Date(beat).getTime() < 90_000;
  const auto = lastDispatch === "not_configured" ? "sin configurar" : lastDispatch?.startsWith("error") ? "con error" : lastDispatch === "dispatched" ? "activo" : "sin necesidad aún";
  return (
    <div className={`rounded-xl border border-[var(--border)] ${compact ? "p-3" : "p-4"} text-sm`} role="status">
      <div className="grid gap-2 sm:grid-cols-3">
        <div><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${schedOk ? "bg-[var(--ink)]" : "bg-[#C9C9C9]"}`} aria-hidden />Programador: <strong>{schedOk ? "activo" : run ? "detenido" : "sin ejecuciones"}</strong> <span className="text-[var(--muted)]">({ago(run?.ran_at)})</span></div>
        <div><span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${alive ? "bg-[var(--ink)]" : "bg-[#C9C9C9]"}`} aria-hidden />Worker: <strong>{alive ? "en marcha" : "en reposo"}</strong> <span className="text-[var(--muted)]">(último latido {ago(beat)})</span></div>
        <div>Arranque automático del worker: <strong>{auto}</strong>{run ? <span className="text-[var(--muted)]"> · {run.pending} en cola</span> : null}</div>
      </div>
      {!compact && <p className="mt-2 text-xs text-[var(--muted)]">El programador corre en la base de datos cada minuto, aunque cierres el navegador: encola las revisiones de tus reglas cada 15 min y marca como fallidos los procesos que se cortaron 3 veces.{auto === "sin configurar" ? " Para que además arranque el worker solo, falta guardar un token de GitHub en el almacén seguro de Supabase; mientras tanto el worker arranca por el programador de GitHub (cada 5 min, sin garantía de puntualidad) o al lanzar un proceso." : ""}</p>}
    </div>
  );
}
