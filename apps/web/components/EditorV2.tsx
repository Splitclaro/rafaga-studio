"use client";
// Editor v2 de un clip: corte preciso (fotograma, ampliar con el original), edición por transcripción, corrección de subtítulos,
// diseño y plantilla, volumen, deshacer/rehacer, duplicar, versiones y autoguardado visible. Usa PreviewPlayer (mismo motor que la exportación).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LAYOUT_IDS, ASPECT_IDS, VIRAL_TEMPLATE_IDS, type CompositionV2, type Word, type LayoutId, type ViralTemplateId } from "@rafaga/composition";
import { supabase } from "../lib/supabase";
import PreviewPlayer, { type PClip } from "./PreviewPlayer";
import { TEMPLATE_LABEL } from "../lib/generations";
import {
  History, Autosaver, deleteRange, restoreRange, deleteWords, stepFrame, extend, editWordText, setWordTiming, setLayout, setAspect, setVolume, applyTemplate, durationOf,
  type EditState, type SaveState,
} from "../lib/editor";

const LAYOUT_LABEL: Record<LayoutId, string> = { single_track: "Un hablante con seguimiento", split_two: "Dos hablantes en pantalla dividida", active_speaker: "Cambio según el hablante activo", screen_presenter: "Pantalla + ponente", fit_full: "Vídeo completo adaptado", manual: "Reencuadre manual" };
const SAVE_TEXT: Record<SaveState, string> = { idle: "", guardando: "Guardando…", guardado: "Guardado", "error al guardar": "Error al guardar: tus cambios siguen aquí" };

