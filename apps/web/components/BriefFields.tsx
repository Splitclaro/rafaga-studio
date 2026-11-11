"use client";
import { useId } from "react";
import { BRIEF_LIMITS, BRIEF_EFFECT, TONES, composeBrief, normalizeBrief, type BriefData } from "@rafaga/selection/brief";
import BriefUnderstanding from "./BriefUnderstanding";

export const EMPTY_BRIEF: BriefData = { objective: "" };

/** «¿Qué quieres conseguir con estos clips?» + detalles opcionales. Cada campo indica qué parte del proceso gobierna. */
export default function BriefFields({ value, onChange, compact = false }: { value: BriefData; onChange: (b: BriefData) => void; compact?: boolean }) {
  const id = useId();
  const set = (k: keyof BriefData, v: string) => onChange({ ...value, [k]: v });
  const extra = (["audience", "topics", "must_include", "avoid", "cta"] as const);
  const L: Record<(typeof extra)[number], [string, string]> = { audience: ["Público", "Estudiantes que empiezan a emprender"], topics: ["Temas prioritarios", "errores al vender, primeros clientes"], must_include: ["Fragmentos o personas que deben aparecer", "la invitada, la historia del primer cliente"], avoid: ["Contenido que debe evitarse", "el patrocinador, la despedida"], cta: ["Llamada a la acción", "Escucha el episodio completo"] };
  const filled = Object.entries(value).filter(([k, v]) => k !== "objective" && v).length;
  return (
    <div>
      <label htmlFor={`${id}-o`} className="text-sm font-medium">¿Qué momentos quieres encontrar?</label>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Ideas para tu encargo">
        {["Momentos graciosos", "Consejos", "Polémicas", "Historias", "Citas"].map((t) => <button key={t} type="button" className="chip" onClick={() => { const low = value.objective.toLowerCase(); if (!low.includes(t.toLowerCase())) set("objective", (value.objective ? value.objective.replace(/[\s.]+$/, "") + ". " : "") + "Busca " + t.toLowerCase() + ".") }}>{t}</button>)}
      </div>
      <textarea id={`${id}-o`} rows={compact ? 2 : 3} maxLength={BRIEF_LIMITS.objective} value={value.objective} onChange={(e) => set("objective", e.target.value)} className="input mt-1.5 resize-y"
        placeholder="Ej.: cinco cortes para gente que no conoce al artista. Prioriza las historias detrás de sus canciones, evita su vida privada y deja que se escuche el remate." />
      <BriefUnderstanding text={value.objective} compact={compact} />
      <details className="mt-2 text-sm" open={filled > 0 ? undefined : undefined}>
        <summary className="cursor-pointer text-[var(--muted)]">Más detalles (opcional){filled ? ` · ${filled} rellenados` : ""}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {extra.map((k) => (
            <label key={k} className={`block ${k === "must_include" || k === "avoid" ? "sm:col-span-2" : ""}`}><span className="text-xs font-medium">{L[k][0]}</span>
              <input value={value[k] ?? ""} onChange={(e) => set(k, e.target.value)} maxLength={BRIEF_LIMITS[k]} placeholder={L[k][1]} className="input mt-1" /><span className="mt-0.5 block text-[11px] text-[var(--muted)]">{BRIEF_EFFECT[k]}</span></label>))}
          <label className="block"><span className="text-xs font-medium">Tono</span>
            <select value={value.tone ?? ""} onChange={(e) => set("tone", e.target.value)} className="input mt-1"><option value="">Sin preferencia</option>{TONES.map((t: string) => <option key={t}>{t}</option>)}</select><span className="mt-0.5 block text-[11px] text-[var(--muted)]">{BRIEF_EFFECT.tone}</span></label>
          <label className="block"><span className="text-xs font-medium">Idioma</span>
            <select value={value.language ?? ""} onChange={(e) => set("language", e.target.value)} className="input mt-1"><option value="">Detectar</option><option>Español</option><option>Inglés</option><option>Catalán</option><option>Portugués</option></select><span className="mt-0.5 block text-[11px] text-[var(--muted)]">{BRIEF_EFFECT.language}</span></label>
        </div>
      </details>
    </div>
  );
}
export const briefText = (b: BriefData) => composeBrief(normalizeBrief(b));
