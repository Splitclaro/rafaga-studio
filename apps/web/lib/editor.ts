// Modelo de edición del editor v2: operaciones puras sobre la composición v2 y las palabras del clip, historial con deshacer/rehacer
// y autoguardado con debounce. Los cortes (`cuts`) actualizan vídeo, audio y subtítulos a la vez (mapTime / retimeWords del motor común).
import { editText, setTiming, mapTime, mergeCuts, keptLength, switchLayout, viralTemplate, type CompositionV2, type Cut, type LayoutId, type ViralTemplateId, type Word } from "@rafaga/composition";

export const MAX_CLIP_SEC_V2 = 180, MIN_CLIP_SEC = 1, FRAME = 1 / 30;
export interface EditState { comp: CompositionV2; words: Word[] }
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const span = (s: EditState) => { const f = s.comp.fragments; return { start: f[0].start, end: f.at(-1)!.end }; };
/** Duración del clip ya sin los cortes. */
export const durationOf = (s: EditState) => { const { start, end } = span(s); return r3(keptLength(end - start, s.comp.cuts)); };
const withDuration = (s: EditState): EditState => ({ ...s, comp: { ...s.comp, duration: durationOf(s) } });

/** Ajusta el inicio del clip (segundos de la fuente). Las palabras y los cortes se mantienen en tiempo relativo al nuevo inicio. */
export function setIn(s: EditState, start: number, srcDuration: number): EditState {
  const { start: a, end } = span(s), ns = Math.max(0, Math.min(r3(start), end - MIN_CLIP_SEC, srcDuration));
  if (end - ns > MAX_CLIP_SEC_V2) return s;
  const d = r3(ns - a);
  const words = s.words.map((w) => ({ ...w, start: r3(w.start - d), end: r3(w.end - d) })).filter((w) => w.end > 0);
  const cuts = s.comp.cuts?.map((c) => ({ s: Math.max(0, r3(c.s - d)), e: r3(c.e - d) })).filter((c) => c.e > 0);
  const fragments = s.comp.fragments.map((f, i) => (i === 0 ? { ...f, start: ns } : f));
  return withDuration({ comp: { ...s.comp, fragments, cuts: cuts?.length ? cuts : undefined }, words });
}
export function setOut(s: EditState, end: number, srcDuration: number): EditState {
  const { start } = span(s); const ne = Math.min(srcDuration, Math.max(r3(end), start + MIN_CLIP_SEC));
  if (ne - start > MAX_CLIP_SEC_V2) return s;
  const frags = s.comp.fragments.map((f, i, a) => (i === a.length - 1 ? { ...f, end: ne } : f));
  return withDuration({ ...s, comp: { ...s.comp, fragments: frags } });
}
/** Paso de fotograma (±1/30 s) sobre el inicio o el final. */
export const stepFrame = (s: EditState, which: "in" | "out", frames: number, srcDuration: number) =>
  which === "in" ? setIn(s, span(s).start + frames * FRAME, srcDuration) : setOut(s, span(s).end + frames * FRAME, srcDuration);
/** Amplía usando el original: `sec` > 0 alarga, < 0 recorta. */
export const extend = (s: EditState, which: "start" | "end", sec: number, srcDuration: number) => (which === "start" ? setIn(s, span(s).start - sec, srcDuration) : setOut(s, span(s).end + sec, srcDuration));

/** Borra un fragmento (en tiempo relativo al clip, línea de la fuente): se añade como corte y desaparece del vídeo, el audio y los subtítulos. */
export function deleteRange(s: EditState, from: number, to: number): EditState {
  const len = span(s).end - span(s).start, a = Math.max(0, r3(from)), b = Math.min(len, r3(to));
  if (b - a < 0.05) return s;
  const cuts = mergeCuts([...(s.comp.cuts ?? []), { s: a, e: b }], len);
  if (keptLength(len, cuts) < MIN_CLIP_SEC) return s;
  return withDuration({ ...s, comp: { ...s.comp, cuts } });
}
/** Restaura cualquier corte que toque el intervalo. */
export function restoreRange(s: EditState, from: number, to: number): EditState {
  const cuts = (s.comp.cuts ?? []).filter((c) => !(c.s < to && c.e > from));
  return withDuration({ ...s, comp: { ...s.comp, cuts: cuts.length ? cuts : undefined } });
}
/** Borra palabras por transcripción: del inicio de la primera al final de la última. */
export const deleteWords = (s: EditState, i: number, j: number) => deleteRange(s, s.words[Math.min(i, j)].start - 0.02, s.words[Math.max(i, j)].end + 0.02);

