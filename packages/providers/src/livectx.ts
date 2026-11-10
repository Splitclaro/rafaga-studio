// Contexto compartido entre ventanas de un directo: cada ventana nueva arranca con la cola de la anterior, así un momento que empieza en una y
// termina en la siguiente se puede seleccionar entero; y los momentos ya entregados no se repiten (ni dentro del contexto ni tras una reconexión).
export interface Span { start: number; end: number }
export const CONTEXT_SECONDS = 30;
/** Segundos de cola de la ventana anterior que se anteponen a la nueva. */
export const contextTail = (prevWindowSec: number | null, want = CONTEXT_SECONDS) => (prevWindowSec && prevWindowSec > 8 ? Math.min(want, Math.floor(prevWindowSec * 0.5)) : 0);
/** Tiempo absoluto (desde el inicio de la sesión) de un candidato de una ventana cuya fuente empieza en `absStart`. */
export const toAbs = (absStart: number, c: Span): Span => ({ start: +(absStart + c.start).toFixed(2), end: +(absStart + c.end).toFixed(2) });
/** Un candidato cuyo final cae dentro del contexto ya pertenecía a la ventana anterior. */
export const insideContext = (c: Span, skipBefore: number, slack = 1) => c.end <= skipBefore + slack;
export function overlapRatio(a: Span, b: Span): number { const ov = Math.min(a.end, b.end) - Math.max(a.start, b.start); return ov > 0 ? ov / Math.min(a.end - a.start, b.end - b.start) : 0; }
export const isDuplicate = (abs: Span, delivered: Span[], threshold = 0.3) => delivered.some((d) => overlapRatio(abs, d) > threshold);
/** Filtra los candidatos de una ventana: fuera los del contexto y los ya entregados. Devuelve los nuevos y el motivo de cada descarte. */
export function freshCandidates<T extends Span>(cands: T[], o: { absStart: number; skipBefore: number; delivered: Span[] }): { fresh: T[]; dropped: { c: T; why: "contexto" | "duplicado" }[] } {
  const fresh: T[] = [], dropped: { c: T; why: "contexto" | "duplicado" }[] = [];
  for (const c of cands) {
    if (insideContext(c, o.skipBefore)) dropped.push({ c, why: "contexto" });
    else if (isDuplicate(toAbs(o.absStart, c), o.delivered)) dropped.push({ c, why: "duplicado" });
    else fresh.push(c);
  }
  return { fresh, dropped };
}
/** Latencia que vive el usuario: desde que termina el momento en la señal hasta que su clip se puede reproducir. */
export const liveLatency = (momentEndedAtMs: number, clipReadyAtMs: number) => Math.max(0, Math.round((clipReadyAtMs - momentEndedAtMs) / 1000));
