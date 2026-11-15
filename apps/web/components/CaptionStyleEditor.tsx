"use client";
// Editor de estilo v2 (el mismo en clipping y en letra): los 9 controles, presets de comportamiento, «Sorpréndeme»,
// guardar/cargar (≤ 20 por espacio) y comparación A/B con el mismo instante, letra y fondo.
import { Fragment, useEffect, useMemo, useState } from "react";
import { BEHAVIOUR_PRESETS, CAPTION_FONTS, CAPTION_FAMILIES, surpriseCaption, validateCaptionStyle, type BehaviourPresetId, type CaptionStyleV2 } from "@rafaga/composition";
import { supabase } from "../lib/supabase";
import { classicPresets } from "../lib/lyriccutover";
import { TRENDING_STYLES } from "../lib/trendingstyles";
import { applyPreset, deleteStyle, listStylesV2, saveStyle, toggleAB, abState, currentStyle, type RpcFn } from "../lib/styles";

const field = "w-full rounded-lg border hairline bg-white px-2 py-1.5 text-sm", lbl = "mb-1 block text-xs text-[var(--muted)]";
const rpcFn: RpcFn = (fn, args) => supabase.rpc(fn, args) as never;
const faces = CAPTION_FONTS.filter((f) => f.file).map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url('/fonts/caption/${f.file}') format('truetype');font-display:swap}`).join("\n");

export default function CaptionStyleEditor({ value, onChange, preset, onPreset, sample = "bajo la luna de abril caminamos", workspaceId, background = "#111111" }: {
  value: CaptionStyleV2; onChange: (v: CaptionStyleV2) => void; preset: BehaviourPresetId; onPreset: (p: BehaviourPresetId) => void; sample?: string; workspaceId?: string | null; background?: string;
}) {
  const [saved, setSaved] = useState<ReturnType<typeof listStylesV2>>([]), [name, setName] = useState("Mi estilo"), [msg, setMsg] = useState<string | null>(null);
  const [ab, setAb] = useState(() => abState(value, value, 0, sample, background)), [seed, setSeed] = useState(1);
  const set = (patch: Partial<CaptionStyleV2>) => onChange(validateCaptionStyle({ ...value, ...patch }));
  const reload = async () => { const { data } = await supabase.from("text_styles").select("id,name,style").order("created_at"); setSaved(listStylesV2((data ?? []) as never)); };
  useEffect(() => { if (workspaceId) void reload(); }, [workspaceId]);
  const shown = ab.which === "a" ? value : currentStyle(ab);
  const preview = useMemo(() => {
    const s = shown, px = { S: 22, M: 30, L: 40 }[s.size] * s.sizeFine;
    return { fontFamily: `'${s.font}', Inter, sans-serif`, fontWeight: s.weight, fontSize: px, color: s.color, textTransform: s.case === "upper" ? "uppercase" : s.case === "lower" ? "lowercase" : "none", fontStyle: s.italic ? "italic" : "normal", letterSpacing: `${s.tracking ?? 0}em`,
      textShadow: s.effect === "shadow" ? "0 2px 4px rgba(0,0,0,.7)" : s.effect === "glow" ? `0 0 8px ${s.activeColor}` : s.effect === "stroke" ? "0 0 2px #000, 0 0 2px #000, 0 0 3px #000" : "none",
      background: s.effect === "box" ? "rgba(0,0,0,.8)" : "transparent", padding: s.effect === "box" ? "4px 10px" : 0, borderRadius: 6,
      ...(s.gradient ? { backgroundImage: `linear-gradient(${s.color}, ${s.gradient})`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" } : {}),
    } as const;
  }, [shown]);
  const words = sample.split(" ");
  async function save() {
    if (!workspaceId) return; const r = await saveStyle(rpcFn, workspaceId, null, name, value, preset);
    setMsg(r.ok ? "Estilo guardado." : r.message); if (r.ok) void reload();
  }
  return (
    <section className="space-y-4" aria-label="Editor de estilo">
      <style>{faces}</style>
      <div className="flex items-center justify-center rounded-xl p-8" style={{ background }} aria-label="Vista previa del estilo">
        <p style={preview} aria-live="off">{words.map((w, i) => <Fragment key={i}><span style={i === 1 && shown.active !== "none" ? { color: shown.active === "color" || shown.active === "underline" ? shown.activeColor : undefined, textDecoration: shown.active === "underline" ? "underline" : undefined, display: "inline-block", transform: shown.active === "scale" ? "scale(1.15)" : undefined, background: shown.active === "box" ? shown.activeColor + "99" : undefined } : undefined}>{w}</span>{i < words.length - 1 ? " " : ""}</Fragment>)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>Comparar:</span>
        <button type="button" className="btn btn-ghost !min-h-8" onClick={() => setAb((s) => ({ ...s, a: value }))}>Fijar A</button>
        <button type="button" className="btn btn-ghost !min-h-8" onClick={() => setAb((s) => ({ ...s, b: value }))}>Fijar B</button>
        <button type="button" className="btn btn-ghost !min-h-8" onClick={() => setAb((s) => toggleAB({ ...s, lyrics: sample, background }))} aria-pressed={ab.which === "b"}>Ver {ab.which === "a" ? "B" : "A"}</button>
        <span className="text-[var(--muted)]">Mostrando {ab.which.toUpperCase()} · misma letra y fondo</span>
      </div>
      <div role="group" aria-label="Estilos populares" className="space-y-1.5"><span className="block text-xs font-medium text-[var(--muted)]">Estilos populares</span>
        <ul className="flex gap-2 overflow-x-auto pb-1">{TRENDING_STYLES.map((t) => <li key={t.id}><button type="button" title={t.name} onClick={() => { onPreset(t.preset); onChange(t.style); }} className="rounded-xl border hairline px-3 py-2 text-sm hover:bg-[var(--hover)]" style={{ fontFamily: `'${t.style.font}', Inter, sans-serif`, fontWeight: t.style.weight, fontStyle: t.style.italic ? "italic" : "normal", textTransform: t.style.case === "upper" ? "uppercase" : t.style.case === "lower" ? "lowercase" : "none", letterSpacing: `${t.style.tracking ?? 0}em` }}>{t.name}</button></li>)}</ul></div>
      <div role="group" aria-label="Looks clásicos" className="flex flex-wrap items-center gap-2 text-xs"><span className="text-[var(--muted)]">Looks clásicos:</span>
        {classicPresets().map((p) => <button key={p.id} type="button" title={p.description} className="rounded-full border hairline px-3 py-1" onClick={() => onChange(p.style)}>{p.name}</button>)}</div>
      <div role="radiogroup" aria-label="Comportamiento" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.values(BEHAVIOUR_PRESETS).map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => { onPreset(p.id); onChange(applyPreset(value, p.id)); }}
            className={`rounded-xl border px-2 py-2 text-xs ${preset === p.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "hairline"}`}>{p.label}</button>))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Tipografía</h3>
        <label><span className={lbl}>Fuente</span><select className={field} value={value.font} onChange={(e) => set({ font: e.target.value })}>{CAPTION_FAMILIES.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label><span className={lbl}>Peso</span><select className={field} value={value.weight} onChange={(e) => set({ weight: Number(e.target.value) as 400 | 700 })}><option value={400}>Normal</option><option value={700}>Negrita</option></select></label>
        <label><span className={lbl}>Caja</span><select className={field} value={value.case} onChange={(e) => set({ case: e.target.value as CaptionStyleV2["case"] })}><option value="asis">Como se escribe</option><option value="upper">MAYÚSCULAS</option><option value="lower">minúsculas</option></select></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!value.italic} onChange={(e) => set({ italic: e.target.checked })} />Cursiva</label>
        <label className="sm:col-span-2"><span className={lbl}>Espaciado entre letras ({(value.tracking ?? 0).toFixed(2)} em)</span><input type="range" min={-0.05} max={0.3} step={0.01} value={value.tracking ?? 0} onChange={(e) => set({ tracking: Number(e.target.value) })} className="w-full" /></label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Color</h3>
        <label className="flex items-center gap-2 text-xs"><input type="color" value={value.color} onChange={(e) => set({ color: e.target.value.toUpperCase() })} aria-label="Color del texto" />Texto</label>
        <label className="flex items-center gap-2 text-xs"><input type="color" value={value.activeColor} onChange={(e) => set({ activeColor: e.target.value.toUpperCase() })} aria-label="Color de la palabra activa" />Palabra activa</label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Efectos</h3>
        <label><span className={lbl}>Efecto</span><select className={field} value={value.effect} onChange={(e) => set({ effect: e.target.value as CaptionStyleV2["effect"] })}>{[["none", "Ninguno"], ["shadow", "Sombra"], ["glow", "Brillo"], ["stroke", "Contorno"], ["box", "Caja"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Entrada</h3>
        <label><span className={lbl}>Entrada</span><select className={field} value={value.entrance} onChange={(e) => set({ entrance: e.target.value as CaptionStyleV2["entrance"] })}>{[["none", "Sin animación"], ["fade", "Aparecer"], ["slide", "Deslizar"], ["pop", "Rebote"], ["typewriter", "Máquina de escribir"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="sm:col-span-2"><span className={lbl}>Duración de la entrada ({value.entranceMs ? `${value.entranceMs} ms` : "la del comportamiento"})</span><input type="range" min={0} max={2000} step={50} value={value.entranceMs ?? 0} onChange={(e) => set({ entranceMs: Number(e.target.value) })} className="w-full" /></label>
        <label><span className={lbl}>Dirección de la entrada</span><select className={field} value={value.entranceDir ?? "up"} onChange={(e) => set({ entranceDir: e.target.value as CaptionStyleV2["entranceDir"] })}><option value="up">Desde abajo</option><option value="down">Desde arriba</option><option value="left">Desde la izquierda</option><option value="right">Desde la derecha</option></select></label>
        <label><span className={lbl}>Curva</span><select className={field} value={value.ease ?? ""} onChange={(e) => set({ ease: (e.target.value || undefined) as CaptionStyleV2["ease"] })}><option value="">Lineal</option><option value="out">Frena al llegar</option><option value="in">Acelera</option><option value="inout">Suave</option></select></label>
        <label><span className={lbl}>Salida</span><select className={field} value={value.exit ?? ""} onChange={(e) => set({ exit: (e.target.value || undefined) as CaptionStyleV2["exit"] })}><option value="">La del comportamiento</option><option value="cut">Corte</option><option value="fade">Desvanecer</option><option value="slide">Subir y desvanecer</option><option value="pop">Encoger</option></select></label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Movimiento y efectos</h3>
        <label><span className={lbl}>En reposo</span><select className={field} value={value.idle ?? ""} onChange={(e) => set({ idle: (e.target.value || undefined) as CaptionStyleV2["idle"] })}><option value="">Quieto</option><option value="float">Flotar</option><option value="pulse">Latir</option><option value="wobble">Balancear</option></select></label>
        <label><span className={lbl}>Caos ({Math.round((value.chaos ?? 0) * 100)} %)</span><input type="range" min={0} max={1} step={0.05} value={value.chaos ?? 0} onChange={(e) => set({ chaos: Number(e.target.value) })} className="w-full" /></label>
        <label><span className={lbl}>Rotación al entrar ({value.entranceRot ?? 0}°)</span><input type="range" min={-45} max={45} step={5} value={value.entranceRot ?? 0} onChange={(e) => set({ entranceRot: Number(e.target.value) || undefined })} className="w-full" /></label>
        <label><span className={lbl}>Escalonado ({value.stagger ? `${value.stagger} ms` : "sin escalonar"})</span><input type="range" min={0} max={400} step={20} value={value.stagger ?? 0} onChange={(e) => set({ stagger: Number(e.target.value) || undefined })} className="w-full" /></label>
        <label><span className={lbl}>Orden del escalonado</span><select className={field} value={value.staggerOrder ?? "forward"} onChange={(e) => set({ staggerOrder: e.target.value === "reverse" ? "reverse" : undefined })}><option value="forward">De izquierda a derecha</option><option value="reverse">De derecha a izquierda</option></select></label>
        <label><span className={lbl}>Vibración de la línea base (±{value.jitter ?? 0} px)</span><input type="range" min={0} max={12} step={1} value={value.jitter ?? 0} onChange={(e) => set({ jitter: Number(e.target.value) || undefined })} className="w-full" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!value.palette} onChange={(e) => set({ palette: e.target.checked || undefined })} />Ciclo de paleta (alterna color, color activo y degradado palabra a palabra)</label>
        <label><span className={lbl}>Ecos</span><select className={field} value={value.echo ?? 0} onChange={(e) => set({ echo: (Number(e.target.value) || undefined) as CaptionStyleV2["echo"] })}><option value={0}>Ninguno</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
        <label className="sm:col-span-2"><span className={lbl}>Degradado (color de abajo)</span><span className="flex items-center gap-2"><input type="checkbox" checked={!!value.gradient} onChange={(e) => set({ gradient: e.target.checked ? "#FF4D8D" : undefined })} aria-label="Activar degradado" />{value.gradient ? <input type="color" value={value.gradient} onChange={(e) => set({ gradient: e.target.value })} aria-label="Color final del degradado" /> : <span className="text-xs text-[var(--muted)]">Desactivado</span>}</span></label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Palabra activa</h3>
        <label><span className={lbl}>Palabra activa</span><select className={field} value={value.active} onChange={(e) => set({ active: e.target.value as CaptionStyleV2["active"] })}>{[["none", "Ninguna"], ["color", "Color"], ["scale", "Agrandar"], ["underline", "Subrayar"], ["box", "Caja"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <h3 className="col-span-full pt-2 text-xs font-medium text-[var(--muted)]">Diseño</h3>
        <label><span className={lbl}>Tamaño</span><select className={field} value={value.size} onChange={(e) => set({ size: e.target.value as CaptionStyleV2["size"] })}><option value="S">Pequeño</option><option value="M">Mediano</option><option value="L">Grande</option></select></label>
        <label><span className={lbl}>Ajuste fino de tamaño ({value.sizeFine})</span><input type="range" min={0.6} max={1.6} step={0.05} value={value.sizeFine} onChange={(e) => set({ sizeFine: Number(e.target.value) })} className="w-full" /></label>
        <label><span className={lbl}>Posición vertical ({Math.round(value.position.y * 100)} %)</span><input type="range" min={0.1} max={0.92} step={0.01} value={value.position.y} onChange={(e) => set({ position: { ...value.position, y: Number(e.target.value) } })} className="w-full" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost !min-h-9" onClick={() => { setSeed(seed + 1); onChange(surpriseCaption(seed)); }}>Sorpréndeme</button>
        {workspaceId && <>
          <input className={`${field} !w-48`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nombre del estilo" />
          <button type="button" className="btn btn-primary !min-h-9" onClick={() => void save()}>Guardar estilo</button></>}
      </div>
      {workspaceId && saved.length > 0 && <ul className="flex flex-wrap gap-2 text-xs" aria-label="Mis estilos">{saved.map((s) => (
        <li key={s.id} className="flex items-center gap-1 rounded-full border hairline px-2 py-1"><button type="button" onClick={() => { onChange(s.style); onPreset(s.preset); setName(s.name); }}>{s.name}</button>
          <button type="button" aria-label={`Borrar ${s.name}`} onClick={() => { if (confirm(`¿Borrar el estilo «${s.name}»?`)) void deleteStyle(rpcFn, s.id).then(reload); }}>×</button></li>))}
        <li className="text-[var(--muted)]">{saved.length}/20</li></ul>}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