export default function EditorV2({ clipId }: { clipId: string }) {
  const router = useRouter();
  const hist = useRef<History<EditState> | null>(null), saver = useRef<Autosaver | null>(null);
  const [state, setState] = useState<EditState | null>(null), [save, setSave] = useState<SaveState>("idle"), [, bump] = useState(0);
  const [meta, setMeta] = useState<{ title: string; version: number; srcW: number; srcH: number; srcDur: number; sourceId: string; startS: number; endS: number; reason: string | null; overall: number | null } | null>(null);
  const [proxy, setProxy] = useState<string | null>(null), [tab, setTab] = useState<"corte" | "texto" | "diseno" | "audio">("corte"), [sel, setSel] = useState<[number, number] | null>(null);
  const [fs, setFs] = useState(false), [msg, setMsg] = useState<string | null>(null), [allWords, setAllWords] = useState<Word[]>([]);
  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? "", []);

  useEffect(() => { (async () => {
    const { data: c } = await supabase.from("clips").select("id,title,current_version,generation_id,project_id,candidate:clip_candidates(start_ms,end_ms,reason,scores)").eq("id", clipId).single();
    if (!c) return;
    const cand = (Array.isArray(c.candidate) ? c.candidate[0] : c.candidate) as { start_ms: number; end_ms: number; reason: string | null; scores: { overall?: number } | null } | null;
    const [{ data: v }, { data: g }, { data: p }] = await Promise.all([
      supabase.from("clip_versions").select("composition").eq("clip_id", clipId).eq("version", c.current_version).single(),
      supabase.from("generations").select("transcript_id").eq("id", c.generation_id).single(),
      supabase.from("projects").select("source_id").eq("id", c.project_id).single(),
    ]);
    const [{ data: tr }, { data: src }] = await Promise.all([supabase.from("transcripts").select("words").eq("id", g!.transcript_id).single(), supabase.from("sources").select("duration_ms,width,height").eq("id", p!.source_id).single()]);
    const comp = v!.composition as CompositionV2, startS = comp.fragments[0].start, endS = comp.fragments.at(-1)!.end;
    const words = (comp.words?.length ? comp.words : ((tr?.words as Word[]) ?? []).filter((w) => w.start >= startS && w.end <= endS + 0.05).map((w) => ({ ...w, start: +(w.start - startS).toFixed(3), end: +(w.end - startS).toFixed(3) })));
    setAllWords((tr?.words as Word[]) ?? []);
    const init: EditState = { comp, words }; hist.current = new History(init); setState(init);
    setMeta({ title: c.title, version: c.current_version, srcW: src?.width ?? 1920, srcH: src?.height ?? 1080, srcDur: (src?.duration_ms ?? 0) / 1000, sourceId: p!.source_id, startS: cand ? cand.start_ms / 1000 : startS, endS: cand ? cand.end_ms / 1000 : endS, reason: cand?.reason ?? null, overall: cand?.scores?.overall ?? null });
    saver.current = new Autosaver(async (s) => {
      const r = await fetch(`/api/clips/${clipId}/draft`, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ base_version: c.current_version, spec: { ...s.comp, words: s.words } }) });
      if (!r.ok) throw new Error("draft");
    }, setSave);
    const pr = await fetch(`/api/uploads/sources/${p!.source_id}/proxy`, { headers: { Authorization: `Bearer ${await token()}` } }); if (pr.ok) setProxy((await pr.json()).url);
  })(); }, [clipId, token]);

  const apply = useCallback((f: (s: EditState) => EditState) => { const h = hist.current; if (!h) return; const next = h.apply(f(h.present)); setState(next); saver.current?.edit(next); bump((x) => x + 1); }, []);
  const undo = () => { const n = hist.current?.undo(); if (n) { setState(n); saver.current?.edit(n); bump((x) => x + 1); } };
  const redo = () => { const n = hist.current?.redo(); if (n) { setState(n); saver.current?.edit(n); bump((x) => x + 1); } };
  const saveVersion = async () => {
    if (!state || !meta) return; setMsg(null);
    const r = await fetch(`/api/clips/${clipId}/versions`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ composition: { ...state.comp, words: state.words }, aspect: state.comp.aspect, layout: state.comp.layout, template: state.comp.template ?? null, base_version: meta.version }) });
    const b = await r.json();
    if (r.status === 201) { setMeta({ ...meta, version: b.version }); setMsg(`Versión ${b.version} guardada.`); }
    else if (r.status === 409) setMsg(`Otra pestaña guardó la versión ${b.conflict.current_version}. Recarga para no pisarla.`);
    else setMsg(b?.error?.message ?? "No se pudo guardar la versión.");
  };
  const duplicate = async () => { const { data, error } = await supabase.rpc("duplicate_clip", { p_clip: clipId }); if (error) setMsg("No se pudo duplicar."); else router.push(`/app/c/${data}`); };
  const lines = useMemo(() => state?.words ?? [], [state]);
  if (!state || !meta) return <main className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 md:px-8"><div className="skeleton h-40 w-full" /></main>;
  const h = hist.current!, dur = durationOf(state);
  const pclip: PClip = { id: clipId, title: meta.title, overall: meta.overall, reason: meta.reason, comp: state.comp, startS: meta.startS, endS: meta.endS };
  const range: [number, number] | null = sel ? [Math.min(...sel), Math.max(...sel)] : null;
  const btn = "btn btn-ghost !px-2 !py-1 text-xs";

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/app/p/${"" /* volver */}`} onClick={(e) => { e.preventDefault(); router.back(); }} className="text-sm text-[var(--muted)] underline">← Volver</Link>
        <h1 className="mx-2 min-w-0 flex-1 truncate text-2xl">{meta.title}</h1>
        <button type="button" className={btn} onClick={undo} disabled={!h.canUndo}>Deshacer</button><button type="button" className={btn} onClick={redo} disabled={!h.canRedo}>Rehacer</button>
        <button type="button" className={btn} onClick={duplicate}>Duplicar</button><button type="button" className="btn btn-primary !px-3 !py-1 text-xs" onClick={saveVersion}>Guardar versión</button>
        <span role="status" aria-live="polite" className="min-w-[120px] text-xs text-[var(--muted)]">{SAVE_TEXT[save]}</span>
      </div>
      {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr]">
        <div><PreviewPlayer clips={[pclip]} index={0} onIndex={() => {}} proxyUrl={proxy} src={{ w: meta.srcW, h: meta.srcH }} words={allWords} onEdit={() => {}} onExport={() => router.push(`/app/exportados`)} />
          <button type="button" className={`${btn} mt-2`} onClick={() => setFs(true)}>Pantalla completa</button></div>
        <section className="card p-4" aria-label="Herramientas de edición">
          <div role="tablist" className="mb-3 flex flex-wrap gap-2">{([["corte", "Corte"], ["texto", "Transcripción"], ["diseno", "Diseño"], ["audio", "Audio"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`${btn} ${tab === k ? "!bg-[var(--accent-soft)]" : ""}`}>{l}</button>)}</div>
          <p className="mb-3 text-xs text-[var(--muted)]">Duración {dur.toFixed(1)} s · versión {meta.version} · {state.comp.cuts?.length ?? 0} cortes</p>
          {tab === "corte" && (<div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><b>Inicio</b><button className={btn} onClick={() => apply((s) => stepFrame(s, "in", -1, meta.srcDur))}>−1 fotograma</button><button className={btn} onClick={() => apply((s) => stepFrame(s, "in", 1, meta.srcDur))}>+1 fotograma</button>
              <button className={btn} onClick={() => apply((s) => extend(s, "start", 2, meta.srcDur))}>Ampliar 2 s con el original</button></div>
            <div className="flex flex-wrap items-center gap-2"><b>Final</b><button className={btn} onClick={() => apply((s) => stepFrame(s, "out", -1, meta.srcDur))}>−1 fotograma</button><button className={btn} onClick={() => apply((s) => stepFrame(s, "out", 1, meta.srcDur))}>+1 fotograma</button>
              <button className={btn} onClick={() => apply((s) => extend(s, "end", 2, meta.srcDur))}>Ampliar 2 s con el original</button></div>
            <div><b>Fragmentos eliminados</b>{state.comp.cuts?.length ? <ul className="mt-1 space-y-1">{state.comp.cuts.map((c, i) => <li key={i} className="flex items-center gap-2 text-xs"><span className="tnum">{c.s.toFixed(1)}–{c.e.toFixed(1)} s</span><button className={btn} onClick={() => apply((s) => restoreRange(s, c.s, c.e))}>Restaurar</button></li>)}</ul> : <p className="mt-1 text-xs text-[var(--muted)]">Ninguno. Selecciona palabras en Transcripción para borrar un fragmento.</p>}</div>
          </div>)}
          {tab === "texto" && (<div className="space-y-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Pulsa una palabra para elegirla; pulsa otra con Mayús para seleccionar un tramo.</p>
            <div className="max-h-52 overflow-y-auto leading-8">{lines.map((w, i) => { const on = range && i >= range[0] && i <= range[1]; return <button key={i} type="button" onClick={(e) => setSel(e.shiftKey && sel ? [sel[0], i] : [i, i])} className={`mr-1 rounded px-1 ${on ? "bg-[var(--accent-soft)]" : ""}`}>{w.text}</button>; })}</div>
            {range && range[0] === range[1] && lines[range[0]] && (<div className="flex flex-wrap items-center gap-2"><input defaultValue={lines[range[0]].text} key={`${range[0]}-${lines[range[0]].text}`} onBlur={(e) => e.target.value !== lines[range[0]].text && apply((s) => editWordText(s, range[0], e.target.value))} className="rounded border hairline bg-transparent px-2 py-1" aria-label="Texto de la palabra" />
              <label className="text-xs">Inicio <input type="number" step={0.05} defaultValue={lines[range[0]].start} onBlur={(e) => apply((s) => setWordTiming(s, range[0], Number(e.target.value), s.words[range[0]].end))} className="w-20 rounded border hairline bg-transparent px-1" /></label>
              <label className="text-xs">Fin <input type="number" step={0.05} defaultValue={lines[range[0]].end} onBlur={(e) => apply((s) => setWordTiming(s, range[0], s.words[range[0]].start, Number(e.target.value)))} className="w-20 rounded border hairline bg-transparent px-1" /></label></div>)}
            {range && <button className={btn} onClick={() => { apply((s) => deleteWords(s, range[0], range[1])); setSel(null); }}>Borrar la selección del vídeo</button>}
          </div>)}
          {tab === "diseno" && (<div className="grid gap-3 text-sm sm:grid-cols-3">
            <label>Diseño<select className="mt-1 w-full rounded border hairline bg-transparent px-2 py-1.5" value={state.comp.layout} onChange={(e) => apply((s) => setLayout(s, e.target.value as LayoutId))}>{LAYOUT_IDS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}</select></label>
            <label>Plantilla<select className="mt-1 w-full rounded border hairline bg-transparent px-2 py-1.5" value={state.comp.template ?? ""} onChange={(e) => e.target.value && apply((s) => applyTemplate(s, e.target.value as ViralTemplateId))}><option value="">—</option>{VIRAL_TEMPLATE_IDS.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}</select></label>
            <label>Formato<select className="mt-1 w-full rounded border hairline bg-transparent px-2 py-1.5" value={state.comp.aspect} onChange={(e) => apply((s) => setAspect(s, e.target.value as CompositionV2["aspect"]))}>{ASPECT_IDS.map((a) => <option key={a}>{a}</option>)}</select></label>
            <p className="text-xs text-[var(--muted)] sm:col-span-3">Cambiar de diseño o plantilla conserva el contenido y la edición (cortes, subtítulos, audio). No vuelve a analizar el vídeo ni gasta unidades.</p>
          </div>)}
          {tab === "audio" && <label className="block text-sm">Volumen del clip · <span className="tnum">{Math.round(state.comp.audio.volume * 100)} %</span><input type="range" min={0} max={2} step={0.05} value={state.comp.audio.volume} onChange={(e) => apply((s) => setVolume(s, Number(e.target.value)))} className="mt-1 w-full" /></label>}
        </section>
      </div>
      {fs && <PreviewPlayer fullscreen clips={[pclip]} index={0} onIndex={() => {}} onClose={() => setFs(false)} proxyUrl={proxy} src={{ w: meta.srcW, h: meta.srcH }} words={allWords} onEdit={() => setFs(false)} onExport={() => router.push(`/app/exportados`)} />}
    </main>
  );
}
