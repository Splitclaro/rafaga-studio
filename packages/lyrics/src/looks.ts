// Looks de videolyric: composición completa (lienzo, rectángulo de imagen, texto, flujo de letra, tratamiento y montaje).
// Una sola función de layout alimenta la vista previa (canvas del navegador) y el export (ASS + FFmpeg),
// con tiempos cuantizados al frame de salida: misma palabra, misma posición y mismo frame en ambos.
// Parámetros medidos en las referencias: docs/LYRIC_LOOKS.md.
import type { TimedWord } from "./index.ts";
import { rng } from "./index.ts";
import { SANS_BOLD, SANS_REGULAR } from "./metrics.ts";
import type { FontMetrics } from "./ttf.ts";

export const LOOK_ENGINE_VERSION = 1;
export const FPS = 30;

/** Fuente de render: Liberation Sans (SIL OFL) en el worker; en el navegador, la misma o Arial (métricas idénticas). */
export const LOOK_FONT = { render: "Liberation Sans", css: '"Liberation Sans", Arial, "Helvetica Neue", Helvetica, sans-serif', ascent: 1854, descent: 434 } as const;

export interface LookImage {
  /** Relación de aspecto del rectángulo de imagen (ancho/alto). Se conserva en cualquier lienzo: nunca se deforma. */
  aspect: number;
  /** Centro vertical del rectángulo, en fracción del alto del lienzo (solo cuando la imagen no llena el alto). */
  cy: number;
  /** Ancho del rectángulo en fracción del lienzo cuando el lienzo es más estrecho que la imagen. */
  width: number;
  fit: "cover" | "contain";
  zoom: number;          // 1 = sin zoom; >1 recorta más
  offsetX: number;       // -1..1 desplazamiento del recorte dentro del rectángulo
  offsetY: number;
}
export interface LookText {
  x: number;             // borde izquierdo del bloque, fracción del ancho de la imagen
  y: number;             // borde superior del bloque, fracción del alto de la imagen (si centerY, es el centro)
  centerY: boolean;      // el bloque se centra verticalmente en y (reservando las líneas de la página)
  w: number;             // ancho máximo del bloque, fracción del ancho de la imagen
  size: number;          // tamaño de letra (em) como fracción del alto de la imagen
  weight: 400 | 700;
  tracking: number;      // em extra entre caracteres
  wordGap: number;       // em entre palabras (separación expresiva, sin espacios repetidos)
  lineHeight: number;    // em entre líneas base
  maxLines: number;
  align: "left" | "center";
  case: "lower" | "asis" | "upper";
  color: string;         // #RRGGBB
  shadow: number;        // 0..1 sombra suave
}
export interface LookFlow {
  /** word: cada palabra aparece al cantarse y se queda · group: grupos de `groupSize` · phrase: la página entera a la vez */
  reveal: "word" | "group" | "phrase";
  groupSize: number;
  hold: number;          // s que la página sigue visible tras la última palabra (si no empieza otra antes)
  minVisible: number;    // s mínimos de una palabra en pantalla
  fadeIn: number;        // s
  fadeOut: number;       // s
}
export interface LookTreatment { grain: number; soften: number; desaturate: number; tint: [number, number, number]; aberration: number; instability: number; vignette: number; brightness: number }
export interface LookMontage { cut: "phrase" | "interval" | "beat"; interval: number; minShot: number; maxShot: number; intensity?: "soft" | "medium" | "dynamic"; beatEvery?: 0 | 1 | 2 | 4 | 8 }
export interface LyricLook {
  id: string; version: number; name: string; description: string;
  canvas: { ratio: string; bg: string };
  image: LookImage; text: LookText; flow: LookFlow; treatment: LookTreatment; montage: LookMontage;
}

const T0: LookTreatment = { grain: 0, soften: 0, desaturate: 0, tint: [0, 0, 0], aberration: 0, instability: 0, vignette: 0, brightness: 0 };

