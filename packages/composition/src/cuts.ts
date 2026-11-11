// Cortes internos de un clip («quitar silencios y muletillas»). Todo en segundos RELATIVOS al clip, sobre la línea de tiempo de la fuente.
// La vista previa salta los cortes y el export los elimina con select/aselect: ambos usan la misma lista, así que coinciden.
import type { Word } from "./subtitles.ts";

export interface Cut { s: number; e: number }
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Hesitaciones habituales en español e inglés. Conservador: solo sonidos sin significado, no palabras con contenido. */
const FILLER = /^(?:e+h+m*|e+m+|h+m+|m{2,}|u+h+m*|a+h+|e+eh+)[.,;:!?…]*$/i;
export const isFiller = (t: string) => FILLER.test(t.trim());

export interface CutOptions { minGap?: number; pad?: number; fillers?: boolean; minCut?: number }
export interface CutPlan { cuts: Cut[]; silences: number; fillers: number; removedSec: number }

/** Normaliza: ordena, recorta a [0,len], descarta vacíos y fusiona solapes/contiguos. */
export function mergeCuts(cuts: Cut[], len: number, minCut = 0.05): Cut[] {
  const l = cuts.map((c) => ({ s: Math.max(0, r3(c.s)), e: Math.min(len, r3(c.e)) })).filter((c) => c.e - c.s >= minCut).sort((a, b) => a.s - b.s);
  const out: Cut[] = [];
  for (const c of l) { const p = out[out.length - 1]; if (p && c.s <= p.e + 0.001) p.e = Math.max(p.e, c.e); else out.push({ ...c }); }
  return out;
}
export const removedSeconds = (cuts: Cut[]) => r3(cuts.reduce((t, c) => t + (c.e - c.s), 0));
export const keptLength = (len: number, cuts: Cut[] | undefined) => r3(len - removedSeconds(cuts ?? []));

/** Propone cortes: pausas largas entre palabras (con un margen para no comer el aire de las frases) y hesitaciones. */
export function detectCuts(words: Word[], len: number, o: CutOptions = {}): CutPlan {
  const minGap = o.minGap ?? 0.8, pad = o.pad ?? 0.15, useFill = o.fillers !== false, minCut = o.minCut ?? 0.12;
  const ws = [...words].sort((a, b) => a.start - b.start);
  const raw: Cut[] = []; let silences = 0, fillers = 0;
  if (!ws.length) return { cuts: [], silences: 0, fillers: 0, removedSec: 0 };
  const gap = (a: number, b: number) => { if (b - a >= minGap) { const s = a + pad, e = b - pad; if (e - s >= minCut) { raw.push({ s, e }); silences++; } } };
  gap(0, ws[0].start);                                   // silencio inicial
  for (let i = 0; i < ws.length - 1; i++) gap(ws[i].end, ws[i + 1].start);
  gap(ws[ws.length - 1].end, len);                       // silencio final
  if (useFill) for (const w of ws) if (isFiller(w.text) && w.end - w.start >= 0.08) { raw.push({ s: w.start, e: w.end }); fillers++; }
  const cuts = mergeCuts(raw, len, minCut);
  return { cuts, silences, fillers, removedSec: removedSeconds(cuts) };
}

/** Tiempo de la fuente → tiempo de salida (descontando lo cortado antes). Dentro de un corte devuelve el inicio del corte. */
export function mapTime(t: number, cuts: Cut[] | undefined): number {
  let removed = 0;
  for (const c of cuts ?? []) { if (t >= c.e) removed += c.e - c.s; else if (t > c.s) { removed += t - c.s; break; } else break; }
  return r3(t - removed);
}

/** Palabras en tiempos de salida: se descartan las que caen dentro de un corte y el resto se desplaza. */
export function retimeWords(words: Word[], cuts: Cut[] | undefined): Word[] {
  if (!cuts?.length) return words;
  const out: Word[] = [];
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (cuts.some((c) => mid >= c.s && mid < c.e)) continue;
    const s = mapTime(w.start, cuts), e = Math.max(s + 0.02, mapTime(w.end, cuts));
    out.push({ ...w, start: s, end: e });
  }
  return out;
}

/** Expresión de FFmpeg que es verdadera fuera de los cortes (para select/aselect). */
export function keepExpr(cuts: Cut[]): string {
  return `not(${cuts.map((c) => `between(t,${c.s.toFixed(3)},${c.e.toFixed(3)})`).join("+")})`;
}

/** ¿El instante `t` (relativo al clip) cae dentro de un corte? Devuelve el final del corte o null. */
export function cutEndAt(t: number, cuts: Cut[] | undefined): number | null {
  for (const c of cuts ?? []) if (t >= c.s && t < c.e) return c.e;
  return null;
}
