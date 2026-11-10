import { PRESET_IMPACTO, type SubtitleStyle, type Word } from "./subtitles.ts";

export type Ratio = "9:16" | "4:5" | "1:1" | "16:9" | "4:3";
export const RATIO_SIZE: Record<Ratio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 }, "4:3": { width: 1440, height: 1080 },
};

export interface BrollItem { path: string; kind: "video" | "photo"; start: number; dur: number; name?: string }

export interface Composition {
  v: 1;
  sourceSha256: string | null;
  startSec: number; endSec: number; // en la fuente
  fps: 30;
  ratio: Ratio;
  /** blur: vídeo completo sobre fondo desenfocado · fill: rellena el cuadro recortando (posición manual crop.x) · fit: vídeo completo con barras negras */
  layout: "speaker" | "blur" | "fill" | "fit";
  crop: { x: number }; // 0..1, posición horizontal del recorte en layout fill
  broll?: BrollItem[]; // imágenes/vídeos propios superpuestos por tramos (tiempos relativos al clip)
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

/** Argumentos de FFmpeg (sin shell). `broll` son rutas LOCALES ya descargadas por el worker. */
export function ffmpegArgs(c: Composition, io: { input: string; assPath: string; output: string; fontsDir?: string; broll?: { local: string; kind: "video" | "photo"; start: number; dur: number }[] }): string[] {
  const { width: W, height: H } = RATIO_SIZE[c.ratio];
  const dur = c.endSec - c.startSec;
  const cx = Math.min(1, Math.max(0, c.crop?.x ?? 0.5));
  const layout = c.layout === "fill" || c.layout === "fit" ? c.layout : "blur";
  const base =
    layout === "fill" ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:'(in_w-${W})*${cx.toFixed(3)}':'(in_h-${H})/2',setsar=1[base]`
    : layout === "fit" ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base]`
    : `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5[b];[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[f];[b][f]overlay=(W-w)/2:(H-h)/2,setsar=1[base]`;
  const parts = [base];
  const extra: string[] = [];
  let last = "base";
  (io.broll ?? []).forEach((b, i) => {
    const s = Math.max(0, b.start), e = Math.min(dur, b.start + b.dur);
    if (e <= s) return;
    extra.push(...(b.kind === "photo" ? ["-loop", "1", "-t", String(dur), "-i", b.local] : ["-stream_loop", "-1", "-t", String(dur), "-i", b.local]));
    const k = extra.filter((x) => x === "-i").length; // índice de entrada: 0 es el vídeo principal
    parts.push(`[${k}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${c.fps},setpts=PTS+${s.toFixed(3)}/TB[b${i}]`);
    parts.push(`[${last}][b${i}]overlay=0:0:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})':eof_action=pass[o${i}]`);
    last = `o${i}`;
  });
  const sub = c.burnSubtitles ? `,subtitles=${escapeFilterPath(io.assPath)}${io.fontsDir ? `:fontsdir=${escapeFilterPath(io.fontsDir)}` : ""}` : "";
  parts.push(`[${last}]fps=${c.fps},format=yuv420p${sub}[v]`);
  return ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(c.startSec), "-t", String(dur), "-i", io.input, ...extra,
    "-filter_complex", parts.join(";"), "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0", "-r", String(c.fps),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", io.output];
}

/** Las rutas las genera el worker (no el usuario); aun así se escapan los caracteres especiales del filtro. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
