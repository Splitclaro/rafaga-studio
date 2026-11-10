// Criterio editorial de Ráfaga, sin IA de pago y determinista. Sirve de respaldo y de verificador de la IA:
//  1) interpretBrief: entiende el encargo en lenguaje natural (obligatorio vs preferencia, cantidad, duración, público, tono).
//  2) scoreWindow: puntúa un tramo con señales observables (qué dice, cómo empieza, si se entiende solo, si cierra).
//  3) refineBounds: decide dónde entrar y salir (recupera la frase que explica, incluye la pregunta, deja oír el remate).
//  4) diversify: evita llenar el lote con cortes casi iguales.
//  5) explain: razón concreta y comprobable al reproducir el clip. El «potencial» es una estimación editorial, no una predicción.
import type { TWord } from "./index.ts";

export const EDITORIAL_VERSION = "editorial-v1";
import { norm, STOP, KIND_LEX, KIND_WORDS, NUM, stem, contentTerms, interpretBrief, type Kind, type Intent } from "./intent.ts";
export { stem, contentTerms, interpretBrief, type Kind, type Intent };
void STOP; void KIND_WORDS; void NUM; void norm;

// ───────── análisis de tramos ─────────
const END = /[.!?…»"”)]$/;
export const sentenceEnd = (w: string) => END.test(w);
export function sentences(words: TWord[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []; let from = 0;
  words.forEach((w, i) => { if (sentenceEnd(w.text) || i === words.length - 1) { out.push({ from, to: i }); from = i + 1; } });
  return out;
}
const text = (words: TWord[], a: number, b: number) => words.slice(a, b + 1).map((w) => w.text).join(" ");
const ANAPHORA = /^(eso|esto|ello|aquello|por eso|por esto|tambi[eé]n|pero|y |entonces|as[ií] que|ah[ií]|como (te )?(dec[ií]a|dije)|lo que (te )?(dec[ií]a|dije)|ese|esa|esos|esas|aquel|aquella|luego|despu[eé]s|bueno|pues|o sea|sin embargo|adem[aá]s)\b/i;
const FILLER_START = /^(bueno|eh+|mm+|pues|este|a ver|o sea|y bueno|vale)\b/i;
const CONCLUSIVE = /\b(por eso|al final|as[ií] que|y ese fue|esa fue|la lecci[oó]n|en resumen|moraleja|desde entonces|y (?:colorín|colorin)|eso fue (?:todo|lo que)|y listo)\b/i;

export interface Scores { relevance: number; hook: number; standalone: number; closure: number }
export interface Scored { scores: Scores; excluded: boolean; kindHits: Partial<Record<Kind, number>>; matched: string[]; notes: string[] }

/** Puntúa un tramo (índices inclusivos) con señales observables. Con brief, la relevancia manda; sin brief, gana lo autónomo. */
export function scoreWindow(words: TWord[], a: number, b: number, it: Intent): Scored {
  const body = text(words, a, b), terms = contentTerms(body);
  const sents = sentences(words.slice(a, b + 1)).map((s) => ({ from: s.from + a, to: s.to + a }));
  const first = text(words, sents[0].from, sents[0].to), last = text(words, sents[sents.length - 1].from, sents[sents.length - 1].to);
  const notes: string[] = [];
  const excluded = it.exclude.some((x) => terms.includes(x));
  // tipos de contenido por frase
  const kindHits: Partial<Record<Kind, number>> = {};
  for (const s of sents) { const st = text(words, s.from, s.to); for (const k of Object.keys(KIND_LEX) as Kind[]) if (KIND_LEX[k].test(st)) kindHits[k] = (kindHits[k] ?? 0) + 1; }
  const dens = (k: Kind) => (kindHits[k] ?? 0) / sents.length;
  // relevancia
  const matched = it.focus.filter((x) => terms.includes(x));
  let rel = 5;
  if (it.focus.length) { const cover = matched.length / Math.min(it.focus.length, 6), density = terms.length ? terms.filter((x) => it.focus.includes(x)).length / terms.length : 0; rel = 10 * (0.45 * Math.min(1, cover) + 0.55 * Math.min(1, density * 5)); }
  if (it.kinds.length) { const boost = Math.min(1, Math.max(...it.kinds.map(dens)) * 1.6); rel = it.focus.length ? Math.max(rel * (0.7 + 0.3 * boost), 0.35 * rel + 6.5 * boost) : 10 * boost; }   // las palabras del encargo pueden ser descriptores («prácticos», «con giro»): el tipo de contenido también aporta relevancia   // con temas explícitos el tipo refuerza; sin ellos, manda
  // «historia con giro»: pasado + giro dentro del tramo
  if (it.kinds.includes("stories") && !/\b(pero|de repente|resulta que|al final|sin embargo)\b/i.test(body)) { rel *= 0.75; notes.push("cuenta algo pero no se aprecia un giro"); }
  for (const m of it.must) if (!terms.includes(m)) { rel *= 0.5; notes.push(`no menciona «${m}»`); }
  for (const s of it.soft) if (terms.includes(s.term)) rel += s.weight * 2;
  const startsOn = it.focus.length ? it.focus.some((x) => contentTerms(first).includes(x)) || it.kinds.some((k) => KIND_LEX[k].test(first)) : true;
  if (!startsOn) rel *= 0.8;
  rel = Math.max(0, Math.min(10, rel));
  // gancho
  const fw = first.split(/\s+/).length; let hook = 5;
  if (/[?¡!]/.test(first)) hook += 1.5; if (/\d/.test(first)) hook += 1; if (/\b(nunca|error|secreto|mentira|nadie|siempre|jam[aá]s|el problema|lo que nadie|no sab[ií]as)\b/i.test(first)) hook += 1.5;
  if (FILLER_START.test(first)) hook -= 2; if (fw > 28) hook -= 1.5; if (fw <= 16) hook += 0.5;
  hook = Math.max(0, Math.min(10, hook));
  // se entiende solo
  let standalone = 7; if (ANAPHORA.test(first.replace(/^[¿¡"«]/, ""))) { standalone -= 3; notes.push("empieza apoyándose en lo anterior"); }
  if (body.split(/\s+/).length < 25) standalone -= 1.5; if (/\b(como (te )?(dec[ií]a|dije|vimos)|lo de antes)\b/i.test(body)) standalone -= 2; standalone = Math.max(0, Math.min(10, standalone));
  // cierre
  let closure = sentenceEnd(words[b].text) ? 6.5 : 3;
  if (/\?\s*["»”]?$/.test(last)) { closure -= 3; notes.push("termina en pregunta sin respuesta"); }
  if (/[:,]$/.test(words[b].text)) closure -= 2; if (CONCLUSIVE.test(last)) closure += 2; if (/\b(y|pero|porque|que|entonces)\.?$/i.test(words[b].text)) closure -= 2;
  closure = Math.max(0, Math.min(10, closure));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { scores: { relevance: r1(rel), hook: r1(hook), standalone: r1(standalone), closure: r1(closure) }, excluded, kindHits, matched, notes };
}

// ───────── límites del corte ─────────
export interface Bounds { a: number; b: number; changes: string[] }
/**
 * Decide la entrada y la salida. Recupera la frase anterior si el corte empieza apoyándose en ella (el «Eso fue lo que lo cambió todo»),
 * incluye la pregunta cuando el corte arranca con su respuesta, y deja oír el remate. Nunca supera maxSec ni cambia lo que se dice.
 */
export function refineBounds(words: TWord[], a: number, b: number, o: { maxSec: number; wantsPayoff?: boolean; wantsQuestion?: boolean; maxLeadSec?: number }): Bounds {
  const S = sentences(words), changes: string[] = [];
  const si = (i: number) => S.findIndex((s) => i >= s.from && i <= s.to);
  let sa = si(a), sb = si(b);
  if (sa < 0 || sb < 0) return { a, b, changes };
  const dur = () => words[S[sb].to].end - words[S[sa].from].start;
  const lead = o.maxLeadSec ?? 14;
  const first = () => text(words, S[sa].from, S[sa].to).replace(/^[¿¡"«]/, "");
  // 1) entrada: si empieza apoyándose en lo anterior, recuperar la frase que lo explica (hasta 2 frases)
  for (let k = 0; k < 2 && sa > 0; k++) {
    const prev = S[sa - 1], gap = words[S[sa].from].start - words[prev.to].end;
    const isQuestionBefore = /\?\s*["»”]?$/.test(words[prev.to].text);
    const needs = ANAPHORA.test(first()) || (isQuestionBefore && (o.wantsQuestion || /^(s[ií]|no|pues|porque|claro|exacto|la verdad)\b/i.test(first())));
    if (!needs || gap > 2.5 || dur() + (words[S[sa].from].start - words[prev.from].start) > o.maxSec || words[S[sa].from].start - words[prev.from].start > lead) break;
    sa--; const cm = isQuestionBefore ? "incluye la pregunta que origina la respuesta" : "recupera la frase que da contexto al inicio"; if (!changes.includes(cm)) changes.push(cm);
  }
  // 2) salida: no terminar en una pregunta, en «:» ni en una preparación sin desenlace
  for (let k = 0; k < 3 && sb < S.length - 1; k++) {
    const last = text(words, S[sb].from, S[sb].to), nxt = S[sb + 1], gap = words[nxt.from].start - words[S[sb].to].end;
    const open = /\?\s*["»”]?$/.test(last) || /[:,]$/.test(words[S[sb].to].text);
    // Remate: solo hacia un cierre real de la misma historia (frase conclusiva) o hacia una frase corta que lo prepara; nunca hacia otra pregunta
    const nt = text(words, nxt.from, nxt.to), isQ = /^[¿]/.test(nt) || /\?\s*["»”]?$/.test(nt), len = nxt.to - nxt.from + 1;
    const after = S[sb + 2], concl = (x?: { from: number; to: number }) => !!x && CONCLUSIVE.test(text(words, x.from, x.to)) && x.to - x.from + 1 <= 25;
    const punch = !!o.wantsPayoff && !isQ && gap <= 2.5 && (concl(nxt) || (len <= 12 && concl(after) && words[after.from].start - words[nxt.to].end <= 2.5));
    if (!(open || punch) || gap > 3 || words[nxt.to].end - words[S[sa].from].start > o.maxSec) break;
    sb++; const msg = open ? "extiende hasta la respuesta o el desenlace" : "deja que se escuche el remate"; if (!changes.includes(msg)) changes.push(msg);
  }
  return { a: S[sa].from, b: S[sb].to, changes };
}

// ───────── diversidad ─────────
export interface Pickable { a: number; b: number; overall: number }
const jaccard = (x: Set<string>, y: Set<string>) => { let i = 0; for (const v of x) if (y.has(v)) i++; return i / Math.max(1, x.size + y.size - i); };
/** Selección con penalización por similitud de contenido (MMR): evita cortes casi idénticos sin renunciar a los mejores. */
export function diversify<T extends Pickable>(words: TWord[], cands: T[], count: number, o: { maxSim?: number } = {}): T[] {
  const maxSim = o.maxSim ?? 0.55;
  const sets = new Map<T, Set<string>>(cands.map((c) => [c, new Set(contentTerms(text(words, c.a, c.b)))]));
  const picked: T[] = [], pool = [...cands].sort((x, y) => y.overall - x.overall);
  while (picked.length < count && pool.length) {
    let best = -1, bs = -Infinity;
    pool.forEach((c, i) => {
      const sim = picked.length ? Math.max(...picked.map((p) => jaccard(sets.get(c)!, sets.get(p)!))) : 0;
      const overlap = picked.some((p) => Math.min(words[p.b].end, words[c.b].end) - Math.max(words[p.a].start, words[c.a].start) > 0.1);
      if (sim > maxSim || overlap) return;
      const s = c.overall - 4 * sim; if (s > bs) { bs = s; best = i; }
    });
    if (best < 0) break;
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

// ───────── explicación comprobable ─────────
const KIND_REASON: Record<Kind, string> = { tips: "da consejos concretos", stories: "cuenta una anécdota", reactions: "recoge una reacción", demo: "enseña la acción y su resultado", opinion: "defiende una opinión", qa: "responde a una pregunta" };
const quote = (ws: TWord[], a: number, b: number, n = 9) => { const w = ws.slice(a, b + 1).map((x) => x.text); return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`; };
export function explain(words: TWord[], a: number, b: number, sc: Scored, it: Intent, changes: string[] = []): { reason: string; evidence: string[] } {
  const S = sentences(words.slice(a, b + 1)).map((s) => ({ from: s.from + a, to: s.to + a }));
  const head = quote(words, S[0].from, S[0].to), tail = quote(words, Math.max(S[S.length - 1].from, S[S.length - 1].to - 8), S[S.length - 1].to, 9);
  const top = (Object.entries(sc.kindHits) as [Kind, number][]).sort((x, y) => y[1] - x[1])[0];
  const parts: string[] = [`Empieza con «${head}» y termina con «${tail.replace(/^…/, "")}»`];
  if (top && top[1] >= 1) parts.push(`${KIND_REASON[top[0]]}${top[1] > 1 ? ` (${top[1]} frases)` : ""}`);
  if (sc.matched.length) parts.push(`toca lo que pediste: ${sc.matched.slice(0, 3).join(", ")}`);
  if (changes.length) parts.push(changes.join("; "));
  if (sc.scores.standalone >= 7) parts.push("se entiende sin ver lo anterior");
  const evidence = [head, tail];
  return { reason: parts.join(". ") + ".", evidence };
}

// ───────── instrucciones sobre resultados ─────────
export type Directive =
  | { scope: "clip"; action: "include_question" | "extend" | "shorten"; note: string }
  | { scope: "search"; action: "more_like" | "less"; terms: string[]; note: string }
  | { scope: "search"; action: "only_kind"; kind: Kind; note: string }
  | { scope: "search"; action: "variants"; count: number; note: string };
/** Interpreta «más como este», «menos polémica», «incluye la pregunta», «busca solo reacciones», «haz cinco variantes». */
export function parseDirective(s: string): Directive | null {
  const t = s.trim();
  if (/\bincluye la pregunta|con la pregunta\b/i.test(t)) return { scope: "clip", action: "include_question", note: "Ajusta el inicio de este corte para que incluya la pregunta." };
  if (/\bm[aá]s (largo|extenso)|alarga|ampl[ií]a\b/i.test(t)) return { scope: "clip", action: "extend", note: "Alarga este corte." };
  if (/\bm[aá]s corto|acorta|recorta\b/i.test(t)) return { scope: "clip", action: "shorten", note: "Acorta este corte." };
  const v = t.match(/\bhaz\s+(\w+)\s+variantes\b/i); if (v) { const n = /^\d+$/.test(v[1]) ? Number(v[1]) : NUM[v[1].toLowerCase()]; if (n) return { scope: "search", action: "variants", count: n, note: `Genera ${n} variantes manteniendo el intervalo.` }; }
  const only = t.match(/\bbusca solo\s+(.+)/i); if (only) for (const [k, re] of KIND_WORDS) if (re.test(only[1])) return { scope: "search", action: "only_kind", kind: k, note: `Busca nuevos momentos de tipo «${only[1].trim()}».` };
  if (/\bm[aá]s como (este|esta|ese|esa)\b/i.test(t)) return { scope: "search", action: "more_like", terms: [], note: "Busca momentos parecidos a este." };
  const less = t.match(/\bmenos\s+(.+)/i); if (less) return { scope: "search", action: "less", terms: contentTerms(less[1]), note: `Rebaja los momentos con «${less[1].trim()}».` };
  return null;
}

// ───────── candidatos completos ─────────
import { overall } from "./index.ts";
import { suggestTitle } from "./title.ts";
export interface EditorialCandidate {
  startWord: number; endWord: number; title: string; reason: string; briefFit: string; excluded?: boolean;
  scores: Scores; evidence: string[]; changes: string[]; overall: number;
}
export function editorialCandidates(words: TWord[], intent: Intent, o: { minSec: number; maxSec: number; count: number; briefText?: string | null }): EditorialCandidate[] {
  if (words.length < 8) return [];
  const S = sentences(words), hasBrief = !!intent.raw;
  // Con encargo, un corte no puede abrir ni cerrar con una frase sin relación con lo pedido (evita arrastrar temas ajenos).
  const active = hasBrief && (intent.focus.length > 0 || intent.kinds.length > 0);
  const TOPIC_SHIFT = /\b(hablando de otra cosa|cambiando de tema|por cierto|ahora una pausa|pasamos a|volvemos|dejando eso|otra cosa|dicho esto)\b/i;
  const own = S.map((sn) => { const st = text(words, sn.from, sn.to), ts = contentTerms(st); return intent.focus.some((x) => ts.includes(x)) || intent.kinds.some((k) => KIND_LEX[k].test(st)) || intent.must.some((x) => ts.includes(x)); });
  // La señal se propaga a las frases siguientes de la misma secuencia (hasta 3 seguidas) salvo cambio de tema explícito.
  const signal: boolean[] = []; let run = 0;
  S.forEach((sn, i) => {
    if (!active) return void signal.push(true);
    if (own[i]) { run = 0; return void signal.push(true); }
    const shift = TOPIC_SHIFT.test(text(words, sn.from, sn.to));
    if (i > 0 && signal[i - 1] && !shift && run < 3) { run++; return void signal.push(true); }
    run = 0; signal.push(false);
  });
  const raw: (EditorialCandidate & { a: number; b: number })[] = [];
  for (let s = 0; s < S.length; s++) for (let e = s; e < S.length; e++) {
    const dur = words[S[e].to].end - words[S[s].from].start;
    if (dur > o.maxSec) break; if (dur < o.minSec * 0.6) continue;
    if (!signal[s] || !signal[e]) continue;   // se admite algo más corto: el ajuste de límites puede alargarlo
    let a = S[s].from, b = S[e].to;
    const rb = refineBounds(words, a, b, { maxSec: o.maxSec, wantsPayoff: intent.wantsPayoff, wantsQuestion: intent.wantsQuestion });
    a = rb.a; b = rb.b;
    const d2 = words[b].end - words[a].start; if (d2 < o.minSec || d2 > o.maxSec) continue;
    const sc = scoreWindow(words, a, b, intent);
    if (sc.excluded) continue;
    if (hasBrief && (intent.focus.length || intent.kinds.length) && sc.scores.relevance < 4.5) continue;   // mejor menos cortes que relleno
    const ex = explain(words, a, b, sc, intent, rb.changes);
    const body = words.slice(a, b + 1).map((w) => w.text).join(" ");
    raw.push({ a, b, startWord: a, endWord: b, scores: sc.scores, evidence: ex.evidence, changes: rb.changes, reason: ex.reason, excluded: false,
      briefFit: hasBrief ? (sc.matched.length ? `Coincide con: ${sc.matched.slice(0, 4).join(", ")}` : sc.notes[0] ?? "Encaja con el tipo de contenido pedido") : "Sin encargo: tramo autónomo con gancho y cierre",
      title: suggestTitle(body, o.briefText ?? intent.raw) || body.split(" ").slice(0, 8).join(" ").replace(/[.,;:]$/, ""), overall: Math.round((overall(sc.scores, hasBrief) + (intent.wantsPayoff ? 0.3 * sc.scores.closure : 0)) * 10) / 10 });
  }
  // un mismo núcleo puede salir de varias ventanas: se queda la mejor de cada solape y luego se diversifica
  return diversify(words, raw, o.count * 3).map(({ a: _a, b: _b, ...c }) => c);
}

/** Segundos de entrada y salida con holgura: nunca invade la palabra anterior ni la siguiente. */
export function padBounds(words: TWord[], a: number, b: number, pre = 0.25, post = 0.4): { startSec: number; endSec: number } {
  const prevEnd = a > 0 ? words[a - 1].end : 0, nextStart = b < words.length - 1 ? words[b + 1].start : Infinity;
  const startSec = Math.max(0, Math.max(words[a].start - pre, prevEnd + (words[a].start - prevEnd > 0.15 ? 0.05 : 0)));
  const endSec = Math.min(words[b].end + post, nextStart - (nextStart - words[b].end > 0.2 ? 0.05 : 0));
  return { startSec: +startSec.toFixed(2), endSec: +Math.max(endSec, words[b].end).toFixed(2) };
}