/** A. Archivo analógico — referencia 966×720 (≈4:3) a pantalla completa, grabación VHS de carretera/ciudad. */
export const LOOK_ARCHIVO: LyricLook = {
  id: "archivo", version: 1, name: "Archivo analógico",
  description: "Metraje 4:3 a pantalla completa con textura VHS suave y palabras blancas que se acumulan en una línea.",
  canvas: { ratio: "4:3", bg: "#000000" },
  image: { aspect: 4 / 3, cy: 0.5, width: 1, fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 },
  text: { x: 0.17, y: 0.43, centerY: true, w: 0.72, size: 0.105, weight: 400, tracking: -0.01, wordGap: 1.5, lineHeight: 1.2, maxLines: 1, align: "left", case: "lower", color: "#FFFFFF", shadow: 0.15 },
  flow: { reveal: "word", groupSize: 1, hold: 0.5, minVisible: 0.25, fadeIn: 0, fadeOut: 0 },
  treatment: { ...T0, grain: 0.35, soften: 0.35, desaturate: 0.25, tint: [0.04, 0.02, -0.03], aberration: 0.25, instability: 0.2, vignette: 0.2 },
  montage: { cut: "phrase", interval: 3, minShot: 1.6, maxShot: 5 },
};
/** B. Diario urbano — lienzo negro, imagen 5:4 contenida y algo por encima del centro, dos líneas a la izquierda. */
export const LOOK_DIARIO: LyricLook = {
  id: "diario", version: 1, name: "Diario urbano",
  description: "Imagen contenida sobre negro, sin estirar ni rellenar con desenfoque. Dos líneas sobrias que se completan al cantar.",
  canvas: { ratio: "9:16", bg: "#000000" },
  image: { aspect: 1.25, cy: 0.4375, width: 1, fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 },
  text: { x: 0.17, y: 0.5, centerY: true, w: 0.74, size: 0.1, weight: 400, tracking: -0.005, wordGap: 1.0, lineHeight: 2.0, maxLines: 2, align: "left", case: "lower", color: "#FFFFFF", shadow: 0.1 },
  flow: { reveal: "word", groupSize: 1, hold: 0.6, minVisible: 0.25, fadeIn: 0, fadeOut: 0 },
  treatment: { ...T0, desaturate: 0.1 },
  montage: { cut: "phrase", interval: 4, minShot: 2, maxShot: 6 },
};
/** C. Cine panorámico — banda ≈2,3:1 en lienzo 9:16, más alta que el centro; letra mayor relativa a la banda. */
export const LOOK_PANORAMICO: LyricLook = {
  id: "panoramico", version: 1, name: "Cine panorámico",
  description: "Banda panorámica estable sobre negro, tratamiento cromático moderado y letra blanca anclada a la imagen.",
  canvas: { ratio: "9:16", bg: "#000000" },
  image: { aspect: 2.3, cy: 0.383, width: 1, fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 },
  text: { x: 0.12, y: 0.45, centerY: true, w: 0.8, size: 0.19, weight: 700, tracking: -0.01, wordGap: 1.2, lineHeight: 1.15, maxLines: 2, align: "left", case: "lower", color: "#FFFFFF", shadow: 0.2 },
  flow: { reveal: "word", groupSize: 1, hold: 0.6, minVisible: 0.25, fadeIn: 0, fadeOut: 0 },
  treatment: { ...T0, desaturate: 0.15, tint: [0.03, 0.01, -0.02], vignette: 0.15, brightness: -0.02 },
  montage: { cut: "phrase", interval: 4, minShot: 2, maxShot: 7 },
};
export const LOOKS: Record<string, LyricLook> = { archivo: LOOK_ARCHIVO, diario: LOOK_DIARIO, panoramico: LOOK_PANORAMICO };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
/** Mezcla segura de overrides del usuario con límites (nunca valores que rompan el render). */
export function resolveLook(id: string, o: DeepPartial<LyricLook> = {}): LyricLook {
  const b = LOOKS[id];
  if (!b) throw new Error(`look desconocido: ${id}`);
  const i = { ...b.image, ...(o.image ?? {}) }, t = { ...b.text, ...(o.text ?? {}) }, f = { ...b.flow, ...(o.flow ?? {}) };
  const tr = { ...b.treatment, ...(o.treatment ?? {}) } as LookTreatment, m = { ...b.montage, ...(o.montage ?? {}) };
  const hex = (c: unknown, d: string) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : d);
  return {
    ...b,
    canvas: { ratio: b.canvas.ratio, bg: hex(o.canvas?.bg, b.canvas.bg) },
    image: { aspect: clamp(i.aspect, 0.4, 3), cy: clamp(i.cy, 0.15, 0.85), width: clamp(i.width, 0.5, 1), fit: i.fit === "contain" ? "contain" : "cover", zoom: clamp(i.zoom, 1, 2), offsetX: clamp(i.offsetX, -1, 1), offsetY: clamp(i.offsetY, -1, 1) },
    text: { x: clamp(t.x, 0, 0.6), y: clamp(t.y, 0.05, 0.95), centerY: !!t.centerY, w: clamp(t.w, 0.3, 1), size: clamp(t.size, 0.04, 0.3), weight: t.weight === 700 ? 700 : 400, tracking: clamp(t.tracking, -0.05, 0.2), wordGap: clamp(t.wordGap, 0.3, 4), lineHeight: clamp(t.lineHeight, 1, 3), maxLines: Math.round(clamp(t.maxLines, 1, 3)), align: t.align === "center" ? "center" : "left", case: t.case === "upper" || t.case === "asis" ? t.case : "lower", color: hex(t.color, b.text.color), shadow: clamp(t.shadow, 0, 1) },
    flow: { reveal: f.reveal === "group" || f.reveal === "phrase" ? f.reveal : "word", groupSize: Math.round(clamp(f.groupSize, 1, 6)), hold: clamp(f.hold, 0, 3), minVisible: clamp(f.minVisible, 0.1, 2), fadeIn: clamp(f.fadeIn, 0, 0.5), fadeOut: clamp(f.fadeOut, 0, 0.5) },
    treatment: { grain: clamp(tr.grain, 0, 1), soften: clamp(tr.soften, 0, 1), desaturate: clamp(tr.desaturate, 0, 1), tint: [0, 1, 2].map((k) => clamp(tr.tint?.[k] ?? 0, -0.3, 0.3)) as [number, number, number], aberration: clamp(tr.aberration, 0, 1), instability: clamp(tr.instability, 0, 1), vignette: clamp(tr.vignette, 0, 1), brightness: clamp(tr.brightness, -0.2, 0.2) },
    montage: { cut: m.cut === "interval" || m.cut === "beat" ? m.cut : "phrase", interval: clamp(m.interval, 1.5, 15), minShot: clamp(m.minShot, 0.8, 10), maxShot: clamp(m.maxShot, 1.5, 20), intensity: m.intensity === "soft" || m.intensity === "dynamic" ? m.intensity : "medium", beatEvery: ([1, 2, 4, 8] as const).includes(m.beatEvery as 1) ? (m.beatEvery as 1 | 2 | 4 | 8) : 0 },
  };
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const CANVAS: Record<string, { w: number; h: number }> = { "9:16": { w: 1080, h: 1920 }, "4:5": { w: 1080, h: 1350 }, "1:1": { w: 1080, h: 1080 }, "16:9": { w: 1920, h: 1080 }, "4:3": { w: 1440, h: 1080 } };
/** Tamaño real del lienzo: 1080p o 720p (lado corto). */
export function canvasSize(ratio: string, res: 1080 | 720 = 1080): { W: number; H: number } {
  const c = CANVAS[ratio] ?? CANVAS["9:16"];
  const k = res / 1080;
  return { W: even(c.w * k), H: even(c.h * k) };
}
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const evenPos = (n: number) => Math.max(0, Math.round(n / 2) * 2);

