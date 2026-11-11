"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { PRESETS, validateStyle, exportStyle, importStyle, surpriseStyle, fxOf, type SubtitleStyle, type SubtitleFx, type EntryFx } from "@rafaga/composition";
import { supabase } from "../../../lib/supabase";
import { useTextStyles, type SavedStyle } from "../../../lib/textStyles";
import { useWorkspaceFonts } from "../../../lib/fonts";
import LyricSample from "../../../components/LyricSample";
import Icon from "../../../components/Icon";
import BrandTabs from "../../../components/BrandTabs";

const SAMPLES = ["bajo la luna de abril caminamos", "no me digas que no", "y si el mañana nos espera ya"];
type Draft = { id: string | null; name: string; style: SubtitleStyle };

export default function StyleStudio() {
  const { saved, reload } = useTextStyles();
  const { fonts } = useWorkspaceFonts();
  const [draft, setDraft] = useState<Draft>({ id: null, name: "Mi estilo", style: PRESETS.Letra });
  const [history, setHistory] = useState<SubtitleStyle[]>([]);
  const [dirty, setDirty] = useState(false);
  const [dark, setDark] = useState(true);
  const [play, setPlay] = useState(true);
  const [sample, setSample] = useState(SAMPLES[0]);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [seed, setSeed] = useState(1);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (!play || reduce) { if (reduce) setStep(2); return; } const i = setInterval(() => setStep((s) => s + 1), 520); return () => clearInterval(i); }, [play]);

  const set = (patch: Partial<SubtitleStyle>) => { setHistory((h) => [...h.slice(-30), draft.style]); setDraft((d) => ({ ...d, style: validateStyle({ ...d.style, ...patch }, d.style) })); setDirty(true); };
  const load = (name: string, style: SubtitleStyle, id: string | null) => { setDraft({ id, name, style }); setHistory([]); setDirty(false); setMsg(null); };
  const undo = () => { const h = history[history.length - 1]; if (!h) return; setHistory((x) => x.slice(0, -1)); setDraft((d) => ({ ...d, style: h })); setDirty(true); };

  async function ws() { const { data } = await supabase.from("workspaces").select("id").limit(1).single(); return data?.id as string; }
  async function save(asNew: boolean) {
    const name = draft.name.trim(); if (!name) return setMsg("Ponle un nombre al estilo.");
    const { data: s } = await supabase.auth.getSession();
    if (draft.id && !asNew) {
      const { error } = await supabase.from("text_styles").update({ name, style: draft.style }).eq("id", draft.id);
      if (error) return setMsg(error.code === "23505" ? "Ya tienes un estilo con ese nombre." : error.message);
      setMsg("Cambios guardados."); setDirty(false); return reload();
    }
    const { data, error } = await supabase.from("text_styles").insert({ workspace_id: await ws(), name, style: draft.style, created_by: s.session?.user.id }).select("id").single();
    if (error) return setMsg(error.code === "23505" ? "Ya tienes un estilo con ese nombre. Cambia el nombre." : error.message);
    setDraft((d) => ({ ...d, id: data.id })); setMsg("Estilo guardado en «Mis estilos»."); setDirty(false); reload();
  }
  async function remove(st: SavedStyle) {
    if (!confirm(`¿Borrar el estilo «${st.name}»? Los clips que ya lo usaron conservan su aspecto.`)) return;
    await supabase.from("text_styles").delete().eq("id", st.id);
    if (draft.id === st.id) setDraft((d) => ({ ...d, id: null }));
    reload();
  }
  function duplicate(st: SavedStyle) { load(`${st.name} (copia)`, st.style, null); setDirty(true); }
  function doExport() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([exportStyle(draft.name, draft.style)], { type: "application/json" })); a.download = `${draft.name.replace(/[^\w-]+/g, "-") || "estilo"}.rafaga-style.json`; a.click(); URL.revokeObjectURL(a.href); }
  async function doImport(f: File | undefined) {
    if (!f) return; if (f.size > 20000) return setMsg("El archivo es demasiado grande para ser un estilo.");
    const r = importStyle(await f.text()); if (!r) return setMsg("Ese archivo no es un estilo de Ráfaga válido.");
    load(r.name, r.style, null); setDirty(true); setMsg("Estilo importado. Revísalo y guárdalo.");
  }

  const fontOptions = useMemo(() => ["Bootzy TM", "Arial", ...(fonts ?? []).map((f) => f.family)], [fonts]);
  const s = draft.style;
  const fx = fxOf(s);
  const setFx = (patch: Partial<SubtitleFx>) => set({ fx: { ...s.fx, ...patch } });
  const [kwText, setKwText] = useState("");
  useEffect(() => { setKwText(fxOf(draft.style).keywords.join(", ")); }, [draft.id, draft.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const bg = dark ? "#151515" : "#F2F2F2";
  const Range = ({ label, k, min, max, step: st = 1, fmt = (v: number) => String(v) }: { label: string; k: keyof SubtitleStyle; min: number; max: number; step?: number; fmt?: (v: number) => string }) => (
    <label className="block text-sm">{label} <span className="mono text-[var(--muted)]">{fmt(s[k] as number)}</span>
      <input type="range" min={min} max={max} step={st} value={s[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<SubtitleStyle>)} className="mt-1 w-full" /></label>
  );

  return (
    <>
    <BrandTabs />
<main className="mx-auto max-w-7xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">Style Studio</h1><p className="mt-1 text-[var(--muted)]">Crea el estilo de texto de tus clips y vídeos con letra. Lo que ves en la vista previa es lo que sale en el MP4.</p></header>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Estilos */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-3">
            <div className="mb-2 px-1 text-sm font-medium">Estilos base</div>
            <ul className="grid grid-cols-2 gap-2">{Object.entries(PRESETS).map(([k, v]) => (
              <li key={k}><button onClick={() => load(k, v, null)} aria-label={`Usar «${k}» de base`} className="w-full overflow-hidden rounded-lg border hairline text-left hover:border-[var(--ink)]"><span className="grid h-14 place-items-center bg-[#151515]"><LyricSample style={{ ...v, fontName: v.fontName }} text="bajo la luna" scale={0.17} step={2} /></span><span className="flex items-center justify-between px-2 py-1 text-xs"><span className="truncate">{k}</span>{v.fx && <span className="text-[10px] text-[var(--muted)]">fx</span>}</span></button></li>))}</ul>
            <p className="mt-2 px-1 text-[11px] text-[var(--muted)]">{Object.keys(PRESETS).length} tratamientos. «fx» = entrada animada, caja o palabras clave.</p>
          </div>
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between px-1"><span className="text-sm font-medium">Mis estilos</span><span className="mono text-xs text-[var(--muted)]">{saved?.length ?? 0}</span></div>
            {saved === null && <div className="skeleton h-10" />}
            {saved?.length === 0 && <p className="px-1 text-sm text-[var(--muted)]">Aún no has guardado ninguno. Ajusta un estilo y pulsa «Guardar nuevo».</p>}
            <ul className="space-y-1">{saved?.map((st) => (
              <li key={st.id} className={`rounded-lg ${draft.id === st.id ? "bg-[var(--hover)]" : ""}`}>
                <button onClick={() => load(st.name, st.style, st.id)} className="grid h-14 w-full place-items-center overflow-hidden rounded-lg bg-[#151515]" aria-label={`Abrir ${st.name}`}><LyricSample style={st.style} text="bajo la luna" scale={0.2} step={step} /></button>
                <div className="flex items-center justify-between px-1 py-1 text-xs"><span className="truncate font-medium">{st.name}</span><span className="flex shrink-0 gap-2"><button className="underline" onClick={() => duplicate(st)}>Duplicar</button><button className="underline" onClick={() => remove(st)}>Borrar</button></span></div>
              </li>))}</ul>
          </div>
        </aside>

        {/* Controles */}
        <section className="card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">Nombre<input value={draft.name} onChange={(e) => { setDraft((d) => ({ ...d, name: e.target.value })); setDirty(true); }} maxLength={60} className="input mt-1" /></label>
            <button onClick={undo} disabled={!history.length} className="btn btn-ghost">Deshacer</button>
            <button onClick={() => { const n = seed + 1; setSeed(n); setHistory((h) => [...h.slice(-30), draft.style]); setDraft((d) => ({ ...d, style: surpriseStyle(n, d.style.fontName) })); setDirty(true); }} className="btn btn-ghost"><Icon n="wand" className="h-4 w-4" />Sorpréndeme</button>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Tipografía</legend>
              <label className="block text-sm">Fuente<select value={s.fontName} onChange={(e) => set({ fontName: e.target.value, bold: e.target.value === "Bootzy TM" ? false : s.bold })} className="input mt-1">{fontOptions.map((f) => <option key={f}>{f}</option>)}</select></label>
              <Range label="Tamaño" k="fontSize" min={40} max={160} />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mayúsculas">
                {([["Normal", false, false], ["MAYÚSCULAS", true, false], ["minúsculas", false, true]] as const).map(([l, u, lo]) => <button key={l} className="chip" aria-pressed={!!s.uppercase === u && !!s.lowercase === lo} onClick={() => set({ uppercase: u, lowercase: lo })}>{l}</button>)}
                <button className="chip" aria-pressed={s.bold !== false} onClick={() => set({ bold: s.bold === false })}>Negrita</button>
              </div></fieldset>
            <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Color y efectos</legend>
              <div className="grid grid-cols-3 gap-2 text-sm">{([["Texto", "primary"], ["Activa", "active"], ["Contorno", "outline"]] as const).map(([l, k]) => <label key={k}>{l}<input type="color" value={s[k]} onChange={(e) => set({ [k]: e.target.value.toUpperCase() } as Partial<SubtitleStyle>)} className="mt-1 block h-9 w-full rounded-lg border hairline bg-white" /></label>)}</div>
              <Range label="Contorno" k="outlineWidth" min={0} max={14} /><Range label="Sombra" k="shadow" min={0} max={10} /></fieldset>
            <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Animación de la palabra activa</legend>
              <div role="radiogroup" className="grid gap-1.5">{([["color", "Cambia de color", "La palabra que suena se ilumina."], ["reveal", "Aparece al cantarse", "Las palabras entran según suenan."], ["dim", "Resto atenuado", "Toda la frase visible, lo que falta tenue."]] as const).map(([k, l, d]) => (
                <button key={k} role="radio" aria-checked={s.highlight === k} onClick={() => set({ highlight: k })} className={`rounded-xl border p-2.5 text-left text-sm ${s.highlight === k ? "border-[var(--ink)] ring-1 ring-[#111]" : "hairline hover:bg-[var(--hover)]"}`}><span className="font-medium">{l}</span><span className="block text-xs text-[var(--muted)]">{d}</span></button>))}</div></fieldset>
            <fieldset className="space-y-3 sm:col-span-2"><legend className="mb-1 text-sm font-medium">Compositor (se exporta al MP4)</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3 text-sm">
                  <label className="block">Entrada del bloque<select value={fx.entry} onChange={(e) => setFx({ entry: e.target.value as EntryFx })} className="input mt-1">{([["none", "Corte directo"], ["fade", "Fundido"], ["pop", "Pop (escala)"], ["rise", "Sube"], ["drop", "Cae"], ["blur", "Desenfoque a nítido"]] as const).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  {fx.entry !== "none" && <label className="block">Duración de la entrada <span className="mono text-[var(--muted)]">{fx.entryMs} ms</span><input type="range" min={60} max={800} step={20} value={fx.entryMs} onChange={(e) => setFx({ entryMs: Number(e.target.value) })} className="mt-1 w-full" /></label>}
                  <label className="block">Fundido de salida <span className="mono text-[var(--muted)]">{fx.exitFade ? `${fx.exitFade} ms` : "corte"}</span><input type="range" min={0} max={600} step={20} value={fx.exitFade} onChange={(e) => setFx({ exitFade: Number(e.target.value) })} className="mt-1 w-full" /></label>
                  <label className="block">Espaciado entre letras <span className="mono text-[var(--muted)]">{fx.spacing} px</span><input type="range" min={-2} max={12} step={1} value={fx.spacing} onChange={(e) => setFx({ spacing: Number(e.target.value) })} className="mt-1 w-full" /></label>
                  <label className="block">Suavizado de bordes <span className="mono text-[var(--muted)]">{fx.soften}</span><input type="range" min={0} max={6} step={1} value={fx.soften} onChange={(e) => setFx({ soften: Number(e.target.value) })} className="mt-1 w-full" /></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={fx.italic} onChange={(e) => setFx({ italic: e.target.checked })} />Cursiva</label>
                </div>
                <div className="space-y-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!fx.box} onChange={(e) => setFx({ box: e.target.checked ? { color: "#000000", opacity: 0.8, pad: 12 } : null })} />Caja de color detrás del texto</label>
                  {fx.box && <div className="grid grid-cols-3 items-end gap-2"><label className="text-xs">Color<input type="color" value={fx.box.color} onChange={(e) => setFx({ box: { ...fx.box!, color: e.target.value.toUpperCase() } })} className="mt-1 block h-9 w-full rounded-lg border hairline bg-white" /></label><label className="text-xs">Opacidad<input type="range" min={0.1} max={1} step={0.05} value={fx.box.opacity} onChange={(e) => setFx({ box: { ...fx.box!, opacity: Number(e.target.value) } })} className="mt-2 w-full" /></label><label className="text-xs">Margen<input type="range" min={2} max={40} step={1} value={fx.box.pad} onChange={(e) => setFx({ box: { ...fx.box!, pad: Number(e.target.value) } })} className="mt-2 w-full" /></label></div>}
                  <label className="block">Palabras clave (separadas por comas)<input value={kwText} onChange={(e) => setKwText(e.target.value)} onBlur={() => setFx({ keywords: kwText.split(",").map((k) => k.trim()).filter(Boolean) })} placeholder="dinero, error, nunca" className="input mt-1" /></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={fx.keywordsAuto} onChange={(e) => setFx({ keywordsAuto: e.target.checked })} />Además, cifras y palabras de 7+ letras</label>
                  <label className="block text-xs">Color de palabras clave<input type="color" value={fx.keywordColor} onChange={(e) => setFx({ keywordColor: e.target.value.toUpperCase() })} className="mt-1 block h-9 w-24 rounded-lg border hairline bg-white" /></label>
                </div>
              </div>
              <p className="text-xs text-[var(--muted)]">La vista previa aproxima la animación; el MP4 usa el mismo motor de subtítulos (libass) con estos mismos valores. Las palabras clave son una heurística sencilla, no un análisis de significado.</p>
            </fieldset>
            <fieldset className="space-y-3"><legend className="mb-1 text-sm font-medium">Composición</legend>
              <Range label="Posición vertical" k="y" min={0.1} max={0.92} step={0.01} fmt={(v) => `${Math.round(v * 100)} %`} />
              <Range label="Líneas máximas" k="maxLines" min={1} max={3} /><Range label="Caracteres por línea" k="maxCharsPerLine" min={8} max={40} /><Range label="Palabras por bloque" k="maxWordsPerGroup" min={1} max={12} /></fieldset>
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">Aún no incluye: animación por letra, degradados, capas múltiples ni efectos con semilla aleatoria. Lo que ves aquí sí se exporta.</p>
        </section>

        {/* Vista previa + acciones */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-2xl border hairline" style={{ background: bg }}>
            <div className="grid aspect-[9/16] max-h-[460px] w-full place-items-center" style={{ color: dark ? "#fff" : "#111" }}><div style={{ marginTop: `${(s.y - 0.5) * 180}%` }}><LyricSample style={s} text={sample} scale={0.3} step={step} /></div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" aria-pressed={dark} onClick={() => setDark(true)}>Fondo oscuro</button><button className="chip" aria-pressed={!dark} onClick={() => setDark(false)}>Fondo claro</button>
            <button className="chip ml-auto" onClick={() => setPlay(!play)} aria-pressed={play}><Icon n="play" className="h-3 w-3" />{play ? "Pausar" : "Reproducir"}</button>
          </div>
          <label className="block text-sm">Texto de prueba<select value={sample} onChange={(e) => setSample(e.target.value)} className="input mt-1">{SAMPLES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <div className="card space-y-2 p-3">
            <div className="grid grid-cols-2 gap-2"><button onClick={() => save(false)} disabled={!draft.id || !dirty} className="btn btn-primary">Guardar cambios</button><button onClick={() => save(true)} className="btn btn-ghost">Guardar nuevo</button></div>
            <div className="grid grid-cols-2 gap-2"><button onClick={doExport} className="btn btn-ghost">Exportar</button><button onClick={() => importRef.current?.click()} className="btn btn-ghost">Importar</button></div>
            <input ref={importRef} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ""; }} />
            <p role="status" aria-live="polite" className="min-h-4 text-xs text-[var(--muted)]">{msg ?? (dirty ? "Cambios sin guardar." : "")}</p>
            <p className="text-xs text-[var(--muted)]">Tus estilos aparecen en el editor de clips (Estilo → Preset) y en Lyric Studio.</p>
          </div>
        </aside>
      </div>
    </main>
    </>
  );
}
