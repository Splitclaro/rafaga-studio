"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  activeWordAt, groupWords, editText, splitWord, mergeWithNext, setTiming, offsetAll, styleForRatio, toSRT, toVTT, toTranscript,
  PRESETS, RATIO_SIZE, type Composition, type Ratio, type SubtitleStyle, type Word,
} from "@rafaga/composition";
import { supabase } from "../../../../lib/supabase";
import { useWorkspaceFonts } from "../../../../lib/fonts";

type Doc = { words: Word[]; style: SubtitleStyle; ratio: Ratio; burn: boolean; preset: string };
type Render = { id: string; clip_version: number; ratio: string; burn_subtitles: boolean; storage_path: string; created_at: string };

export default function ClipEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { fonts } = useWorkspaceFonts();
  const [meta, setMeta] = useState<{ title: string; ws: string; projectId: string; version: number; base: Composition; src: string } | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "conflict" | "error">("saved");
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<"texto" | "estilo" | "exportar">("texto");
  const [renders, setRenders] = useState<Render[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);
  const fg = useRef<HTMLVideoElement>(null), bg = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(1);

  const loadRenders = useCallback(async () => {
    const { data } = await supabase.from("renders").select("id,clip_version,ratio,burn_subtitles,storage_path,created_at").eq("clip_id", id).eq("status", "ready").order("created_at", { ascending: false });
    setRenders((data ?? []) as Render[]);
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data: c, error } = await supabase.from("clips").select("id,title,workspace_id,project_id,current_version").eq("id", id).single();
      if (error || !c) return setErr("Clip no encontrado.");
      const { data: v } = await supabase.from("clip_versions").select("composition").eq("clip_id", id).eq("version", c.current_version).single();
      const { data: p } = await supabase.from("projects").select("source_id").eq("id", c.project_id).single();
      if (!v || !p) return setErr("No se pudo cargar la versión del clip.");
      const comp = v.composition as Composition & { preset?: string };
      const signed = await supabase.storage.from("originals").createSignedUrl(`${c.workspace_id}/${p.source_id}/original`, 3600);
      versionRef.current = c.current_version;
      setMeta({ title: c.title, ws: c.workspace_id, projectId: c.project_id, version: c.current_version, base: comp, src: signed.data?.signedUrl ?? "" });
      setDoc({ words: comp.words, style: comp.style, ratio: comp.ratio, burn: comp.burnSubtitles, preset: comp.preset ?? "Impacto" });
      await loadRenders();
    })();
  }, [id, loadRenders]);

  // ---------- Reproducción sincronizada con el tramo del clip ----------
  const clipLen = meta ? meta.base.endSec - meta.base.startSec : 0;
  useEffect(() => {
    const v = fg.current; if (!v || !meta) return;
    const onTime = () => {
      const rel = v.currentTime - meta.base.startSec;
      if (rel >= clipLen) { v.pause(); setPlaying(false); seek(0); return; }
      setT(Math.max(0, rel));
      if (bg.current && Math.abs(bg.current.currentTime - v.currentTime) > 0.25) bg.current.currentTime = v.currentTime;
    };
    v.addEventListener("timeupdate", onTime);
    let raf = 0; const loop = () => { onTime(); raf = requestAnimationFrame(loop); };
    if (playing) raf = requestAnimationFrame(loop);
    return () => { v.removeEventListener("timeupdate", onTime); cancelAnimationFrame(raf); };
  }, [meta, playing, clipLen]); // eslint-disable-line react-hooks/exhaustive-deps
  function seek(rel: number) {
    if (!meta) return;
    const abs = meta.base.startSec + Math.max(0, Math.min(clipLen, rel));
    if (fg.current) fg.current.currentTime = abs;
    if (bg.current) bg.current.currentTime = abs;
    setT(Math.max(0, Math.min(clipLen, rel)));
  }
  function togglePlay() {
    const v = fg.current; if (!v) return;
    if (v.paused) { if (t >= clipLen - 0.05) seek(0); v.play(); bg.current?.play(); setPlaying(true); } else { v.pause(); bg.current?.pause(); setPlaying(false); }
  }
  useEffect(() => {
    const el = stage.current; if (!el || !doc) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / RATIO_SIZE[doc.ratio].width));
    ro.observe(el); return () => ro.disconnect();
  }, [doc?.ratio, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Edición con historial y autosave ----------
  const change = (fn: (d: Doc) => Doc) => {
    if (!doc) return;
    setPast((p) => [...p.slice(-99), doc]); setFuture([]);
    setDoc(fn(doc)); setSave("dirty");
  };
  const undo = () => { if (!past.length || !doc) return; setFuture((f) => [doc, ...f]); setDoc(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setSave("dirty"); };
  const redo = () => { if (!future.length || !doc) return; setPast((p) => [...p, doc]); setDoc(future[0]); setFuture((f) => f.slice(1)); setSave("dirty"); };

  const persist = useCallback(async (d: Doc): Promise<number | null> => {
    if (!meta) return null;
    setSave("saving");
    const next = versionRef.current + 1;
    const composition: Composition & { preset: string } = { ...meta.base, words: d.words, style: d.style, ratio: d.ratio, burnSubtitles: d.burn, preset: d.preset };
    const { data: s } = await supabase.auth.getSession();
    const ins = await supabase.from("clip_versions").insert({ clip_id: id, workspace_id: meta.ws, version: next, composition, created_by: s.session?.user.id });
    if (ins.error) { setSave(ins.error.code === "23505" ? "conflict" : "error"); setErr(ins.error.code === "23505" ? "Otra sesión guardó este clip. Recarga para ver la última versión." : ins.error.message); return null; }
    const up = await supabase.from("clips").update({ current_version: next }).eq("id", id).eq("current_version", versionRef.current).select("id");
    if (up.error || !up.data?.length) { setSave("conflict"); setErr("Otra sesión guardó este clip. Recarga para ver la última versión."); return null; }
    versionRef.current = next; setMeta((m) => (m ? { ...m, version: next } : m)); setSave("saved");
    return next;
  }, [id, meta]);

  useEffect(() => {
    if (save !== "dirty" || !doc) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { persist(doc); }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [doc, save, persist]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  // ---------- Export ----------
  async function exportMp4() {
    if (!doc || !meta) return;
    let v = versionRef.current;
    if (save !== "saved") { const n = await persist(doc); if (!n) return; v = n; }
    setExporting("Solicitando export…");
    const { data, error } = await supabase.rpc("request_render", { p_clip: id, p_version: v, p_ratio: doc.ratio, p_burn: doc.burn });
    if (error) { setExporting(null); return setErr(error.message); }
    if ((data as { reused?: boolean }).reused) { setExporting("Ya existía este export: listo para descargar."); return loadRenders(); }
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    setExporting("Renderizando en el worker…");
    const jobId = (data as { job_id: string }).job_id;
    const started = Date.now();
    const poll = setInterval(async () => {
      const { data: j } = await supabase.from("jobs").select("status,error_message").eq("id", jobId).single();
      const secs = Math.round((Date.now() - started) / 1000);
      if (j?.status === "done") { clearInterval(poll); setExporting(`Listo en ${secs} s.`); loadRenders(); }
      else if (j?.status === "failed") { clearInterval(poll); setExporting(null); setErr(`El export falló: ${j.error_message}`); }
      else setExporting(`Renderizando en el worker… ${secs} s${j?.status === "queued" ? " (en cola)" : ""}`);
    }, 3000);
  }
  async function download(r: Render) {
    const name = `${(meta?.title ?? "clip").replace(/[^\w\-áéíóúñ ]/gi, "").slice(0, 40)}-v${r.clip_version}-${r.ratio.replace(":", "x")}.mp4`;
    const { data } = await supabase.storage.from("renders").createSignedUrl(r.storage_path, 300, { download: name });
    if (data?.signedUrl) window.location.href = data.signedUrl;
  }
  function saveText(name: string, text: string, type: string) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Render del overlay (mismas reglas que el export) ----------
  const eff = useMemo(() => (doc ? styleForRatio(doc.style, doc.ratio) : null), [doc]);
  const groups = useMemo(() => (doc && eff ? groupWords(doc.words, eff) : []), [doc, eff]);
  if (err && !doc) return <main className="mx-auto max-w-3xl px-4 py-10">{err}</main>;
  if (!doc || !meta || !eff) return <main className="mx-auto max-w-3xl px-4 py-10 text-[var(--muted)]">Cargando editor…</main>;
  const R = RATIO_SIZE[doc.ratio];
  const cur = groups.find((g) => activeWordAt(g, t) >= 0);
  const act = cur ? activeWordAt(cur, t) : -1;
  let k = 0;
  const unsafe = doc.ratio === "9:16" && (doc.style.y > 0.84 || doc.style.y < 0.15);
  const setStyle = (patch: Partial<SubtitleStyle>) => change((d) => ({ ...d, style: { ...d.style, ...patch } }));
  const SAVE = { saved: `Guardado · v${meta.version}`, dirty: "Cambios sin guardar", saving: "Guardando…", conflict: "Conflicto de versión", error: "Error al guardar" }[save];
  const filtered = doc.words.map((w, i) => ({ w, i })).filter(({ w }) => !q || w.text.toLowerCase().includes(q.toLowerCase()));
  const activeWordIndex = (() => { let n = -1; doc.words.forEach((w, i) => { if (w.start <= t) n = i; }); return n; })();

  return (
    <main className="px-4 py-6 md:px-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/app/p/${meta.projectId}`} className="text-sm text-[var(--muted)] underline">← Proyecto</Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{meta.title}</h1>
        <span role="status" aria-live="polite" className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">{SAVE}</span>
        <button onClick={undo} disabled={!past.length} className="rounded border border-[var(--border)] px-2 py-1 text-sm disabled:opacity-40" title="Deshacer (Cmd+Z)">Deshacer</button>
        <button onClick={redo} disabled={!future.length} className="rounded border border-[var(--border)] px-2 py-1 text-sm disabled:opacity-40" title="Rehacer (Cmd+Shift+Z)">Rehacer</button>
        <button onClick={exportMp4} className="rounded-lg bg-[#111] px-4 py-2 text-sm font-medium text-white">Exportar MP4</button>
      </header>
      {err && <p role="alert" className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm">⚠ {err}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Preview */}
        <section aria-label="Vista previa" className="flex flex-col items-center gap-3">
          <div ref={stage} className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${R.width}/${R.height}`, maxWidth: doc.ratio === "16:9" ? 860 : doc.ratio === "1:1" ? 560 : 380 }}>
            <video ref={bg} src={meta.src} muted playsInline preload="auto" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" aria-hidden />
            <video ref={fg} src={meta.src} playsInline preload="auto" className="absolute inset-0 h-full w-full object-contain" onLoadedMetadata={() => seek(0)} />
            {unsafe && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[16%] border-t-2 border-dashed border-white/70" aria-hidden />}
            {doc.burn && cur && (
              <div className="pointer-events-none absolute left-0 right-0 text-center leading-[1.15]" data-testid="caption"
                style={{ bottom: (1 - eff.y) * R.height * scale, fontSize: eff.fontSize * scale, fontFamily: `"${eff.fontName}", "Liberation Sans", Arial, sans-serif`, fontWeight: eff.bold === false ? 400 : 700, padding: `0 ${R.width * 0.06 * scale}px`,
                  WebkitTextStroke: `${eff.outlineWidth * 2 * scale}px ${eff.outline}`, paintOrder: "stroke fill", textShadow: eff.shadow ? `${eff.shadow * scale * 2}px ${eff.shadow * scale * 2}px 0 rgba(0,0,0,.5)` : "none", textTransform: eff.uppercase ? "uppercase" : "none" }}>
                {cur.lines.map((line, li) => <div key={li}>{line.map((w) => { const i = k++; return <span key={i} style={{ color: i === act ? eff.active : eff.primary }}>{w.text} </span>; })}</div>)}
              </div>
            )}
          </div>
          {unsafe && <p className="text-xs">⚠ El texto puede quedar tapado por la interfaz de la red social (zona discontinua).</p>}
          <div className="flex w-full max-w-[860px] items-center gap-3">
            <button onClick={togglePlay} className="rounded-lg bg-[#111] px-4 py-2 text-sm font-medium text-white" aria-pressed={playing}>{playing ? "Pausa" : "Reproducir"}</button>
            <input aria-label="Posición en el clip" type="range" min={0} max={clipLen} step={1 / 30} value={t} onChange={(e) => seek(Number(e.target.value))} className="w-full" />
            <span className="tnum w-24 text-right text-sm">{t.toFixed(2)} / {clipLen.toFixed(1)} s</span>
          </div>
        </section>

        {/* Panel de propiedades */}
        <section aria-label="Propiedades" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div role="tablist" className="flex border-b border-[var(--border)] text-sm">
            {(["texto", "estilo", "exportar"] as const).map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={`flex-1 px-3 py-2 capitalize ${tab === x ? "border-b-2 border-[#111] font-medium" : "text-[var(--muted)]"}`}>{x}</button>
            ))}
          </div>

          {tab === "texto" && (
            <div className="p-3">
              <div className="mb-2 flex gap-2">
                <input aria-label="Buscar en la transcripción" placeholder="Buscar palabra…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-white px-2 py-1 text-sm" />
                <button onClick={() => change((d) => ({ ...d, words: offsetAll(d.words, -0.1, clipLen) }))} className="rounded border border-[var(--border)] bg-white px-2 text-xs" title="Adelantar todos los subtítulos 0,1 s">−0,1 s</button>
                <button onClick={() => change((d) => ({ ...d, words: offsetAll(d.words, 0.1, clipLen) }))} className="rounded border border-[var(--border)] bg-white px-2 text-xs" title="Retrasar todos los subtítulos 0,1 s">+0,1 s</button>
              </div>
              <p className="mb-2 text-xs text-[var(--muted)]">Corregir el texto no corta el audio ni el vídeo. Selecciona una palabra para ver sus tiempos.</p>
              <ol className="max-h-[56vh] space-y-1 overflow-auto pr-1">
                {filtered.map(({ w, i }) => (
                  <li key={i} className={`rounded px-1 ${i === activeWordIndex ? "bg-black/[0.06]" : ""}`}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { seek(w.start); setSel(i); }} className="tnum w-14 shrink-0 text-left text-xs text-[var(--muted)] underline-offset-2 hover:underline">{w.start.toFixed(2)}</button>
                      <input aria-label={`Palabra ${i + 1}`} value={w.text} onFocus={() => setSel(i)} onChange={(e) => change((d) => ({ ...d, words: editText(d.words, i, e.target.value) }))} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 focus:border-[var(--border)] focus:bg-white" />
                    </div>
                    {sel === i && (
                      <div className="mb-1 ml-16 flex flex-wrap items-center gap-2 text-xs">
                        <label>Inicio <input type="number" step={0.01} value={w.start} onChange={(e) => change((d) => ({ ...d, words: setTiming(d.words, i, Number(e.target.value), d.words[i].end, clipLen) }))} className="tnum w-20 rounded border border-[var(--border)] bg-white px-1" /></label>
                        <label>Fin <input type="number" step={0.01} value={w.end} onChange={(e) => change((d) => ({ ...d, words: setTiming(d.words, i, d.words[i].start, Number(e.target.value), clipLen) }))} className="tnum w-20 rounded border border-[var(--border)] bg-white px-1" /></label>
                        <button onClick={() => change((d) => ({ ...d, words: splitWord(d.words, i) }))} className="rounded border border-[var(--border)] bg-white px-2">Dividir</button>
                        <button onClick={() => change((d) => ({ ...d, words: mergeWithNext(d.words, i) }))} disabled={i >= doc.words.length - 1} className="rounded border border-[var(--border)] bg-white px-2 disabled:opacity-40">Unir con siguiente</button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {tab === "estilo" && (
            <div className="grid gap-3 p-3 text-sm">
              <div className="flex items-end gap-2">
                <label className="flex-1">Preset
                  <select value={doc.preset} onChange={(e) => change((d) => ({ ...d, preset: e.target.value, style: { ...PRESETS[e.target.value] } }))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5">
                    {Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}
                  </select></label>
                <button onClick={() => change((d) => ({ ...d, style: { ...PRESETS[d.preset] } }))} className="rounded border border-[var(--border)] bg-white px-3 py-1.5">Restaurar preset</button>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <label>Fuente
                  <select value={doc.style.fontName} onChange={(e) => setStyle({ fontName: e.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5" style={{ fontFamily: `"${doc.style.fontName}", Arial` }}>
                    <option value="Arial">Arial</option>
                    {fonts?.map((f) => <option key={f.id} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
                  </select></label>
                <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={doc.style.bold !== false} onChange={(e) => setStyle({ bold: e.target.checked })} /> Negrita</label>
              </div>
              <Link href="/app/brand-kits" className="-mt-1 text-xs text-[var(--muted)] underline">Añadir fuentes propias</Link>
              <label>Tamaño · <span className="tnum">{doc.style.fontSize}</span><input type="range" min={40} max={150} value={doc.style.fontSize} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} className="w-full" /></label>
              <div className="grid grid-cols-3 gap-2">
                <label>Texto<input type="color" value={doc.style.primary} onChange={(e) => setStyle({ primary: e.target.value.toUpperCase() })} className="mt-1 block h-8 w-full" /></label>
                <label>Palabra activa<input type="color" value={doc.style.active} onChange={(e) => setStyle({ active: e.target.value.toUpperCase() })} className="mt-1 block h-8 w-full" /></label>
                <label>Contorno<input type="color" value={doc.style.outline} onChange={(e) => setStyle({ outline: e.target.value.toUpperCase() })} className="mt-1 block h-8 w-full" /></label>
              </div>
              <label>Grosor de contorno · <span className="tnum">{doc.style.outlineWidth}</span><input type="range" min={0} max={12} value={doc.style.outlineWidth} onChange={(e) => setStyle({ outlineWidth: Number(e.target.value) })} className="w-full" /></label>
              <label>Sombra · <span className="tnum">{doc.style.shadow}</span><input type="range" min={0} max={8} value={doc.style.shadow} onChange={(e) => setStyle({ shadow: Number(e.target.value) })} className="w-full" /></label>
              <label>Posición vertical · <span className="tnum">{Math.round(doc.style.y * 100)} %</span><input type="range" min={0.1} max={0.95} step={0.01} value={doc.style.y} onChange={(e) => setStyle({ y: Number(e.target.value) })} className="w-full" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!doc.style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} /> Mayúsculas</label>
              <details>
                <summary className="cursor-pointer text-[var(--muted)]">Ajustes avanzados</summary>
                <div className="mt-2 grid gap-2">
                  <label>Palabras máx. por bloque · <span className="tnum">{doc.style.maxWordsPerGroup}</span><input type="range" min={1} max={10} value={doc.style.maxWordsPerGroup} onChange={(e) => setStyle({ maxWordsPerGroup: Number(e.target.value) })} className="w-full" /></label>
                  <label>Caracteres por línea · <span className="tnum">{doc.style.maxCharsPerLine}</span><input type="range" min={10} max={40} value={doc.style.maxCharsPerLine} onChange={(e) => setStyle({ maxCharsPerLine: Number(e.target.value) })} className="w-full" /></label>
                  <label>Líneas máx. · <span className="tnum">{doc.style.maxLines}</span><input type="range" min={1} max={3} value={doc.style.maxLines} onChange={(e) => setStyle({ maxLines: Number(e.target.value) })} className="w-full" /></label>
                </div>
              </details>
            </div>
          )}

          {tab === "exportar" && (
            <div className="grid gap-3 p-3 text-sm">
              <label>Formato
                <select value={doc.ratio} onChange={(e) => change((d) => ({ ...d, ratio: e.target.value as Ratio }))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5">
                  <option value="9:16">9:16 · 1080×1920 (Shorts, Reels, TikTok)</option>
                  <option value="1:1">1:1 · 1080×1080</option>
                  <option value="16:9">16:9 · 1920×1080</option>
                </select></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={doc.burn} onChange={(e) => change((d) => ({ ...d, burn: e.target.checked }))} /> Subtítulos incrustados en el vídeo</label>
              <button onClick={exportMp4} className="rounded-lg bg-[#111] px-4 py-2 font-medium text-white">Exportar MP4 (versión actual)</button>
              {exporting && <p role="status" aria-live="polite" className="text-[var(--muted)]">{exporting}</p>}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => saveText(`${meta.title}.srt`, toSRT(doc.words, eff), "application/x-subrip")} className="rounded border border-[var(--border)] bg-white px-3 py-1.5">SRT</button>
                <button onClick={() => saveText(`${meta.title}.vtt`, toVTT(doc.words, eff), "text/vtt")} className="rounded border border-[var(--border)] bg-white px-3 py-1.5">VTT</button>
                <button onClick={() => saveText(`${meta.title}.txt`, toTranscript(doc.words), "text/plain")} className="rounded border border-[var(--border)] bg-white px-3 py-1.5">Transcripción</button>
              </div>
              <h3 className="mt-2 font-medium">Exportaciones</h3>
              {!renders.length && <p className="text-[var(--muted)]">Aún no hay exportaciones de este clip.</p>}
              <ul className="space-y-1">
                {renders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded border border-[var(--border)] bg-white px-2 py-1">
                    <span className="tnum">v{r.clip_version} · {r.ratio} · {r.burn_subtitles ? "con subtítulos" : "sin subtítulos"}</span>
                    <button onClick={() => download(r)} className="underline">Descargar</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