export interface Rect { x: number; y: number; w: number; h: number }
/** Rectángulo de imagen en px: conserva el aspecto; banda centrada en `cy` si el lienzo es más estrecho, columna centrada si es más ancho. */
export function imageRect(look: LyricLook, W: number, H: number): Rect {
  const a = look.image.aspect;
  if (W / H <= a) {
    const w = even(W * look.image.width), h = Math.min(H, even(w / a));
    const y = Math.round(clamp(look.image.cy * H - h / 2, 0, H - h) / 2) * 2;
    return { x: evenPos((W - w) / 2), y, w, h };
  }
  const h = H, w = even(h * a);
  return { x: evenPos((W - w) / 2), y: 0, w, h };
}

const caseText = (s: string, c: LookText["case"]) => (c === "lower" ? s.toLocaleLowerCase("es") : c === "upper" ? s.toLocaleUpperCase("es") : s);
/** Ancho en px de un texto con la tabla de métricas (Arial = Liberation Sans). */
export function measure(text: string, emPx: number, weight: 400 | 700, tracking = 0): number {
  const m: FontMetrics = weight === 700 ? SANS_BOLD : SANS_REGULAR;
  let u = 0, n = 0;
  for (const ch of text) { u += m.advance[ch.codePointAt(0)!] ?? m.fallback; n++; }
  return (u / m.unitsPerEm) * emPx + Math.max(0, n - 1) * tracking * emPx;
}

