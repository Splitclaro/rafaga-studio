import { PRESET_IMPACTO, type SubtitleStyle, type Word } from "./subtitles.ts";

export type Ratio = "9:16" | "1:1" | "16:9";
export const RATIO_SIZE: Record<Ratio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 },
};

export interface Composition {
  v: 1;
  sourceSha256: string | null;
  startSec: number; endSec: number; // en la fuente
  fps: 30;
  ratio: Ratio;
  layout: "speaker" | "blur";
  crop: { x: number }; // 0..1, centro horizontal del recorte (keyframes llegarán después)
  words: Word[]; // tiempos RELATIVOS al clip
  style: SubtitleStyle;
  burnSubtitles: boolean;
}

const ms = (x: number) => Math.round(x * 1000) / 1000;

/** Relativiza las palabras al clip: nunca usar tiempo global tras recortar. */
export function buildComposition(src: { words: Word[]; startSec: number; endSec: number; sha256?: string | null; ratio?: Ratio; style?: SubtitleStyle }): Composition {
  const { startSec, endSec } = src;
  if (!(endSec > startSec)) throw new Error("Intervalo inválido");
  const words = src.words
    .filter((w) => w.end > startSec && w.start < endSec)
    .map((w) => ({ text: w.text, start: ms(Math.max(0, w.start - startSec)), end: ms(Math.min(endSec - startSec, w.end - startSec)) }));
  return { v: 1, sourceSha256: src.sha256 ?? null, startSec, endSec, fps: 30, ratio: src.ratio ?? "9:16", layout: "blur", crop: { x: 0.5 }, words, style: src.style ?? PRESET_IMPACTO, burnSubtitles: true };
}

/** Argumentos de FFmpeg (sin shell). Fondo desenfocado + vídeo completo centrado, o recorte vertical. */
export function ffmpegArgs(c: Composition, io: { input: string; assPath: string; output: string; fontsDir?: string }): string[] {
  const { width: W, height: H } = RATIO_SIZE[c.ratio];
  const dur = c.endSec - c.startSec;
  const sub = c.burnSubtitles ? `,subtitles=${escapeFilterPath(io.assPath)}${io.fontsDir ? `:fontsdir=${escapeFilterPath(io.fontsDir)}` : ""}` : "";
  const fc =
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5[b];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[f];` +
    `[b][f]overlay=(W-w)/2:(H-h)/2,fps=${c.fps},format=yuv420p${sub}[v]`;
  return ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(c.startSec), "-t", String(dur), "-i", io.input,
    "-filter_complex", fc, "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0", "-r", String(c.fps),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", io.output];
}

/** Las rutas las genera el worker (no el usuario); aun así se escapan los caracteres especiales del filtro. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
