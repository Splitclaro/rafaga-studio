// Modos editoriales de selección, filtros de calidad y puntuación orientativa con cinco motivos.
// Los modos (qué se busca) están separados de los modelos de IA que los ejecutan (`model`). Sin dispersión artificial de notas.
import type { TWord } from "./index.ts";

export type ModeId = "automatico" | "por_tema" | "pregunta_respuesta" | "educativo" | "historia" | "destacados" | "manual";
export type FilterId = "sentence_start" | "unresolved_reference" | "closure" | "overlap";
export interface ModeDef { id: ModeId; label: string; promptId: string; filters: FilterId[]; model: "editorial" | null; hint: string }

const ALL: FilterId[] = ["sentence_start", "unresolved_reference", "closure", "overlap"];
export const MODES: Record<ModeId, ModeDef> = {
  automatico: { id: "automatico", label: "Automático", promptId: "auto-v1", filters: ALL, model: "editorial", hint: "Elige los momentos más comprensibles y relevantes por sí solos, sin instrucciones adicionales." },
  por_tema: { id: "por_tema", label: "Por tema", promptId: "tema-v1", filters: ALL, model: "editorial", hint: "Busca solo contenido relacionado con lo que pide el usuario en el encargo; descarta lo que no encaje." },
  pregunta_respuesta: { id: "pregunta_respuesta", label: "Pregunta y respuesta", promptId: "qa-v1", filters: ALL, model: "editorial", hint: "Cada momento debe incluir la pregunta (o el contexto necesario) y terminar cuando la respuesta se completa." },
  educativo: { id: "educativo", label: "Educativo", promptId: "edu-v1", filters: ALL, model: "editorial", hint: "Extrae explicaciones, consejos, pasos o conclusiones completas y accionables." },
  historia: { id: "historia", label: "Historia o anécdota", promptId: "story-v1", filters: ALL, model: "editorial", hint: "Busca secuencias con planteamiento y desenlace: la anécdota debe entenderse de principio a fin." },
  destacados: { id: "destacados", label: "Destacados", promptId: "highlights-v1", filters: ALL, model: null, hint: "Momentos relevantes por señales sonoras y visuales (subidas de energía y cambios de escena)." },
  manual: { id: "manual", label: "Manual", promptId: "manual-v1", filters: [], model: null, hint: "El usuario elige los fragmentos desde la transcripción o la línea de tiempo." },
};
export const MODE_IDS = Object.keys(MODES) as ModeId[];

