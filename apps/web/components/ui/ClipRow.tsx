"use client";
import Link from "next/link";
import { memo, useState } from "react";
import Icon from "../Icon";
import { supabase } from "../../lib/supabase";
import { downloadMp4, fileName } from "../../lib/download";
import { StatusLabel, pieceStatus, fmtDur } from "./status";
import type { WallClip } from "./ClipCard";

/**
 * Vista de detalle de un clip (patrón observado en Vizard/NexusClips, con nuestro texto): vídeo vertical a la izquierda; a la derecha
 * número y título, puntuación grande, acciones a la vista, motivo de la selección y transcripción del clip bajo demanda.
 * La puntuación es una ESTIMACIÓN del selector, no una medida de viralidad: se etiqueta como «Encaje».
 */
function ClipRowBase({ c, index, selected, onSelect, onFavorite, onDiscard, projectName }: {
  c: WallClip; index: number; selected: boolean; onSelect: (id: string, shift: boolean) => void;
  onFavorite: (id: string, v: boolean) => void | Promise<void>; onDiscard: (id: string) => void | Promise<void>; projectName: string;
}) {
  const st = pieceStatus(c);
  const [playing, setPlaying] = useState(false);
  const [text, setText] = useState<string | null>(null), [open, setOpen] = useState(false), [err, setErr] = useState<string | null>(null);
  const score = c.score != null ? Math.max(0, Math.min(10, c.score)) : null;

  async function toggleText() {
    setOpen((o) => !o);
    if (text !== null || open) return;
    const { data } = await supabase.from("clip_versions").select("composition").eq("clip_id", c.id).eq("version", c.current_version).single();
    const words = ((data?.composition as { words?: { text: string }[] } | null)?.words ?? []).map((w) => w.text);
    setText(words.length ? words.join(" ") : "Este clip no tiene transcripción guardada.");
  }
  async function download() {
    if (!c.path) return;
    setErr(null);
    const r = await downloadMp4("renders", c.path, fileName(`${projectName}_${String(index).padStart(2, "0")}-${c.title}`));
    if (!r.ok) setErr(r.error);
  }

  return (
    <li id={`clip-${c.id}`} className={`card scroll-mt-24 p-4 ${selected ? "ring-2 ring-[var(--accent)]" : ""}`}>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="relative mx-auto aspect-[9/16] w-44 shrink-0 overflow-hidden rounded-2xl bg-[var(--ink)] sm:mx-0 sm:w-48">
          {playing && c.url ? <video src={c.url} poster={c.thumb} controls autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" onEnded={() => setPlaying(false)} />
            : c.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            : <div className="absolute inset-0 grid place-items-center text-[11px] text-white/70">{c.hasRender ? "Sin portada" : "Creando…"}</div>}
          {!playing && c.url && <button onClick={() => setPlaying(true)} aria-label={`Reproducir «${c.title}»`} className="absolute inset-0 grid place-items-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-[var(--ink)] shadow"><Icon n="play" className="h-5 w-5" /></span></button>}
          {c.durMs ? <span className="tnum absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{fmtDur(c.durMs)}</span> : null}
          {c.ratio && <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{c.ratio}</span>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <input type="checkbox" aria-label={`Seleccionar «${c.title}»`} checked={selected} onChange={(e) => onSelect(c.id, (e.nativeEvent as MouseEvent).shiftKey)} className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
            <h3 className="min-w-0 flex-1 text-lg leading-snug"><span className="mr-2 text-[var(--muted)]">#{index}</span>{c.title}</h3>
            <button onClick={() => onFavorite(c.id, !c.favorite)} aria-pressed={c.favorite} aria-label={c.favorite ? "Quitar de favoritos" : "Marcar como favorito"} className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-[var(--hover)] ${c.favorite ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}><Icon n="brand" className="h-4 w-4" /></button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            {score != null && (
              <div title="Estimación del selector (IA o reglas). No garantiza viralidad." className="leading-none">
                <span className="font-[family-name:var(--font-heading)] text-4xl font-bold tracking-tight text-[var(--accent)]">{score.toFixed(1)}</span>
                <span className="ml-1 text-sm text-[var(--muted)]">/10</span>
                <span className="mt-1 block text-[11px] font-medium text-[var(--muted)]">ENCAJE ESTIMADO</span>
              </div>
            )}
            <StatusLabel status={st.status} note={st.note} />
            {c.startMs != null && c.endMs != null && <span className="tnum text-xs text-[var(--muted)]">Origen {fmtDur(c.startMs)}–{fmtDur(c.endMs)}</span>}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={download} disabled={!c.path} title={c.path ? "" : "Aún no hay MP4: ábrelo en el editor y pulsa Exportar"} className="btn btn-primary !py-2 !text-sm"><Icon n="download" className="h-4 w-4" />Descargar</button>
            <Link href={`/app/c/${c.id}`} className="btn btn-ghost !py-2 !text-sm"><Icon n="scissors" className="h-4 w-4" />Editar</Link>
            <Link href={`/app/r/${c.id}`} className="btn btn-ghost !py-2 !text-sm">Revisar</Link>
            <button onClick={() => { if (confirm("¿Descartar este clip? Deja de aparecer en el proyecto (los exports hechos se conservan).")) onDiscard(c.id); }} className="btn btn-ghost !py-2 !text-sm text-[var(--muted)]">Descartar</button>
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{err}</p>}

          {(c.reason || c.brief_fit) && <p className="mt-4 text-sm leading-relaxed text-[var(--text)]">{c.reason}{c.brief_fit ? <span className="mt-1 block text-[var(--muted)]">{c.brief_fit}</span> : null}</p>}
          <button onClick={toggleText} aria-expanded={open} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"><Icon n={open ? "chevD" : "chevR"} className="h-3.5 w-3.5" />Transcripción del clip</button>
          {open && <p className="mt-2 max-h-48 overflow-auto rounded-xl bg-[var(--surface)] p-3 text-sm leading-relaxed text-[var(--text)]">{text ?? "Cargando…"}</p>}
        </div>
      </div>
    </li>
  );
}
export const ClipRow = memo(ClipRowBase);
