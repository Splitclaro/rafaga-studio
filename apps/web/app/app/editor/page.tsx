"use client";
// Editor de vídeos (v3): subir una canción y «Vídeos creados» (borradores y vídeos renderizados) dentro de la herramienta.
// Fuente pública: P6 (subir ≤50 MB → letra → estilo → render y guardar). Cada canción abre su recorrido en /app/editor/[songId].
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import { uploadSong, downloadRender, SONG_FORMATS } from "../../../lib/songupload";
import type { UploadEvent } from "../../../lib/uploader";

type Draft = { project_id: string; song_id: string; updated_at: string; songs: { title: string; status: string } | null };
type Video = { id: string; status: string; created_at: string; ratio: string; clips: { title: string; project_id: string } | null };
const TABS = [["borradores", "Borradores"], ["renderizados", "Vídeos renderizados"], ["progreso", "En progreso"]] as const;
const when = (iso: string) => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function EditorDeVideos() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[] | null>(null), [videos, setVideos] = useState<Video[] | null>(null), [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("borradores"), [ev, setEv] = useState<UploadEvent | null>(null), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const ctl = useRef<{ cancel: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    const [d, v] = await Promise.all([
      supabase.from("lyric_projects").select("project_id,song_id,updated_at,songs(title,status)").order("updated_at", { ascending: false }).limit(60),
      supabase.from("renders").select("id,status,created_at,ratio,clips!inner(title,project_id,projects!inner(mode))").eq("clips.projects.mode", "lyrics").eq("kind", "mp4").order("created_at", { ascending: false }).limit(60),
    ]);
    if (d.error || v.error) setErr("No se pudo cargar tu historial. Vuelve a intentarlo en unos segundos.");
    setDrafts((d.data ?? []) as unknown as Draft[]); setVideos((v.data ?? []) as unknown as Video[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function pick(files: File[]) {
    if (busy || !files.length) return;
    setBusy(true); setMsg(null);
    const ids: string[] = [];
    for (const [i, f] of files.slice(0, 10).entries()) {
      try { setMsg(files.length > 1 ? `Subiendo ${i + 1} de ${Math.min(files.length, 10)}: ${f.name}` : `Subiendo ${f.name}`); ids.push(await uploadSong(f, setEv, (c) => { ctl.current = c; })); }
      catch (e) { setMsg((e as Error).message); }
    }
    ctl.current = null; setBusy(false); setEv(null);
    if (ids.length === 1) return router.push(`/app/editor/${ids[0]}?paso=audio`);
    if (ids.length > 1) { setMsg(`${ids.length} canciones subidas: cada una es su propio vídeo. Ábrelas desde Borradores.`); void load(); }
  }

  const rendered = (videos ?? []).filter((v) => v.status === "ready"), running = (videos ?? []).filter((v) => v.status === "queued" || v.status === "running");
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">Editor de vídeos</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Sube una canción y conviértela en un vídeo con su letra: audio, letras, estilo y render.</p></header>

      <section aria-label="Subir una canción" className="card mb-8 p-4">
        <label htmlFor="ed-song" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(Array.from(e.dataTransfer.files)); }}
          className={`grid cursor-pointer place-items-center rounded-[20px] border-2 border-dashed border-[var(--border-2)] p-8 text-center ${busy ? "pointer-events-none opacity-60" : "hover:border-[var(--accent)]"}`}>
          <Icon n="music" className="h-7 w-7" />
          <span className="mt-2 font-display text-lg font-bold">Suelta aquí tu canción</span>
          <span className="text-sm text-[var(--muted)]">{SONG_FORMATS} · hasta 50 MB · puedes soltar varias: cada una será su propio vídeo</span>
          <span className="btn btn-primary mt-3"><Icon n="upload" className="h-4 w-4" />Elegir archivo</span>
        </label>
        <input id="ed-song" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" multiple disabled={busy} className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void pick(fs); }} />
        {ev && busy && <div className="mt-3 text-sm" aria-live="polite"><div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((100 * ev.bytesSent) / Math.max(1, ev.totalBytes))}%` }} /></div>
          <p className="tnum mt-1 text-xs text-[var(--muted)]">{(ev.bytesSent / 1048576).toFixed(1)} de {(ev.totalBytes / 1048576).toFixed(1)} MB{ev.etaS != null ? ` · quedan ${ev.etaS} s` : ""}</p>
          <button type="button" className="btn btn-ghost mt-2 !min-h-9" onClick={() => void ctl.current?.cancel().then(() => { setBusy(false); setMsg("Subida cancelada. No se ha guardado nada."); })}>Cancelar</button></div>}
        {msg && <p role="status" className="mt-3 text-sm">{msg}</p>}
      </section>

      <section aria-labelledby="h-creados">
        <h2 id="h-creados" className="mb-1 text-lg">Vídeos creados</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">Todo se guarda en tu cuenta: puedes cerrar y seguir después desde aquí.</p>
        <div role="tablist" aria-label="Vídeos creados" className="mb-4 flex flex-wrap gap-1.5">{TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className="chip" onClick={() => setTab(k)}>{l}{k === "renderizados" && videos ? ` (${rendered.length})` : k === "progreso" && videos ? ` (${running.length})` : k === "borradores" && drafts ? ` (${drafts.length})` : ""}</button>))}</div>
        {err && <p role="alert" className="card mb-3 p-4 text-sm">{err} <button className="underline" onClick={() => { setErr(null); void load(); }}>Reintentar</button></p>}
        {drafts === null ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="skeleton h-20" />)}</ul>
          : tab === "borradores" ? (!drafts.length ? <p className="card border-dashed p-8 text-center text-[var(--muted)]">Aún no tienes borradores. Sube una canción para empezar.</p> :
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{drafts.map((d) => (
              <li key={d.project_id}><Link href={`/app/editor/${d.song_id}`} className="card lift block p-4"><b className="line-clamp-1">{d.songs?.title ?? "Canción"}</b><span className="mt-1 block text-xs text-[var(--muted)]">Guardado el {when(d.updated_at)}</span></Link></li>))}</ul>)
          : (() => { const list = tab === "renderizados" ? rendered : running; return !list.length ? <p className="card border-dashed p-8 text-center text-[var(--muted)]">{tab === "renderizados" ? "Aún no has renderizado ningún vídeo." : "No hay vídeos renderizándose ahora."}</p> :
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((v) => (
              <li key={v.id} className="card flex items-center justify-between gap-3 p-4"><span className="min-w-0"><b className="line-clamp-1">{v.clips?.title ?? "Vídeo"}</b><span className="block text-xs text-[var(--muted)]">{v.ratio} · {when(v.created_at)}{v.status !== "ready" ? " · renderizando" : ""}</span></span>
                {v.status === "ready" && <button type="button" className="btn btn-ghost !min-h-9 shrink-0" onClick={async () => { const e = await downloadRender(v.id, v.clips?.title ?? "video"); if (e) setMsg(e); }}><Icon n="download" className="h-4 w-4" />Descargar</button>}</li>))}</ul>; })()}
      </section>
    </main>
  );
}
