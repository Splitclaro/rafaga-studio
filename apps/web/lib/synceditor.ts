// Estado del editor de sincronización (puro): marcar manteniendo, velocidad, mover/redimensionar/insertar/borrar con deshacer.
// Los tiempos son segundos de la CANCIÓN (el llamador pasa audio.currentTime), nunca del reloj del navegador.
import { nudgeWord, resizeWord, insertWord, deleteWord, type SyncWord } from "@rafaga/lyrics";

export type Rate = 0.5 | 0.75 | 1;
interface Snap { words: SyncWord[]; cursor: number }
export interface EditorState { words: SyncWord[]; cursor: number; rate: Rate; holding: { index: number; t0: number } | null; past: Snap[]; future: Snap[] }

export const initEditor = (words: SyncWord[]): EditorState => ({ words, cursor: 0, rate: 1, holding: null, past: [], future: [] });
const commit = (s: EditorState, words: SyncWord[], cursor = s.cursor): EditorState => ({ ...s, words, cursor, holding: null, past: [...s.past, { words: s.words, cursor: s.cursor }].slice(-100), future: [] });
const r3 = (n: number) => +n.toFixed(3);
const fix = (w: SyncWord, start: number, end: number): SyncWord => ({ ...w, start: r3(start), end: r3(end), manual: true, origin: "manual", confidence: 1, flags: w.flags.filter((f) => f !== "doubtful" && f !== "not_heard") });

/** Empieza a mantener la marca sobre la palabra actual. */
export function holdStart(s: EditorState, t: number): EditorState { return s.cursor >= s.words.length ? s : { ...s, holding: { index: s.cursor, t0: t } }; }
/** Suelta: fija la palabra en [t0, t] (mínimo 50 ms), la marca como manual y avanza. */
export function holdEnd(s: EditorState, t: number): EditorState {
  if (!s.holding) return s;
  const { index, t0 } = s.holding;
  return commit(s, s.words.map((w, i) => (i === index ? fix(w, t0, Math.max(t, t0 + 0.05)) : w)), index + 1);
}
/** Toque corto: inicio en t y fin en el inicio de la palabra siguiente (o 0,3 s después). */
export function tap(s: EditorState, t: number): EditorState {
  if (s.cursor >= s.words.length) return s;
  const nx = s.words[s.cursor + 1], end = nx && nx.start > t + 0.05 ? nx.start - 0.01 : t + 0.3;
  return commit(s, s.words.map((w, i) => (i === s.cursor ? fix(w, t, end) : w)), s.cursor + 1);
}
export const setRate = (s: EditorState, rate: Rate): EditorState => ({ ...s, rate });
export const nudge = (s: EditorState, i: number, d: number): EditorState => commit(s, nudgeWord(s.words, i, d));
export const resize = (s: EditorState, i: number, edge: "start" | "end", v: number): EditorState => commit(s, resizeWord(s.words, i, edge, v));
export function insert(s: EditorState, i: number, text: string): EditorState { try { return commit(s, insertWord(s.words, i, text)); } catch { return s; } }   // sin hueco libre no cambia nada
export const remove = (s: EditorState, i: number): EditorState => commit(s, deleteWord(s.words, i), Math.min(s.cursor, Math.max(0, s.words.length - 2)));
export function undo(s: EditorState): EditorState { const p = s.past.at(-1); return p ? { ...s, words: p.words, cursor: p.cursor, holding: null, past: s.past.slice(0, -1), future: [{ words: s.words, cursor: s.cursor }, ...s.future] } : s; }
export function redo(s: EditorState): EditorState { const f = s.future[0]; return f ? { ...s, words: f.words, cursor: f.cursor, holding: null, past: [...s.past, { words: s.words, cursor: s.cursor }], future: s.future.slice(1) } : s; }
/** Aplica marcas de TapSync (en el orden de la letra) como palabras manuales. */
export function applyMarks(s: EditorState, marks: { start: number; end: number | null }[]): EditorState {
  return commit(s, s.words.map((w, i) => (marks[i] ? fix(w, marks[i].start, Math.max(marks[i].end ?? marks[i].start + 0.3, marks[i].start + 0.05)) : w)), Math.min(marks.length, s.words.length));
}
/** Índices de palabras dudosas (confianza < 0,5) para resaltarlas; las corregidas a mano ya no cuentan. */
export const doubtfulIndexes = (words: SyncWord[]): number[] => words.flatMap((w, i) => (w.confidence < 0.5 && !w.manual ? [i] : []));
/** Cuerpo de `PUT /api/lyrics/songs/:id/alignment`. */
export const toPayload = (s: EditorState, baseRevision: number | null) => ({ base_revision: baseRevision, words: s.words.map(({ text, start, end, line, manual, occurrence, confidence, origin, flags }) => ({ text, start, end, line, manual, occurrence, confidence, origin, flags })) });
