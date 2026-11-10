// Brief estructurado: «¿Qué quieres conseguir con estos clips?» + detalles opcionales.
// - composeBrief(): texto completo (para la IA y para guardar la versión usada en cada generación).
// - lexicalBrief(): solo lo que sirve al selector léxico (objetivo, temas, personas/fragmentos y exclusiones);
//   público, tono y llamada a la acción NO entran: ensuciarían la coincidencia de palabras.
export const BRIEF_VERSION = 1;
export interface BriefData { objective: string; audience?: string; topics?: string; must_include?: string; avoid?: string; tone?: string; cta?: string; language?: string }
export const BRIEF_LIMITS: Record<keyof BriefData, number> = { objective: 1000, audience: 200, topics: 300, must_include: 300, avoid: 300, tone: 80, cta: 200, language: 40 };
export const BRIEF_MAX_TOTAL = 2000;
export const TONES = ["Cercano", "Profesional", "Inspirador", "Divertido", "Serio", "Emotivo"] as const;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Normaliza datos de entrada (nunca lanza). Devuelve null si no hay nada que guardar. */
export function normalizeBrief(raw: unknown): BriefData | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: BriefData = { objective: clean(o.objective, BRIEF_LIMITS.objective) };
  for (const k of ["audience", "topics", "must_include", "avoid", "tone", "cta", "language"] as const) { const v = clean(o[k], BRIEF_LIMITS[k]); if (v) out[k] = v; }
  return Object.values(out).some(Boolean) ? out : null;
}
const end = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

export function composeBrief(d: BriefData | null): string {
  if (!d) return "";
  const parts = [d.objective && end(d.objective), d.audience && `Público: ${end(d.audience)}`, d.topics && `Temas prioritarios: ${end(d.topics)}`, d.must_include && `Debe aparecer: ${end(d.must_include)}`,
    d.tone && `Tono: ${end(d.tone)}`, d.cta && `Llamada a la acción: ${end(d.cta)}`, d.language && `Idioma: ${end(d.language)}`, d.avoid && `Evita ${end(d.avoid)}`].filter(Boolean) as string[];
  return parts.join("\n").slice(0, BRIEF_MAX_TOTAL);
}
export function lexicalBrief(d: BriefData | null): string {
  if (!d) return "";
  return [d.objective && end(d.objective), d.topics && end(d.topics), d.must_include && end(d.must_include), d.avoid && `Evita ${end(d.avoid)}`].filter(Boolean).join(" ");
}
/** ¿Qué campos del brief influyen en qué parte del proceso? (se muestra al usuario; no hay campos decorativos). */
export const BRIEF_EFFECT: Record<keyof BriefData, string> = {
  objective: "Guía la selección de momentos y los títulos.", audience: "Lo recibe la IA al elegir y titular; sin IA no se usa.", topics: "Prioriza los momentos que tratan estos temas.",
  must_include: "Prioriza fragmentos que mencionan estas personas o ideas.", avoid: "Descarta los fragmentos que caen en estas exclusiones.", tone: "La IA redacta los títulos con este tono; sin IA no se usa.",
  cta: "La IA lo tiene en cuenta al titular; no se añade texto al vídeo.", language: "Indica el idioma esperado a la IA; el reconocimiento de voz lo detecta aparte.",
};
