"use client";
// Panel de creación (al estilo de las herramientas de referencia): el usuario decide el RESULTADO antes de generar.
// Receta · brand kit · modo · duración · momentos a incluir · intervalo · subtítulos (estilo, fuente, colores, tamaño, posición) ·
// gancho · formato y plantilla viral · resumen con consumo y estimación · Crear (idempotente).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
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
  const [recipe, setRecipe] = useState<Recipe>("clips");
  const [mode, setMode] = useState<Mode>("auto");
  const [duration, setDuration] = useState<Bucket>("auto");
  const [count, setCount] = useState<string>("");
  const [brief, setBrief] = useState(""), [exclude, setExclude] = useState("");
  const [from, setFrom] = useState("0:00"), [to, setTo] = useState(mmss(durationMs));
  const [subs, setSubs] = useState(true), [style, setStyle] = useState<CaptionStyle>(CAPTION_DEFAULT);
  const [hook, setHook] = useState(false), [hookN, setHookN] = useState(10);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("9:16"), [template, setTemplate] = useState<string>("titular_video_subtitulos");
  const [brandKit, setBrandKit] = useState(""), [kits, setKits] = useState<{ id: string; name: string }[]>([]);
  const [recipes, setRecipes] = useState<{ id: string; name: string; params: Partial<GenerationParams> }[]>([]);
  const [est, setEst] = useState<Est | null>(null), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const idem = useRef<string | null>(null);

  const params = useMemo(() => ({
    recipe, mode, duration, count: count ? Number(count) : null, range_start_ms: parse(from), range_end_ms: parse(to), language: "auto", brief: [brief.trim(), exclude.trim() ? `Evitar: ${exclude.trim()}` : ""].filter(Boolean).join("\n") || undefined,
    exclude: exclude.trim() || undefined, aspect, template: recipe === "clips" || recipe === "reframe" ? template : undefined, subtitles: subs, caption_style: subs ? style : undefined, hook: hook ? { enabled: true, top_n: hookN } : undefined, brand_kit_id: brandKit || undefined,
  }), [recipe, mode, duration, count, from, to, brief, exclude, aspect, template, subs, style, hook, hookN, brandKit]);

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
  const lbl = "mb-1 block text-xs font-medium text-[var(--muted)]";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={lbl}>Receta</span>
            <select className={field} value={recipe} onChange={(e) => setRecipe(e.target.value as Recipe)}>{RECIPES.map((r) => <option key={r} value={r}>{RECIPE_LABEL[r]}</option>)}</select></label>
          <label><span className={lbl}>Brand kit</span>
            <select className={field} value={brandKit} onChange={(e) => setBrandKit(e.target.value)}><option value="">Ninguno</option>{kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select className="rounded-lg border hairline bg-transparent px-2 py-1" defaultValue="" onChange={(e) => e.target.value && applyRecipe(e.target.value)} aria-label="Mis recetas"><option value="">Mis recetas…</option>{recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={saveRecipe}>Guardar como receta</button>
        </div>

        {(recipe === "clips") && (<>
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className={lbl}>La IA elige</span>
              <select className={field} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
            <label><span className={lbl}>Duración del clip</span>
              <select className={field} value={duration} onChange={(e) => setDuration(e.target.value as Bucket)}>{(Object.keys(DURATION_BUCKETS) as Bucket[]).map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}</select></label>
            <label><span className={lbl}>Número de clips</span>
              <select className={field} value={count} onChange={(e) => setCount(e.target.value)}><option value="">Los que haya</option>{[3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <label className="block"><span className={lbl}>Momentos a incluir (opcional)</span>
            <textarea className={field} rows={2} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ejemplo: busca todos los momentos en los que alguien se ríe o cuenta una anécdota" />
            <span className="mt-1 block text-xs text-[var(--muted)]">Cómo escribirlo: di qué quieres encontrar, para quién y con qué tono. Es una estimación de la IA, no una garantía.</span></label>
          <label className="block"><span className={lbl}>Evitar (opcional)</span>
            <input className={field} maxLength={1000} value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="Ejemplo: el patrocinador, la despedida" /></label>
        </>)}

        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={lbl}>Desde</span><input className={field} value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" aria-label="Inicio del tramo" /></label>
          <label><span className={lbl}>Hasta (de {mmss(durationMs)})</span><input className={field} value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" aria-label="Final del tramo" /></label>
        </div>

        <fieldset className="space-y-3">
          <legend className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} aria-label="Subtítulos" /> Subtítulos</legend>
          {subs && (<>
            <div role="radiogroup" aria-label="Estilo de subtítulos" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CAPTION_PRESETS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={style.preset === p} onClick={() => setStyle({ ...style, preset: p })}
                  className={`rounded-xl border px-2 py-3 text-center text-xs ${style.preset === p ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "hairline"}`}>
                  <span style={{ fontFamily: style.font, color: style.preset === "contorno" ? "#fff" : undefined, textShadow: p === "contorno" ? "0 0 2px #000, 0 0 2px #000" : p === "neon" ? `0 0 6px ${style.active_color}` : undefined, background: p === "caja" ? "#000" : undefined, color2: undefined } as React.CSSProperties} className="block text-sm font-bold">TO GET STARTED</span>
                  <span className="mt-1 block text-[var(--muted)]">{PRESET_LABEL[p]}</span></button>))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className={lbl}>Fuente</span><select className={field} value={style.font} onChange={(e) => setStyle({ ...style, font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
              <label><span className={lbl}>Tamaño</span><select className={field} value={style.size} onChange={(e) => setStyle({ ...style, size: e.target.value as CaptionStyle["size"] })}><option value="S">Pequeño</option><option value="M">Mediano</option><option value="L">Grande</option></select></label>
              <label><span className={lbl}>Posición</span><select className={field} value={style.position} onChange={(e) => setStyle({ ...style, position: e.target.value as CaptionStyle["position"] })}><option value="top">Arriba</option><option value="middle">Centro</option><option value="bottom">Abajo</option></select></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {([["color", "Texto"], ["active_color", "Palabra activa"], ["outline_color", "Contorno"]] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-xs"><input type="color" value={style[k]} onChange={(e) => setStyle({ ...style, [k]: e.target.value.toUpperCase() })} aria-label={l} />{l}<span className="mono text-[var(--muted)]">{style[k]}</span></label>))}
            </div>
          </>)}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={hook} onChange={(e) => setHook(e.target.checked)} aria-label="Gancho automático" /> Gancho automático (titular)</legend>
          {hook && <label className="block text-xs">Aplicar a los <input type="number" min={1} max={20} value={hookN} onChange={(e) => setHookN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="mx-1 w-16 rounded border hairline bg-transparent px-1 py-0.5" /> mejores clips
            <span className="block text-[var(--muted)]">Los clips se ordenan por la estimación de la IA; cada uno cuenta como 1 minuto y lo no usado se devuelve.</span></label>}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={lbl}>Formato</span><select className={field} value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>{ASPECTS.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label><span className={lbl}>Plantilla</span><select className={field} value={template} onChange={(e) => setTemplate(e.target.value)}>{VIRAL_TEMPLATES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}</select></label>
        </div>
      </div>

      <aside className="card h-fit space-y-3 p-5 lg:sticky lg:top-4" aria-live="polite">
        <h2 className="text-sm font-medium">Resumen</h2>
        {est ? (<>
          <ul className="list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">{est.summary.map((s) => <li key={s}>{s}</li>)}</ul>
          <dl className="space-y-1 text-sm tnum">
            <div className="flex justify-between"><dt>Procesado del vídeo</dt><dd>{est.units.processing || "—"}</dd></div>
            <div className="flex justify-between"><dt>Selección de momentos</dt><dd>{est.units.clipping}</dd></div>
            <div className="flex justify-between"><dt>Subtítulos</dt><dd>0</dd></div>
            {est.units.hook > 0 && <div className="flex justify-between"><dt>Gancho</dt><dd>{est.units.hook}</dd></div>}
            <div className="flex justify-between border-t hairline pt-1 font-medium"><dt>Total (unidades)</dt><dd>{est.units.total}</dd></div>
            <div className="flex justify-between text-[var(--muted)]"><dt>Tu saldo</dt><dd>{est.balance}</dd></div>
          </dl>
          {est.reusable_analysis && <p className="text-xs text-[var(--muted)]">Ya hay un análisis de este vídeo: no se vuelve a transcribir.</p>}
          <p className="text-xs text-[var(--muted)]">{est.eta ? `Tiempo estimado: entre ${Math.round(est.eta.p50_s / 60) || 1} y ${Math.max(1, Math.round(est.eta.p90_s / 60))} min.` : "Aún no se puede calcular el tiempo: faltan datos de procesos anteriores."}</p>
          {est.requested_count != null && est.requested_count > est.viable_count && <p className="text-xs">Pides {est.requested_count} clips, pero este tramo solo da para {est.viable_count} de esa duración.</p>}
        </>) : <p className="text-xs text-[var(--muted)]">Calculando…</p>}
        {msg && <p role="alert" className="text-xs">{msg}</p>}
        <button type="button" className="btn btn-primary w-full" disabled={busy || !est || est.units.total > est.balance} onClick={create}>{busy ? "Creando…" : "Crear"}</button>
        {est && est.units.total > est.balance && <p className="text-xs">Saldo insuficiente: pide más unidades o reduce el tramo.</p>}
      </aside>
    </div>
  );
}
