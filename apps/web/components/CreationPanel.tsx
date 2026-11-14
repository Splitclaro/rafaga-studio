"use client";
// Panel de creación (al estilo de las herramientas de referencia): el usuario decide el RESULTADO antes de generar.
// Receta · brand kit · modo · duración · momentos a incluir · intervalo · subtítulos (estilo, fuente, colores, tamaño, posición) ·
// gancho · formato y plantilla viral · resumen con consumo y estimación · Crear (idempotente).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { DEFAULT_CAPTION, captionToSubtitleStyle, type BehaviourPresetId, type CaptionStyleV2 } from "@rafaga/composition";
import CaptionStyleEditor from "./CaptionStyleEditor";
import {
  MODES, MODE_LABEL, DURATION_BUCKETS, BUCKET_LABEL, RECIPES, RECIPE_LABEL, VIRAL_TEMPLATES, TEMPLATE_LABEL, ASPECTS, CAPTION_PRESETS, CAPTION_DEFAULT,
  type Bucket, type Recipe, type Mode, type CaptionStyle, type GenerationParams,
} from "../lib/generations";

const FONTS = ["Inter", "Montserrat", "Bebas Neue", "Anton", "Oswald", "Roboto", "Raleway", "Nunito", "Bootzy TM"];
const PRESET_LABEL: Record<string, string> = { palabra_a_palabra: "Palabra a palabra", corte_por_palabra: "Corte por palabra", barrido_marcador: "Barrido marcador", palabras_clave: "Palabras clave", karaoke: "Karaoke", caja: "Caja", contorno: "Contorno", neon: "Neón" };
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const parse = (s: string) => { const p = s.trim().split(":").map(Number); return p.some((x) => !Number.isFinite(x)) ? NaN : p.reduce((t, x) => t * 60 + x, 0) * 1000; };
type Est = { minutes: number; units: { processing: number; clipping: number; hook: number; total: number }; balance: number; eta: { p50_s: number; p90_s: number } | null; reusable_analysis: boolean; viable_count: number; requested_count: number | null; summary: string[] };

