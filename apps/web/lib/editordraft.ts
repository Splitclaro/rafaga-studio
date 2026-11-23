// Editor de vídeos (v3): borrador de una pieza de letra ↔ LyricComposition, pasos del recorrido y tiempos «m:ss.d».
// El borrador vive en `lyric_projects` (save_lyric_project) y la letra en las revisiones de alineación: recargar reabre el mismo estado.
import { validateLyricComposition, type LyricComposition } from "@rafaga/composition";

export const STEPS = ["audio", "letras", "estilo", "render"] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABEL: Record<Step, string> = { audio: "Audio", letras: "Letras", estilo: "Estilo", render: "Render" };

export type Word = { text: string; start: number; end: number; line: number };
export type DraftRow = {
  project_id: string; song_id: string; mode: "letra" | "texto" | "portada"; range_start_ms: number; range_end_ms: number | null; aspect: LyricComposition["aspect"]; res: 720 | 1080;
  style: unknown; preset: string | null; background: Record<string, unknown>; settings: Record<string, unknown>; hook: unknown; message: unknown; cover: unknown; updated_at?: string;
};

/** Tramo por defecto: 30 s desde un segundo antes de la primera palabra, sin pasar del final de la canción. */
export function defaultRange(words: Word[], durationS: number | null): { start: number; end: number } {
  const first = words[0]?.start ?? 0, start = Math.max(0, Math.floor(first - 1));
  const end = Math.min(durationS ?? start + 30, start + 30);
  return { start, end: Math.max(start + 1, end) };
}

export function draftToComposition(d: DraftRow, words: Word[], durationS: number | null): LyricComposition {
  const def = defaultRange(words, durationS);
  const start = d.range_end_ms == null && d.range_start_ms === 0 ? def.start : d.range_start_ms / 1000;
  const end = d.range_end_ms == null ? def.end : d.range_end_ms / 1000;
  return validateLyricComposition({
    aspect: d.aspect, res: d.res, mode: d.mode, range: { start, end }, words,
    ...(d.style ? { style: d.style } : {}), ...(d.preset ? { preset: d.preset } : {}),
    background: d.background, settings: d.settings, hook: d.hook ?? null, message: d.message ?? null, cover: d.cover ?? null,
  });
}

/** Parche para save_lyric_project: solo las claves que la función admite. Los fondos se limitan a 20 elementos (tope de tamaño de la columna). */
export function compositionToPatch(c: LyricComposition): Record<string, unknown> {
  const bg = c.background as unknown as { items?: unknown[]; [k: string]: unknown };
  return {
    mode: c.mode, range_start_ms: Math.round(c.range.start * 1000), range_end_ms: Math.round(c.range.end * 1000), aspect: c.aspect, res: c.res,
    style: c.style, preset: c.preset, background: { ...bg, items: (bg.items ?? []).slice(0, 20) }, settings: c.settings,
    hook: c.hook, message: c.message, cover: c.cover ?? null,
  };
}

/** Qué paso se puede abrir con lo que hay: sin letra sincronizada no hay Letras ni Estilo; sin palabras en el tramo no hay Render. */
export function stepAllowed(step: Step, s: { hasSong: boolean; hasWords: boolean; wordsInRange: number }): { ok: boolean; why?: string } {
  if (!s.hasSong) return { ok: false, why: "Primero sube una canción." };
  if (step === "audio") return { ok: true };
  if (!s.hasWords) return { ok: false, why: "La letra aún se está preparando." };
  if (step === "render" && s.wordsInRange === 0) return { ok: false, why: "El tramo elegido no tiene letra: amplíalo en Audio." };
  return { ok: true };
}

export const wordsInRange = (words: Word[], r: { start: number; end: number }) => words.filter((w) => w.end > r.start && w.start < r.end).length;

/** «m:ss.d» ↔ segundos. Acepta «ss», «m:ss» y «m:ss.d»; devuelve NaN si no es válido. */
export function parseClock(s: string): number {
  const t = s.trim(); if (!/^\d+(:\d{1,2})?(\.\d+)?$/.test(t)) return NaN;
  const [a, b] = t.split(":");
  return b === undefined ? Number(a) : Number(a) * 60 + Number(b);
}
export const formatClock = (sec: number) => { const s = Math.max(0, sec), m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };

/** Ajusta el tramo: el fin se conserva al mover el inicio (si sigue siendo posterior), mínimo 1 s y dentro de la canción. */
export function setRange(r: { start: number; end: number }, patch: { start?: number; end?: number }, durationS: number | null): { start: number; end: number } {
  const max = durationS ?? Number.POSITIVE_INFINITY;
  let start = patch.start ?? r.start, end = patch.end ?? r.end;
  start = Math.min(Math.max(0, start), Math.max(0, max - 1));
  end = Math.min(Math.max(end, start + 1), max);
  return { start: +start.toFixed(3), end: +end.toFixed(3) };
}