export interface PlacedWord { text: string; x: number; y: number; em: number; start: number; end: number; fadeIn: number; fadeOut: number; page: number; source: number }
export interface Layout { W: number; H: number; fps: number; image: Rect; em: number; weight: 400 | 700; color: string; shadow: number; tracking: number; words: PlacedWord[]; pages: { start: number; end: number }[] }

/** Cuantiza al frame de salida: la palabra es visible en el frame k si k/fps ≥ start. */
export const toFrame = (s: number, fps = FPS) => Math.round(s * fps) / fps;

/**
 * Layout determinista de la letra: páginas que caben en el bloque (sin saltos accidentales),
 * posiciones fijas por palabra (la entrada de una palabra no mueve las anteriores) y tiempos reales de la alineación.
 */
export function layoutLyrics(words: TimedWord[], look: LyricLook, W: number, H: number, len: number, fps = FPS): Layout {
  const img = imageRect(look, W, H), t = look.text, f = look.flow;
  const em = Math.max(8, Math.round(t.size * img.h));
  const boxW = t.w * img.w, gap = t.wordGap * em, lh = t.lineHeight * em;
  const sorted = words.map((w, i) => ({ ...w, i })).filter((w) => w.text.trim() && Number.isFinite(w.start)).sort((a, b) => a.start - b.start);
  // 1) páginas: palabras de una misma línea de letra que caben en maxLines líneas del bloque
  type Item = { w: (typeof sorted)[number]; text: string; width: number; line: number; xo: number };
  const pages: Item[][] = [];
  let cur: Item[] = [], lineNo = 0, x = 0, prevLine = -1;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; lineNo = 0; x = 0; };
  for (const w of sorted) {
    if (w.line !== prevLine) { flush(); prevLine = w.line; }
    const text = caseText(w.text.trim(), t.case);
    const width = measure(text, em, t.weight, t.tracking);
    if (x > 0 && x + gap + width > boxW) { lineNo++; x = 0; if (lineNo >= t.maxLines) flush(); }
    const xo = x > 0 ? x + gap : 0;
    cur.push({ w, text, width, line: lineNo, xo });
    x = xo + width;
  }
  flush();
  // 2) tiempos de página y de palabra
  const out: PlacedWord[] = [], pageTimes: { start: number; end: number }[] = [];
  const asc = (LOOK_FONT.ascent / 2048) * em;
  pages.forEach((pg, pi) => {
    const nextStart = pi + 1 < pages.length ? pages[pi + 1][0].w.start : Infinity;
    const last = pg[pg.length - 1].w;
    const pStart = toFrame(Math.max(0, pg[0].w.start), fps);
    let pEnd = Math.min(nextStart, Math.max(last.end, last.start + f.minVisible) + f.hold, len);
    pEnd = toFrame(Math.max(pEnd, pStart + 1 / fps), fps);
    pageTimes.push({ start: pStart, end: pEnd });
    const lines = Math.max(...pg.map((p) => p.line)) + 1;
    // centrado vertical sobre las líneas que ocupará la página completa (espacio reservado: no salta al revelar)
    const blockH = (lines - 1) * lh + em;
    const top = img.y + (t.centerY ? t.y * img.h - blockH / 2 : t.y * img.h);
    const lineW = (l: number) => { const ws = pg.filter((p) => p.line === l); const lw = ws[ws.length - 1]; return lw.xo + lw.width; };
    pg.forEach((p, k) => {
      const groupLead = f.reveal === "phrase" ? pg[0] : f.reveal === "group" ? pg[Math.floor(k / f.groupSize) * f.groupSize] : p;
      const start = Math.min(toFrame(Math.max(0, groupLead.w.start), fps), pEnd - 1 / fps);
      const left = img.x + t.x * img.w + (t.align === "center" ? (boxW - lineW(p.line)) / 2 : 0);
      out.push({ text: p.text, x: Math.round(left + p.xo), y: Math.round(top + p.line * lh), em, start: Math.max(pStart, start), end: pEnd, fadeIn: f.fadeIn, fadeOut: f.fadeOut, page: pi, source: p.w.i });
    });
    void asc;
  });
  return { W, H, fps, image: img, em, weight: t.weight, color: t.color, shadow: t.shadow, tracking: t.tracking, words: out, pages: pageTimes };
}

