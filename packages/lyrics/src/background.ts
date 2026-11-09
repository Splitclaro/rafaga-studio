// Composición de fondo para Lyric Studio: secuencia de clips/fotos (o color sólido) + ajustes. Pura y testeable.
import { rng } from "./index.ts";

export type FilterName = "none" | "midnight" | "super8" | "noir" | "vaporwave";
export interface BgSettings {
  dim: number;          // 0–0.8  oscurecer el fondo
  bars: number;         // 0–0.4  barras cinemáticas (fracción total de altura cubierta)
  filter: FilterName;
  interval: number;     // s por clip en modo secuencia
  sequence: boolean;    // varios clips que cambian cada `interval` s
}
export const DEFAULT_BG: BgSettings = { dim: 0.3, bars: 0, filter: "none", interval: 5, sequence: true };

const FILTERS: Record<FilterName, string> = {
  none: "",
  midnight: "colorbalance=bs=0.22:ms=0.08,eq=brightness=-0.04:saturation=0.85",
  super8: "eq=saturation=1.15:contrast=1.06,colorbalance=rs=0.08:gs=0.04:bs=-0.06,noise=alls=10:allf=t,vignette=PI/5",
  noir: "hue=s=0,eq=contrast=1.18:brightness=-0.02",
  vaporwave: "colorbalance=rs=0.22:gs=-0.08:bs=0.28,eq=saturation=1.35",
};

export interface BgItem { path: string; kind: "video" | "photo" }

/** Orden de clips reproducible para una variante: sin repetir hasta agotar los disponibles. */
export function sequenceFor(items: BgItem[], len: number, s: BgSettings, seed: number): { item: BgItem; dur: number }[] {
  if (!items.length) return [];
  const per = s.sequence ? Math.max(2, s.interval) : len;
  let k = Math.ceil(len / per);
  const perEff = k > 60 ? len / 60 : per; // límite de entradas para FFmpeg
  k = Math.ceil(len / perEff);
  const r = rng(seed);
  const order: BgItem[] = [];
  while (order.length < k) {
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    order.push(...pool);
  }
  return order.slice(0, k).map((item, i) => ({ item, dur: +(i === k - 1 ? len - perEff * (k - 1) : perEff).toFixed(3) }));
}

/**
 * Argumentos de FFmpeg (sin shell). `segments` vacío = color sólido.
 * Entradas: [segmentos…, audio]. Salida H.264/AAC con la letra (ASS) quemada.
 */
export function lyricFfmpegArgs(o: {
  W: number; H: number; len: number; color: string; segments: { item: BgItem; dur: number }[]; settings: BgSettings;
  audio: string; ass: string; fontsDir?: string; out: string; escape: (p: string) => string;
}): string[] {
  const a: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  const v: string[] = [];
  if (!o.segments.length) {
    a.push("-f", "lavfi", "-i", `color=c=0x${o.color.replace("#", "")}:s=${o.W}x${o.H}:r=30:d=${o.len}`);
    v.push("[0:v]format=yuv420p[bg]");
  } else {
    o.segments.forEach((s) => {
      if (s.item.kind === "photo") a.push("-loop", "1", "-t", String(s.dur), "-i", s.item.path);
      else a.push("-stream_loop", "-1", "-t", String(s.dur), "-i", s.item.path);
    });
    o.segments.forEach((_, i) => v.push(`[${i}:v]scale=${o.W}:${o.H}:force_original_aspect_ratio=increase,crop=${o.W}:${o.H},setsar=1,fps=30,format=yuv420p[s${i}]`));
    v.push(`${o.segments.map((_, i) => `[s${i}]`).join("")}concat=n=${o.segments.length}:v=1:a=0[bg]`);
  }
  const audioIdx = o.segments.length || 1;
  a.push("-i", o.audio);
  const post: string[] = [];
  if (FILTERS[o.settings.filter]) post.push(FILTERS[o.settings.filter]);
  if (o.settings.dim > 0) post.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@${Math.min(0.8, o.settings.dim).toFixed(2)}:t=fill`);
  const barH = Math.round((Math.min(0.4, o.settings.bars) * o.H) / 2);
  if (barH > 0) post.push(`drawbox=x=0:y=0:w=iw:h=${barH}:color=black:t=fill`, `drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:color=black:t=fill`);
  post.push(`subtitles=${o.escape(o.ass)}${o.fontsDir ? `:fontsdir=${o.escape(o.fontsDir)}` : ""}`, "format=yuv420p");
  v.push(`[bg]${post.join(",")}[v]`);
  a.push("-filter_complex", v.join(";"), "-map", "[v]", "-map", `${audioIdx}:a:0`, "-c:v", "libx264", "-preset", "superfast", "-crf", "22",
    "-c:a", "aac", "-b:a", "192k", "-t", String(o.len), "-movflags", "+faststart", o.out);
  return a;
}

/** Ráfaga Collections: colecciones curadas de la plataforma. Aún sin medios (se añadirán con la app lista). */
export const RAFAGA_COLLECTIONS = [
  { id: "urbano", name: "Urbano", hint: "Calles, luces y ciudad" },
  { id: "vhs", name: "Cinta VHS", hint: "Grano y color de vídeo casero" },
  { id: "noche", name: "Noche", hint: "Neón y oscuridad" },
  { id: "naturaleza", name: "Naturaleza", hint: "Bosques, mar y montaña" },
  { id: "lluvia", name: "Lluvia", hint: "Cristales y calles mojadas" },
  { id: "abstracto", name: "Abstracto", hint: "Formas y líquidos" },
  { id: "atardecer", name: "Atardecer", hint: "Luz dorada" },
  { id: "escenas-musicales", name: "Escenas musicales", hint: "Estudio, directo, vinilos" },
  { id: "gaming", name: "Gaming", hint: "Partidas con licencia" },
] as const;
