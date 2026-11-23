"use client";
// Editor de vídeo avanzado: visor, recursos, propiedades del elemento seleccionado y línea de tiempo multipista.
// Fuentes públicas: P1 (capas, medios propios, textos, tamaños, exportación), P3 (dividir, ajustar entre clips, fill/fit), P7 (todo en el navegador).
// Guardado automático con versión (save_editor_project); la exportación se graba en el navegador con el mismo dibujo que la vista previa.
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addMedia, addText, splitAt, removeItem, trimItem, reorder, updateText, validateTimeline, timelineDuration, TL_ASPECTS, type TimelineDoc, type TlAspect, type VideoItem, type AudioItem, type TextItem, type MediaRef } from "@rafaga/composition";
import Icon from "../../../../components/Icon";
import { supabase } from "../../../../lib/supabase";
import { loadProject, saveProject, resolveMedia, type EditorProject } from "../../../../lib/editorstore";
import { TimelinePlayer, pickRecorderMime } from "../../../../lib/timelineplayer";
import CollectionsPicker, { useCollections } from "../../../../components/Collections";

type Save = "idle" | "saving" | "saved" | "error" | "conflict";
type Asset = { ref: MediaRef; label: string; kind: "video" | "image" | "audio" };
const PX = 60;   // píxeles por segundo con zoom 1
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const uid = () => Math.random().toString(36).slice(2, 9);
const QUALITY = [["Alta (resolución completa)", 1], ["Media (2/3)", 2 / 3], ["Rápida (1/2)", 0.5]] as const;