/** Estado visible en el instante t (vista previa). Mismo criterio de frame que libass con los tiempos del ASS. */
export function frameState(L: Layout, t: number): { word: PlacedWord; alpha: number }[] {
  const tf = Math.floor(t * L.fps + 1e-6) / L.fps;
  const res: { word: PlacedWord; alpha: number }[] = [];
  for (const w of L.words) {
    if (tf + 1e-6 < w.start || tf + 1e-6 >= w.end) continue;
    let a = 1;
    if (w.fadeIn > 0) a = Math.min(a, (tf - w.start) / w.fadeIn);
    if (w.fadeOut > 0) a = Math.min(a, (w.end - tf) / w.fadeOut);
    res.push({ word: w, alpha: clamp(a, 0, 1) });
  }
  return res;
}

/** Tiempo ASS (centésimas) que libass muestra exactamente a partir del mismo frame: floor al centisegundo. */
export function assFrameTime(s: number): string {
  const cs = Math.floor(s * 100 + 1e-6);
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
const assColor = (hex: string, alpha = 0) => `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
const assEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, " ");

/** ASS con una línea por palabra, anclada arriba-izquierda (\an7) en su posición fija. */
export function layoutToAss(L: Layout, fontName: string = LOOK_FONT.render): string {
  // Tamaño ASS = (ascent+descent)/unitsPerEm × em  ->  el em renderizado coincide con el del layout
  const fs = +((L.em * (LOOK_FONT.ascent + LOOK_FONT.descent)) / 2048).toFixed(2);
  const shad = L.shadow > 0 ? Math.max(1, Math.round(L.em * 0.04 * L.shadow * 2)) : 0;
  const header = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${L.W}`, `PlayResY: ${L.H}`, "ScaledBorderAndShadow: yes", "WrapStyle: 2", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: W,${fontName},${fs},${assColor(L.color)},${assColor(L.color)},&H00000000,${assColor("#000000", 0x99)},${L.weight === 700 ? -1 : 0},0,0,0,100,100,${+(L.tracking * L.em).toFixed(2)},0,1,0,${shad},7,0,0,0,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = L.words.map((w) => {
    const fad = w.fadeIn || w.fadeOut ? `\\fad(${Math.round(w.fadeIn * 1000)},${Math.round(w.fadeOut * 1000)})` : "";
    return `Dialogue: 0,${assFrameTime(w.start)},${assFrameTime(w.end)},W,,0,0,0,,{\\an7\\pos(${w.x},${w.y})${fad}}${assEscape(w.text)}`;
  });
  return [...header, ...ev, ""].join("\n");
}

/** Cadena FFmpeg del tratamiento (sobre el rectángulo de imagen). Valores numéricos acotados: sin texto del usuario. */
export function treatmentFilters(tr: LookTreatment, seed: number): string[] {
  const f: string[] = [];
  if (tr.instability > 0) { const a = (2 + 4 * tr.instability).toFixed(1); f.push(`pad=iw+16:ih+16:8:8:color=black`, `crop=iw-16:ih-16:8+${a}*sin(t*7.3+${seed % 97}):8+${a}*0.6*sin(t*5.1)`); }
  if (tr.soften > 0) f.push(`gblur=sigma=${(tr.soften * 2.2).toFixed(2)}`);
  if (tr.desaturate > 0 || tr.brightness) f.push(`eq=saturation=${(1 - tr.desaturate * 0.75).toFixed(3)}:brightness=${tr.brightness.toFixed(3)}`);
  if (tr.tint.some((x) => x !== 0)) f.push(`colorbalance=rm=${tr.tint[0].toFixed(3)}:gm=${tr.tint[1].toFixed(3)}:bm=${tr.tint[2].toFixed(3)}`);
  if (tr.aberration > 0) { const s = Math.max(1, Math.round(tr.aberration * 4)); f.push(`rgbashift=rh=${s}:bh=-${s}`); }
  if (tr.grain > 0) f.push(`noise=alls=${Math.round(tr.grain * 26)}:allf=t:all_seed=${seed % 100000}`);
  if (tr.vignette > 0) f.push(`vignette=angle=${(0.25 + tr.vignette * 0.45).toFixed(3)}`);
  return f;
}

