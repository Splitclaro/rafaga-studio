"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { Chip, isActive, type Row } from "./ProjectList";
import Icon from "./Icon";

type ClipRow = { id: string; title: string; thumb?: string; ratio?: string; version?: number; path?: string; bytes?: number; url?: string; score?: number; ms: number };
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const dur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`; };
const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "clip";

/** Un proyecto con todos sus clips visibles, descarga individual y «Descargar todos». */
export default function ProjectClips({ p, onDelete }: { p: Row; onDelete: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [clips, setClips] = useState<ClipRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: cs } = await supabase.from("clips").select("id,title,thumb_path,candidate:clip_candidates(start_ms,end_ms,scores)").eq("project_id", p.id).eq("discarded", false).order("created_at", { ascending: true });
    const list = (cs ?? []) as unknown as { id: string; title: string; thumb_path: string | null; candidate: { start_ms: number; end_ms: number; scores: { overall?: number } | null } | null }[];
    const ids = list.map((c) => c.id);
    const { data: rs } = ids.length ? await supabase.from("renders").select("clip_id,storage_path,probe,ratio,clip_version,created_at").in("clip_id", ids).eq("status", "ready").order("created_at", { ascending: false }) : { data: [] };
    const tp = list.map((c) => c.thumb_path).filter((x): x is string => !!x);
    const sg = tp.length ? (await supabase.storage.from("renders").createSignedUrls(tp, 3600)).data ?? [] : [];
    const tm = new Map(sg.map((x) => [x.path, x.signedUrl]));
    const out: ClipRow[] = await Promise.all(list.map(async (c) => {
      const r = (rs ?? []).find((x) => x.clip_id === c.id);
      const url = r ? (await supabase.storage.from("renders").createSignedUrl(r.storage_path, 900)).data?.signedUrl : undefined;
      return { id: c.id, title: c.title, thumb: c.thumb_path ? tm.get(c.thumb_path) ?? undefined : undefined, ratio: r?.ratio, version: r?.clip_version, path: r?.storage_path, bytes: Number((r?.probe as { size?: string } | null)?.size ?? 0), url, score: c.candidate?.scores?.overall, ms: c.candidate ? c.candidate.end_ms - c.candidate.start_ms : 0 };
    }));
    setClips(out);
  }, [p.id]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!open || !isActive(p.status)) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [open, p.status, load]);

  async function dl(c: ClipRow) {
    if (!c.path) return;
    const { data } = await supabase.storage.from("renders").createSignedUrl(c.path, 300, { download: `${safe(c.title)}-${(c.ratio ?? "").replace(":", "x")}.mp4` });
    if (data?.signedUrl) { const a = document.createElement("a"); a.href = data.signedUrl; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); }
  }
  async function dlAll() {
    const ready = (clips ?? []).filter((c) => c.path);
    if (!ready.length) return setNote("Aún no hay clips renderizados para descargar. Ábrelos y pulsa Exportar.");
    setBusy(true); setNote(`Descargando ${ready.length} clip${ready.length === 1 ? "" : "s"}… si el navegador pide permiso para varias descargas, acéptalo.`);
    for (const c of ready) { await dl(c); await new Promise((r) => setTimeout(r, 900)); }
    setBusy(false); setNote(`${ready.length} descarga${ready.length === 1 ? "" : "s"} iniciada${ready.length === 1 ? "" : "s"}.`);
  }
  const readyCount = clips?.filter((c) => c.path).length ?? 0;

  return (
    <li className="card overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <Link href={`/app/p/${p.id}`} className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--ink)]">
          {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : <span className="dots-dark grid h-full place-items-center text-white/60"><Icon n="film" className="h-6 w-6" /></span>}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/app/p/${p.id}`} className="block truncate font-medium hover:underline">{p.name}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><Chip status={p.status} /><span className="tnum">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span><span className="tnum">{p.clips} clip{p.clips === 1 ? "" : "s"}</span></div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => onDelete(p.id, p.name)}>Borrar</button>
          <button className="btn btn-primary !px-3 !py-1.5 !text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Ocultar clips" : `Ver clips (${p.clips})`}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]" role="status">{note ?? (clips ? `${readyCount} de ${clips.length} listos para descargar` : "Cargando clips…")}</p>
            <div className="flex gap-2"><Link href={`/app/p/${p.id}`} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Abrir proyecto</Link><button disabled={busy || !readyCount} onClick={dlAll} className="btn btn-primary !px-3 !py-1.5 !text-xs disabled:opacity-40"><Icon n="download" className="h-3.5 w-3.5" />Descargar todos</button></div>
          </div>
          {!clips ? <div className="skeleton h-32" /> : !clips.length ? <p className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">{isActive(p.status) ? "Creando clips… aparecerán aquí según estén listos." : "Este proyecto aún no tiene clips. Ábrelo para detectar momentos."}</p> : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{clips.map((c) => (
              <li key={c.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
                {c.url ? <video src={c.url} poster={c.thumb} controls preload="none" className="aspect-[9/16] w-full bg-black object-cover" /> : <Link href={`/app/c/${c.id}`} className="grid aspect-[9/16] place-items-center bg-[var(--ink)] px-2 text-center text-xs text-white/80">Sin exportar<br />Abrir y exportar</Link>}
                <div className="p-2"><div className="truncate text-xs font-medium" title={c.title}>{c.title}</div>
                  <div className="mono mt-0.5 text-[11px] text-[var(--muted)]">{c.ms ? dur(c.ms) : ""}{c.bytes ? ` · ${mb(c.bytes)}` : ""}</div>
                  <div className="mt-1.5 flex gap-1"><Link href={`/app/c/${c.id}`} className="btn btn-ghost !px-2 !py-1 !text-[11px]">Editar</Link>{c.path && <button onClick={() => dl(c)} className="btn btn-primary !px-2 !py-1 !text-[11px]" aria-label={`Descargar ${c.title}`}><Icon n="download" className="h-3 w-3" /></button>}</div></div>
              </li>))}</ul>)}
        </div>)}
    </li>
  );
}
