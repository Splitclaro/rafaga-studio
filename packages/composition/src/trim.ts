// Recorte de un clip (inicio/fin en la fuente) sin perder la edición: las palabras se re-relativizan, el B-roll se desplaza y recorta,
// y al ampliar se rellenan SOLO las zonas nuevas con la transcripción original (lo ya editado no se toca).
import type { BrollItem } from "./composition.ts";
import type { Word } from "./subtitles.ts";

export const MIN_CLIP_SEC = 3, MAX_CLIP_SEC = 90;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface TrimState { startSec: number; endSec: number; words: Word[]; broll?: BrollItem[] }
export type TrimResult = ({ ok: true; dropped: number; added: number } & Required<TrimState>) | { ok: false; reason: string };

/**
 * @param c clip actual (palabras y B-roll relativos al clip)
 * @param sourceWords transcripción completa en tiempos de la fuente (opcional): rellena lo que queda al ampliar
 * @param srcDuration duración de la fuente en s (límite superior del fin)
 */
export function trimClip(c: TrimState, startSec: number, endSec: number, srcDuration: number, sourceWords: Word[] = []): TrimResult {
  const s = r3(Math.max(0, startSec)), e = r3(Math.min(srcDuration > 0 ? srcDuration : Infinity, endSec));
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, reason: "Intervalo no válido." };
  const len = r3(e - s);
  if (len < MIN_CLIP_SEC) return { ok: false, reason: `El clip no puede durar menos de ${MIN_CLIP_SEC} s.` };
  if (len > MAX_CLIP_SEC) return { ok: false, reason: `El clip no puede durar más de ${MAX_CLIP_SEC} s.` };
  const shift = r3(s - c.startSec);   // >0: se recorta por delante
  const oldLen = c.endSec - c.startSec;
  const kept: Word[] = []; let dropped = 0;
  for (const w of c.words) {
    const ns = w.start - shift, ne = w.end - shift, dur = Math.max(0.001, ne - ns);
    const inside = Math.min(ne, len) - Math.max(ns, 0);
    if (inside / dur < 0.5) { dropped++; continue; }   // una palabra se conserva si al menos la mitad sigue dentro
    kept.push({ ...w, start: r3(Math.max(0, ns)), end: r3(Math.min(len, ne)) });
  }
  // zonas nuevas (antes del inicio o después del fin anteriores): palabras de la transcripción que caen enteras fuera de lo ya cubierto
  let added = 0;
  const oldS = c.startSec, oldE = c.startSec + oldLen;
  for (const w of sourceWords) {
    const wholeNew = (w.end <= oldS || w.start >= oldE);
    if (!wholeNew) continue;
    const ns = w.start - s, ne = w.end - s;
    if (ns < 0 || ne > len) continue;
    kept.push({ ...w, start: r3(ns), end: r3(ne) }); added++;
  }
  kept.sort((a, b) => a.start - b.start);
  const broll: BrollItem[] = [];
  for (const b of c.broll ?? []) {
    const bs = b.start - shift, be = bs + b.dur;
    const cs = Math.max(0, bs), ce = Math.min(len, be);
    if (ce - cs >= 0.3) broll.push({ ...b, start: r3(cs), dur: r3(ce - cs) });
  }
  return { ok: true, startSec: s, endSec: e, words: kept, broll, dropped, added };
}

/** Ajusta un borde arrastrado: respeta mínimo/máximo, la fuente y la otra punta. */
export function clampEdge(edge: "start" | "end", value: number, startSec: number, endSec: number, srcDuration: number): number {
  const max = srcDuration > 0 ? srcDuration : Infinity;
  if (edge === "start") return r3(Math.min(Math.max(value, endSec - MAX_CLIP_SEC, 0), endSec - MIN_CLIP_SEC));
  return r3(Math.max(Math.min(value, startSec + MAX_CLIP_SEC, max), startSec + MIN_CLIP_SEC));
}