export interface ShotItem { path: string; kind: "video" | "photo"; duration?: number }
export interface Shot { item: ShotItem; start: number; dur: number; entry: number }
/**
 * Montaje: cortes en cambios de frase (si la frase dura entre minShot y maxShot) o a intervalo fijo.
 * Sin repetir clip consecutivo si hay alternativa. No se presenta como «al beat»: son cortes de frase o de reloj.
 */
export function planShots(items: ShotItem[], pages: { start: number }[], len: number, m: LookMontage, seed: number, fps = FPS): Shot[] {
  if (!items.length) return [];
  const cuts = [0];
  const candidates = m.cut === "phrase" ? pages.map((p) => p.start).filter((s) => s > 0 && s < len) : [];
  let last = 0;
  const pushUntil = (to: number) => { while (to - last > m.maxShot) { last += Math.min(m.maxShot, Math.max(m.minShot, m.interval)); cuts.push(last); } };
  if (m.cut === "phrase") {
    for (const c of candidates) { pushUntil(c); if (c - last >= m.minShot && len - c >= m.minShot * 0.6) { cuts.push(c); last = c; } }
    pushUntil(len);
  } else {
    for (let s = m.interval; s < len - 0.5; s += m.interval) cuts.push(s);
  }
  return assignShots(items, cuts, len, seed, fps);
}

/** Asigna un plano a cada tramo entre cortes: sin repetir el clip anterior si hay alternativas y con punto de entrada reproducible. */
export function assignShots(items: ShotItem[], cutTimes: number[], len: number, seed: number, fps = FPS): Shot[] {
  const r = rng(seed);
  const out: Shot[] = [];
  let prev = -1;
  const times = [...new Set(cutTimes.map((c) => toFrame(c, fps)))].sort((a, b) => a - b);
  times.forEach((s, i) => {
    const e = i + 1 < times.length ? times[i + 1] : len;
    let k = Math.floor(r() * items.length);
    if (items.length > 1 && k === prev) k = (k + 1 + Math.floor(r() * (items.length - 1))) % items.length;
    prev = k;
    const it = items[k], dur = +(e - s).toFixed(3);
    const room = it.kind === "video" && it.duration ? Math.max(0, it.duration - dur - 0.1) : 0;
    out.push({ item: it, start: s, dur, entry: +(room * r()).toFixed(2) });
  });
  return out.filter((x) => x.dur > 0);
}

export interface MontageInfo { mode: "beats" | "phrases" | "interval" | "interval-fallback"; bpm?: number; confidence?: number; every?: number; shots: number; avgShot: number; note?: string }
const TARGET = { soft: 3.2, medium: 2.0, dynamic: 1.1 } as const;
/**
 * Montaje al ritmo: cortes en beats detectados (cada 1, 2, 4 u 8 según intensidad o ajuste manual). Si el ritmo no es fiable,
 * cadencia estable y se informa. Nunca se anuncia «al beat» si solo hay un temporizador.
 */
export function planShotsOnBeats(items: ShotItem[], beat: { bpm: number; confidence: number; beats: number[] } | null, len: number, m: LookMontage, seed: number, reliable: boolean, fps = FPS): { shots: Shot[]; info: MontageInfo } {
  if (!items.length) return { shots: [], info: { mode: "beats", shots: 0, avgShot: 0 } };
  const target = TARGET[m.intensity ?? "medium"];
  let cuts: number[] = [0]; let info: MontageInfo;
  if (beat && reliable && beat.beats.length >= 8) {
    const period = 60 / beat.bpm;
    let every = m.beatEvery && m.beatEvery > 0 ? m.beatEvery : ([1, 2, 4, 8] as const).reduce((best, n) => (Math.abs(n * period - target) < Math.abs(best * period - target) ? n : best), 1 as 1 | 2 | 4 | 8);
    while (every * period < Math.max(0.8, m.minShot) && every < 16) every *= 2;     // nunca planos ilegibles
    const bs = beat.beats.filter((b) => b > 0.4 && b < len - 0.4);
    for (let i = 0; i < bs.length; i += every) cuts.push(bs[i]);
    cuts = cuts.filter((c, i) => i === 0 || c - cuts[i - 1] >= 0.6);
    info = { mode: "beats", bpm: beat.bpm, confidence: beat.confidence, every, shots: 0, avgShot: 0 };
  } else {
    for (let t = target; t < len - 0.5; t += target) cuts.push(t);
    info = { mode: "interval-fallback", bpm: beat?.bpm, confidence: beat?.confidence, shots: 0, avgShot: 0, note: `Ritmo no fiable${beat ? ` (confianza ${(beat.confidence * 100).toFixed(0)} %)` : ""}: se usa una cadencia estable de ${target.toFixed(1)} s en lugar de cortes al ritmo.` };
  }
  const shots = assignShots(items, cuts, len, seed, fps);
  info.shots = shots.length; info.avgShot = +(len / Math.max(1, shots.length)).toFixed(2);
  return { shots, info };
}

