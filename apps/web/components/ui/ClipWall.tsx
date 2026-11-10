"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../Icon";
import { supabase } from "../../lib/supabase";
import { validateStyle, type SubtitleStyle } from "@rafaga/composition";
import { ClipCard, type WallClip } from "./ClipCard";
import { pieceStatus, STATUS_LABEL, type PieceStatus } from "./status";

type Filter = "all" | "to_review" | "approved" | "changes" | "failed" | "fav";
type Sort = "score" | "time" | "title" | "recent";
type View = "grid" | "list";
const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "pieza";

/**
 * Muro visual de resultados: miniaturas grandes, filtros con contadores reales, selección persistente al filtrar,
 * barra de acciones (comparar, aprobar, añadir a entrega, descargar) y un único vídeo de vista previa a la vez.
 */
export default function ClipWall({ projectId, projectName, clips, onFavorite, onDiscard, showScore = true }: {
  projectId: string; projectName: string; clips: WallClip[]; onFavorite: (id: string, v: boolean) => Promise<void> | void; onDiscard: (id: string) => Promise<void> | void; showScore?: boolean;
}) {
  const router = useRouter();
  const key = `rafaga.wall.${projectId}`;
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(showScore ? "score" : "recent");
  const [view, setView] = useState<View>("grid");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [deliver, setDeliver] = useState(false);
  const [styleDlg, setStyleDlg] = useState(false);
  const [kits, setKits] = useState<{ id: string; name: string; version: number; subtitle_style: SubtitleStyle }[] | null>(null);
  const [kitId, setKitId] = useState("");
  const [dName, setDName] = useState(""), [dDesc, setDDesc] = useState("");
  const last = useRef<string | null>(null);

  useEffect(() => { try { const s = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (s) { setFilter(s.filter ?? "all"); setSort(s.sort ?? "score"); setView(s.view ?? "grid"); setQ(s.q ?? ""); if (Array.isArray(s.sel)) setSel(new Set(s.sel)); } } catch {} }, [key]);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify({ filter, sort, view, q, sel: [...sel] })); } catch {} }, [key, filter, sort, view, q, sel]);
  useEffect(() => { const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduce) setPreview(null); }, [preview]);

  const withStatus = useMemo(() => clips.map((c) => ({ c, st: pieceStatus(c).status as PieceStatus })), [clips]);
  const counts = useMemo(() => ({
    all: clips.length, to_review: withStatus.filter((x) => x.st === "to_review").length, approved: withStatus.filter((x) => x.st === "approved").length,
    changes: withStatus.filter((x) => x.st === "changes").length, failed: withStatus.filter((x) => x.st === "failed").length, fav: clips.filter((c) => c.favorite).length,
  }), [clips, withStatus]);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const l = withStatus.filter(({ c, st }) => (filter === "all" || (filter === "fav" ? c.favorite : st === filter)) && (!ql || c.title.toLowerCase().includes(ql)));
    const by: Record<Sort, (a: WallClip, b: WallClip) => number> = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1), recent: (a, b) => b.created_at.localeCompare(a.created_at), time: (a, b) => a.created_at.localeCompare(b.created_at), title: (a, b) => a.title.localeCompare(b.title, "es"),
    };
    return l.map((x) => x.c).sort(by[sort]);
  }, [withStatus, filter, q, sort]);
  const byId = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const selected = useMemo(() => [...sel].map((id) => byId.get(id)).filter((x): x is WallClip => !!x), [sel, byId]);
  // Limpia de la selección clips que ya no existen (descartados)
  useEffect(() => { setSel((s) => { const n = new Set([...s].filter((id) => byId.has(id))); return n.size === s.size ? s : n; }); }, [byId]);

  const onSelect = useCallback((id: string, shift: boolean) => {
    setSel((s) => {
      const n = new Set(s);
      if (shift && last.current) { const ids = shown.map((c) => c.id); const a = ids.indexOf(last.current), b = ids.indexOf(id); if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; for (const x of ids.slice(lo, hi + 1)) n.add(x); last.current = id; return n; } }
      if (n.has(id)) n.delete(id); else n.add(id);
      last.current = id; return n;
    });
  }, [shown]);

  async function approve() {
    setBusy("Aprobando…"); setMsg(null); let ok = 0; const errs: string[] = [];
    for (const c of selected) { const { error } = await supabase.rpc("set_review", { p_clip: c.id, p_status: "approved", p_version: c.current_version, p_note: null }); if (error) errs.push(`«${c.title}»: ${error.message}`); else ok++; }
    setBusy(null); setMsg(`${ok} aprobada${ok === 1 ? "" : "s"} (versión actual).${errs.length ? ` ${errs.length} con error: ${errs[0]}` : ""}`); router.refresh(); window.dispatchEvent(new Event("rafaga:reload-clips"));
  }
  async function download() {
    const ready = selected.filter((c) => c.path);
    if (!ready.length) return setMsg("Ninguna de las piezas seleccionadas tiene todavía un MP4 listo para descargar.");
    setBusy(`Descargando ${ready.length}…`); setMsg("Si el navegador pide permiso para varias descargas, acéptalo.");
    const rows: Record<string, string | number>[] = [];
    for (const [i, c] of ready.entries()) {
      const name = `${safe(projectName)}_${String(i + 1).padStart(2, "0")}-${safe(c.title)}_${(c.ratio ?? "9x16").replace(":", "x")}_v${c.version}.mp4`;
      const { data } = await supabase.storage.from("renders").createSignedUrl(c.path!, 300, { download: name });
      if (data?.signedUrl) { const a = document.createElement("a"); a.href = data.signedUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
      const st = pieceStatus(c).status;
      rows.push({ titulo: c.title, archivo: name, version: c.version, formato: c.ratio ?? "", duracion_s: c.durMs ? +(c.durMs / 1000).toFixed(1) : "", estado: STATUS_LABEL(st), id_interno: c.id });
      await new Promise((r) => setTimeout(r, 900));
    }
    const manifest = new Blob([JSON.stringify({ proyecto: projectName, generado: new Date().toISOString(), piezas: rows }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(manifest); a.download = `${safe(projectName)}_manifiesto.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setBusy(null); setMsg(`${ready.length} descarga${ready.length === 1 ? "" : "s"} y manifiesto.`);
  }
  async function openStyle() {
    setStyleDlg(true); setKitId("");
    const { data } = await supabase.from("brand_kits").select("id,name,version,subtitle_style").is("archived_at", null).not("subtitle_style", "is", null).order("created_at");
    setKits((data ?? []) as typeof kits);
  }
  /** Aplica el estilo de subtítulos del kit SOLO a las piezas seleccionadas: versión nueva de cada clip (el resto no cambia) y se puede volver a la anterior desde el editor. */
  async function applyStyle() {
    const kit = kits?.find((k) => k.id === kitId); if (!kit) return;
    setBusy("Aplicando estilo…"); setMsg(null); let ok = 0; const errs: string[] = [];
    const { data: u } = await supabase.auth.getSession();
    for (const c of selected) {
      const { data: cur } = await supabase.from("clips").select("workspace_id,current_version").eq("id", c.id).single();
      const { data: v } = cur ? await supabase.from("clip_versions").select("composition").eq("clip_id", c.id).eq("version", cur.current_version).single() : { data: null };
      if (!cur || !v) { errs.push(c.title); continue; }
      const to = cur.current_version + 1;
      const ins = await supabase.from("clip_versions").insert({ clip_id: c.id, workspace_id: cur.workspace_id, version: to, composition: { ...(v.composition as object), style: validateStyle(kit.subtitle_style), preset: `kit:${kit.name}` }, created_by: u.session?.user.id });
      if (ins.error) { errs.push(c.title); continue; }
      const up = await supabase.from("clips").update({ current_version: to }).eq("id", c.id).eq("current_version", cur.current_version).select("id");
      if (up.error || !up.data?.length) errs.push(c.title); else ok++;
    }
    setBusy(null); setStyleDlg(false);
    setMsg(`Estilo «${kit.name}» aplicado a ${ok} clip${ok === 1 ? "" : "s"} (versión nueva de cada uno; los demás no cambian).${errs.length ? ` ${errs.length} no se pudieron actualizar (cambiaron mientras tanto).` : ""} Las aprobaciones anteriores ya no valen para la versión nueva.`);
    window.dispatchEvent(new Event("rafaga:reload-clips"));
  }
  async function createDelivery(e: React.FormEvent) {
    e.preventDefault();
    const items = selected.map((c) => ({ clip_id: c.id, version: c.current_version }));
    setBusy("Creando entrega…");
    const { data, error } = await supabase.rpc("create_delivery", { p_project: projectId, p_name: dName || projectName, p_description: dDesc, p_items: items });
    setBusy(null); if (error) return setMsg(error.message);
    router.push(`/app/entregas/${data as string}`);
  }

  const FILTERS: [Filter, string][] = [["all", "Todos"], ["to_review", "Por revisar"], ["approved", "Aprobados"], ["changes", "Cambios solicitados"], ...(counts.failed ? [["failed", "Fallidos"] as [Filter, string]] : []), ["fav", "Favoritos"]];
  const canCompare = selected.length === 2;

  return (
    <section aria-labelledby="wall-h" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 id="wall-h" className="text-2xl tracking-tight">Resultados</h2><p className="mt-1 text-sm text-[var(--muted)]">{clips.length} pieza{clips.length === 1 ? "" : "s"} · {counts.approved} aprobada{counts.approved === 1 ? "" : "s"} · {counts.to_review} por revisar</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="wall-q">Buscar por título</label>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><input id="wall-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar título" className="w-36 bg-transparent text-sm outline-none sm:w-48" /></div>
          <label className="sr-only" htmlFor="wall-s">Ordenar</label>
          <select id="wall-s" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm">{showScore && <option value="score">Mayor encaje primero</option>}<option value="recent">Más recientes</option><option value="time">Más antiguos</option><option value="title">Título A–Z</option></select>
          <div role="group" aria-label="Vista" className="inline-flex rounded-xl border border-[var(--border)] bg-white p-0.5">{([["grid", "Galería"], ["list", "Lista"]] as const).map(([k, l]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1.5 text-sm ${view === k ? "bg-[#111] text-white" : "text-[var(--muted)]"}`}>{l}</button>)}</div>
        </div>
      </div>

      <div role="tablist" aria-label="Filtrar resultados" className="mt-5 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className="chip shrink-0">{l}<span className="tnum text-xs opacity-70">{counts[k]}</span></button>)}
      </div>

      <div className="min-h-6 pt-2 text-sm" role="status" aria-live="polite">{busy ?? msg}</div>

      {!shown.length ? (
        <div className="mt-4 rounded-2xl bg-[var(--surface)] p-10 text-center text-sm text-[var(--muted)]">{q || filter !== "all" ? "Ninguna pieza coincide con este filtro." : "Aún no hay resultados."}{(q || filter !== "all") && <button className="ml-2 underline" onClick={() => { setQ(""); setFilter("all"); }}>Quitar filtros</button>}</div>
      ) : view === "grid" ? (
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((c) => <ClipCard key={c.id} c={c} selected={sel.has(c.id)} previewing={preview === c.id} onSelect={onSelect} onPreview={setPreview} />)}
        </ul>
      ) : (
        <ul className="mt-4 space-y-1">{shown.map((c) => <ClipCard key={c.id} c={c} selected={sel.has(c.id)} previewing={false} onSelect={onSelect} onPreview={setPreview} view="list" />)}</ul>
      )}

      {sel.size > 0 && (
        <div role="region" aria-label="Acciones de selección" className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-3xl rounded-2xl bg-[#111] p-2.5 text-white shadow-xl md:bottom-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum px-2 text-sm font-medium">{sel.size} clip{sel.size === 1 ? "" : "s"} seleccionado{sel.size === 1 ? "" : "s"}</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              <button disabled={!canCompare} title={canCompare ? "" : "Selecciona exactamente 2 para comparar"} onClick={() => router.push(`/app/p/${projectId}/comparar?a=${selected[0].id}&b=${selected[1].id}`)} className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-40">Comparar</button>
              <button onClick={openStyle} className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20">Aplicar estilo</button>
              <button onClick={approve} disabled={!!busy} className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-40">Aprobar</button>
              <button onClick={() => { setDName(projectName); setDeliver(true); }} className="rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20">Añadir a entrega</button>
              <button onClick={download} disabled={!!busy} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-[#111] disabled:opacity-40">Descargar</button>
              <details className="relative"><summary className="cursor-pointer list-none rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20">Más</summary>
                <div className="absolute bottom-full right-0 mb-2 w-48 rounded-xl bg-white p-1 text-sm text-[#111] shadow-xl">
                  <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]" onClick={async () => { for (const c of selected) await onFavorite(c.id, !c.favorite); }}>Alternar favorito</button>
                  <button className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]" onClick={async () => { if (confirm(`¿Descartar ${selected.length} clip${selected.length === 1 ? "" : "s"}? Dejan de aparecer en el proyecto (los exports hechos se conservan).`)) { for (const c of selected) await onDiscard(c.id); setSel(new Set()); } }}>Descartar…</button>
                </div></details>
              <button onClick={() => setSel(new Set())} aria-label="Limpiar selección" className="rounded-xl px-2 py-2 hover:bg-white/10"><Icon n="x" className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {styleDlg && (
        <div role="dialog" aria-modal="true" aria-labelledby="st-h" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === "Escape" && setStyleDlg(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="st-h" className="text-xl tracking-tight">Aplicar estilo a {selected.length} clip{selected.length === 1 ? "" : "s"}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Cambia solo los subtítulos de la selección. Cada clip recibe una versión nueva; el resto de piezas no se toca.</p>
            {!kits ? <div className="skeleton mt-4 h-10" /> : !kits.length ? <p className="mt-4 text-sm">Aún no tienes kits con estilo de subtítulos. Crea uno en Brand kit (puedes empezar desde una plantilla).</p> : (
              <label className="mt-4 block text-sm">Estilo<select value={kitId} onChange={(e) => setKitId(e.target.value)} autoFocus className="input mt-1"><option value="">Elige un kit…</option>{kits.map((k) => <option key={k.id} value={k.id}>{k.name} · v{k.version} · {k.subtitle_style.fontName}</option>)}</select></label>)}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setStyleDlg(false)} className="btn btn-ghost">Cancelar</button><button onClick={applyStyle} disabled={!kitId || !!busy} className="btn btn-primary">Aplicar</button></div>
          </div>
        </div>
      )}

      {deliver && (
        <div role="dialog" aria-modal="true" aria-labelledby="dl-h" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onKeyDown={(e) => e.key === "Escape" && setDeliver(false)}>
          <form onSubmit={createDelivery} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="dl-h" className="text-xl tracking-tight">Preparar entrega</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{selected.length} pieza{selected.length === 1 ? "" : "s"} con su versión actual. Los cambios posteriores del clip no alteran esta entrega.</p>
            <label className="mt-4 block text-sm">Nombre<input value={dName} onChange={(e) => setDName(e.target.value)} maxLength={120} required autoFocus className="input mt-1" /></label>
            <label className="mt-3 block text-sm">Descripción (opcional)<textarea value={dDesc} onChange={(e) => setDDesc(e.target.value)} maxLength={1000} rows={3} className="input mt-1 resize-y" /></label>
            {selected.some((c) => pieceStatus(c).status !== "approved") && <p className="mt-3 text-xs text-[var(--muted)]">{selected.filter((c) => pieceStatus(c).status !== "approved").length} pieza(s) aún no están aprobadas; se mostrarán con su estado real.</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeliver(false)} className="btn btn-ghost">Cancelar</button><button className="btn btn-primary" disabled={!!busy}>Crear entrega</button></div>
          </form>
        </div>
      )}
    </section>
  );
}
