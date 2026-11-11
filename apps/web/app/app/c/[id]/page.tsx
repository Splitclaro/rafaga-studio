"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  activeWordAt, groupWords, editText, splitWord, mergeWithNext, setTiming, offsetAll, styleForRatio, toSRT, toVTT, toTranscript,
  PRESETS, RATIO_SIZE, caseOf, trimClip, xAt, type ReframePath, type Composition, type BrollItem, type Ratio, type SubtitleStyle, type Word,
} from "@rafaga/composition";
import { r2Signed } from "../../../../lib/projects";
import { supabase } from "../../../../lib/supabase";
import { downloadMp4 } from "../../../../lib/download";
import { useWorkspaceFonts } from "../../../../lib/fonts";
import { useCollections } from "../../../../components/Collections";
import { useTextStyles } from "../../../../lib/textStyles";
import Icon from "../../../../components/Icon";
import Timeline from "../../../../components/Timeline";

type Layout = "blur" | "fill" | "fit";
type Reframe = { kf: { t: number; x: number }[]; mode?: string; coverage?: number };
type Doc = { reframe?: Reframe; startSec: number; endSec: number; words: Word[]; style: SubtitleStyle; ratio: Ratio; burn: boolean; preset: string; layout: Layout; cropX: number; broll: BrollItem[] };
type Render = { id: string; clip_version: number; ratio: string; burn_subtitles: boolean; storage_path: string; created_at: string };

