"use client";
// Resultados v2 (solo proyectos con trabajos v2): rejilla de vistas verticales con puntuación 0–100, búsqueda, filtro y orden,
// selección múltiple, grupos por generación con mapa temporal, resumen con avisos y pantalla completa al pulsar un clip.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { requestClipExport } from "../lib/exportClient";
import PreviewPlayer, { type PClip } from "./PreviewPlayer";
import CreationPanel from "./CreationPanel";
import type { CompositionV2, Word } from "@rafaga/composition";

interface Cand { title: string; reason: string | null; start_ms: number; end_ms: number; scores: { overall?: number; reasons?: Record<string, string> } | null }
interface Row { id: string; title: string; scene_text?: string | null; feedback?: string | null; thumb_path: string | null; technical_state: string; editorial_state: string; favorite: boolean; needs_review: boolean; current_version: number; generation_id: string; created_at: string; candidate: Cand | Cand[] | null }
interface Gen { id: string; created_at: string; params: { brief?: string; mode?: string; range_start_ms?: number; range_end_ms?: number }; delivered_count: number | null; requested_count: number | null; warnings: { code: string; requested?: number; delivered?: number; reasons?: string[]; message?: string; clip_id?: string }[]; units_consumed: number | null; status: string; transcript_id: string }
const cand = (r: Row): Cand | null => (Array.isArray(r.candidate) ? r.candidate[0] : r.candidate) ?? null;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const WARN: Record<string, (w: Gen["warnings"][number]) => string> = {
  shortfall: (w) => `Pediste ${w.requested} clips y hay ${w.delivered} que valen la pena${w.reasons?.length ? `: ${w.reasons.join("; ")}` : ""}.`,
  no_moments: (w) => `No se encontraron momentos que cumplan lo pedido${w.reasons?.length ? ` (${w.reasons.join("; ")})` : ""}. Prueba otro tema, modo o duración.`,
  coverage_fill: (w) => w.message ?? "Algunos clips son tramos repartidos por el vídeo, porque no había suficientes momentos con voz completa.",
  selector_fallback: (w) => w.message ?? "Se usaron reglas de respaldo.", safe_zone: () => "Algún texto invade la zona de la interfaz de la plataforma.",
};

