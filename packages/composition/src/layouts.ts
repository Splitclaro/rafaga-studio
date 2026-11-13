// Composición v2: diseños, formatos (9:16, 16:9, 1:1) y plantillas virales como funciones puras. UNA sola fuente de cajas:
// la vista previa y la exportación (vía `toLegacyComposition` → `ffmpegArgs`) las leen de aquí. Coordenadas normalizadas [0,1]; píxeles pares.
import { buildComposition, RATIO_SIZE, type Composition } from "./composition.ts";
import { retimeWords, type Cut } from "./cuts.ts";
import { xAt, type ReframeKf } from "./reframe.ts";
import { groupWords, layoutLines, activeWordAt, PRESET_IMPACTO, type SubtitleStyle, type Word } from "./subtitles.ts";
import { safeArea, SAFE_ZONES, type Platform, type Rect } from "./safezones.ts";

export type LayoutId = "single_track" | "split_two" | "active_speaker" | "screen_presenter" | "fit_full" | "manual";
export const LAYOUT_IDS: LayoutId[] = ["single_track", "split_two", "active_speaker", "screen_presenter", "fit_full", "manual"];
export type AspectId = "9:16" | "16:9" | "1:1";
export const ASPECT_IDS: AspectId[] = ["9:16", "16:9", "1:1"];
export type Box = Rect;

