import { PRESET_IMPACTO, type SubtitleStyle, type Word } from "./subtitles.ts";

export type Ratio = "9:16" | "4:5" | "1:1" | "16:9" | "4:3";
export const RATIO_SIZE: Record<Ratio, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 }, "4:3": { width: 1440, height: 1080 },
};

import { cropXExpr } from "./reframe.ts";
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
  /** Reencuadre automático: keyframes de crop.x en tiempo relativo al clip (solo layout fill). Si existe, manda sobre crop.x. */
  reframe?: { kf: { t: number; x: number }[]; mode?: string; coverage?: number };
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
/** Logo de marca superpuesto en el clip (posición en esquinas, escala relativa al ancho, opacidad). */
export interface BrandLogo { position: "tl" | "tr" | "bl" | "br"; scale: number; opacity: number; margin: number }
export interface BrandBumper { kind: "video" | "photo"; dur: number; hasAudio: boolean }
export const LOGO_DEFAULT: BrandLogo = { position: "tr", scale: 0.16, opacity: 0.9, margin: 0.04 };
const clampN = (v: unknown, a: number, b: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
export function sanitizeLogo(l: Partial<BrandLogo> | null | undefined): BrandLogo {
  const p = l?.position;
  return { position: p === "tl" || p === "bl" || p === "br" ? p : "tr", scale: clampN(l?.scale, 0.05, 0.4, LOGO_DEFAULT.scale), opacity: clampN(l?.opacity, 0.1, 1, LOGO_DEFAULT.opacity), margin: clampN(l?.margin, 0, 0.15, LOGO_DEFAULT.margin) };
}

export function ffmpegArgs(c: Composition, io: { input: string; assPath: string; output: string; fontsDir?: string; broll?: { local: string; kind: "video" | "photo"; start: number; dur: number }[];
  /** Marca (instantánea de una versión del brand kit): logo sobre el clip e intro/outro concatenados. */
  logo?: { local: string } & BrandLogo; intro?: { local: string } & BrandBumper; outro?: { local: string } & BrandBumper; mainHasAudio?: boolean }): string[] {
  const { width: W, height: H } = RATIO_SIZE[c.ratio];
  const dur = c.endSec - c.startSec;
  const cx = Math.min(1, Math.max(0, c.crop?.x ?? 0.5));
  const cxExpr = c.reframe?.kf?.length ? cropXExpr(c.reframe.kf) : cx.toFixed(3);
  const layout = c.layout === "fill" || c.layout === "fit" ? c.layout : "blur";
  const base =
    layout === "fill" ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:'(in_w-${W})*(${cxExpr})':'(in_h-${H})/2',setsar=1[base]`
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
  const nIn = () => extra.filter((x) => x === "-i").length;
  if (io.logo) {
    extra.push("-loop", "1", "-t", String(dur), "-i", io.logo.local);
    const k = nIn(), L = sanitizeLogo(io.logo);
    const lw = Math.max(16, Math.round((W * L.scale) / 2) * 2), m = Math.round(Math.min(W, H) * L.margin);
    const x = L.position.endsWith("l") ? `${m}` : `W-w-${m}`, y = L.position.startsWith("t") ? `${m}` : `H-h-${m}`;
    parts.push(`[${k}:v]scale=${lw}:-2,format=rgba,colorchannelmixer=aa=${L.opacity.toFixed(2)}[lg]`);
    parts.push(`[${last}][lg]overlay=${x}:${y}:shortest=1[lo]`);
    last = "lo";
  }
  const bumpers = [io.intro ? { b: io.intro, tag: "in" } : null, io.outro ? { b: io.outro, tag: "out" } : null].filter(Boolean) as { b: { local: string } & BrandBumper; tag: string }[];
  if (!bumpers.length) {
    parts.push(`[${last}]fps=${c.fps},format=yuv420p${sub}[v]`);
    return ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(c.startSec), "-t", String(dur), "-i", io.input, ...extra,
      "-filter_complex", parts.join(";"), "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0", "-r", String(c.fps),
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", io.output];
  }
  // Intro/outro: mismo tamaño, fps y formato de audio que el clip; sin audio propio → silencio de su duración
  parts.push(`[${last}]fps=${c.fps},format=yuv420p${sub}[mv]`);
  const AF = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  parts.push(io.mainHasAudio === false ? `anullsrc=r=48000:cl=stereo,atrim=duration=${dur.toFixed(3)}[ma]` : `[0:a:0]${AF},atrim=duration=${dur.toFixed(3)},apad=whole_dur=${dur.toFixed(3)}[ma]`);
  const seg: Record<string, [string, string]> = {};
  for (const { b, tag } of bumpers) {
    const d = clampN(b.dur, 0.5, 15, 3);
    if (b.kind === "photo") extra.push("-loop", "1", "-t", d.toFixed(3), "-i", b.local); else extra.push("-t", d.toFixed(3), "-i", b.local);
    const k = nIn();
    parts.push(`[${k}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${c.fps},format=yuv420p,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[${tag}v]`);
    parts.push(b.kind === "video" && b.hasAudio ? `[${k}:a:0]${AF},atrim=duration=${d.toFixed(3)},apad=whole_dur=${d.toFixed(3)}[${tag}a]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${d.toFixed(3)}[${tag}a]`);
    seg[tag] = [`[${tag}v]`, `[${tag}a]`];
  }
  const order = [seg.in, ["[mv]", "[ma]"], seg.out].filter(Boolean) as [string, string][];
  parts.push(`${order.map(([v, a]) => v + a).join("")}concat=n=${order.length}:v=1:a=1[v][a]`);
  return ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(c.startSec), "-t", String(dur), "-i", io.input, ...extra,
    "-filter_complex", parts.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-threads", "0", "-r", String(c.fps),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", io.output];
}

/** Las rutas las genera el worker (no el usuario); aun así se escapan los caracteres especiales del filtro. */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