export default function ClipEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { fonts } = useWorkspaceFonts();
  const [meta, setMeta] = useState<{ title: string; ws: string; projectId: string; sourceId: string; version: number; base: Composition; src: string } | null>(null);
  const [mode, setMode] = useState<"quick" | "advanced">("quick");
  const [srcDur, setSrcDur] = useState(0);
  const [off, setOff] = useState(0);   // desfase de la vista previa respecto al original (0 si se reproduce el original)
  const [trimMsg, setTrimMsg] = useState<string | null>(null);
  const srcWords = useRef<Word[] | null>(null);
  const [rfMode, setRfMode] = useState<"follow" | "group">("follow");
  const [rf, setRf] = useState<{ id: string; status: string; path: ReframePath | null; error: string | null } | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "conflict" | "error">("saved");
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<"texto" | "estilo" | "encuadre" | "social" | "broll" | "exportar">("texto");
  const quick = mode === "quick";
  const { cols } = useCollections();
  const { saved: myStyles } = useTextStyles();
  const presetStyle = (name: string): SubtitleStyle => PRESETS[name] ?? myStyles?.find((x) => x.name === name)?.style ?? PRESETS.Impacto;
  const [brollUrls, setBrollUrls] = useState<Record<string, string>>({});
  const [renders, setRenders] = useState<Render[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);
  const fg = useRef<HTMLVideoElement>(null), bg = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [xl, setXl] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftW, setLeftW] = useState(380);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)"); const f = () => setXl(mq.matches); f(); mq.addEventListener("change", f);
    try { setMode(localStorage.getItem("rafaga.editor.mode") === "advanced" ? "advanced" : "quick"); setLeftOpen(localStorage.getItem("rafaga.editor.left") !== "0"); const w = Number(localStorage.getItem("rafaga.editor.leftw")); if (w >= 280 && w <= 560) setLeftW(w); } catch {}
    return () => mq.removeEventListener("change", f);
  }, []);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); const x0 = e.clientX, w0 = leftW;
    const mv = (ev: PointerEvent) => setLeftW(Math.min(560, Math.max(280, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setLeftW((w) => { try { localStorage.setItem("rafaga.editor.leftw", String(w)); } catch {} return w; }); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const toggleLeft = () => { const v = !leftOpen; setLeftOpen(v); try { localStorage.setItem("rafaga.editor.left", v ? "1" : "0"); } catch {} };
  const versionRef = useRef(1);

  const loadRenders = useCallback(async () => {
    const { data } = await supabase.from("renders").select("id,clip_version,ratio,burn_subtitles,storage_path,created_at").eq("clip_id", id).eq("status", "ready").order("created_at", { ascending: false });
    setRenders((data ?? []) as Render[]);
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data: c, error } = await supabase.from("clips").select("id,title,workspace_id,project_id,current_version,preview_path,preview_offset").eq("id", id).single();
      if (error || !c) return setErr("Clip no encontrado.");
      const { data: v } = await supabase.from("clip_versions").select("composition").eq("clip_id", id).eq("version", c.current_version).single();
      const { data: p } = await supabase.from("projects").select("source_id").eq("id", c.project_id).single();
      if (!v || !p) return setErr("No se pudo cargar la versión del clip.");
      const comp = v.composition as Composition & { preset?: string };
      // Original por partes: el navegador reproduce la vista previa (tramo del clip ± 90 s) que genera el worker, con su desfase.
      const { data: sr } = await supabase.from("sources").select("parts,storage_backend").eq("id", p.source_id).single();
      const usePreview = !!sr?.parts && !!c.preview_path;
      const signed = sr?.storage_backend === "r2" ? { data: { signedUrl: await r2Signed("get", p.source_id).catch(() => "") } }
        : usePreview ? await supabase.storage.from("proxies").createSignedUrl(c.preview_path!, 3600) : await supabase.storage.from("originals").createSignedUrl(`${c.workspace_id}/${p.source_id}/original`, 3600);
      setOff(usePreview ? Number(c.preview_offset ?? 0) : 0);
      versionRef.current = c.current_version;
      setMeta({ title: c.title, ws: c.workspace_id, projectId: c.project_id, sourceId: p.source_id, version: c.current_version, base: comp, src: signed.data?.signedUrl ?? "" });
      setDoc({ reframe: comp.reframe, startSec: comp.startSec, endSec: comp.endSec, words: comp.words, style: comp.style, ratio: comp.ratio, burn: comp.burnSubtitles, preset: comp.preset ?? "Impacto", layout: comp.layout === "fill" || comp.layout === "fit" ? comp.layout : "blur", cropX: comp.crop?.x ?? 0.5, broll: comp.broll ?? [] });
      await loadRenders();
    })();
  }, [id, loadRenders]);

  useEffect(() => {
    (async () => {
      const need = (doc?.broll ?? []).map((b) => b.path).filter((p) => !brollUrls[p]);
      if (!need.length) return;
      const { data } = await supabase.storage.from("originals").createSignedUrls(need, 3600);
      setBrollUrls((u) => ({ ...u, ...Object.fromEntries((data ?? []).flatMap((x) => (x.signedUrl && x.path ? [[x.path, x.signedUrl] as [string, string]] : []))) }));
    })();
  }, [doc?.broll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Reproducción sincronizada con el tramo del clip ----------
  const clipLen = doc ? doc.endSec - doc.startSec : meta ? meta.base.endSec - meta.base.startSec : 0;
  const clipStart = doc?.startSec ?? meta?.base.startSec ?? 0;
  useEffect(() => {
    const v = fg.current; if (!v || !meta) return;
    const onTime = () => {
      const rel = v.currentTime + off - clipStart;
      if (rel >= clipLen) { v.pause(); setPlaying(false); seek(0); return; }
      setT(Math.max(0, rel));
      if (bg.current && Math.abs(bg.current.currentTime - v.currentTime) > 0.25) bg.current.currentTime = v.currentTime;
    };
    v.addEventListener("timeupdate", onTime);
    let raf = 0; const loop = () => { onTime(); raf = requestAnimationFrame(loop); };
    if (playing) raf = requestAnimationFrame(loop);
    return () => { v.removeEventListener("timeupdate", onTime); cancelAnimationFrame(raf); };
  }, [meta, playing, clipLen, clipStart, off]); // eslint-disable-line react-hooks/exhaustive-deps
  function seek(rel: number) {
    if (!meta) return;
    const abs = clipStart + Math.max(0, Math.min(clipLen, rel));
    if (fg.current) fg.current.currentTime = abs - off;
    if (bg.current) bg.current.currentTime = abs - off;
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

  // ---------- Reencuadre automático: análisis de caras en el worker; la trayectoria solo se aplica si la persona quiere ----------
  useEffect(() => {
    if (!rf || !["queued", "analyzing"].includes(rf.status)) return;
    const i = setInterval(async () => {
      const { data } = await supabase.from("reframe_tracks").select("status,path,error").eq("id", rf.id).maybeSingle();
      if (data && data.status !== rf.status) setRf({ id: rf.id, status: data.status, path: (data.path as ReframePath | null) ?? null, error: data.error });
      else if (data?.error && data.error !== rf.error) setRf({ ...rf, error: data.error });
    }, 3000);
    return () => clearInterval(i);
  }, [rf]);
  async function analyzeFaces() {
    if (!doc || !meta) return;
    setRf({ id: "", status: "queued", path: null, error: null });
    const { data, error } = await supabase.rpc("request_reframe", { p_clip: id, p_start: doc.startSec, p_end: doc.endSec, p_ratio: doc.ratio, p_mode: rfMode });
    if (error) return setRf({ id: "", status: "failed", path: null, error: error.message });
    const { data: s2 } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s2.session?.access_token ?? ""}` } }).catch(() => {});
    const tid = data as string;
    const { data: row } = await supabase.from("reframe_tracks").select("status,path,error").eq("id", tid).maybeSingle();
    setRf({ id: tid, status: row?.status ?? "queued", path: (row?.path as ReframePath | null) ?? null, error: row?.error ?? null });
  }
  const applyReframe = () => { if (rf?.path && rf.path.mode !== "static") change((d) => ({ ...d, layout: "fill", reframe: { kf: rf.path!.kf, mode: rf.path!.mode, coverage: rf.path!.coverage } })); };
  const clearReframe = () => change((d) => ({ ...d, reframe: undefined }));

  // ---------- Recorte: cambia inicio/fin conservando la edición; al ampliar rellena solo lo nuevo con la transcripción ----------
  async function applyTrim(ns: number, ne: number) {
    if (!doc || !meta) return;
    if (srcWords.current === null) {
      const { data } = await supabase.from("transcripts").select("words").eq("source_id", meta.sourceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      srcWords.current = Array.isArray(data?.words) ? (data!.words as Word[]) : [];
    }
    const r = trimClip({ startSec: doc.startSec, endSec: doc.endSec, words: doc.words, broll: doc.broll }, ns, ne, srcDur, srcWords.current);
    if (!r.ok) return setTrimMsg(r.reason);
    setTrimMsg(`Clip de ${(r.endSec - r.startSec).toFixed(1)} s${r.dropped ? ` · ${r.dropped} palabra${r.dropped === 1 ? "" : "s"} fuera` : ""}${r.added ? ` · ${r.added} añadida${r.added === 1 ? "" : "s"} de la transcripción` : ""}.`);
    const keepAbs = clipStart + t;
    change((d) => ({ ...d, startSec: r.startSec, endSec: r.endSec, words: r.words, broll: r.broll, reframe: undefined }));
    if (doc.reframe) setTrimMsg((m) => `${m ?? ""} Se quitó el seguimiento de caras: vuelve a analizar el tramo nuevo.`);
    setSel(null);
    const rel = Math.min(Math.max(0, keepAbs - r.startSec), r.endSec - r.startSec);
    if (fg.current) fg.current.currentTime = r.startSec + rel - off; if (bg.current) bg.current.currentTime = r.startSec + rel - off; setT(rel);
  }
  const setModeP = (m: "quick" | "advanced") => { setMode(m); try { localStorage.setItem("rafaga.editor.mode", m); } catch {} if (m === "quick" && ["social", "broll"].includes(tab)) setTab("estilo"); };

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
    const composition: Composition & { preset: string } = { ...meta.base, startSec: d.startSec, endSec: d.endSec, words: d.words, style: d.style, ratio: d.ratio, burnSubtitles: d.burn, preset: d.preset, layout: d.layout, crop: { x: d.cropX }, broll: d.broll, ...(d.reframe && d.layout === "fill" ? { reframe: d.reframe } : { reframe: undefined }) };
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
    const res = await downloadMp4("renders", r.storage_path, name); if (!res.ok) alert(res.error);
  }
  function saveText(name: string, text: string, type: string) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Render del overlay (mismas reglas que el export) ----------
  const eff = useMemo(() => (doc ? styleForRatio(doc.style, doc.ratio) : null), [doc]);
  const groups = useMemo(() => (doc && eff ? groupWords(doc.words, eff) : []), [doc, eff]);
  // Frases para revisar: corte por puntuación final, pausa > 0,7 s o 16 palabras
  const phrases = useMemo(() => {
    const out: { from: number; to: number }[] = []; if (!doc) return out;
    let from = 0;
    doc.words.forEach((w, i) => {
      const next = doc.words[i + 1];
      if (!next || /[.!?…]$/.test(w.text) || next.start - w.end > 0.7 || i - from + 1 >= 16) { out.push({ from, to: i }); from = i + 1; }
    });
    return out;
  }, [doc]);
  const activeIdx = useMemo(() => { let n = -1; doc?.words.forEach((w, i) => { if (w.start <= t) n = i; }); return n; }, [doc, t]);
  const activePhrase = useMemo(() => phrases.findIndex((p) => activeIdx >= p.from && activeIdx <= p.to), [phrases, activeIdx]);
  useEffect(() => { if (!playing || activePhrase < 0) return; listRef.current?.querySelector<HTMLElement>(`[data-phrase="${activePhrase}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [activePhrase, playing]);
  if (err && !doc) return <main className="mx-auto max-w-3xl px-4 py-10">{err}</main>;
  if (!doc || !meta || !eff) return <main className="mx-auto max-w-3xl px-4 py-10 text-[var(--muted)]">Cargando editor…</main>;
  const R = RATIO_SIZE[doc.ratio];
  const cur = groups.find((g) => activeWordAt(g, t) >= 0);
  const act = cur ? activeWordAt(cur, t) : -1;
  let k = 0;
  const unsafe = doc.ratio === "9:16" && (doc.style.y > 0.84 || doc.style.y < 0.15);
  const setStyle = (patch: Partial<SubtitleStyle>) => change((d) => ({ ...d, style: { ...d.style, ...patch } }));
  const SAVE = { saved: `Guardado · v${meta.version}`, dirty: "Cambios sin guardar", saving: "Guardando…", conflict: "Conflicto de versión", error: "Error al guardar" }[save];
  const ql = q.trim().toLowerCase();
  const shown = phrases.map((p, pi) => ({ p, pi })).filter(({ p }) => !ql || doc.words.slice(p.from, p.to + 1).some((w) => w.text.toLowerCase().includes(ql)));
  const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  const transcript = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap gap-2">
        <input aria-label="Buscar en la transcripción" placeholder="Buscar palabra…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded border border-[var(--border)] bg-white px-2 py-1 text-sm" />
        {!quick && <button onClick={() => change((d) => ({ ...d, words: offsetAll(d.words, -0.1, clipLen) }))} className="rounded border border-[var(--border)] bg-white px-2 text-xs" title="Adelantar todos los subtítulos 0,1 s">−0,1 s</button>}
        {!quick && <button onClick={() => change((d) => ({ ...d, words: offsetAll(d.words, 0.1, clipLen) }))} className="rounded border border-[var(--border)] bg-white px-2 text-xs" title="Retrasar todos los subtítulos 0,1 s">+0,1 s</button>}
      </div>
      <p className="mb-2 text-xs text-[var(--muted)]">{doc.words.length} palabras · {phrases.length} frases{ql ? ` · ${shown.length} con «${q}»` : ""}. Pulsa una palabra para ir a ese instante y corregirla; el audio y el vídeo no se cortan.</p>
      <ol ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto pr-1 xl:max-h-[calc(100vh-260px)] max-xl:max-h-[56vh]">
        {shown.map(({ p, pi }) => (
          <li key={pi} data-phrase={pi} className={`rounded-lg border px-2 py-1.5 ${pi === activePhrase ? "border-[var(--ink)] bg-white" : "border-transparent hover:bg-white/70"}`}>
            <div className="flex gap-2">
              <button onClick={() => { seek(doc.words[p.from].start); setSel(p.from); }} className="tnum w-10 shrink-0 pt-0.5 text-left text-xs text-[var(--muted)] hover:underline" aria-label={`Ir a ${clock(doc.words[p.from].start)}`}>{clock(doc.words[p.from].start)}</button>
              <p className="min-w-0 flex-1 text-[15px] leading-7">
                {doc.words.slice(p.from, p.to + 1).map((w, k) => { const i = p.from + k; const hit = !!ql && w.text.toLowerCase().includes(ql);
                  return <button key={i} onClick={() => { seek(w.start); setSel(i); }} className={`mr-1 rounded px-0.5 text-left ${i === activeIdx ? "bg-[var(--ink)] text-white" : sel === i ? "ring-1 ring-[#111]" : hit ? "bg-black/10" : "hover:bg-black/5"}`}>{w.text}</button>; })}
              </p>
            </div>
            {sel !== null && sel >= p.from && sel <= p.to && (
              <div className="mb-1 ml-12 mt-1 grid gap-2 rounded-lg bg-[var(--surface)] p-2 text-xs">
                <label>Texto <input aria-label={`Palabra ${sel + 1}`} value={doc.words[sel].text} onChange={(e) => change((d) => ({ ...d, words: editText(d.words, sel, e.target.value) }))} className="mt-0.5 w-full rounded border border-[var(--border)] bg-white px-1.5 py-1 text-sm" autoFocus /></label>
                <div className="flex flex-wrap items-center gap-2">
                  {!quick && <><label>Inicio <input type="number" step={0.01} value={doc.words[sel].start} onChange={(e) => change((d) => ({ ...d, words: setTiming(d.words, sel, Number(e.target.value), d.words[sel].end, clipLen) }))} className="tnum w-20 rounded border border-[var(--border)] bg-white px-1" /></label>
                  <label>Fin <input type="number" step={0.01} value={doc.words[sel].end} onChange={(e) => change((d) => ({ ...d, words: setTiming(d.words, sel, d.words[sel].start, Number(e.target.value), clipLen) }))} className="tnum w-20 rounded border border-[var(--border)] bg-white px-1" /></label>
                  <button onClick={() => change((d) => ({ ...d, words: splitWord(d.words, sel) }))} className="rounded border border-[var(--border)] bg-white px-2 py-1">Dividir</button>
                  <button onClick={() => change((d) => ({ ...d, words: mergeWithNext(d.words, sel) }))} disabled={sel >= doc.words.length - 1} className="rounded border border-[var(--border)] bg-white px-2 py-1 disabled:opacity-40">Unir con siguiente</button></>}
                  <button onClick={() => setSel(null)} className="ml-auto underline">Cerrar</button>
                </div>
              </div>)}
          </li>))}
        {!shown.length && <li className="text-sm text-[var(--muted)]">Ninguna frase contiene «{q}».</li>}
      </ol>
    </div>
  );
  const tabsAll = (quick ? ["texto", "estilo", "encuadre", "exportar"] : ["texto", "estilo", "encuadre", "social", "broll", "exportar"]) as readonly ("texto" | "estilo" | "encuadre" | "social" | "broll" | "exportar")[];
  const tabsShown = xl ? tabsAll.filter((x) => x !== "texto") : tabsAll;
  const tabEff = xl && tab === "texto" ? "estilo" : quick && ["social", "broll"].includes(tab) ? "estilo" : tab;

  return (
    <main className="px-4 py-6 md:px-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/app/p/${meta.projectId}`} className="text-sm text-[var(--muted)] underline">← Proyecto</Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{meta.title}</h1>
        <span className="tnum hidden text-xs text-[var(--muted)] sm:inline">{doc.ratio} · {clipLen.toFixed(1)} s · {doc.words.length} palabras</span>
        <div role="group" aria-label="Modo del editor" className="inline-flex rounded-full bg-[var(--hover)] p-0.5 text-xs">{([["quick", "Rápido"], ["advanced", "Avanzado"]] as const).map(([m, l]) => <button key={m} aria-pressed={mode === m} onClick={() => setModeP(m)} className={`rounded-full px-3 py-1 ${mode === m ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{l}</button>)}</div>
        <span role="status" aria-live="polite" className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">{SAVE}</span>
        <button onClick={undo} disabled={!past.length} className="rounded border border-[var(--border)] px-2 py-1 text-sm disabled:opacity-40" title="Deshacer (Cmd+Z)">Deshacer</button>
        <button onClick={redo} disabled={!future.length} className="rounded border border-[var(--border)] px-2 py-1 text-sm disabled:opacity-40" title="Rehacer (Cmd+Shift+Z)">Rehacer</button>
        <button onClick={exportMp4} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Exportar MP4</button>
      </header>
      {err && <p role="alert" className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm">⚠ {err}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[var(--lw)_minmax(0,1fr)_380px]" style={{ ["--lw" as string]: leftOpen ? `${leftW}px` : "44px" }}>
        {/* Transcripción (solo en pantallas anchas; en estrechas es la pestaña «Texto») */}
        <section aria-label="Transcripción" className="relative hidden min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 xl:flex">
          <div className="mb-2 flex items-center justify-between"><h2 className={`text-sm font-medium ${leftOpen ? "" : "sr-only"}`}>Transcripción</h2>
            <button onClick={toggleLeft} aria-expanded={leftOpen} aria-label={leftOpen ? "Plegar transcripción" : "Mostrar transcripción"} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><Icon n={leftOpen ? "chevL" : "chevR"} className="h-4 w-4" /></button></div>
          {leftOpen && transcript}
          {leftOpen && <div role="separator" aria-orientation="vertical" aria-label="Cambiar ancho de la transcripción" tabIndex={0} onPointerDown={startResize}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const w = Math.min(560, Math.max(280, leftW + (e.key === "ArrowRight" ? 20 : -20))); setLeftW(w); try { localStorage.setItem("rafaga.editor.leftw", String(w)); } catch {} } }}
            className="absolute -right-3 top-0 hidden h-full w-3 cursor-col-resize xl:block" title="Arrastra para cambiar el ancho"><span className="mx-auto mt-[40%] block h-10 w-1 rounded bg-[var(--border)]" /></div>}
        </section>
        {/* Preview */}
        <section aria-label="Vista previa" className="flex flex-col items-center gap-3">
          <div ref={stage} className="relative w-full overflow-hidden rounded-xl bg-black" style={doc.ratio === "16:9" ? { aspectRatio: `${R.width}/${R.height}`, width: "100%", maxWidth: 1000 } : { aspectRatio: `${R.width}/${R.height}`, height: "min(calc(100vh - 330px), 780px)", minHeight: 320, width: "auto", maxWidth: "100%" }}>
            <video ref={bg} src={meta.src} muted playsInline preload="auto" className={`absolute inset-0 h-full w-full scale-110 object-cover blur-2xl ${doc.layout === "blur" ? "" : "hidden"}`} aria-hidden />
            <video ref={fg} src={meta.src} playsInline preload="auto" className={`absolute inset-0 h-full w-full ${doc.layout === "fill" ? "object-cover" : "object-contain"}`} style={doc.layout === "fill" ? { objectPosition: `${(doc.reframe?.kf?.length ? xAt(doc.reframe.kf, t, doc.cropX) : doc.cropX) * 100}% 50%` } : undefined} onLoadedMetadata={() => { setSrcDur((fg.current?.duration ?? 0) + off); seek(0); }} />
            {doc.broll.map((b, i) => t >= b.start && t < b.start + b.dur && brollUrls[b.path] ? (b.kind === "photo"
              ? <img key={i} src={brollUrls[b.path]} alt="" className="absolute inset-0 h-full w-full object-cover" />
              : <video key={i} src={brollUrls[b.path]} muted autoPlay loop playsInline className="absolute inset-0 h-full w-full object-cover" />) : null)}
            {unsafe && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[16%] border-t-2 border-dashed border-white/70" aria-hidden />}
            {doc.burn && cur && (
              <div className="pointer-events-none absolute left-0 right-0 text-center leading-[1.15]" data-testid="caption"
                style={{ bottom: (1 - eff.y) * R.height * scale, fontSize: eff.fontSize * scale, fontFamily: `"${eff.fontName}", "Liberation Sans", Arial, sans-serif`, fontWeight: eff.bold === false ? 400 : 700, padding: `0 ${R.width * 0.06 * scale}px`,
                  WebkitTextStroke: `${eff.outlineWidth * 2 * scale}px ${eff.outline}`, paintOrder: "stroke fill", textShadow: eff.shadow ? `${eff.shadow * scale * 2}px ${eff.shadow * scale * 2}px 0 rgba(0,0,0,.5)` : "none", }}>
                {cur.lines.map((line, li) => <div key={li}>{line.map((w) => { const i = k++; const mode = eff.highlight ?? "color"; const fut = i > act; return <span key={i} style={{ color: i === act ? eff.active : eff.primary, opacity: fut && mode === "reveal" ? 0 : fut && mode === "dim" ? 0.37 : 1 }}>{caseOf(eff, w.text)} </span>; })}</div>)}
              </div>
            )}
          </div>
          {unsafe && <p className="text-xs">⚠ El texto puede quedar tapado por la interfaz de la red social (zona discontinua).</p>}
          <div className="flex w-full max-w-[860px] items-center gap-3">
            <button onClick={togglePlay} className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white" aria-pressed={playing}>{playing ? "Pausa" : "Reproducir"}</button>
            <input aria-label="Posición en el clip" type="range" min={0} max={clipLen} step={1 / 30} value={t} onChange={(e) => seek(Number(e.target.value))} className="w-full" />
            <span className="tnum w-28 shrink-0 whitespace-nowrap text-right text-sm">{t.toFixed(2)} / {clipLen.toFixed(1)} s</span>
          </div>
          <Timeline src={meta.src} srcOffset={off} srcDuration={srcDur} start={doc.startSec} end={doc.endSec} t={t} words={doc.words} broll={doc.broll} tracks={!quick} onTrim={applyTrim} onSeek={seek} onSelectWord={(i) => setSel(i)} />
          {trimMsg && <p role="status" aria-live="polite" className="w-full max-w-[860px] text-xs text-[var(--muted)]">{trimMsg}</p>}
        </section>

        {/* Panel de propiedades */}
        <section aria-label="Propiedades" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div role="tablist" className="flex border-b border-[var(--border)] text-sm">
            {tabsShown.map((x) => (
              <button key={x} role="tab" aria-selected={tabEff === x} onClick={() => setTab(x)} className={`flex-1 px-2 py-2 text-[13px] ${tabEff === x ? "border-b-2 border-[var(--ink)] font-medium" : "text-[var(--muted)]"}`}>{x === "broll" ? "B-roll" : x === "social" ? "Social" : x[0].toUpperCase() + x.slice(1)}</button>
            ))}
          </div>

          {tabEff === "texto" && <div className="flex flex-col p-3">{transcript}</div>}

          {tabEff === "estilo" && (
            <div className="grid gap-3 p-3 text-sm">
              <div className="flex items-end gap-2">
                <label className="flex-1">Preset
                  <select value={doc.preset} onChange={(e) => change((d) => ({ ...d, preset: e.target.value, style: { ...presetStyle(e.target.value) } }))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5">
                    <optgroup label="Base">{Object.keys(PRESETS).map((p) => <option key={p}>{p}</option>)}</optgroup>
                    {!!myStyles?.length && <optgroup label="Mis estilos">{myStyles.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}</optgroup>}
                  </select></label>
                <button onClick={() => change((d) => ({ ...d, style: { ...presetStyle(d.preset) } }))} className="rounded border border-[var(--border)] bg-white px-3 py-1.5">Restaurar preset</button>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <label>Fuente
                  <select value={doc.style.fontName} onChange={(e) => setStyle({ fontName: e.target.value })} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5" style={{ fontFamily: `"${doc.style.fontName}", Arial` }}>
                    <option value="Bootzy TM">Bootzy TM (fuente de los clips)</option>
                    <option value="Arial">Arial</option>
                    {fonts?.map((f) => <option key={f.id} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
                  </select></label>
                <label className="flex items-center gap-2 pb-1.5"><input type="checkbox" checked={doc.style.bold !== false} onChange={(e) => setStyle({ bold: e.target.checked })} /> Negrita</label>
              </div>
              <Link href="/app/style-studio" className="-mt-1 text-xs text-[var(--muted)] underline">Crear o editar estilos en Style Studio</Link>
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

          {tabEff === "encuadre" && (
            <div className="grid gap-4 p-3 text-sm">
              <p className="text-[var(--muted)]">Cómo se adapta el vídeo original al formato elegido ({doc.ratio}).</p>
              {!quick && <div role="radiogroup" aria-label="Encuadre" className="grid gap-2">
                {([["blur", "Desenfocado", "Vídeo completo centrado sobre su propio fondo desenfocado."], ["fill", "Rellenar", "Recorta para ocupar todo el cuadro. Elige qué parte se ve."], ["fit", "Ajustar", "Vídeo completo con barras negras."]] as const).map(([k, l, d]) => (
                  <button key={k} role="radio" aria-checked={doc.layout === k} onClick={() => change((x) => ({ ...x, layout: k }))} className={`rounded-xl border p-3 text-left ${doc.layout === k ? "border-[var(--ink)] ring-1 ring-[#111]" : "hairline hover:bg-[var(--hover)]"}`}><span className="font-medium">{l}</span><span className="block text-xs text-[var(--muted)]">{d}</span></button>))}
              </div>}
              {(() => { const busy = !!rf && ["queued", "analyzing"].includes(rf.status); const ready = rf?.status === "ready" && rf.path; const st = ready && rf.path!.mode === "static";
                return (
                <div className="rounded-xl border border-[var(--border)] bg-white p-3" aria-label="Reencuadre automático">
                  <div className="font-medium">Reencuadre automático</div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">Detecta caras en este tramo y mueve el recorte para mantenerlas en cuadro. Es una sugerencia: la ves en la vista previa antes de aplicarla, y es la misma que se exporta.</p>
                  {doc.reframe ? (
                    <div className="mt-2 text-xs"><p role="status">Aplicado · {doc.reframe.kf.length} puntos de movimiento{typeof doc.reframe.coverage === "number" ? ` · caras en el ${Math.round(doc.reframe.coverage * 100)} % del clip` : ""}.</p>
                      <div className="mt-2 flex flex-wrap gap-2"><button onClick={clearReframe} className="btn btn-ghost !px-3 !py-1 !text-xs">Quitar seguimiento</button><button onClick={analyzeFaces} disabled={busy} className="btn btn-ghost !px-3 !py-1 !text-xs">Volver a analizar</button></div></div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs">Seguir a<select value={rfMode} onChange={(e) => setRfMode(e.target.value as "follow" | "group")} className="mt-1 block rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm"><option value="follow">La cara principal</option><option value="group">El grupo (si caben)</option></select></label>
                      <button onClick={analyzeFaces} disabled={busy} className="btn btn-primary !py-1.5 !text-xs disabled:opacity-50">{busy ? "Analizando…" : "Analizar caras"}</button>
                    </div>)}
                  {busy && <p role="status" aria-live="polite" className="mt-2 text-xs text-[var(--muted)]">Analizando el tramo de {(doc.endSec - doc.startSec).toFixed(0)} s en segundo plano. Puedes seguir editando; avisa aquí al terminar.</p>}
                  {rf?.status === "failed" && <p role="alert" className="mt-2 text-xs">No se pudo analizar: {rf.error ?? "error desconocido"}</p>}
                  {ready && !doc.reframe && (
                    <div className="mt-2 text-xs"><p role="status">{st ? rf.path!.note : `Caras en el ${Math.round(rf.path!.coverage * 100)} % del clip · ${rf.path!.kf.length} puntos de movimiento.${rf.path!.coverage < 0.6 ? " Cobertura baja: revisa la vista previa antes de exportar." : ""}`}</p>
                      {!st && <button onClick={applyReframe} className="btn btn-primary mt-2 !py-1.5 !text-xs">Aplicar</button>}</div>)}
                </div>); })()}
              {!quick && doc.layout === "fill" && (<label>Posición horizontal del recorte · <span className="mono">{Math.round(doc.cropX * 100)} %</span>
                <input type="range" min={0} max={1} step={0.01} value={doc.cropX} disabled={!!doc.reframe} onChange={(e) => change((x) => ({ ...x, cropX: Number(e.target.value) }))} className="mt-1 w-full disabled:opacity-40" />
                <span className="text-xs text-[var(--muted)]">Manual: mueve el recorte hacia quien habla.{doc.reframe ? " Desactivado mientras el seguimiento automático está aplicado." : ""}</span></label>)}
              <div><div className="mb-1 font-medium">Formato</div>
                <div className="flex flex-wrap gap-1.5">{(["9:16", "4:5", "1:1", "16:9"] as Ratio[]).map((r) => <button key={r} aria-pressed={doc.ratio === r} className="chip" onClick={() => change((x) => ({ ...x, ratio: r, reframe: undefined }))}>{r}</button>)}</div></div>
            </div>
          )}

          {tabEff === "social" && (
            <div className="grid gap-3 p-3 text-sm">
              <p className="text-[var(--muted)]">Un clic deja el clip listo para cada red: formato, encuadre y subtítulos en zona segura. Después puedes ajustar lo que quieras.</p>
              {([["TikTok", "9:16", "fill", 0.6], ["Instagram Reels", "9:16", "fill", 0.6], ["YouTube Shorts", "9:16", "fill", 0.62], ["Instagram feed", "4:5", "fill", 0.82], ["X y LinkedIn", "1:1", "blur", 0.84], ["YouTube", "16:9", "fit", 0.88]] as const).map(([name, r, lay, y]) => (
                <button key={name} className="flex items-center justify-between rounded-xl border hairline p-3 text-left hover:bg-[var(--hover)]" onClick={() => change((x) => ({ ...x, ratio: r as Ratio, layout: lay as Layout, style: { ...x.style, y } }))}>
                  <span><span className="font-medium">{name}</span><span className="block text-xs text-[var(--muted)]">{r}, {lay === "fill" ? "rellenar" : lay === "blur" ? "desenfocado" : "ajustar"}, subtítulos al {Math.round(y * 100)} %</span></span><Icon n="check" className="h-4 w-4 opacity-40" /></button>))}
              <p className="text-xs text-[var(--muted)]">Estas zonas son recomendaciones generales: cada red cambia su interfaz, comprueba el resultado antes de publicar. La publicación directa necesita conexiones (Conexiones).</p>
            </div>
          )}

          {tabEff === "broll" && (
            <div className="grid gap-3 p-3 text-sm">
              <p className="text-[var(--muted)]">Superpón imágenes o vídeos de tus <strong>Custom Collections</strong> en momentos concretos. Posición actual: <span className="mono">{t.toFixed(1)} s</span>. La generación de B-roll con IA requiere un proveedor externo que aún no está conectado.</p>
              {!cols?.some((c) => c.items.length) && <p className="rounded-xl border border-dashed hairline p-3">Aún no tienes medios. Crea un pack de medios y sube vídeos o fotos en <Link href="/app/biblioteca?tab=collections" className="underline">Biblioteca → Packs de medios</Link>; aparecerán aquí.</p>}
              {cols?.filter((c) => c.items.length).map((c) => (
                <div key={c.id}><div className="mb-1 text-xs font-medium text-[var(--muted)]">{c.name}</div>
                  <ul className="flex gap-2 overflow-x-auto pb-1">{c.items.map((it) => (
                    <li key={it.id} className="shrink-0"><button onClick={() => change((x) => ({ ...x, broll: [...x.broll, { path: it.storage_path, kind: it.kind, name: it.name, start: Math.min(t, Math.max(0, clipLen - 1)), dur: Math.min(3, Math.max(0.5, clipLen - t)) }].slice(0, 12) }))} className="relative block overflow-hidden rounded-lg border hairline" aria-label={`Añadir ${it.name} en ${t.toFixed(1)} s`}>
                      {it.url ? (it.kind === "photo" ? <img src={it.url} alt="" className="h-20 w-12 object-cover" /> : <video src={it.url} muted preload="metadata" className="h-20 w-12 object-cover" />) : <div className="h-20 w-12 bg-[var(--ink)]" />}
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">+ aquí</span></button></li>))}</ul></div>))}
              <div><div className="mb-1 font-medium">En este clip <span className="mono text-[var(--muted)]">{doc.broll.length}/12</span></div>
                {!doc.broll.length && <p className="text-[var(--muted)]">Ningún B-roll añadido.</p>}
                <ul className="space-y-2">{doc.broll.map((b, i) => (
                  <li key={i} className="rounded-xl border hairline p-2"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{b.kind === "photo" ? "Foto" : "Vídeo"} · {b.name ?? "medio"}</span><button className="underline" onClick={() => change((x) => ({ ...x, broll: x.broll.filter((_, j) => j !== i) }))}>Quitar</button></div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-xs"><label>Inicio (s)<input type="number" min={0} max={clipLen} step={0.1} value={b.start} onChange={(e) => change((x) => ({ ...x, broll: x.broll.map((y, j) => j === i ? { ...y, start: Math.max(0, Math.min(clipLen - 0.5, Number(e.target.value))) } : y) }))} className="input mono mt-0.5 !py-1" /></label>
                      <label>Duración (s)<input type="number" min={0.5} max={clipLen} step={0.1} value={b.dur} onChange={(e) => change((x) => ({ ...x, broll: x.broll.map((y, j) => j === i ? { ...y, dur: Math.max(0.5, Math.min(clipLen - y.start, Number(e.target.value))) } : y) }))} className="input mono mt-0.5 !py-1" /></label></div></li>))}</ul></div>
            </div>
          )}

          {tabEff === "exportar" && (
            <div className="grid gap-3 p-3 text-sm">
              <label>Formato
                <select value={doc.ratio} onChange={(e) => change((d) => ({ ...d, ratio: e.target.value as Ratio }))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1.5">
                  <option value="9:16">9:16 · 1080×1920 (Shorts, Reels, TikTok)</option>
                  <option value="4:5">4:5 · 1080×1350 (feed Instagram)</option>
                  <option value="1:1">1:1 · 1080×1080</option>
                  <option value="16:9">16:9 · 1920×1080</option>
                </select></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={doc.burn} onChange={(e) => change((d) => ({ ...d, burn: e.target.checked }))} /> Subtítulos incrustados en el vídeo</label>
              <button onClick={exportMp4} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white">Exportar MP4 (versión actual)</button>
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