export interface HeadlineSpec { lines: string[]; accent?: string; pill?: string; style?: "plain" | "box"; box: Box }
export interface SubtitleSpec { enabled: boolean; box: Box }
export interface CompositionV2 {
  v: 2; aspect: AspectId; layout: LayoutId; template?: string;
  fragments: { start: number; end: number }[]; cuts?: Cut[]; kf?: ReframeKf[];
  audio: { volume: number; muted?: boolean }; subtitles: SubtitleSpec; headline?: HeadlineSpec;
  extras?: { kind: string; ref: string; start: number; dur: number }[]; duration: number; needs_review?: boolean;
  cam?: { x: number; y: number; w: number; h: number }; splitTop?: number; band?: Box;
  /** Texto y tiempos de subtítulos corregidos por el usuario (relativos al clip, línea de la fuente). Si falta, se usa la transcripción vigente. */
  words?: Word[]; transcript_revision?: number;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
export interface PxBox { x: number; y: number; w: number; h: number }
export interface LayoutPlan { frame: { w: number; h: number }; video: PxBox; secondary?: PxBox; background: "blur" | "none"; headline?: PxBox; subtitles?: PxBox }

const px = (b: Box, W: number, H: number): PxBox => {
  const x = Math.max(0, Math.min(W - 2, Math.round(b.x * W / 2) * 2)), y = Math.max(0, Math.min(H - 2, Math.round(b.y * H / 2) * 2));
  return { x, y, w: Math.min(W - x, even(b.w * W)), h: Math.min(H - y, even(b.h * H)) };
};

/** Cajas en píxeles (siempre dentro del fotograma y con dimensiones pares) de cada diseño para una fuente de srcW×srcH. */
export function planLayout(c: CompositionV2, srcW: number, srcH: number): LayoutPlan {
  const { width: W, height: H } = RATIO_SIZE[c.aspect];
  const frame = { w: W, h: H }, full: Box = { x: 0, y: 0, w: 1, h: 1 };
  let video: PxBox = px(full, W, H), secondary: PxBox | undefined, background: "blur" | "none" = "none";
  switch (c.layout) {
    case "single_track": case "active_speaker": case "manual": break;                        // rellena el fotograma recortando (con encuadre kf)
    case "split_two": {
      if (c.aspect === "16:9") { video = px({ x: 0, y: 0, w: 0.5, h: 1 }, W, H); secondary = px({ x: 0.5, y: 0, w: 0.5, h: 1 }, W, H); }
      else { video = px({ x: 0, y: 0, w: 1, h: 0.5 }, W, H); secondary = px({ x: 0, y: 0.5, w: 1, h: 0.5 }, W, H); }
      break;
    }
    case "screen_presenter": {
      const top = c.splitTop ?? (c.aspect === "16:9" ? 1 : 0.62);
      if (c.aspect === "16:9") { video = px({ x: 0, y: 0, w: 0.72, h: 1 }, W, H); secondary = px({ x: 0.72, y: 0.1, w: 0.28, h: 0.5 }, W, H); }
      else { video = px({ x: 0, y: 0, w: 1, h: top }, W, H); secondary = px({ x: 0, y: top, w: 1, h: 1 - top }, W, H); }
      break;
    }
    case "fit_full": {
      background = c.aspect === "16:9" && srcW / srcH >= 16 / 9 - 0.01 ? "none" : "blur";
      if (c.band) video = px(c.band, W, H);
      else { const s = Math.min(W / srcW, H / srcH), w = Math.min(W, even(srcW * s)), h = Math.min(H, even(srcH * s)); video = { x: Math.floor((W - w) / 4) * 2, y: Math.floor((H - h) / 4) * 2, w, h }; }
      break;
    }
  }
  return { frame, video, secondary, background, ...(c.headline ? { headline: px(c.headline.box, W, H) } : {}), ...(c.subtitles.enabled ? { subtitles: px(c.subtitles.box, W, H) } : {}) };
}

// ── Respaldo de encuadre ──
/** Si el seguimiento pierde al sujeto (cobertura < minCoverage): última caja buena ponderada al centro; si no hay, vídeo completo. Siempre marca revisión. */
export function applyTrackingFallback(c: CompositionV2, o: { coverage: number; minCoverage?: number; lastGoodX?: number | null }): CompositionV2 {
  if (o.coverage >= (o.minCoverage ?? 0.5)) return c;
  if (o.lastGoodX != null && Number.isFinite(o.lastGoodX)) return { ...c, kf: [{ t: 0, x: Math.round((0.5 * o.lastGoodX + 0.25) * 10000) / 10000 }], needs_review: true };   // 50 % última buena, 50 % centro
  return { ...c, layout: "fit_full", kf: undefined, needs_review: true };
}

/** Cambiar de diseño conserva fragmentos, cortes, subtítulos, titular, audio y extras. */
export function switchLayout(c: CompositionV2, layout: LayoutId): CompositionV2 {
  if (!LAYOUT_IDS.includes(layout)) throw new Error(`diseño desconocido: ${layout}`);
  return { ...c, layout, kf: layout === "fit_full" ? undefined : c.kf };
}

const MAP: Record<LayoutId, Composition["layout"]> = { single_track: "fill", split_two: "split", active_speaker: "speaker", screen_presenter: "split", fit_full: "blur", manual: "fill" };
/** Convierte la composición v2 a la `Composition` que ya entiende `ffmpegArgs` (misma exportación que hoy). */
export function toLegacyComposition(c: CompositionV2, words: Word[], src: { width: number; height: number }): Composition {
  const start = c.fragments[0]?.start ?? 0, end = c.fragments.at(-1)?.end ?? start + c.duration;
  const base = buildComposition({ words: c.words?.length ? c.words : words, startSec: start, endSec: end, ratio: c.aspect });
  const out: Composition = { ...base, layout: MAP[c.layout], burnSubtitles: c.subtitles.enabled, ...(c.cuts?.length ? { cuts: c.cuts } : {}) };
  if (c.kf?.length && (c.layout === "single_track" || c.layout === "manual" || c.layout === "active_speaker")) out.reframe = { kf: c.kf, mode: "follow" };
  if (c.layout === "screen_presenter" || c.layout === "split_two") { out.cam = c.cam ?? { x: 0.62, y: 0.55, w: 0.34, h: 0.4 }; out.splitTop = c.splitTop ?? (c.layout === "split_two" ? 0.5 : 0.62); }
  void src; return out;
}

// ── Plantillas virales ──
export const VIRAL_TEMPLATE_IDS = ["titular_video_subtitulos", "pantalla_dividida", "hablante_seguimiento", "cambio_hablante", "presentacion_ponente", "presentacion_sola", "titular_en_caja", "titular_sobre_desenfoque", "video_completo"] as const;
export type ViralTemplateId = (typeof VIRAL_TEMPLATE_IDS)[number];
export interface TemplateOpts { duration: number; fragments?: { start: number; end: number }[]; headline?: { lines: string[]; accent?: string; pill?: string }; platforms?: Platform[]; subtitles?: boolean; srcAspect?: number }
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Apila [titular][banda][subtítulos] centrado en el área disponible; si no cabe, reduce la banda. Devuelve rectángulos normalizados. */
function stack(avail: Rect, bandAspect: number, frameAspect: number, hHead: number, hSub: number, wFrac = 1): { head: Box; band: Box; sub: Box } {
  let bandW = Math.min(avail.w, wFrac), bandH = (bandW * frameAspect) / bandAspect;      // alto normalizado de la banda para un ancho dado
  const need = hHead + hSub + bandH;
  if (need > avail.h) { const k = (avail.h - hHead - hSub) / bandH; bandW *= Math.max(0.5, k); bandH *= Math.max(0.5, k); }
  const total = hHead + bandH + hSub, y0 = avail.y + Math.max(0, (avail.h - total) / 2), x0 = avail.x + (avail.w - bandW) / 2;
  return { head: { x: avail.x, y: y0, w: avail.w, h: hHead }, band: { x: x0, y: y0 + hHead, w: bandW, h: bandH }, sub: { x: avail.x, y: y0 + hHead + bandH, w: avail.w, h: hSub } };
}

const TPL: Record<ViralTemplateId, (a: AspectId, o: TemplateOpts, area: Rect) => Partial<CompositionV2>> = {
  titular_video_subtitulos: (a, o, area) => {
    const { width: W, height: H } = RATIO_SIZE[a], bandAspect = a === "9:16" ? 16 / 9 : a === "1:1" ? 4 / 5 : 16 / 9;
    const s = stack(a === "16:9" ? area : area, a === "9:16" ? bandAspect : a === "1:1" ? 1 : bandAspect, W / H, a === "16:9" ? 0.14 : 0.1, a === "16:9" ? 0.14 : 0.1);
    return { layout: "fit_full", band: s.band, headline: { lines: o.headline?.lines ?? [], accent: o.headline?.accent ?? "#FFD60A", pill: o.headline?.pill, style: "plain", box: s.head }, subtitles: { enabled: o.subtitles !== false, box: s.sub } };
  },
  pantalla_dividida: (_a, o, area) => ({ layout: "split_two", splitTop: 0.5, subtitles: { enabled: o.subtitles !== false, box: { x: area.x, y: area.y + area.h * 0.44, w: area.w, h: 0.12 } } }),
  hablante_seguimiento: (_a, o, area) => ({ layout: "single_track", subtitles: { enabled: o.subtitles !== false, box: { x: area.x, y: area.y + area.h * 0.62, w: area.w, h: 0.14 } } }),
  cambio_hablante: (_a, o, area) => ({ layout: "active_speaker", subtitles: { enabled: o.subtitles !== false, box: { x: area.x, y: area.y + area.h * 0.62, w: area.w, h: 0.14 } } }),
  presentacion_ponente: (a, o, area) => ({ layout: "screen_presenter", splitTop: a === "16:9" ? 1 : 0.62, subtitles: { enabled: o.subtitles !== false, box: { x: area.x, y: area.y + area.h * 0.58, w: area.w, h: 0.12 } } }),
  presentacion_sola: (a, o, area) => { const s = stack(area, 16 / 9, a === "9:16" ? 9 / 16 : a === "1:1" ? 1 : 16 / 9, 0.12, 0.12); return { layout: "fit_full", band: s.band, headline: { lines: o.headline?.lines ?? [], accent: o.headline?.accent, style: "box", box: s.head }, subtitles: { enabled: o.subtitles !== false, box: s.sub } }; },
  titular_en_caja: (a, o, area) => { const s = stack(area, 16 / 9, a === "9:16" ? 9 / 16 : a === "1:1" ? 1 : 16 / 9, 0.12, 0.12); return { layout: "fit_full", band: s.band, headline: { lines: o.headline?.lines ?? [], accent: o.headline?.accent ?? "#FFFFFF", style: "box", box: s.head }, subtitles: { enabled: o.subtitles !== false, box: s.sub } }; },
  titular_sobre_desenfoque: (a, o, area) => { const { width: W, height: H } = RATIO_SIZE[a]; const s = stack(area, 16 / 9, W / H, 0.14, 0.12); return { layout: "fit_full", band: s.band, headline: { lines: o.headline?.lines ?? [], accent: o.headline?.accent, style: "plain", box: s.head }, subtitles: { enabled: o.subtitles !== false, box: s.sub } }; },
  video_completo: (_a, o, area) => ({ layout: "fit_full", subtitles: { enabled: o.subtitles !== false, box: { x: area.x, y: area.y + area.h * 0.72, w: area.w, h: 0.12 } } }),
};

/** Plantilla viral → composición v2 para un formato. Con plataformas elegidas todo el texto queda dentro del área segura común. */
export function viralTemplate(id: ViralTemplateId, aspect: AspectId, o: TemplateOpts): CompositionV2 {
  const area = o.platforms?.length && aspect === "9:16" ? safeArea(o.platforms) : FULL;
  const part = TPL[id](aspect, o, area);
  const fragments = o.fragments ?? [{ start: 0, end: o.duration }];
  return { v: 2, aspect, template: id, layout: "fit_full", fragments, audio: { volume: 1 }, subtitles: { enabled: true, box: { x: 0, y: 0.7, w: 1, h: 0.12 } }, duration: o.duration, ...part } as CompositionV2;
}

/** Cajas de texto de una composición (para validar zonas seguras y dibujarlas en la vista previa). */
export const textBoxes = (c: CompositionV2): { id: string; rect: Rect }[] => [
  ...(c.headline?.lines.length ? [{ id: "headline", rect: c.headline.box }] : []), ...(c.subtitles.enabled ? [{ id: "subtitles", rect: c.subtitles.box }] : []),
];

const assRgb = (hex: string) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase() : "&H00FFFFFF"; };
const assTime = (t: number) => { const c = Math.round(t * 100), h = Math.floor(c / 360000), m = Math.floor((c % 360000) / 6000), s = Math.floor((c % 6000) / 100); return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c % 100).padStart(2, "0")}`; };
/** Añade el titular (1–2 líneas: primera blanca, segunda del color de acento) a un ASS ya generado, en la MISMA caja que usa la vista previa. */
export function injectHeadline(ass: string, c: CompositionV2, font = "Liberation Sans"): string {
  const h = c.headline; if (!h?.lines.length) return ass;
  const { width: W, height: H } = RATIO_SIZE[c.aspect], b = px(h.box, W, H);
  const longest = Math.max(1, ...h.lines.map((l) => l.length));
  const size = Math.max(20, Math.round(Math.min(b.h / Math.max(1, h.lines.length) * 0.78, W / 16, (b.w * 0.94) / (longest * 0.7))));   // que la línea más larga quepa en la caja (negrita en mayúsculas ≈ 0,7 em por carácter)
  const style = `Style: Headline,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,${h.style === "box" ? "&H00000000" : "&H64000000"},-1,0,0,0,100,100,0,0,${h.style === "box" ? 3 : 1},${h.style === "box" ? 14 : Math.max(3, Math.round(size / 14))},0,5,${b.x},${W - b.x - b.w},0,1`;
  const text = h.lines.map((l, i) => (i === 1 && h.accent ? `{\\c${assRgb(h.accent)}}` : "") + l.replace(/[{}\\]/g, "")).join("\\N");
  const ev = `Dialogue: 5,${assTime(0)},${assTime(Math.max(0.1, c.duration))},Headline,,0,0,0,,{\\an5\\pos(${Math.round(b.x + b.w / 2)},${Math.round(b.y + b.h / 2)})}${text}`;
  return ass.replace(/(\r?\nStyle: Default[^\n]*)/, `$1\n${style}`).replace(/\s*$/, `\n${ev}\n`);
}

// ── Escena en un instante: lo que dibuja la vista previa, calculado con las MISMAS funciones que la exportación ──
export interface SceneSubtitle { text: string; lines: string[]; active: number; start: number; end: number }
export interface Scene {
  t: number; plan: LayoutPlan; cropX: number | null; subtitle: SceneSubtitle | null;
  headline: { lines: string[]; accent?: string; pill?: string; style: "plain" | "box"; box: PxBox } | null;
  overlays: { platform: Platform; id: string; rect: PxBox }[];
}
export interface SceneOpts { words?: Word[]; style?: SubtitleStyle; safeZones?: Platform[] }

/** Grupos de subtítulos tal y como los exporta `buildAss`: palabras relativas al clip, retimadas con los cortes y agrupadas por el estilo. */
export function subtitleGroups(c: CompositionV2, words: Word[], style: SubtitleStyle = PRESET_IMPACTO) {
  return groupWords(retimeWords(words, c.cuts), style);
}
/** Tiempo de la línea de la fuente (relativo al clip) que corresponde a un instante del vídeo ya sin cortes. */
export function unmapTime(tOut: number, cuts: Cut[] | undefined): number {
  let t = tOut; for (const k of [...(cuts ?? [])].sort((a, b) => a.s - b.s)) if (t >= k.s) t += k.e - k.s; return t;
}

export function sceneAt(c: CompositionV2, t: number, srcW: number, srcH: number, o: SceneOpts = {}): Scene {
  const plan = planLayout(c, srcW, srcH), { w: W, h: H } = plan.frame;
  const style = o.style ?? PRESET_IMPACTO;
  let subtitle: SceneSubtitle | null = null;
  if (c.subtitles.enabled && o.words?.length) {
    const g = subtitleGroups(c, o.words, style).find((x) => t >= x.start && t < x.end);
    if (g) { const lines = layoutLines(g.words, style.maxCharsPerLine).map((l) => l.map((w) => w.text).join(" ")); subtitle = { text: g.words.map((w) => w.text).join(" "), lines, active: activeWordAt(g, t), start: g.start, end: g.end }; }
  }
  const overlays: Scene["overlays"] = [];
  if (o.safeZones?.length && c.aspect === "9:16") for (const p of o.safeZones) for (const u of SAFE_ZONES[p].unsafe) overlays.push({ platform: p, id: u.id, rect: px(u.rect, W, H) });
  return {
    t, plan, subtitle, overlays,
    cropX: ["single_track", "manual", "active_speaker"].includes(c.layout) ? xAt(c.kf, unmapTime(t, c.cuts), 0.5) : null,
    headline: c.headline?.lines.length ? { lines: c.headline.lines, accent: c.headline.accent, pill: c.headline.pill, style: c.headline.style ?? "plain", box: plan.headline! } : null,
  };
}
