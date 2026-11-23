// Textos de Lyric Studio que Escalium ofrece y Ráfaga no exponía (E7): llamada a la acción al final, título fijo y fundidos de audio.
// Todo se escribe en la LyricComposition existente (hook, message, settings.fadeIn/fadeOut): el motor de vista previa y exportación es el mismo (lyricOverlays).
import type { LyricComposition } from "@rafaga/composition";

export const CTA_MAX_SECONDS = 15;

/** Llamada a la acción durante los últimos `secs` segundos del tramo. Texto vacío la quita. Los tiempos del mensaje son de la canción (absolutos). */
export function withCta(c: LyricComposition, text: string, secs: number): LyricComposition {
  const t = text.trim();
  if (!t) return { ...c, message: null };
  const s = Math.min(CTA_MAX_SECONDS, Math.max(1, secs), c.duration);
  return { ...c, message: { text: t.slice(0, 200), start: +(c.range.end - s).toFixed(3), end: c.range.end } };
}

/** Título fijo: el gancho de la franja superior durante todo el vídeo (si no, sus segundos propios). */
export function withFixedTitle(c: LyricComposition, whole: boolean): LyricComposition {
  if (!c.hook) return c;
  return { ...c, hook: { ...c.hook, start: whole ? 0 : c.hook.start, dur: whole ? Math.min(600, c.duration) : Math.min(c.hook.dur, 10) } };
}

export function withFades(c: LyricComposition, fadeIn: number, fadeOut: number): LyricComposition {
  const k = (v: number) => Math.min(5, Math.max(0, Number.isFinite(v) ? v : 0));
  return { ...c, settings: { ...c.settings, fadeIn: k(fadeIn), fadeOut: k(fadeOut) } };
}