/** Argumentos FFmpeg del look: lienzo de color, imagen contenida en su rectángulo, tratamiento, letra (ASS) y audio de la canción. */
export function lookFfmpegArgs(o: {
  look: LyricLook; W: number; H: number; len: number; shots: Shot[]; color: string; seed: number;
  audio: string; ass: string; fontsDir?: string; out: string; escape: (p: string) => string; preset?: string;
}): string[] {
  const r = imageRect(o.look, o.W, o.H), im = o.look.image;
  const a: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  const v: string[] = [`color=c=0x${o.look.canvas.bg.slice(1)}:s=${o.W}x${o.H}:r=${FPS}:d=${o.len}[cv]`];
  const zw = even(r.w * im.zoom), zh = even(r.h * im.zoom);
  const cx = `(iw-${r.w})/2*(1+${im.offsetX.toFixed(3)})`, cy = `(ih-${r.h})/2*(1+${im.offsetY.toFixed(3)})`;
  if (!o.shots.length) {
    v.push(`color=c=0x${o.color.replace("#", "")}:s=${r.w}x${r.h}:r=${FPS}:d=${o.len},format=yuv420p[img0]`);
  } else {
    o.shots.forEach((s) => {
      if (s.item.kind === "photo") a.push("-loop", "1", "-framerate", String(FPS), "-t", String(s.dur), "-i", s.item.path);
      else a.push("-stream_loop", "-1", "-ss", String(s.entry), "-t", String(s.dur), "-i", s.item.path);
    });
    o.shots.forEach((s, i) => {
      const fit = im.fit === "contain"
        ? `scale=${r.w}:${r.h}:force_original_aspect_ratio=decrease,pad=${r.w}:${r.h}:(ow-iw)/2:(oh-ih)/2:color=0x${o.look.canvas.bg.slice(1)}`
        : `scale=${zw}:${zh}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}:${cx}:${cy}`;
      v.push(`[${i}:v]${fit},setsar=1,fps=${FPS},format=yuv420p,trim=duration=${s.dur},setpts=PTS-STARTPTS[s${i}]`);
    });
    v.push(`${o.shots.map((_, i) => `[s${i}]`).join("")}concat=n=${o.shots.length}:v=1:a=0[img0]`);
  }
  const tf = treatmentFilters(o.look.treatment, o.seed);
  v.push(`[img0]${tf.length ? tf.join(",") + "," : ""}format=yuv420p[img]`);
  v.push(`[cv][img]overlay=${r.x}:${r.y}:shortest=1,subtitles=${o.escape(o.ass)}${o.fontsDir ? `:fontsdir=${o.escape(o.fontsDir)}` : ""},format=yuv420p[v]`);
  const audioIdx = o.shots.length;
  a.push("-i", o.audio);
  a.push("-filter_complex", v.join(";"), "-map", "[v]", "-map", `${audioIdx}:a:0`, "-c:v", "libx264", "-preset", o.preset ?? "superfast", "-crf", "20", "-r", String(FPS),
    "-af", "alimiter=limit=0.97", "-c:a", "aac", "-b:a", "192k", "-t", String(o.len), "-movflags", "+faststart", o.out);
  return a;
}

/** Variación controlada por variante: posición/escala dentro de límites y semilla de montaje/grano. Sin copias idénticas. */
export function varyLook(look: LyricLook, seed: number, amount: number): LyricLook {
  if (amount <= 0) return look;
  const r = rng(seed * 7919 + 13), j = (k: number) => (r() * 2 - 1) * k * amount;
  return resolveLook(look.id, {
    ...look,
    image: { ...look.image, offsetX: look.image.offsetX + j(0.6), offsetY: look.image.offsetY + j(0.4), zoom: look.image.zoom + Math.abs(j(0.08)) },
    text: { ...look.text, x: look.text.x + j(0.04), y: look.text.y + j(0.05), size: look.text.size * (1 + j(0.08)) },
  } as DeepPartial<LyricLook>);
}