export default function EditorAvanzado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [proj, setProj] = useState<EditorProject | null>(null), [doc, setDoc] = useState<TimelineDoc | null>(null), [aspect, setAspect] = useState<TlAspect>("9:16"), [name, setName] = useState("");
  const [save, setSave] = useState<Save>("idle"), [sel, setSel] = useState<string | null>(null), [t, setT] = useState(0), [playing, setPlaying] = useState(false), [zoom, setZoom] = useState(1), [msg, setMsg] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]), [tab, setTab] = useState<"medios" | "canciones">("medios"), [panels, setPanels] = useState({ left: true, right: true });
  const [exp, setExp] = useState<{ open: boolean; q: number; progress: number; running: boolean; err?: string }>({ open: false, q: 1, progress: 0, running: false });
  const canvas = useRef<HTMLCanvasElement>(null), player = useRef<TimelinePlayer | null>(null), docRef = useRef<TimelineDoc | null>(null), aspectRef = useRef<TlAspect>("9:16");
  const version = useRef(1), hist = useRef<{ past: TimelineDoc[]; future: TimelineDoc[] }>({ past: [], future: [] }), first = useRef(true), abort = useRef<AbortController | null>(null);
  const { cols, reload: reloadCols } = useCollections();
  docRef.current = doc; aspectRef.current = aspect;

  useEffect(() => { (async () => { const p = await loadProject(id); if (!p) return setMsg("No encontramos este proyecto. Puede que se haya borrado."); setProj(p); setDoc(p.doc); setAspect(p.aspect); setName(p.name); version.current = p.version; })(); }, [id]);
  useEffect(() => { (async () => {
    const [m, s] = await Promise.all([supabase.from("media_items").select("id,kind,name,duration_ms").order("created_at", { ascending: false }).limit(100), supabase.from("songs").select("id,title,duration_ms,status").eq("status", "ready").order("created_at", { ascending: false }).limit(50)]);
    setAssets([
      ...((m.data ?? []) as { id: string; kind: string; name: string; duration_ms: number | null }[]).map((x) => ({ ref: { kind: "media_item" as const, id: x.id, name: x.name, media: x.kind === "photo" ? "image" as const : "video" as const, ...(x.duration_ms ? { duration: x.duration_ms / 1000 } : {}) }, label: x.name, kind: (x.kind === "photo" ? "image" : "video") as Asset["kind"] })),
      ...((s.data ?? []) as { id: string; title: string; duration_ms: number | null }[]).map((x) => ({ ref: { kind: "song" as const, id: x.id, name: x.title, media: "audio" as const, ...(x.duration_ms ? { duration: x.duration_ms / 1000 } : {}) }, label: x.title, kind: "audio" as Asset["kind"] })),
    ]);
  })(); }, [cols]);

  // Reproductor: un solo dibujo para vista previa y exportación.
  useEffect(() => {
    if (!canvas.current || !doc || player.current) return;
    const p = new TimelinePlayer(canvas.current, () => docRef.current!, () => aspectRef.current, resolveMedia, 0.4); player.current = p;
    p.onTime = setT; p.onEnd = () => setPlaying(false); void p.seek(0);
    return () => { p.dispose(); player.current = null; };
  }, [!!doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (player.current) { player.current.fit(); void player.current.seek(player.current.time); } }, [aspect]);
  useEffect(() => { if (player.current && doc && !player.current.playing) void player.current.seek(Math.min(player.current.time, timelineDuration(doc))); }, [doc]);

  // Guardado automático con versión.
  useEffect(() => {
    if (!doc || !proj) return; if (first.current) { first.current = false; return; }
    setSave("saving");
    const h = setTimeout(async () => {
      const r = await saveProject(id, version.current, { doc, aspect, name });
      if (r.ok) { version.current = r.version; setSave("saved"); } else setSave(r.conflict ? "conflict" : "error");
    }, 900);
    return () => clearTimeout(h);
  }, [doc, aspect, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback((f: (d: TimelineDoc) => TimelineDoc) => setDoc((d) => { if (!d) return d; const n = validateTimeline(f(d)); hist.current.past.push(d); hist.current.future = []; if (hist.current.past.length > 100) hist.current.past.shift(); return n; }), []);
  const undo = () => setDoc((d) => { const p = hist.current.past.pop(); if (!p || !d) return d; hist.current.future.push(d); return p; });
  const redo = () => setDoc((d) => { const n = hist.current.future.pop(); if (!n || !d) return d; hist.current.past.push(d); return n; });

  const selected = useMemo(() => { if (!doc || !sel) return null; for (const tr of doc.tracks) { const it = (tr.items as (VideoItem | AudioItem | TextItem)[]).find((x) => x.id === sel); if (it) return { tr, it }; } return null; }, [doc, sel]);
  const dur = doc ? timelineDuration(doc) : 0;

  const toggle = async () => { const p = player.current; if (!p) return; if (p.playing) { p.pause(); setPlaying(false); } else { setPlaying(true); await p.play(p.time); } };
  const seek = (s: number) => { player.current?.pause(); setPlaying(false); void player.current?.seek(s); };
  const split = () => { if (sel) apply((d) => splitAt(d, sel, t, uid())); };
  const del = () => { if (sel) { apply((d) => removeItem(d, sel)); setSel(null); } };
  async function addAsset(a: Asset) {
    let d = a.ref.duration ?? 0;
    if (!d && a.kind === "video") d = await new Promise<number>((ok) => { resolveMedia(a.ref).then((u) => { const v = document.createElement("video"); v.preload = "metadata"; v.src = u; v.onloadedmetadata = () => ok(v.duration || 5); v.onerror = () => ok(5); }).catch(() => ok(5)); });
    const ref = { ...a.ref, duration: d || (a.kind === "image" ? 3 : 5) };
    apply((x) => addMedia(x, a.kind === "audio" ? "audio" : "video", ref, { itemId: uid(), out: ref.duration }));
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key === " ") { e.preventDefault(); void toggle(); } else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) split();
      else if (e.key === "Delete" || e.key === "Backspace") del();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key === "ArrowLeft") seek(Math.max(0, t - (e.shiftKey ? 1 : 1 / 30))); else if (e.key === "ArrowRight") seek(Math.min(dur, t + (e.shiftKey ? 1 : 1 / 30)));
    };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  });

  async function doExport() {
    const p = player.current; if (!p || exp.running) return; abort.current = new AbortController();
    setExp((e) => ({ ...e, running: true, progress: 0, err: undefined }));
    try {
      const r = await p.exportFile({ scale: exp.q, onProgress: (x) => setExp((e) => ({ ...e, progress: x })), signal: abort.current.signal });
      const a = document.createElement("a"); a.href = URL.createObjectURL(r.blob); a.download = `${(name || "proyecto").replace(/[\\/:*?"<>|]/g, "").slice(0, 80)}.${r.ext}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setExp((e) => ({ ...e, running: false, progress: 1, open: false })); setMsg(`Vídeo exportado (${r.ext.toUpperCase()}, ${r.seconds.toFixed(1)} s). Se ha guardado en tu carpeta de descargas.`);
    } catch (e) { setExp((x) => ({ ...x, running: false, err: (e as Error).message === "cancelado" ? "Exportación cancelada. El proyecto sigue intacto." : `No se pudo exportar: ${(e as Error).message}` })); }
  }

  if (msg && !proj) return <main className="mx-auto max-w-3xl p-6"><p role="alert" className="card p-4">{msg} <Link href="/app/avanzado" className="underline">Volver a proyectos</Link></p></main>;
  if (!proj || !doc) return <main className="mx-auto max-w-6xl p-6"><div className="skeleton h-72" aria-busy="true" /></main>;
  const saveLabel = { idle: "", saving: "Guardando…", saved: "Guardado", error: "No se pudo guardar", conflict: "Este proyecto se editó en otra pestaña" }[save];
  const A = TL_ASPECTS[aspect], total = Math.max(dur, 10) + 2, W = total * PX * zoom;
  const fld = "w-24 rounded-lg border hairline bg-white px-2 py-1 text-sm tnum";

  return (
    <main className="mx-auto max-w-[1500px] px-3 pb-10 pt-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/app/avanzado" className="text-sm text-[var(--muted)]">← Proyectos</Link>
        <input aria-label="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold hover:border-[var(--border)] focus:border-[var(--accent)]" />
        <label className="text-sm">Formato <select value={aspect} onChange={(e) => setAspect(e.target.value as TlAspect)} className="rounded-lg border hairline px-2 py-1">{(Object.keys(TL_ASPECTS) as TlAspect[]).map((a) => <option key={a}>{a}</option>)}</select></label>
        <span role="status" aria-live="polite" className={`text-sm ${save === "error" || save === "conflict" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{saveLabel}</span>
        <button type="button" className="btn btn-ghost !min-h-9" onClick={undo} disabled={!hist.current.past.length}>Deshacer</button>
        <button type="button" className="btn btn-ghost !min-h-9" onClick={redo} disabled={!hist.current.future.length}>Rehacer</button>
        <button type="button" className="btn btn-primary !min-h-9" disabled={!dur} onClick={() => setExp((e) => ({ ...e, open: true, err: undefined }))}><Icon n="download" className="h-4 w-4" />Exportar</button>
      </div>
      {save === "conflict" && <p role="alert" className="card mb-3 p-3 text-sm">Otra pestaña guardó antes. <button className="underline" onClick={() => location.reload()}>Recargar para ver la última versión</button> (tus cambios de aquí no se han perdido hasta que recargues).</p>}
      {msg && <p role="status" className="card mb-3 p-3 text-sm">{msg}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,280px)]">
        <aside aria-label="Recursos" className={`card space-y-3 p-3 text-sm ${panels.left ? "" : "hidden lg:block lg:opacity-50"}`}>
          <div className="flex items-center justify-between"><h2 className="font-semibold">Recursos</h2><button type="button" className="text-xs underline lg:hidden" onClick={() => setPanels((p) => ({ ...p, left: false }))}>Ocultar</button></div>
          <div role="tablist" aria-label="Tipo de recurso" className="flex gap-1">{([["medios", "Mis medios"], ["canciones", "Canciones"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className="chip" onClick={() => setTab(k)}>{l}</button>)}</div>
          <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Lista de recursos">
            {assets.filter((a) => (tab === "canciones" ? a.kind === "audio" : a.kind !== "audio")).map((a) => (
              <li key={a.ref.kind + a.ref.id}><button type="button" onClick={() => void addAsset(a)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--hover)]"><Icon n={a.kind === "audio" ? "music" : a.kind === "image" ? "grid" : "film"} className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{a.label}</span><span className="text-xs text-[var(--muted)]">Añadir</span></button></li>))}
            {!assets.some((a) => (tab === "canciones" ? a.kind === "audio" : a.kind !== "audio")) && <li className="text-[var(--muted)]">{tab === "canciones" ? "No hay canciones listas. Súbelas en el Editor de vídeos." : "No hay medios. Sube vídeos o fotos abajo."}</li>}
          </ul>
          <button type="button" className="btn btn-ghost w-full !min-h-9" onClick={() => { const at = addText(doc, { at: t, dur: 3, text: "Tu texto", itemId: uid() }); apply(() => at); }}><Icon n="type" className="h-4 w-4" />Añadir texto aquí</button>
          <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Subir tus vídeos, fotos o audios</summary><div className="mt-2"><CollectionsPicker selected={null} onSelect={() => {}} cols={cols} reload={reloadCols} /></div></details>
        </aside>

        <section aria-label="Visor" className="min-w-0 space-y-2">
          <div className="card grid place-items-center bg-black p-2"><canvas ref={canvas} aria-label="Vista previa del proyecto" className="max-h-[60vh] max-w-full" style={{ aspectRatio: `${A.width}/${A.height}`, width: aspect === "16:9" ? "100%" : "auto", height: aspect === "16:9" ? "auto" : "60vh" }} /></div>
          <div className="card flex flex-wrap items-center gap-2 p-2 text-sm">
            <button type="button" className="btn btn-primary !min-h-9" onClick={() => void toggle()} aria-label={playing ? "Pausar" : "Reproducir"}><Icon n="play" className="h-4 w-4" />{playing ? "Pausar" : "Reproducir"}</button>
            <button type="button" className="btn btn-ghost !min-h-9" onClick={() => seek(0)}>Al inicio</button>
            <span className="tnum" aria-live="off">{clock(t)} / {clock(dur)}</span>
            <button type="button" className="btn btn-ghost !min-h-9" disabled={!sel} onClick={split} title="Dividir el elemento elegido en la posición actual (S)">Dividir</button>
            <button type="button" className="btn btn-ghost !min-h-9" disabled={!sel} onClick={del} title="Quitar el elemento y cerrar el hueco (Supr)">Quitar</button>
            <button type="button" className="btn btn-ghost !min-h-9 lg:hidden" onClick={() => setPanels((p) => ({ left: !p.left, right: p.right }))}>Recursos</button>
          </div>
        </section>

        <aside aria-label="Propiedades" className={`card space-y-3 p-3 text-sm ${panels.right ? "" : "hidden lg:block lg:opacity-50"}`}>
          <h2 className="font-semibold">Propiedades</h2>
          {!selected && <p className="text-[var(--muted)]">Elige un elemento de la línea de tiempo para ver sus ajustes.</p>}
          {selected && selected.tr.kind === "text" && (() => { const x = selected.it as TextItem; return (<div className="space-y-2">
            <label className="block">Texto<textarea aria-label="Texto" className="mt-1 w-full rounded-lg border hairline px-2 py-1" rows={2} value={x.text} onChange={(e) => apply((d) => updateText(d, x.id, { text: e.target.value || " " }))} /></label>
            <div className="flex flex-wrap gap-2"><label>Inicio (s)<input type="number" step={0.1} min={0} aria-label="Inicio del texto" className={`${fld} ml-1`} value={x.at} onChange={(e) => apply((d) => updateText(d, x.id, { at: Number(e.target.value) }))} /></label><label>Duración (s)<input type="number" step={0.1} min={0.1} aria-label="Duración del texto" className={`${fld} ml-1`} value={x.dur} onChange={(e) => apply((d) => updateText(d, x.id, { dur: Number(e.target.value) }))} /></label></div>
            <div className="flex flex-wrap items-center gap-2"><label>Tamaño <select aria-label="Tamaño del texto" value={x.size} onChange={(e) => apply((d) => updateText(d, x.id, { size: e.target.value as TextItem["size"] }))} className="rounded-lg border hairline px-2 py-1"><option value="S">Pequeño</option><option value="M">Mediano</option><option value="L">Grande</option></select></label>
              <label>Color <input type="color" aria-label="Color del texto" value={x.color} onChange={(e) => apply((d) => updateText(d, x.id, { color: e.target.value }))} /></label></div>
            <label className="block">Posición vertical<input type="range" min={0.05} max={0.95} step={0.01} aria-label="Posición vertical" className="w-full" value={x.y} onChange={(e) => apply((d) => updateText(d, x.id, { y: Number(e.target.value) }))} /></label></div>); })()}
          {selected && selected.tr.kind !== "text" && (() => { const x = selected.it as VideoItem | AudioItem; return (<div className="space-y-2">
            <p className="truncate font-medium">{x.src.name ?? x.src.id}</p>
            <div className="flex flex-wrap gap-2"><label>Desde (s)<input type="number" step={0.1} min={0} aria-label="Recorte: desde" className={`${fld} ml-1`} value={x.in} onChange={(e) => apply((d) => trimItem(d, x.id, { in: Number(e.target.value) }))} /></label><label>Hasta (s)<input type="number" step={0.1} min={0} aria-label="Recorte: hasta" className={`${fld} ml-1`} value={x.out} onChange={(e) => apply((d) => trimItem(d, x.id, { out: Number(e.target.value) }))} /></label></div>
            <label className="block">Volumen {Math.round(x.volume * 100)} %<input type="range" min={0} max={2} step={0.05} aria-label="Volumen" className="w-full" value={x.volume} onChange={(e) => apply((d) => ({ ...d, tracks: d.tracks.map((tr) => (tr.kind === "text" ? tr : { ...tr, items: (tr.items as (VideoItem | AudioItem)[]).map((y) => (y.id === x.id ? { ...y, volume: Number(e.target.value) } : y)) } as typeof tr)) }))} /></label>
            {selected.tr.kind === "video" && <><label className="block">Encuadre <select aria-label="Encuadre" value={(x as VideoItem).fit} onChange={(e) => apply((d) => ({ ...d, tracks: d.tracks.map((tr) => (tr.kind === "video" ? { ...tr, items: tr.items.map((y) => (y.id === x.id ? { ...y, fit: e.target.value as "fill" | "fit" } : y)) } : tr)) }))} className="rounded-lg border hairline px-2 py-1"><option value="fill">Rellenar (recorta los lados)</option><option value="fit">Ajustar (barras, sin recortar)</option></select></label>
              <div className="flex gap-2"><button type="button" className="btn btn-ghost !min-h-9" onClick={() => apply((d) => reorder(d, x.id, Math.max(0, (d.tracks.find((tr) => tr.kind === "video")!.items as VideoItem[]).sort((a, b) => a.at - b.at).findIndex((y) => y.id === x.id) - 1)))}>← Antes</button><button type="button" className="btn btn-ghost !min-h-9" onClick={() => apply((d) => reorder(d, x.id, (d.tracks.find((tr) => tr.kind === "video")!.items as VideoItem[]).sort((a, b) => a.at - b.at).findIndex((y) => y.id === x.id) + 1))}>Después →</button></div></>}</div>); })()}
        </aside>
      </div>

      <section aria-label="Línea de tiempo" className="card mt-3 p-2">
        <div className="mb-2 flex items-center gap-3 text-sm"><h2 className="font-semibold">Línea de tiempo</h2><label className="flex items-center gap-2 text-xs">Zoom<input type="range" min={0.3} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom de la línea de tiempo" /></label></div>
        <div className="overflow-x-auto"><div className="relative" style={{ width: W + 80, minHeight: 40 + doc.tracks.length * 44 }}>
          <div className="relative ml-[72px] h-6 cursor-pointer border-b hairline" style={{ width: W }} role="slider" aria-label="Posición" aria-valuemin={0} aria-valuemax={Math.round(dur * 10) / 10} aria-valuenow={Math.round(t * 10) / 10} tabIndex={0}
            onClick={(e) => seek(Math.max(0, Math.min(dur, (e.clientX - e.currentTarget.getBoundingClientRect().left) / (PX * zoom))))}>
            {Array.from({ length: Math.ceil(total) }, (_, i) => <span key={i} className="absolute top-0 border-l hairline pl-1 text-[10px] text-[var(--muted)]" style={{ left: i * PX * zoom }}>{i}s</span>)}</div>
          {doc.tracks.map((tr) => (
            <div key={tr.id} className="mt-1 flex h-10 items-center"><span className="w-[72px] shrink-0 pr-2 text-right text-xs text-[var(--muted)]">{tr.kind === "video" ? "Vídeo" : tr.kind === "audio" ? "Sonido" : "Texto"}</span>
              <div className="relative h-10 rounded bg-[var(--surface)]" style={{ width: W }}>
                {(tr.items as (VideoItem | AudioItem | TextItem)[]).map((it) => { const w = ("dur" in it ? it.dur : it.out - it.in) * PX * zoom, label = "text" in it ? it.text : it.src.name ?? it.src.id; return (
                  <button key={it.id} type="button" onClick={() => setSel(it.id)} aria-pressed={sel === it.id} aria-label={`${tr.kind === "text" ? "Texto" : tr.kind === "video" ? "Plano" : "Audio"} ${label}, de ${it.at.toFixed(1)} a ${(it.at + ("dur" in it ? it.dur : it.out - it.in)).toFixed(1)} segundos`}
                    className={`absolute top-1 h-8 overflow-hidden whitespace-nowrap rounded px-1.5 text-left text-xs ${sel === it.id ? "ring-2 ring-[var(--accent)]" : ""} ${tr.kind === "video" ? "bg-[#cfd8ff]" : tr.kind === "audio" ? "bg-[#c9f0dd]" : "bg-[#ffe3b8]"}`} style={{ left: it.at * PX * zoom, width: Math.max(8, w) }}>{label}</button>); })}</div></div>))}
          <div aria-hidden className="pointer-events-none absolute top-0 w-px bg-[var(--accent)]" style={{ left: 72 + t * PX * zoom, height: 30 + doc.tracks.length * 44 }} />
        </div></div>
        {!dur && <p className="p-4 text-center text-sm text-[var(--muted)]">La línea de tiempo está vacía. Añade un vídeo, una foto o un texto desde Recursos.</p>}
      </section>

      {exp.open && (
        <div role="dialog" aria-modal="true" aria-label="Exportar vídeo" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="card w-full max-w-md space-y-3 bg-white p-5">
            <h2 className="text-lg">Exportar vídeo</h2>
            <p className="text-sm text-[var(--muted)]">El vídeo se crea en tu navegador, sin subirlo a ningún servidor, y dura lo que dura el proyecto ({clock(dur)}). Formato {pickRecorderMime().ext.toUpperCase()}. Mantén esta pestaña abierta.</p>
            <label className="block text-sm">Calidad<select value={exp.q} onChange={(e) => setExp((x) => ({ ...x, q: Number(e.target.value) }))} disabled={exp.running} className="ml-2 rounded-lg border hairline px-2 py-1">{QUALITY.map(([l, v]) => <option key={l} value={v}>{l}</option>)}</select></label>
            <p className="text-xs text-[var(--muted)]">{A.width}×{A.height} px en calidad alta · {aspect}</p>
            {exp.running && <div><div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" aria-valuenow={Math.round(exp.progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-[var(--accent)]" style={{ width: `${exp.progress * 100}%` }} /></div><p className="tnum mt-1 text-xs">{Math.round(exp.progress * 100)} %</p></div>}
            {exp.err && <p role="alert" className="text-sm text-[var(--danger)]">{exp.err}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => { if (exp.running) abort.current?.abort(); else setExp((x) => ({ ...x, open: false })); }}>{exp.running ? "Cancelar" : "Cerrar"}</button>{!exp.running && <button type="button" className="btn btn-primary" onClick={() => void doExport()}>Exportar</button>}</div>
          </div>
        </div>)}
    </main>
  );
}