export default function CreationPanel({ projectId, durationMs, onCreated }: { projectId: string; durationMs: number; onCreated?: (r: { generation_id: string; job_id: string }) => void }) {
  const [recipe, setRecipe] = useState<Recipe>(() => { try { const r = new URLSearchParams(window.location.search).get("receta"); return (RECIPES as readonly string[]).includes(r ?? "") ? (r as Recipe) : "clips"; } catch { return "clips"; } });
  const [mode, setMode] = useState<Mode>("cualquier_momento");
  const [duration, setDuration] = useState<Bucket>("auto");
  const [count, setCount] = useState<string>("");
  const [brief, setBrief] = useState(""), [exclude, setExclude] = useState("");
  const [from, setFrom] = useState("0:00"), [to, setTo] = useState(mmss(durationMs));
  const [subs, setSubs] = useState(true), [style, setStyle] = useState<CaptionStyle>(CAPTION_DEFAULT);
  // Con NEXT_PUBLIC_LYRIC_VERSION=v2 el estilo se edita con el MISMO editor que Lyric Studio; `caption_style` conserva su forma validada
  // (preset, font, colores, tamaño, posición) y añade `subtitle_style` = captionToSubtitleStyle(v2) para el motor compartido.
  const lyricV2 = (process.env.NEXT_PUBLIC_LYRIC_VERSION ?? "").trim().toLowerCase() === "v2";
  const [cap2, setCap2] = useState<CaptionStyleV2>(DEFAULT_CAPTION), [beh, setBeh] = useState<BehaviourPresetId>("frase_palabra_activa");
  const style2 = useMemo(() => ({ ...style, font: cap2.font, color: cap2.color, active_color: cap2.activeColor, size: cap2.size, position: (cap2.position.y < 0.35 ? "top" : cap2.position.y < 0.65 ? "middle" : "bottom") as CaptionStyle["position"], subtitle_style: captionToSubtitleStyle(cap2) }), [style, cap2]);
  const [hook, setHook] = useState(false), [hookN, setHookN] = useState(10), [hookStyle, setHookStyle] = useState<"editorial" | "statement" | "classic">("editorial");
  const [durSet, setDurSet] = useState<Bucket[]>([]), [subLang, setSubLang] = useState(""), [open, setOpen] = useState<null | "picks" | "len" | "prompt" | "premium" | "recipes">(null), [recTab, setRecTab] = useState<"built" | "mine">("built"), [showSettings, setShowSettings] = useState(true), [clipping, setClipping] = useState(true);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("9:16"), [template, setTemplate] = useState<string>("titular_video_subtitulos");
  const [brandKit, setBrandKit] = useState(""), [kits, setKits] = useState<{ id: string; name: string }[]>([]);
  const [recipes, setRecipes] = useState<{ id: string; name: string; params: Partial<GenerationParams> }[]>([]);
  const [est, setEst] = useState<Est | null>(null), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const idem = useRef<string | null>(null);

  const params = useMemo(() => ({ ...(subLang ? { subtitle_language: subLang } : {}),
    recipe: recipe === "clips" && !clipping ? "captions" : recipe, mode, duration: durSet[0] ?? duration, ...(durSet.length ? { duration_set: durSet } : {}), count: count ? Number(count) : null, range_start_ms: parse(from), range_end_ms: parse(to), language: "auto", brief: [brief.trim(), exclude.trim() ? `Evitar: ${exclude.trim()}` : ""].filter(Boolean).join("\n") || undefined,
    exclude: exclude.trim() || undefined, aspect, template: recipe === "clips" || recipe === "reframe" ? template : undefined, subtitles: subs, caption_style: subs ? (lyricV2 ? style2 : style) : undefined, hook: hook ? { enabled: true, template: hookStyle, top_n: hookN } : undefined, brand_kit_id: brandKit || undefined,
  }), [recipe, clipping, mode, duration, durSet, subLang, hookStyle, count, from, to, brief, exclude, aspect, template, subs, style, style2, lyricV2, hook, hookN, brandKit]);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";
  useEffect(() => { (async () => {
    const [k, r] = await Promise.all([supabase.from("brand_kits").select("id,name").order("created_at"), supabase.from("generation_recipes").select("id,name,params").order("created_at")]);
    setKits((k.data ?? []) as never); setRecipes((r.data ?? []) as never);
  })(); }, []);

  // Estimación en vivo (con un pequeño retardo para no llamar en cada tecla).
  useEffect(() => {
    if (!Number.isFinite(params.range_start_ms) || !Number.isFinite(params.range_end_ms)) { setEst(null); return; }
    const t = setTimeout(async () => {
      const r = await fetch("/api/generations/estimate", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, params }) });
      const b = await r.json();
      if (r.ok) { setEst(b); setMsg(null); } else { setEst(null); setMsg(b?.error?.message ?? null); }
    }, 400);
    return () => clearTimeout(t);
  }, [params, projectId]);

  const create = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    idem.current ??= `gen-${crypto.randomUUID()}`;       // misma clave en reintentos del mismo envío: nunca duplica trabajo ni cobro
    try {
      const r = await fetch("/api/generations", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "Idempotency-Key": idem.current }, body: JSON.stringify({ project_id: projectId, params }) });
      const b = await r.json();
      if (r.status === 202) { onCreated?.(b); return; }
      idem.current = null;
      setMsg(r.status === 402 ? `Te faltan unidades: necesitas ${b.needed} y tienes ${b.balance}.` : b?.error?.message ?? "No se pudo crear.");
    } finally { setBusy(false); }
  };

  const saveRecipe = async () => {
    const name = window.prompt("Nombre de la receta"); if (!name?.trim()) return;
    const { error } = await supabase.from("generation_recipes").insert({ name: name.trim().slice(0, 80), params: { ...params, range_start_ms: undefined, range_end_ms: undefined } });
    setMsg(error ? "No se pudo guardar la receta." : "Receta guardada."); const r = await supabase.from("generation_recipes").select("id,name,params").order("created_at"); setRecipes((r.data ?? []) as never);
  };
  const applyRecipe = (id: string) => {
    const r = recipes.find((x) => x.id === id)?.params; if (!r) return;
    if (r.recipe) setRecipe(r.recipe); if (r.mode) setMode(r.mode); if (r.duration) setDuration(r.duration); setCount(r.count ? String(r.count) : "");
    if (r.aspect) setAspect(r.aspect); if (r.template) setTemplate(r.template); if (typeof r.subtitles === "boolean") setSubs(r.subtitles); if (r.caption_style) setStyle({ ...CAPTION_DEFAULT, ...r.caption_style });
    if (r.hook) { setHook(r.hook.enabled); setHookN(r.hook.top_n); } if (r.brand_kit_id) setBrandKit(r.brand_kit_id);
  };

  const field = "w-full rounded-lg border hairline bg-transparent px-3 py-2 text-sm";
  const MODE_HINT: Record<Mode, string> = { cualquier_momento: "Tramos con sentido de cualquier parte del vídeo, hasta llegar al número pedido (ideal para videoclips y directos).", automatico: "Los de más gancho, desarrollo y valor. Es una estimación, no una garantía.", por_tema: "Solo lo que pidas en «Momentos a incluir».", pregunta_respuesta: "Conserva la pregunta y termina cuando se completa la respuesta.", educativo: "Explicaciones, consejos y pasos completos.", historia: "Anécdotas con planteamiento y desenlace.", destacados: "Subidas de energía y cambios de escena.", manual: "Tú eliges los fragmentos." };
  const RECIPE_HINT: Record<Recipe, string> = { clips: "La IA busca los mejores momentos y los convierte en clips cortos.", captions: "Añade subtítulos animados a tu vídeo en un clic.", reframe: "Reencuadra el vídeo para cada formato sin recortar a mano.", cleanup: "Limpia la grabación: silencios, muletillas y audio." };
  const lenLabel = durSet.length ? durSet.map((b) => BUCKET_LABEL[b].replace(/ \(.*\)/, "")).join(", ") : "Auto (0–3 min)";
  const Switch = ({ on, set, label, disabled }: { on: boolean; set?: (v: boolean) => void; label: string; disabled?: boolean }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set?.(!on)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--ink)]" : "bg-[var(--border-2)]"} ${disabled ? "opacity-40" : ""}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} /></button>);
  const Row = ({ glyph, title, on, set, soon, children }: { glyph: string; title: string; on?: boolean; set?: (v: boolean) => void; soon?: boolean; children?: React.ReactNode }) => (
    <div className="border-t hairline pt-4">
      <div className="flex items-center gap-3"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg border hairline bg-[var(--surface)] text-sm">{glyph}</span><b className="flex-1 text-sm">{title}</b>
        {soon ? <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--muted)]">Próximamente</span> : <Switch on={!!on} set={set} label={title} />}</div>
      {!soon && on !== false && children ? <div className="mt-3 space-y-3 pl-11">{children}</div> : null}</div>);
  const Pop = ({ id, label, children }: { id: NonNullable<typeof open>; label: string; children: React.ReactNode }) => (
    <span className="relative inline-block">
      <button type="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm hover:bg-[var(--hover)]">{label}<span aria-hidden className="text-[10px]">▾</span></button>
      {open === id && <div role="dialog" className="card-raised absolute left-0 top-full z-20 mt-1 w-[320px] p-2">{children}</div>}</span>);
  const toggleLen = (b: Bucket) => setDurSet((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  const LANGS: [string, string][] = [["", "Sin traducir"], ["en", "Inglés"], ["es", "Español"], ["fr", "Francés"], ["pt", "Portugués"], ["de", "Alemán"], ["it", "Italiano"]];
  const RECS = RECIPES.map((r) => ({ id: r, name: RECIPE_LABEL[r], desc: RECIPE_HINT[r], tag: r === "clips" ? "Clipping" : r === "captions" ? "Subtítulos" : r === "reframe" ? "Reencuadre" : "Limpieza" }));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="card space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => { setRecTab("built"); setOpen("recipes"); }} className="flex items-center gap-3 rounded-2xl border hairline bg-[var(--surface)] p-3 text-left hover:bg-[var(--hover)]">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--ink)] text-white">▦</span><span className="flex-1 text-sm font-medium">Receta</span><span className="text-sm text-[var(--muted)]">{RECIPE_LABEL[recipe]} ▾</span></button>
          <label className="flex items-center gap-3 rounded-2xl border hairline bg-[var(--surface)] p-3">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--ink)] text-white">◈</span><span className="flex-1 text-sm font-medium">Brand kit</span>
            <select className="max-w-[140px] bg-transparent text-sm text-[var(--muted)]" value={brandKit} onChange={(e) => setBrandKit(e.target.value)} aria-label="Brand kit"><option value="">Sin brand kit</option>{kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
        </div>
        <p className="text-sm text-[var(--muted)]">La receta define qué ediciones se aplican. El brand kit define el aspecto: logo, intro, cierre y estilo de subtítulos.</p>
        {open === "recipes" && (
          <div role="dialog" aria-label="Gestionar recetas" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(null)}>
            <div className="card-raised max-h-[85vh] w-full max-w-3xl overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg">Gestionar recetas</h2><p className="text-sm text-[var(--muted)]">Guarda tus recetas de autoedición para reutilizarlas.</p></div><button className="btn btn-ghost !px-3" onClick={() => setOpen(null)} aria-label="Cerrar">✕</button></div>
              <div className="mt-3 flex items-center gap-2 border-b hairline">
                {([["built", "Recetas de Ráfaga"], ["mine", "Mis recetas"]] as const).map(([k, l]) => <button key={k} onClick={() => setRecTab(k)} aria-pressed={recTab === k} className={`px-3 py-2 text-sm ${recTab === k ? "border-b-2 border-[var(--ink)] font-semibold" : "text-[var(--muted)]"}`}>{l}</button>)}
                <button className="btn btn-ghost ml-auto !py-1.5 !text-xs" onClick={() => { setOpen(null); void saveRecipe(); }}>+ Crear receta nueva</button></div>
              {recTab === "built" ? <ul className="mt-4 grid gap-3 sm:grid-cols-2">{RECS.map((r) => <li key={r.id}><button onClick={() => { setRecipe(r.id); setOpen(null); }} className={`h-full w-full rounded-2xl border p-4 text-left hover:bg-[var(--hover)] ${recipe === r.id ? "border-[var(--ink)]" : "hairline"}`}><b className="block text-sm">{r.name}</b><span className="mt-1 block text-xs text-[var(--muted)]">{r.desc}</span><span className="mt-2 inline-block rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px]">{r.tag}</span></button></li>)}</ul>
                : <ul className="mt-4 space-y-2">{recipes.length ? recipes.map((r) => <li key={r.id}><button onClick={() => { applyRecipe(r.id); setOpen(null); }} className="w-full rounded-xl border hairline p-3 text-left text-sm hover:bg-[var(--hover)]">{r.name}</button></li>) : <li className="text-sm text-[var(--muted)]">Aún no has guardado ninguna receta. Ajusta la configuración y pulsa «Crear receta nueva».</li>}</ul>}
            </div></div>)}

        <div className="flex items-center justify-between"><button type="button" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} className="text-sm font-medium">Ajustes de la receta {showSettings ? "▴" : "▾"}</button>
          <select className="rounded-lg border hairline bg-transparent px-2 py-1 text-xs" defaultValue="" onChange={(e) => e.target.value && applyRecipe(e.target.value)} aria-label="Mis recetas"><option value="">Mis recetas…</option>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>

        {showSettings && (<div className="space-y-4">
          {recipe === "clips" && (
            <div>
              <div className="flex items-center gap-3"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg border hairline bg-[var(--surface)]">✂</span><b className="flex-1 text-sm">Clipping</b><Switch on={clipping} set={setClipping} label="Clipping" /></div>
              {clipping && <div className="mt-3 space-y-3 pl-11">
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--muted)]">
                  <span>La IA elige:</span>
                  <Pop id="picks" label={MODE_LABEL[mode]}>
                    <ul>{MODES.map((m) => <li key={m}><button type="button" onClick={() => { setMode(m); setOpen(null); }} className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-[var(--hover)]"><span className="mt-0.5 w-4">{mode === m ? "✓" : ""}</span><span><b className="block text-sm text-[var(--text)]">{MODE_LABEL[m]}</b><span className="text-xs">{MODE_HINT[m]}</span></span></button></li>)}</ul></Pop>
                  <span>Duración del clip:</span>
                  <Pop id="len" label={lenLabel}>
                    <ul>{(Object.keys(DURATION_BUCKETS) as Bucket[]).map((b) => <li key={b}><label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm text-[var(--text)] hover:bg-[var(--hover)]"><input type="checkbox" checked={b === "auto" ? durSet.length === 0 : durSet.includes(b)} onChange={() => (b === "auto" ? setDurSet([]) : toggleLen(b))} />{b === "auto" ? "Auto (0–3 min)" : BUCKET_LABEL[b]}</label></li>)}</ul></Pop>
                  <span>Clips:</span>
                  <select className="rounded-lg bg-transparent px-1 py-1 text-sm" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Número de clips"><option value="">Los que haya</option>{[3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                </div>
                <label className="block"><span className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--muted)]">Momentos a incluir (opcional)
                  <Pop id="prompt" label="Cómo escribirlo"><p className="p-2 text-xs text-[var(--text)]">Di qué quieres encontrar, para quién y con qué tono. Ejemplo: «todos los momentos graciosos», «los consejos para principiantes». Es una estimación de la IA, no una garantía.</p></Pop></span>
                  <textarea className={field} rows={2} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ejemplo: busca todos los momentos en los que alguien se ríe o cuenta una anécdota" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-[var(--muted)]">Evitar (opcional)</span>
                  <input className={field} maxLength={1000} value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Ejemplo: el patrocinador, la despedida" /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><span className="mb-1 block text-xs font-medium text-[var(--muted)]">Desde</span><input className={field} value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" aria-label="Inicio del tramo" /></label>
                  <label><span className="mb-1 block text-xs font-medium text-[var(--muted)]">Hasta (de {mmss(durationMs)})</span><input className={field} value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" aria-label="Final del tramo" /></label></div>
              </div>}
            </div>)}

          <Row glyph="CC" title="Subtítulos" on={subs} set={setSubs}>
            {lyricV2 ? <CaptionStyleEditor value={cap2} onChange={setCap2} preset={beh} onPreset={setBeh} /> : (<>
              <div role="radiogroup" aria-label="Estilo de subtítulos" className="flex gap-2 overflow-x-auto pb-1">
                {CAPTION_PRESETS.map((pz) => (
                  <button key={pz} type="button" role="radio" aria-checked={style.preset === pz} onClick={() => setStyle({ ...style, preset: pz })} className={`relative min-w-[120px] rounded-xl border px-2 py-4 text-center text-xs ${style.preset === pz ? "border-[var(--ink)] bg-[var(--surface)]" : "hairline"}`}>
                    {style.preset === pz && <span className="absolute left-2 top-1 text-[10px] text-[var(--muted)]">Seleccionado</span>}
                    <span style={{ fontFamily: style.font, fontWeight: 800, textShadow: pz === "contorno" ? "0 0 2px #000" : undefined }} className="block text-base">Para empezar</span><span className="mt-1 block text-[var(--muted)]">{PRESET_LABEL[pz]}</span></button>))}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label><span className="mb-1 block text-xs text-[var(--muted)]">Fuente</span><select className={field} value={style.font} onChange={(e) => setStyle({ ...style, font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
                <label><span className="mb-1 block text-xs text-[var(--muted)]">Tamaño</span><select className={field} value={style.size} onChange={(e) => setStyle({ ...style, size: e.target.value as CaptionStyle["size"] })}><option value="S">Pequeño</option><option value="M">Mediano</option><option value="L">Grande</option></select></label>
                <label><span className="mb-1 block text-xs text-[var(--muted)]">Posición</span><select className={field} value={style.position} onChange={(e) => setStyle({ ...style, position: e.target.value as CaptionStyle["position"] })}><option value="top">Arriba</option><option value="middle">Centro</option><option value="bottom">Abajo</option></select></label></div></>)}
          </Row>

          <Row glyph="✦" title="Gancho automático (beta)" on={hook} set={setHook}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-[var(--muted)]">Titular:</span>{(["editorial", "statement", "classic"] as const).map((h) => <button key={h} type="button" aria-pressed={hookStyle === h} onClick={() => setHookStyle(h)} className={`chip ${hookStyle === h ? "on" : ""}`}>{h === "editorial" ? "Editorial" : h === "statement" ? "Declaración" : "Clásico"}</button>)}</div>
          </Row>
          <Row glyph="◍" title="Gráficos en movimiento: emojis con IA" soon />
          <Row glyph="▤" title="B-roll automático con IA" soon />
          <Row glyph="♫" title="Sonido nítido: limpieza de voz, pausas y muletillas, mejora de audio" soon />
          <Row glyph="◎" title="Buen aspecto: zoom, transiciones y corrección de color automáticos" soon />
          <Row glyph="⇄" title="Traducir" on>
            <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-[var(--muted)]">Doblaje de voz: <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px]">Próximamente</span></span>
              <label className="flex items-center gap-2"><span className="text-[var(--muted)]">Traducción de subtítulos:</span><select className="rounded-lg border hairline bg-transparent px-2 py-1" value={subLang} onChange={(e) => setSubLang(e.target.value)} aria-label="Idioma de los subtítulos">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
          </Row>

          <div className="grid gap-3 border-t hairline pt-4 sm:grid-cols-2">
            <label><span className="mb-1 block text-xs font-medium text-[var(--muted)]">Formato</span><select className={field} value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>{ASPECTS.map((a) => <option key={a}>{a}</option>)}</select></label>
            <label><span className="mb-1 block text-xs font-medium text-[var(--muted)]">Plantilla</span><select className={field} value={template} onChange={(e) => setTemplate(e.target.value)}>{VIRAL_TEMPLATES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}</select></label></div>
          <p><button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={saveRecipe}>Guardar como receta</button></p>
        </div>)}
      </div>

      <aside className="card h-fit space-y-3 p-5 lg:sticky lg:top-4" aria-live="polite">
        <h2 className="text-sm font-medium">Resumen</h2>
        {est ? (<>
          <dl className="space-y-1.5 text-sm tnum">
            <div className="flex justify-between text-[var(--muted)]"><dt>Procesado del vídeo</dt><dd>{est.units.processing || "—"}</dd></div>
            <div className="flex justify-between text-[var(--muted)]"><dt>Selección de momentos</dt><dd>{clipping ? est.units.clipping : "—"}</dd></div>
            <div className="flex justify-between text-[var(--muted)]"><dt>Subtítulos</dt><dd>{subs ? 0 : "—"}</dd></div>
            <div className="mt-2 flex items-center justify-between border-t hairline pt-2"><dt>Funciones premium</dt><dd className="relative">
              <button type="button" aria-expanded={open === "premium"} onClick={() => setOpen(open === "premium" ? null : "premium")} className="text-sm">Aplicadas a los {hookN} mejores clips ▾</button>
              {open === "premium" && <div role="dialog" className="card-raised absolute right-0 top-full z-20 mt-1 w-[300px] p-3 text-left text-xs">
                <div className="flex items-center gap-3"><input type="range" min={1} max={20} value={hookN} onChange={(e) => setHookN(Number(e.target.value))} aria-label="Cuántos clips reciben funciones premium" className="flex-1" /><input type="number" min={1} max={20} value={hookN} onChange={(e) => setHookN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-14 rounded border hairline bg-transparent px-1 py-0.5 text-sm" /></div>
                <p className="mt-2">Elige a cuántos de los mejores clips se aplican las funciones premium. Las funciones con precio por minuto cuentan cada clip como 1 minuto. Las unidades no usadas se devuelven si salen menos clips.</p>
                <p className="mt-2 text-[var(--muted)]">Los clips se ordenan por la nota de la IA, no por su posición en el vídeo.</p></div>}</dd></div>
            <div className="flex justify-between text-[var(--muted)]"><dt>Titular</dt><dd>{hook ? est.units.hook : "—"}</dd></div>
            <div className="flex justify-between border-t hairline pt-2 font-medium"><dt>Total (unidades)</dt><dd>⚡ {est.units.total}</dd></div>
            <div className="flex justify-between text-xs text-[var(--muted)]"><dt>Tu saldo</dt><dd>{est.balance}</dd></div>
          </dl>
          {est.reusable_analysis && <p className="text-xs text-[var(--muted)]">Ya hay un análisis de este vídeo: no se vuelve a transcribir.</p>}
          <p className="text-xs text-[var(--muted)]">{est.eta ? `Tiempo estimado: entre ${Math.round(est.eta.p50_s / 60) || 1} y ${Math.max(1, Math.round(est.eta.p90_s / 60))} min.` : "Aún no se puede calcular el tiempo: faltan datos de procesos anteriores."}</p>
          {est.requested_count != null && est.requested_count > est.viable_count && <p className="text-xs">Pides {est.requested_count} clips, pero este tramo solo da para {est.viable_count} de esa duración.</p>}
        </>) : <p className="text-xs text-[var(--muted)]">Calculando…</p>}
        {msg && <p role="alert" className="text-xs">{msg}</p>}
        <button type="button" className="btn btn-primary w-full" disabled={busy || !est || est.units.total > est.balance} onClick={create}>{busy ? "Creando…" : "Crear"}</button>
        {est && est.units.total > est.balance && <p className="text-xs">Saldo insuficiente: pide más unidades o reduce el tramo.</p>}
        <p className="text-center text-xs text-[var(--muted)]">Al continuar, confirmas que tienes derechos para usar este vídeo.</p>
      </aside>
    </div>
  );
}
