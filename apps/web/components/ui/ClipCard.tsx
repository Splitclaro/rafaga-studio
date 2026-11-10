"use client";
import Link from "next/link";
import { memo } from "react";
import Icon from "../Icon";
import { StatusLabel, pieceStatus, fmtDur } from "./status";

export type WallClip = {
  id: string; title: string; title_source: string; thumb?: string; url?: string; path?: string; bytes?: number; favorite: boolean; version: number; ratio?: string;
  review_status: string; approved_version: number | null; current_version: number; durMs?: number; score?: number | null; reason?: string | null; brief_fit?: string | null; startMs?: number; endMs?: number; created_at: string; hasRender: boolean;
};

/** Tarjeta de pieza: miniatura grande, selección, duración, estado con texto+icono y acción de revisión. Útil sin hover. */
function ClipCardBase({ c, selected, previewing, onSelect, onPreview, aspect = "aspect-[9/16]", view = "grid" }: { c: WallClip; selected: boolean; previewing: boolean; onSelect: (id: string, shift: boolean) => void; onPreview: (id: string | null) => void; aspect?: string; view?: "grid" | "list" }) {
  const st = pieceStatus(c);
  const media = (
    <div className={`relative overflow-hidden rounded-2xl bg-[#111] ${view === "list" ? "h-24 w-[54px] shrink-0 !rounded-xl" : `${aspect} w-full`}`}>
      {previewing && c.url ? <video src={c.url} poster={c.thumb} autoPlay muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" onClick={() => onPreview(null)} />
        : c.thumb ? <img src={c.thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0 grid place-items-center bg-[#1a1a1a] text-[11px] text-white/70">{c.hasRender ? "Sin portada" : "Creando…"}</div>}
      {view === "grid" && <>
        <label className="absolute left-2 top-2 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-white/90 shadow-sm" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">Seleccionar «{c.title}»</span>
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(c.id, (e.nativeEvent as MouseEvent).shiftKey)} className="h-4 w-4 accent-black" />
        </label>
        {c.durMs ? <span className="tnum absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{fmtDur(c.durMs)}</span> : null}
        {c.url && <button onClick={() => onPreview(previewing ? null : c.id)} aria-pressed={previewing} aria-label={previewing ? `Detener vista previa de ${c.title}` : `Vista previa de ${c.title}`} className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm"><Icon n={previewing ? "x" : "play"} className="h-4 w-4" /></button>}
        {c.favorite && <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-white/90" title="Favorito"><Icon n="brand" className="h-3.5 w-3.5" /></span>}
      </>}
    </div>
  );
  if (view === "list") return (
    <li className={`flex items-center gap-3 rounded-2xl p-2 ${selected ? "bg-[var(--hover)] ring-1 ring-[#111]" : "hover:bg-[var(--surface)]"}`}>
      <input type="checkbox" aria-label={`Seleccionar «${c.title}»`} checked={selected} onChange={(e) => onSelect(c.id, (e.nativeEvent as MouseEvent).shiftKey)} className="h-5 w-5 shrink-0 accent-black" />
      {media}
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.title}</div><div className="tnum text-xs text-[var(--muted)]">{c.durMs ? fmtDur(c.durMs) : "—"} · {c.ratio ?? "—"} · v{c.version}</div></div>
      <StatusLabel status={st.status} note={st.note} className="hidden sm:inline-flex" />
      <Link href={`/app/r/${c.id}`} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Abrir revisión</Link>
    </li>
  );
  return (
    <li className={`group rounded-2xl p-1.5 transition-colors ${selected ? "bg-[var(--hover)] ring-2 ring-[#111]" : ""}`}>
      {media}
      <div className="px-1 pb-1 pt-2.5">
        <div className="flex items-start justify-between gap-2"><h3 className="line-clamp-2 text-[15px] font-medium leading-snug" title={c.title}>{c.title}</h3></div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"><StatusLabel status={st.status} note={st.note} /><span className="tnum text-xs text-[var(--muted)]">{c.ratio ?? "—"} · v{c.version}</span></div>
        {st.note && <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{st.note}</p>}
        {c.score != null && <p className="mt-1 text-[11px] text-[var(--muted)]" title={c.brief_fit ?? c.reason ?? undefined}>Encaje estimado {Math.round(c.score * 10)}/100{c.brief_fit ? ` · ${c.brief_fit}` : ""}</p>}
        {c.startMs != null && c.endMs != null && <p className="tnum mt-0.5 text-[11px] text-[var(--muted)]">Origen {fmtDur(c.startMs)}–{fmtDur(c.endMs)}</p>}
        {c.reason && <p className="mt-1 line-clamp-4 text-[12px] leading-snug text-[var(--text)]" title={c.reason}>{c.reason}</p>}
        <Link href={`/app/r/${c.id}`} className="btn btn-ghost mt-2.5 w-full !py-1.5 !text-xs">Abrir revisión</Link>
      </div>
    </li>
  );
}
export const ClipCard = memo(ClipCardBase);
