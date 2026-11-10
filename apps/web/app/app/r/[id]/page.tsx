"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import Icon from "../../../../components/Icon";
import { StatusLabel, pieceStatus, fmtDur } from "../../../../components/ui/status";

type ClipRow = { id: string; title: string; title_source: string; project_id: string; workspace_id: string; current_version: number; review_status: string; approved_version: number | null; thumb_path: string | null; reviewed_at: string | null };
type VerRow = { version: number; created_at: string; composition: { style?: { fontName?: string }; preset?: string; ratio?: string; startSec?: number; endSec?: number } };
type RenderRow = { clip_version: number; ratio: string; storage_path: string; probe: { duration?: string | number; size?: string | number; width?: number; height?: number; brand?: string | null } | null; created_at: string; burn_subtitles: boolean };
type Comment = { id: string; version: number; at_sec: number | null; body: string; kind: string; author: string | null; resolved_at: string | null; created_at: string };
const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "pieza";

export default function ReviewRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const video = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState<ClipRow | null>(null);
  const [projectName, setProjectName] = useState("");
  const [vers, setVers] = useState<VerRow[]>([]);
  const [renders, setRenders] = useState<RenderRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [body, setBody] = useState("");
  const [useTime, setUseTime] = useState(true);
  const [t, setT] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"info" | "comments">("comments");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: c, error } = await supabase.from("clips").select("id,title,title_source,project_id,workspace_id,current_version,review_status,approved_version,thumb_path,reviewed_at").eq("id", id).maybeSingle();
    if (error || !c) return setErr("No se encontró la pieza o no tienes acceso.");
    setClip(c as ClipRow); setView((v) => v ?? (c as ClipRow).current_version);
    const [{ data: p }, { data: vs }, { data: rs }, { data: cm }, { data: ws }] = await Promise.all([
      supabase.from("projects").select("name").eq("id", c.project_id).maybeSingle(),
      supabase.from("clip_versions").select("version,created_at,composition").eq("clip_id", id).order("version", { ascending: false }),
      supabase.from("renders").select("clip_version,ratio,storage_path,probe,created_at,burn_subtitles").eq("clip_id", id).eq("status", "ready").order("created_at", { ascending: false }),
      supabase.from("clip_comments").select("id,version,at_sec,body,kind,author,resolved_at,created_at").eq("clip_id", id).order("created_at"),
      supabase.rpc("my_workspaces"),
    ]);
    setProjectName(p?.name ?? ""); setVers((vs ?? []) as VerRow[]); setRenders((rs ?? []) as RenderRow[]); setComments((cm ?? []) as Comment[]);
    setRole(((ws ?? []) as { role: string; active: boolean }[]).find((w) => w.active)?.role ?? "");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const render = useMemo(() => renders.find((r) => r.clip_version === view) ?? null, [renders, view]);
  useEffect(() => {
    let off = false; setSrc(null);
    if (!render) return;
    supabase.storage.from("renders").createSignedUrl(render.storage_path, 3600).then(({ data }) => { if (!off) setSrc(data?.signedUrl ?? null); });
    return () => { off = true; };
  }, [render]);
  useEffect(() => { const el = video.current; if (!el) return; const f = () => setT(el.currentTime); el.addEventListener("timeupdate", f); return () => el.removeEventListener("timeupdate", f); }, [src]);

  const canReview = ["owner", "admin", "editor", "reviewer", "member"].includes(role);
  const canEdit = ["owner", "admin", "editor", "member"].includes(role);
  const isCurrent = !!clip && view === clip.current_version;
  const st = clip ? pieceStatus({ review_status: clip.review_status, approved_version: clip.approved_version, current_version: clip.current_version, hasRender: renders.some((r) => r.clip_version === clip.current_version) }) : null;
  const vcomments = comments.filter((c) => c.version === view);

  async function decide(status: "approved" | "changes_requested") {
    if (!clip || view == null) return; setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("set_review", { p_clip: id, p_status: status, p_version: view, p_note: body.trim() || null });
    setBusy(false); if (error) return setMsg(error.message);
    setBody(""); setMsg(status === "approved" ? `Versión ${view} aprobada.` : "Cambios solicitados."); load();
  }
  async function comment(e: React.FormEvent) {
    e.preventDefault(); if (!body.trim() || view == null) return; setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("add_clip_comment", { p_clip: id, p_version: view, p_at: useTime && render ? +t.toFixed(2) : null, p_body: body });
    setBusy(false); if (error) return setMsg(error.message); setBody(""); load();
  }
  async function resolve(c: Comment) { const { error } = await supabase.rpc("resolve_clip_comment", { p_id: c.id, p_resolved: !c.resolved_at }); if (error) setMsg(error.message); else load(); }
  async function download() {
    if (!render || !clip) return;
    const name = `${safe(projectName)}_${safe(clip.title)}_${render.ratio.replace(":", "x")}_v${render.clip_version}.mp4`;
    const { data } = await supabase.storage.from("renders").createSignedUrl(render.storage_path, 300, { download: name });
    if (data?.signedUrl) window.location.href = data.signedUrl;
  }
  const seek = (x: number) => { const el = video.current; if (el) { el.currentTime = x; el.focus(); } };

  if (err) return <main className="mx-auto max-w-xl px-4 py-16 text-center"><p>{err}</p><Link href="/app/biblioteca" className="mt-4 inline-block underline">Volver a la biblioteca</Link></main>;
  if (!clip) return <main className="mx-auto max-w-6xl px-4 py-10"><div className="skeleton h-[60vh]" /></main>;

  const panelInfo = (
    <dl className="space-y-3 text-sm">
      {[["Proyecto", projectName], ["Versión vista", `v${view}${isCurrent ? " (actual)" : ""}`], ["Formato", render ? `${render.ratio}${render.probe?.width ? ` · ${render.probe.width}×${render.probe.height}` : ""}` : "—"], ["Duración", render?.probe?.duration ? clock(Number(render.probe.duration)) : "—"],
        ["Estilo", vers.find((v) => v.version === view)?.composition.preset ?? "—"], ["Subtítulos", render ? (render.burn_subtitles ? "Incrustados" : "Sin incrustar") : "—"], ["Marca", render?.probe?.brand ? "Aplicada" : "Sin marca"],
        ["Título", clip.title_source === "user" ? "Escrito por ti" : clip.title_source === "ai" ? "Sugerido (IA)" : "Sugerido a partir del contenido"]].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-[var(--muted)]">{k}</dt><dd className="text-right">{v}</dd></div>)}
    </dl>
  );
  const panelComments = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {!vcomments.length && <li className="text-sm text-[var(--muted)]">Sin comentarios en esta versión.</li>}
        {vcomments.map((c) => (
          <li key={c.id} className={`rounded-xl p-3 text-sm ${c.kind === "approval" ? "bg-[#111] text-white" : c.kind === "changes" ? "bg-white ring-1 ring-dashed ring-[#111] ring-inset" : "bg-[var(--surface)]"} ${c.resolved_at ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 text-xs opacity-80">
              {c.kind === "approval" && <><Icon n="check" className="h-3 w-3" />Aprobación</>}{c.kind === "changes" && <><Icon n="wand" className="h-3 w-3" />Cambios solicitados</>}{c.kind === "comment" && "Comentario"}
              {c.at_sec != null && <button onClick={() => seek(c.at_sec!)} className="tnum underline">en {clock(c.at_sec)}</button>}
              <span className="ml-auto">{new Date(c.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            {c.kind !== "approval" && canReview && <button onClick={() => resolve(c)} className="mt-1 text-xs underline">{c.resolved_at ? "Reabrir" : "Marcar resuelto"}</button>}
          </li>))}
      </ol>
      {canReview ? (
        <form onSubmit={comment} className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <label htmlFor="cm" className="sr-only">Comentario</label>
          <textarea id="cm" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} placeholder="Escribe un comentario o el motivo de la decisión" className="input resize-y" />
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" checked={useTime} onChange={(e) => setUseTime(e.target.checked)} disabled={!render} />Vincular al instante {clock(t)}</label>
          <div className="flex flex-wrap gap-2"><button disabled={busy || !body.trim()} className="btn btn-ghost !py-1.5 !text-xs">Comentar</button></div>
        </form>
      ) : <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">Tu rol ({role || "—"}) permite ver, no comentar ni decidir.</p>}
    </div>
  );

  return (
    <main className="px-4 pb-10 pt-5 md:px-8">
      <nav aria-label="Ruta" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-[var(--muted)]"><Link href="/app/biblioteca" className="hover:underline">Proyectos</Link><span aria-hidden>/</span><Link href={`/app/p/${clip.project_id}`} className="hover:underline">{projectName || "Proyecto"}</Link><span aria-hidden>/</span><span className="text-[var(--text)]">Revisión</span></nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Vídeo">
          <div className="flex items-start justify-between gap-3"><h1 className="text-2xl tracking-tight md:text-3xl">{clip.title}</h1>{st && <StatusLabel status={st.status} note={st.note} />}</div>
          {st?.note && <p className="mt-1 text-sm text-[var(--muted)]">{st.note}</p>}
          <div className="mt-4 grid place-items-center rounded-3xl bg-[#EFEFEF] p-4 md:p-8">
            {src ? <video ref={video} src={src} controls playsInline preload="metadata" poster={undefined} className="max-h-[72vh] w-auto max-w-full rounded-2xl bg-black" />
              : <div className="grid h-[50vh] w-full place-items-center text-center text-sm text-[var(--muted)]">{render ? <span className="pulse" aria-label="Cargando" /> : <p className="max-w-sm">La versión {view} no tiene un MP4 exportado todavía.<br />{canEdit && <Link href={`/app/c/${id}`} className="underline">Ábrela en el editor y exporta</Link>}</p>}</div>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Versión" className="inline-flex flex-wrap gap-1.5">{vers.map((v) => <button key={v.version} aria-pressed={view === v.version} onClick={() => setView(v.version)} className="chip">v{v.version}{v.version === clip.current_version ? " · actual" : ""}{renders.some((r) => r.clip_version === v.version) ? "" : " · sin MP4"}</button>)}</div>
            <div className="ml-auto flex flex-wrap gap-2">
              {canEdit && <Link href={`/app/c/${id}`} className="btn btn-ghost">Editar</Link>}
              <button onClick={download} disabled={!render} className="btn btn-ghost"><Icon n="download" className="h-4 w-4" />Descargar</button>
              {canReview && <button onClick={() => decide("changes_requested")} disabled={busy || !isCurrent} className="btn btn-ghost" title={isCurrent ? "" : "Solo se decide sobre la versión actual"}>Solicitar cambios</button>}
              {canReview && <button onClick={() => decide("approved")} disabled={busy || !isCurrent || !render} className="btn btn-primary" title={isCurrent ? "" : "Solo se decide sobre la versión actual"}><Icon n="check" className="h-4 w-4" />Aprobar v{view}</button>}
            </div>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">{msg}</p>
          {!isCurrent && <p className="text-xs text-[var(--muted)]">Estás viendo una versión anterior. La aprobación siempre se aplica a la versión actual (v{clip.current_version}).</p>}
        </section>

        <aside aria-label="Detalles y comentarios" className="flex min-h-0 flex-col lg:max-h-[calc(100vh-120px)]">
          <div role="tablist" className="mb-3 flex gap-1.5 lg:hidden">{([["comments", `Comentarios (${vcomments.length})`], ["info", "Información"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="chip">{l}</button>)}</div>
          <div className={`${tab === "info" ? "" : "max-lg:hidden"} mb-5`}><h2 className="mb-3 text-lg tracking-tight max-lg:hidden">Información</h2>{panelInfo}</div>
          <div className={`${tab === "comments" ? "flex" : "max-lg:hidden"} min-h-0 flex-1 flex-col lg:flex`}><h2 className="mb-3 text-lg tracking-tight max-lg:hidden">Comentarios <span className="tnum text-sm text-[var(--muted)]">{vcomments.length}</span></h2>{panelComments}</div>
          {fmtDur(0) && null}
        </aside>
      </div>
    </main>
  );
}