export const editWordText = (s: EditState, i: number, text: string): EditState => ({ ...s, words: editText(s.words, i, text) });
export const setWordTiming = (s: EditState, i: number, start: number, end: number): EditState => ({ ...s, words: setTiming(s.words, i, start, end, span(s).end - span(s).start) });
export const setLayout = (s: EditState, layout: LayoutId): EditState => ({ ...s, comp: switchLayout(s.comp, layout) });
/** Cambiar de formato (9:16, 16:9, 1:1): se recalculan las cajas de la plantilla y se conserva todo lo demás. */
export function setAspect(s: EditState, aspect: CompositionV2["aspect"]): EditState {
  if (s.comp.aspect === aspect) return s;
  const id = s.comp.template as ViralTemplateId | undefined;
  const t = viralTemplate(id ?? "video_completo", aspect, { duration: s.comp.duration, fragments: s.comp.fragments, subtitles: s.comp.subtitles.enabled, headline: s.comp.headline ? { lines: s.comp.headline.lines, accent: s.comp.headline.accent, pill: s.comp.headline.pill } : undefined });
  return { ...s, comp: { ...t, layout: s.comp.layout, template: id, cuts: s.comp.cuts, kf: s.comp.kf, audio: s.comp.audio, extras: s.comp.extras, cam: s.comp.cam, needs_review: s.comp.needs_review } };
}
export const setVolume = (s: EditState, v: number): EditState => ({ ...s, comp: { ...s.comp, audio: { ...s.comp.audio, volume: Math.max(0, Math.min(2, v)) } } });
/** Aplicar otra plantilla conserva fragmentos, cortes, audio y extras (solo cambia la presentación). Nunca crea trabajos. */
export function applyTemplate(s: EditState, id: ViralTemplateId, o: { headline?: { lines: string[]; accent?: string; pill?: string }; platforms?: Parameters<typeof viralTemplate>[2]["platforms"] } = {}): EditState {
  const t = viralTemplate(id, s.comp.aspect, { duration: s.comp.duration, fragments: s.comp.fragments, subtitles: s.comp.subtitles.enabled, headline: o.headline ?? (s.comp.headline ? { lines: s.comp.headline.lines, accent: s.comp.headline.accent, pill: s.comp.headline.pill } : undefined), platforms: o.platforms });
  return { ...s, comp: { ...t, cuts: s.comp.cuts, kf: s.comp.kf, audio: s.comp.audio, extras: s.comp.extras, cam: s.comp.cam, needs_review: s.comp.needs_review } };
}

/** Instante del clip sin cortes ↔ instante de la línea de la fuente: error ≤ 1 ms. */
export const toEdit = (tSrc: number, cuts: Cut[] | undefined) => mapTime(tSrc, cuts);

// ── Historial ──
export class History<T> {
  private past: T[] = []; private future: T[] = []; present: T;
  constructor(initial: T) { this.present = initial; }
  apply(next: T): T { if (next === this.present) return this.present; this.past.push(this.present); this.future = []; this.present = next; return next; }
  undo(): T { const p = this.past.pop(); if (p !== undefined) { this.future.push(this.present); this.present = p; } return this.present; }
  redo(): T { const n = this.future.pop(); if (n !== undefined) { this.past.push(this.present); this.present = n; } return this.present; }
  get canUndo() { return this.past.length > 0; } get canRedo() { return this.future.length > 0; }
  /** Duplicar: una copia independiente con el estado actual como inicio. */
  duplicate(): History<T> { return new History<T>(structuredClone(this.present)); }
}

// ── Autoguardado ──
export type SaveState = "idle" | "guardando" | "guardado" | "error al guardar";
export interface Timers { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
/** Escribe UN borrador 800 ms después de la última edición. Si falla, la edición sigue en memoria y se reintenta con la siguiente. */
export class Autosaver {
  state: SaveState = "idle"; private h: unknown = null; private latest: EditState | null = null; private dirty = false;
  private write: (s: EditState) => Promise<void>; private onState: (s: SaveState) => void; private ms: number; private timers: Timers;
  constructor(write: (s: EditState) => Promise<void>, onState: (s: SaveState) => void, ms = 800, timers: Timers = realTimers) { this.write = write; this.onState = onState; this.ms = ms; this.timers = timers; }
  private set(s: SaveState) { this.state = s; this.onState(s); }
  edit(s: EditState) { this.latest = s; this.dirty = true; if (this.h) this.timers.clear(this.h); this.h = this.timers.set(() => { void this.flush(); }, this.ms); }
  async flush() {
    this.h = null; if (!this.dirty || !this.latest) return;
    const s = this.latest; this.dirty = false; this.set("guardando");
    try { await this.write(s); this.set(this.dirty ? "guardando" : "guardado"); } catch { this.dirty = true; this.set("error al guardar"); }
  }
}
