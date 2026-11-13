"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { STAGE, MODE_LABEL } from "../lib/projects";
import Icon from "./Icon";

export type Row = { folder_id?: string | null; archived_at?: string | null; id: string; name: string; created_at: string; project_brief: string | null; mode: string; status: string | null; clips: number; thumb?: string; jobId?: string; engine?: string };

export function useProjects() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("projects").select("id,name,created_at,project_brief,mode,source_id,archived_at,folder_id").is("deleted_at", null).order("created_at", { ascending: false });
    if (error) return setErr(error.message);
    const ids = (data ?? []).map((p) => p.id);
    const srcIds = [...new Set((data ?? []).map((p) => p.source_id))];
    const [jobs, clips, srcs] = await Promise.all([
      ids.length ? supabase.from("jobs").select("*").in("project_id", ids).in("kind", ["detect", "generation"]).order("created_at", { ascending: false }) : { data: [] },
      ids.length ? supabase.from("clips").select("project_id,thumb_path,created_at").in("project_id", ids).eq("discarded", false).order("created_at") : { data: [] },
      srcIds.length ? supabase.from("sources").select("id,thumb_path").in("id", srcIds) : { data: [] },
    ]);
    const paths = (srcs.data ?? []).filter((x: { thumb_path: string | null }) => x.thumb_path).map((x: { thumb_path: string }) => x.thumb_path);
    const signed = paths.length ? (await supabase.storage.from("originals").createSignedUrls(paths, 3600)).data ?? [] : [];
    const urlByPath = new Map(signed.map((x) => [x.path, x.signedUrl]));
    const thumbBySrc = new Map((srcs.data ?? []).map((x: { id: string; thumb_path: string | null }) => [x.id, x.thumb_path ? urlByPath.get(x.thumb_path) : undefined]));
    // Sin miniatura de la fuente: la del primer clip con miniatura propia
    const clipThumb = new Map<string, string>();
    for (const c of (clips.data ?? []) as { project_id: string; thumb_path: string | null }[]) if (c.thumb_path && !clipThumb.has(c.project_id)) clipThumb.set(c.project_id, c.thumb_path);
    const ctPaths = [...clipThumb.values()];
    const ctSigned = ctPaths.length ? (await supabase.storage.from("renders").createSignedUrls(ctPaths, 3600)).data ?? [] : [];
    const ctUrl = new Map(ctSigned.map((x) => [x.path, x.signedUrl]));
    setRows((data ?? []).map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, project_brief: p.project_brief, mode: p.mode, archived_at: p.archived_at, folder_id: p.folder_id, thumb: ((thumbBySrc.get(p.source_id) as string | null | undefined) ?? undefined) ?? (clipThumb.get(p.id) ? ctUrl.get(clipThumb.get(p.id)!) ?? undefined : undefined),
      ...lastJob(jobs.data ?? [], p.id), clips: (clips.data ?? []).filter((c: { project_id: string }) => c.project_id === p.id).length })));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { rows, err, reload: load };
}

type JobRow = { id: string; project_id: string; status: string; engine?: string };
/** Último trabajo del proyecto (la columna `engine` solo existe tras la migración 036; sin ella el trabajo es v1). */
function lastJob(jobs: JobRow[], projectId: string): { status: string | null; jobId?: string; engine?: string } {
  const j = jobs.find((x) => x.project_id === projectId);
  return j ? { status: j.status, jobId: j.id, engine: j.engine ?? "v1" } : { status: null };
}

export const isActive = (s: string | null) => !!s && !["done", "failed", "cancelled"].includes(s);

export function Chip({ status }: { status: string | null }) {
  if (isActive(status)) return <span className="chip !py-0.5"><span className="pulse" aria-hidden />{STAGE[status!] ?? status}</span>;
  return <span className="chip !py-0.5">{status ? <Icon n={status === "done" ? "check" : "x"} className="h-3 w-3" /> : null}{status ? STAGE[status] ?? status : "Sin analizar"}</span>;
}

export function ProjectCard({ p }: { p: Row }) {
  return (
    <Link href={`/app/p/${p.id}`} className="card lift group block overflow-hidden">
      <div className="relative aspect-video overflow-hidden bg-[var(--ink)]">
        {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <div className="grid h-full w-full place-items-center bg-[#1a1a1a] text-xs text-white/60">Sin portada todavía</div>}
        <div className="absolute left-2 top-2"><Chip status={p.status} /></div>
        {p.mode !== "clips" && <span className="chip absolute right-2 top-2 !py-0.5">{MODE_LABEL[p.mode] ?? p.mode}</span>}
        {isActive(p.status) && <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/40"><div className="skeleton h-full w-1/2 !rounded-none opacity-70" /></div>}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="mt-0.5 flex items-center justify-between text-xs text-[var(--muted)]"><span className="tnum">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span><span className="tnum">{p.clips} clip{p.clips === 1 ? "" : "s"}</span></div>
        {p.engine === "v2" && p.jobId && isActive(p.status) && <CancelJob jobId={p.jobId} />}
        <div className="mt-2 text-xs font-medium underline underline-offset-4">{p.status === "failed" ? "Resolver incidencia" : isActive(p.status) ? "Ver progreso" : p.clips > 0 ? "Revisar clips" : p.status === "done" ? "Ver resultados" : "Continuar editando"}</div>
      </div>
    </Link>
  );
}

/** Cancelar un trabajo v2 en curso: detiene tareas nuevas y devuelve lo no empezado. Sin doble envío. */
function CancelJob({ jobId }: { jobId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const cancel = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (state === "busy" || state === "done") return;
    setState("busy");
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
    const b = await r.json().catch(() => ({}));
    if (r.ok) { setState("done"); setMsg(`Cancelado. Se conserva: ${(b.kept ?? []).join(", ") || "nada aún"}; devueltas ${b.refunded_units ?? 0} unidades.`); }
    else { setState("error"); setMsg(b?.error?.message ?? "No se pudo cancelar."); }
  };
  return (
    <div className="mt-2 text-xs">
      <button type="button" onClick={cancel} disabled={state === "busy" || state === "done"} className="btn btn-ghost !px-2 !py-1 text-xs" aria-live="polite">
        {state === "busy" ? "Cancelando…" : state === "done" ? "Cancelado" : "Cancelar"}
      </button>
      {msg && <p className="mt-1 text-[var(--muted)]" role="status">{msg}</p>}
    </div>
  );
}

export default function ProjectGrid({ rows, query = "" }: { rows: Row[]; query?: string }) {
  const q = query.trim().toLowerCase();
  const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  if (!list.length) return <p className="card border-dashed p-6 text-sm text-[var(--muted)]">{q ? "Ningún proyecto coincide con tu búsqueda." : "Aún no tienes proyectos. Sube tu primer vídeo."}</p>;
  return <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{list.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}</ul>;
}