export default function ResultsGrid({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]), [gens, setGens] = useState<Gen[]>([]), [src, setSrc] = useState<{ duration_ms: number; width: number; height: number } | null>(null);
  const [q, setQ] = useState(""), [sort, setSort] = useState<"score" | "duration" | "position">("score"), [filter, setFilter] = useState<"all" | "review" | "approved" | "fav">("all");
  const [view, setView] = useState<"grid" | "list">("grid"), [sel, setSel] = useState<Set<string>>(new Set()), [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<number | null>(null), [newGen, setNewGen] = useState(false);
  const [proxy, setProxy] = useState<string | null>(null), [words, setWords] = useState<Word[]>([]), [comps, setComps] = useState<Record<string, CompositionV2>>({});

  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    const [c, g, s] = await Promise.all([
      supabase.from("clips").select("id,title,scene_text,feedback,thumb_path,technical_state,editorial_state,favorite,needs_review,current_version,generation_id,created_at,candidate:clip_candidates(title,reason,start_ms,end_ms,scores)").eq("project_id", projectId).eq("discarded", false).order("created_at", { ascending: false }),
      supabase.from("generations").select("id,created_at,params,delivered_count,requested_count,warnings,units_consumed,status,transcript_id").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("sources").select("duration_ms,width,height").eq("id", sourceId).single(),
    ]);
    setRows((c.data ?? []) as unknown as Row[]); setGens((g.data ?? []) as unknown as Gen[]); if (s.data) setSrc(s.data as never);
  }, [projectId, sourceId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const ch = supabase.channel(`results-${projectId}`).on("postgres_changes", { event: "*", schema: "public", table: "clips" }, load).subscribe(); return () => { supabase.removeChannel(ch); }; }, [projectId, load]);

  // Miniaturas firmadas tras comprobar el acceso (ruta del servidor)
  useEffect(() => { (async () => {
    const t = await token(); const need = rows.filter((r) => r.thumb_path && !thumbs[r.id]);
    for (const r of need) { const res = await fetch(`/api/uploads/clips/${r.id}/thumb`, { headers: { Authorization: `Bearer ${t}` } }); if (res.ok) { const j = await res.json(); if (j.url) setThumbs((m) => ({ ...m, [r.id]: j.url })); } }
  })(); }, [rows]);   // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    let l = rows.filter((r) => (!term || r.title.toLowerCase().includes(term) || (cand(r)?.reason ?? "").toLowerCase().includes(term))
      && (filter === "all" || (filter === "review" && r.editorial_state === "pendiente") || (filter === "approved" && r.editorial_state === "aprobado") || (filter === "fav" && r.favorite)));
    l = [...l].sort((a, b) => { const ca = cand(a), cb = cand(b);
      if (sort === "duration") return ((cb?.end_ms ?? 0) - (cb?.start_ms ?? 0)) - ((ca?.end_ms ?? 0) - (ca?.start_ms ?? 0));
      if (sort === "position") return (ca?.start_ms ?? 0) - (cb?.start_ms ?? 0);
      return (cb?.scores?.overall ?? 0) - (ca?.scores?.overall ?? 0); });
    return l;
  }, [rows, q, sort, filter]);

  async function feedback(id: string, f: "like" | "dislike" | null) {
    const { error } = await supabase.rpc("set_clip_feedback", { p_clip: id, p_feedback: f });
    if (error) { alert(error.message); return; }
    setRows((l) => (f === "dislike" ? l.filter((x) => x.id !== id) : l.map((x) => (x.id === id ? { ...x, feedback: f } : x))));
  }
  async function openClip(i: number) {
    setOpen(i); setTimeout(() => document.getElementById("inline-player")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    const t = await token();
    if (!proxy) { const r = await fetch(`/api/uploads/sources/${sourceId}/proxy`, { headers: { Authorization: `Bearer ${t}` } }); if (r.ok) setProxy((await r.json()).url); }
    const gen = gens.find((g) => g.id === visible[i].generation_id);
    if (gen && !words.length) { const { data } = await supabase.from("transcripts").select("words").eq("id", gen.transcript_id).single(); setWords((data?.words as Word[]) ?? []); }
    const ids = visible.filter((r) => !comps[r.id]).map((r) => r.id);
    if (ids.length) { const { data } = await supabase.from("clip_versions").select("clip_id,composition").in("clip_id", ids).eq("version", 1); setComps((m) => ({ ...m, ...Object.fromEntries((data ?? []).map((d) => [d.clip_id, d.composition as CompositionV2])) })); }
  }
  const pclips: PClip[] = visible.map((r) => { const c = cand(r); return { id: r.id, title: r.title, scene: r.scene_text ?? null, overall: c?.scores?.overall ?? null, reason: c?.reason ?? null, reasons: c?.scores?.reasons, comp: comps[r.id] ?? null, startS: (c?.start_ms ?? 0) / 1000, endS: (c?.end_ms ?? 0) / 1000, warnings: r.needs_review ? ["Necesita revisión: el seguimiento no estuvo seguro"] : [] }; });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const latest = gens[0], totalMin = src ? Math.round(src.duration_ms / 6000) / 10 : 0;

  return (
    <section className="mt-4" aria-label="Resultados">
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-medium">{latest?.params?.brief ? `«${latest.params.brief.split("\n")[0].slice(0, 120)}»` : "Mejores momentos del vídeo"}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{rows.length} {rows.length === 1 ? "clip" : "clips"} · {totalMin} min analizados{latest?.units_consumed != null ? ` · ${latest.units_consumed} unidades consumidas` : ""} · <Link className="underline" href={`/app/p/${projectId}?transcripcion=1`}>Transcripción</Link></p>
          </div>
          <button type="button" className="btn btn-primary !py-1.5 !text-xs" onClick={() => setNewGen((x) => !x)}>{newGen ? "Cerrar" : "Nueva generación"}</button>
        </div>
        {latest?.warnings?.length ? <ul className="mt-3 space-y-1 text-sm" role="status">{latest.warnings.map((w, i) => <li key={i} className="rounded-lg bg-[var(--surface)] px-3 py-2">{(WARN[w.code] ?? (() => w.message ?? "Aviso de la generación."))(w)}</li>)}</ul> : null}
      </div>
      {newGen && src && <div className="mt-4"><CreationPanel projectId={projectId} durationMs={src.duration_ms} onCreated={() => { setNewGen(false); router.refresh(); load(); }} /></div>}

      {src && gens.length > 0 && rows.length > 0 && (
        <div className="card mt-4 p-4" aria-label="Mapa temporal de los clips">
          <p className="mb-2 text-xs font-medium text-[var(--muted)]">Dónde está cada clip en el vídeo original</p>
          <div className="relative h-8 rounded-lg bg-[var(--surface)]">
            {rows.map((r) => { const c = cand(r); if (!c) return null; return <button key={r.id} type="button" title={`${r.title} · ${mmss(c.start_ms / 1000)}`} onClick={() => { const i = visible.findIndex((v) => v.id === r.id); if (i >= 0) openClip(i); }}
              className="absolute top-1 h-6 rounded bg-[var(--accent)] opacity-80 hover:opacity-100" style={{ left: `${(c.start_ms / src.duration_ms) * 100}%`, width: `${Math.max(0.6, ((c.end_ms - c.start_ms) / src.duration_ms) * 100)}%` }} aria-label={`${r.title} en ${mmss(c.start_ms / 1000)}`} />; })}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por palabras clave o momentos" className="min-w-[220px] flex-1 rounded-lg border hairline bg-transparent px-3 py-2" aria-label="Buscar" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded-lg border hairline bg-transparent px-2 py-2" aria-label="Filtrar"><option value="all">Todos</option><option value="review">Por revisar</option><option value="approved">Aprobados</option><option value="fav">Favoritos</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border hairline bg-transparent px-2 py-2" aria-label="Ordenar"><option value="score">Mayor encaje</option><option value="duration">Más largos</option><option value="position">Posición en el vídeo</option></select>
        <button type="button" className="btn btn-ghost !py-1.5 !text-xs" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? "Lista" : "Rejilla"}</button>
      </div>

      {sel.size > 0 && (
        <div className="card mt-3 flex flex-wrap items-center gap-2 p-3 text-sm" role="toolbar" aria-label="Acciones sobre la selección">
          <b>{sel.size} {sel.size === 1 ? "seleccionado" : "seleccionados"}</b>
          <button type="button" className="btn btn-ghost !py-1 !text-xs" onClick={() => router.push(`/app/c/${[...sel][0]}`)}>Editar el primero</button>
          <button type="button" className="btn btn-ghost !py-1 !text-xs" onClick={async () => { await supabase.from("clips").update({ editorial_state: "aprobado" }).in("id", [...sel]); setSel(new Set()); load(); }}>Aprobar</button>
          <button type="button" className="btn btn-ghost !py-1 !text-xs" onClick={async () => { await supabase.from("clips").update({ discarded: true }).in("id", [...sel]); setSel(new Set()); load(); }}>Descartar</button>
          <button type="button" className="btn btn-ghost !py-1 !text-xs" onClick={() => setSel(new Set())}>Quitar selección</button>
        </div>
      )}

      {visible.length === 0 ? <p className="card mt-4 border-dashed p-6 text-sm text-[var(--muted)]">{rows.length ? "Ningún clip coincide con la búsqueda." : "Todavía no hay clips. Aparecerán aquí en cuanto estén listos."}</p> : (
      <>{open != null && pclips[open] && src && (<div id="inline-player" className="card mt-4 p-4">
        <PreviewPlayer clips={pclips} index={open} onIndex={(i) => openClip(i)} onClose={() => setOpen(null)} proxyUrl={proxy} src={{ w: src.width ?? 1920, h: src.height ?? 1080 }} words={words}
          onEdit={(id) => router.push(`/app/c/${id}`)} onExport={async (id) => { const c = rows.find((x) => x.id === id); if (!c) return; const r = await requestClipExport(await token(), id, c.current_version); if (r.ok) router.push("/app/exports"); else window.alert(r.message); }} />
      </div>)}
        <ul className={view === "grid" ? "mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" : "mt-4 space-y-2"}>
          {visible.map((r, i) => { const c = cand(r), score = c?.scores?.overall, d = c ? Math.round((c.end_ms - c.start_ms) / 1000) : 0;
            return (
              <li key={r.id} className={view === "grid" ? "" : "card flex items-center gap-3 p-2"}>
                <div className={view === "grid" ? "card overflow-hidden" : "w-20 shrink-0 overflow-hidden rounded-lg"}>
                  <button type="button" onClick={() => openClip(i)} className="relative block w-full bg-[var(--ink)]" style={{ aspectRatio: "9 / 16" }} aria-label={`Ver «${r.title}» aquí mismo`}>
                    {thumbs[r.id] ? <img src={thumbs[r.id]} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center p-2 text-center text-xs text-white/70">{r.technical_state === "preparando" ? "Preparando…" : r.title}</span>}
                    <span className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold text-white tnum shadow" style={{ background: "var(--grad)" }}>{score != null ? score : "–"}</span>
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white tnum">{mmss(d)}</span>
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[var(--ink)] shadow">▶ Ver</span>
                  </button>
                  {view === "grid" && <div className="space-y-1 p-2 text-xs"><div className="line-clamp-2 font-medium">{r.title}</div>
                    <div className="flex items-center justify-between text-[var(--muted)]"><span>{c ? mmss(c.start_ms / 1000) : ""}</span><span>{r.editorial_state}</span></div></div>}
                </div>
                <div className={view === "grid" ? "mt-1 flex items-center gap-2 px-1 text-xs" : "flex flex-1 items-center gap-3 text-sm"}>
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Seleccionar «${r.title}»`} />
                  {view === "list" && <span className="min-w-0 flex-1 truncate">{r.title}</span>}
                  <Link href={`/app/c/${r.id}`} className="font-semibold text-[var(--accent-ink)]">Editar</Link>
                  <button type="button" className="text-[var(--muted)] hover:text-[var(--ink)]" title="Duplicar el clip para probar otra versión" onClick={async () => { const { error } = await supabase.rpc("duplicate_clip", { p_clip: r.id }); if (error) alert("No se pudo duplicar."); else load(); }}>Duplicar</button>
                  <button type="button" className="underline" onClick={async () => { await supabase.from("clips").update({ favorite: !r.favorite }).eq("id", r.id); load(); }} aria-pressed={r.favorite}>{r.favorite ? "★" : "☆"}</button>
                  <button type="button" aria-pressed={r.feedback === "like"} aria-label="Me gusta" title="Me gusta: lo tendré en cuenta en la próxima generación" onClick={() => feedback(r.id, r.feedback === "like" ? null : "like")} className={r.feedback === "like" ? "font-semibold" : "opacity-60 hover:opacity-100"}>👍</button>
                  <button type="button" aria-label="No me gusta" title="No me gusta: se oculta y evitaré momentos parecidos" onClick={() => { if (confirm("¿No te gusta este clip? Se ocultará y la próxima generación evitará momentos parecidos.")) void feedback(r.id, "dislike"); }} className="opacity-60 hover:opacity-100">👎</button>
                </div>
              </li>); })}
        </ul></>
      )}

    </section>
  );
}