const END = /[.!?…»"”)]\s*$/;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]/g, "");
const isEnd = (w: string) => END.test(w);
const CONJ = new Set(["y", "pero", "entonces", "pues", "and", "but", "so", "well"]);
const DEICTIC = new Set(["esto", "eso", "aquello", "ella", "ellos", "ellas", "ahi", "alli", "this", "that", "it", "they", "there"]);   // «él» se trata aparte (ver startsWithUnresolved)

export interface Cand { startWord: number; endWord: number }
export type DropReason = "sentence_start" | "unresolved_reference" | "closure" | "overlap";

/** ¿Empieza a mitad de frase? La palabra anterior debe cerrar una frase (o ser el principio del transcript). */
export const startsMidSentence = (words: TWord[], a: number) => a > 0 && !isEnd(words[a - 1].text);
/** ¿Empieza con un pronombre o deíctico sin antecedente dentro del clip? («Y eso…», «Ella dijo…», «This is…»). */
export function startsWithUnresolved(words: TWord[], a: number): boolean {
  let i = a; while (i < words.length - 1 && CONJ.has(norm(words[i].text))) i++;
  const raw = words[i].text.replace(/[^\p{L}]/gu, ""), w = norm(raw);
  if (raw === "Él" || raw === "él") return true;      // pronombre acentuado (el artículo «el» no cuenta)
  return DEICTIC.has(w);
}
export const endsWithoutClosure = (words: TWord[], b: number) => !isEnd(words[b].text);

/** Aplica los filtros del modo en orden de puntuación: lo que sobrevive es lo que se puede entender por sí solo. */
export function qualityFilters<T extends Cand>(words: TWord[], cands: T[], o: { filters?: FilterId[]; maxOverlap?: number; score?: (c: T) => number } = {}): { kept: T[]; dropped: { candidate: T; reason: DropReason }[] } {
  const f = new Set(o.filters ?? ALL), maxOv = o.maxOverlap ?? 0.5;
  const ordered = o.score ? [...cands].sort((a, b) => o.score!(b) - o.score!(a)) : cands;
  const kept: T[] = [], dropped: { candidate: T; reason: DropReason }[] = [];
  for (const c of ordered) {
    let why: DropReason | null = null;
    if (f.has("sentence_start") && startsMidSentence(words, c.startWord)) why = "sentence_start";
    else if (f.has("unresolved_reference") && startsWithUnresolved(words, c.startWord)) why = "unresolved_reference";
    else if (f.has("closure") && endsWithoutClosure(words, c.endWord)) why = "closure";
    else if (f.has("overlap")) {
      const len = (x: Cand) => words[x.endWord].end - words[x.startWord].start;
      if (kept.some((k) => { const ov = Math.min(words[k.endWord].end, words[c.endWord].end) - Math.max(words[k.startWord].start, words[c.startWord].start); return ov > maxOv * Math.min(len(k), len(c)); })) why = "overlap";
    }
    if (why) dropped.push({ candidate: c, reason: why }); else kept.push(c);
  }
  return { kept, dropped };
}

// ── Puntuación ──
export const EDITORIAL_WEIGHTS = { gancho: 0.30, desarrollo: 0.20, valor: 0.25, afinidad: 0.15, calidad_tecnica: 0.10 } as const;
export type Reason = keyof typeof EDITORIAL_WEIGHTS;
export interface ReasonScore { score: number; text: string }
export interface Score { reasons: Record<Reason, ReasonScore>; overall: number; notes: { difference?: string } }

const STOP = new Set("de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu te ti tus ellas the and to of a in is it that for on with as are was this be at or".split(" "));
const terms = (s: string) => [...new Set(s.split(/\s+/).map(norm).filter((t) => t.length > 3 && !STOP.has(t)))];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const sentences = (ws: TWord[]) => { const out: TWord[][] = []; let cur: TWord[] = []; for (const w of ws) { cur.push(w); if (isEnd(w.text)) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out; };

const HOOK_WORDS = /\b(nunca|siempre|error|secreto|clave|truco|verdad|increíble|increible|mentira|problema|por qué|por que|cómo|como|never|always|mistake|secret|truth|why|how)\b/i;
const ADVICE = /\b(consejo|truco|clave|aprende|paso|primero|segundo|recuerda|evita|debes|tienes que|hay que|importante|dato|razón|razon|tip|step|learn|avoid|remember)\b/i;
const CONCLUDE = /\b(así que|asi que|por eso|en resumen|la clave|moraleja|al final|conclusión|conclusion|por tanto|so that's|in short|that's why)\b/i;

export function editorialScore(words: TWord[], c: Cand, ctx: { brief?: string | null; minSec?: number; maxSec?: number } = {}): Score {
  const w = words.slice(c.startWord, c.endWord + 1), text = w.map((x) => x.text).join(" "), ss = sentences(w), first = ss[0] ? ss[0].map((x) => x.text).join(" ") : "";
  const dur = Math.max(0.1, w[w.length - 1].end - w[0].start);
  // Gancho: cómo abre
  let g = 0.3; const gt: string[] = [];
  if (/[?¿]/.test(first)) { g += 0.3; gt.push("abre con una pregunta"); }
  if (HOOK_WORDS.test(first)) { g += 0.2; gt.push("arranca con una afirmación fuerte"); }
  if (/\d/.test(first)) { g += 0.1; gt.push("incluye una cifra"); }
  if (ss[0] && ss[0].length <= 14) { g += 0.1; gt.push("la primera frase es corta"); }
  // Desarrollo: tiene principio, nudo y cierre
  let d = 0.2; const dt: string[] = [];
  if (ss.length >= 2) { d += 0.3; dt.push(`${ss.length} frases enlazadas`); }
  if (ss.length >= 4) d += 0.1;
  if (CONCLUDE.test(text)) { d += 0.25; dt.push("termina con una conclusión"); }
  if (isEnd(w[w.length - 1].text)) { d += 0.15; dt.push("cierra la frase final"); } else dt.push("no cierra la última frase");
  // Valor: informa o aconseja
  const t = terms(text); let v = 0.25; const vt: string[] = [];
  if (ADVICE.test(text)) { v += 0.3; vt.push("contiene consejos o pasos"); }
  if (/\d/.test(text)) { v += 0.1; vt.push("aporta datos"); }
  if (t.length / Math.max(1, w.length) > 0.35) { v += 0.2; vt.push("vocabulario variado"); }
  // Afinidad con el encargo
  let a = 0.5; let at = "Sin encargo: no se mide la afinidad.";
  const bt = terms(ctx.brief ?? "");
  if (bt.length) { const hit = bt.filter((x) => t.includes(x)); a = clamp01(0.15 + 0.85 * (hit.length / Math.max(2, Math.min(bt.length, 6)))); at = hit.length ? `Coincide con «${hit.slice(0, 3).join("», «")}» del encargo.` : "No menciona los temas del encargo."; }
  // Calidad técnica: densidad de habla, silencios, duración dentro del rango
  const wps = w.length / dur; let q = 0.4; const qt: string[] = [];
  if (wps >= 1.5 && wps <= 4) { q += 0.3; qt.push("ritmo de habla claro"); } else qt.push(wps < 1.5 ? "habla muy escasa" : "habla muy rápida");
  let maxGap = 0; for (let i = 1; i < w.length; i++) maxGap = Math.max(maxGap, w[i].start - w[i - 1].end);
  if (maxGap < 1.5) { q += 0.2; qt.push("sin silencios largos"); } else qt.push(`silencio de ${maxGap.toFixed(1)} s`);
  if (ctx.minSec == null || (dur >= ctx.minSec && dur <= (ctx.maxSec ?? Infinity))) q += 0.1;
  const reasons: Record<Reason, ReasonScore> = {
    gancho: { score: r2(clamp01(g)), text: gt.length ? `Gancho: ${gt.join(", ")}.` : "Gancho: abre sin una señal especial." },
    desarrollo: { score: r2(clamp01(d)), text: `Desarrollo: ${dt.join(", ") || "frase única"}.` },
    valor: { score: r2(clamp01(v)), text: vt.length ? `Valor: ${vt.join(", ")}.` : "Valor: contenido general." },
    afinidad: { score: r2(clamp01(a)), text: at },
    calidad_tecnica: { score: r2(clamp01(q)), text: `Calidad técnica: ${qt.join(", ")}.` },
  };
  const overall = Math.round(100 * (Object.keys(EDITORIAL_WEIGHTS) as Reason[]).reduce((s, k) => s + EDITORIAL_WEIGHTS[k] * reasons[k].score, 0));
  return { reasons, overall, notes: {} };
}

/** Puntúa y ordena. Los empates conservan su nota y reciben `notes.difference` con lo que de verdad los distingue. */
export function scoreAll<T extends Cand>(words: TWord[], cands: T[], ctx: { brief?: string | null; minSec?: number; maxSec?: number } = {}): (T & { score: Score })[] {
  const out = cands.map((c) => ({ ...c, score: editorialScore(words, c, ctx) })).sort((a, b) => b.score.overall - a.score.overall);
  for (let i = 0; i < out.length; i++) {
    const tied = out.filter((o) => o.score.overall === out[i].score.overall && o !== out[i]);
    if (!tied.length) continue;
    const other = tied[0], mine = out[i].score.reasons, theirs = other.score.reasons;
    const best = (Object.keys(mine) as Reason[]).map((k) => ({ k, d: mine[k].score - theirs[k].score })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
    const name: Record<Reason, string> = { gancho: "el gancho", desarrollo: "el desarrollo", valor: "el valor", afinidad: "la afinidad", calidad_tecnica: "la calidad técnica" };
    const secs = (x: Cand) => Math.round(words[x.endWord].end - words[x.startWord].start);
    out[i].score.notes.difference = best.d === 0 ? `Misma puntuación que otro momento; dura ${secs(out[i])} s frente a ${secs(other)} s.` : `Empata con otro momento: ${best.d > 0 ? "gana" : "pierde"} en ${name[best.k]} y compensa en el resto.`;
  }
  return out;
}

/** Mínimo de un clip: 70 % del objetivo, acotado entre el mínimo del rango y 3 s por debajo del máximo (generaliza el arreglo 1d1024f). */
export function minSecFor(bucket: { min: number; max: number }, targetS?: number | null): number {
  if (!targetS) return bucket.min;
  return Math.min(Math.max(bucket.min, Math.round((targetS * 70) / 100)), Math.max(bucket.min, bucket.max - 3));   // entero: 45×0,7 en coma flotante da 31,49…
}

export interface Shortfall { code: "shortfall" | "no_moments"; requested: number; delivered: number; reasons: string[] }
/** El número pedido es un objetivo: si hay menos, se explica la diferencia (nunca 0 en silencio). */
export function shortfall(requested: number | null, delivered: number, reasons: string[]): Shortfall | null {
  if (delivered === 0) return { code: "no_moments", requested: requested ?? 0, delivered: 0, reasons };
  if (requested == null || delivered >= requested) return null;
  return { code: "shortfall", requested, delivered, reasons };
}
export const DROP_TEXT: Record<string, string> = { sentence_start: "empezaba a mitad de frase", unresolved_reference: "empezaba con una referencia sin explicar", closure: "terminaba sin cerrar la frase", overlap: "se solapaba con un momento mejor", duration: "duración fuera de rango", indices: "no coincidía con la transcripción", excluded: "contenido excluido por el encargo", scores: "puntuación no válida", previous: "ya estaba entre los clips anteriores" };
