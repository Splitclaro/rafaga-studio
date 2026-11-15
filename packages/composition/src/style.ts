import { PRESET_LETRA, FX_DEFAULT, type SubtitleStyle, type SubtitleFx, type EntryFx } from "./subtitles.ts";
import { CAPTION_FONTS } from "./fontcatalog.ts";

/** PRNG reproducible (mulberry32). */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : d);
const family = (v: unknown, d: string) => (typeof v === "string" && /^[\p{L}\p{N} _.-]{1,60}$/u.test(v) ? v : d);

const ENTRIES: EntryFx[] = ["none", "fade", "pop", "rise", "drop", "blur"];
/** Valida el compositor por evento: valores acotados y palabras clave limpias (sin caracteres de control de ASS). */
export function validateFx(raw: unknown, base: Partial<SubtitleFx> = {}): Partial<SubtitleFx> | undefined {
  const o = (raw && typeof raw === "object" ? raw : base) as Record<string, unknown>;
  const b = { ...FX_DEFAULT, ...base };
  const box = o.box && typeof o.box === "object" ? (o.box as Record<string, unknown>) : o.box === null ? null : b.box;
  const kws = Array.isArray(o.keywords) ? o.keywords : b.keywords;
  const out: SubtitleFx = {
    entry: ENTRIES.includes(o.entry as EntryFx) ? (o.entry as EntryFx) : b.entry, entryMs: clamp(o.entryMs, 60, 800, b.entryMs),
    exitFade: clamp(o.exitFade, 0, 600, b.exitFade),
    box: box ? { color: hex(box.color, "#000000"), opacity: clamp(box.opacity, 0.1, 1, 0.8), pad: clamp(box.pad, 2, 40, 12) } : null,
    keywords: kws.filter((k): k is string => typeof k === "string").map((k) => k.replace(/[^\p{L}\p{N}' -]/gu, "").trim().slice(0, 30)).filter(Boolean).slice(0, 40),
    keywordsAuto: o.keywordsAuto === undefined ? b.keywordsAuto : !!o.keywordsAuto, keywordColor: hex(o.keywordColor, b.keywordColor), spacing: clamp(o.spacing, -2, 12, b.spacing), italic: o.italic === undefined ? b.italic : !!o.italic, soften: clamp(o.soften, 0, 6, b.soften),
  };
  const differs = JSON.stringify(out) !== JSON.stringify(FX_DEFAULT);
  return differs ? out : undefined;
}

/** Valida y normaliza un estilo (importado, guardado o aleatorio). Nunca lanza: devuelve valores seguros. */
export function validateStyle(raw: unknown, base: SubtitleStyle = PRESET_LETRA): SubtitleStyle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hl = o.highlight === "color" || o.highlight === "reveal" || o.highlight === "dim" ? o.highlight : base.highlight ?? "color";
  return {
    fontName: family(o.fontName, base.fontName), fontSize: clamp(o.fontSize, 32, 200, base.fontSize),
    primary: hex(o.primary, base.primary), active: hex(o.active, base.active), outline: hex(o.outline, base.outline),
    outlineWidth: clamp(o.outlineWidth, 0, 16, base.outlineWidth), shadow: clamp(o.shadow, 0, 12, base.shadow),
    x: 0.5, y: clamp(o.y, 0.1, 0.92, base.y),
    maxLines: Math.round(clamp(o.maxLines, 1, 3, base.maxLines)), maxCharsPerLine: Math.round(clamp(o.maxCharsPerLine, 8, 40, base.maxCharsPerLine)),
    maxWordsPerGroup: Math.round(clamp(o.maxWordsPerGroup, 1, 12, base.maxWordsPerGroup)),
    uppercase: !!o.uppercase && !o.lowercase, lowercase: !!o.lowercase && !o.uppercase, bold: o.bold === undefined ? base.bold : !!o.bold, highlight: hl,
    fx: validateFx(o.fx, base.fx),
  };
}

/** Exportación/importación de presets con esquema versionado. */
export const exportStyle = (name: string, s: SubtitleStyle) => JSON.stringify({ rafagaStyle: 1, name, style: s }, null, 2);
export function importStyle(text: string): { name: string; style: SubtitleStyle } | null {
  try { const j = JSON.parse(text); if (j?.rafagaStyle !== 1 || typeof j.style !== "object") return null; return { name: String(j.name ?? "Estilo importado").slice(0, 60), style: validateStyle(j.style) }; } catch { return null; }
}

const PALETTES = [["#FFFFFF", "#B5F36D"], ["#FFFFFF", "#FFD400"], ["#F5F5F5", "#FF5C8A"], ["#111111", "#FFFFFF"], ["#FFFFFF", "#7AD7FF"], ["#FFF1D6", "#FF8A3D"]];
/** «Sorpréndeme»: estilo válido y legible, reproducible con semilla. */
export function surpriseStyle(seed: number, fontName: string): SubtitleStyle {
  const r = rng(seed); const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const [primary, active] = pick(PALETTES);
  const dark = primary === "#111111";
  return validateStyle({ fontName, fontSize: 60 + Math.round(r() * 50), primary, active, outline: dark ? "#FFFFFF" : "#000000", outlineWidth: pick([0, 0, 3, 5, 7]), shadow: pick([0, 2, 3, 5]),
    y: 0.45 + r() * 0.35, maxLines: 2, maxCharsPerLine: 14 + Math.round(r() * 14), maxWordsPerGroup: 3 + Math.round(r() * 5), uppercase: r() < 0.4, lowercase: false, bold: false, highlight: pick(["color", "reveal", "dim"]), fx: { entry: pick<EntryFx>(["none", "fade", "pop", "rise", "blur"]), entryMs: 160 + Math.round(r() * 200), spacing: pick([0, 0, 1, 2]), soften: pick([0, 0, 1]) } });
}

// ───────── Estilo v2 (compartido por clipping y letra): 9 controles ─────────
// Controles: fuente (font), peso (weight), caja (case), colores (color, activeColor), efecto (effect), entrada (entrance, entranceBy),
// palabra activa (active), posición (position) y tamaño (size, sizeFine). Lo anterior (SubtitleStyle v1) no cambia.
export interface CaptionStyleV2 {
  rafagaStyle: 2; font: string; weight: 400 | 700; case: "asis" | "upper" | "lower"; color: string; activeColor: string;
  effect: "none" | "shadow" | "glow" | "stroke" | "box"; entrance: "none" | "fade" | "slide" | "pop" | "typewriter"; entranceBy: "word" | "line";
  active: "none" | "color" | "scale" | "underline" | "box"; position: { x: number; y: number }; size: "S" | "M" | "L"; sizeFine: number;
  /** Cursiva, espaciado entre letras (fracción del cuerpo, como «Letter spacing» de LyricTune) y duración de la entrada en ms (0 = la del preset). */
  italic?: boolean; tracking?: number; entranceMs?: number;
  /** Extras de LyricTune: degradado vertical (color final), ecos (copias fantasma), dirección y curva de la entrada, salida propia, movimiento en reposo y caos (0–1). */
  gradient?: string; echo?: 1 | 2 | 3; entranceDir?: "up" | "down" | "left" | "right"; ease?: "out" | "in" | "inout";
  exit?: "fade" | "slide" | "pop" | "cut"; idle?: "float" | "pulse" | "wobble"; chaos?: number;
}
const CASES = ["asis", "upper", "lower"] as const, EFFECTS = ["none", "shadow", "glow", "stroke", "box"] as const, ENTRANCES = ["none", "fade", "slide", "pop", "typewriter"] as const;
const ACTIVES = ["none", "color", "scale", "underline", "box"] as const, SIZES = ["S", "M", "L"] as const;
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
export const DEFAULT_CAPTION: CaptionStyleV2 = { rafagaStyle: 2, font: "Inter", weight: 700, case: "asis", color: "#FFFFFF", activeColor: "#FFD400", effect: "shadow", entrance: "fade", entranceBy: "word", active: "color", position: { x: 0.5, y: 0.5 }, size: "M", sizeFine: 1 };
/** Familias disponibles en el catálogo (sin repetir). */
export const CAPTION_FAMILIES = [...new Set(CAPTION_FONTS.map((f) => f.family))];
const knownFont = (v: unknown) => (typeof v === "string" && CAPTION_FAMILIES.includes(v) ? v : CAPTION_FAMILIES[0] ?? "Inter");

/** Convierte un estilo v1 (SubtitleStyle) en uno v2 con la misma intención. */
export function captionFromSubtitleStyle(s: SubtitleStyle): CaptionStyleV2 {
  const entry = s.fx?.entry ?? "none";
  return {
    ...DEFAULT_CAPTION, font: knownFont(s.fontName), weight: s.bold ? 700 : 400, case: s.uppercase ? "upper" : s.lowercase ? "lower" : "asis",
    color: s.primary, activeColor: s.active, effect: s.fx?.box ? "box" : s.outlineWidth > 0 ? "stroke" : s.shadow > 0 ? "shadow" : "none",
    entrance: entry === "pop" ? "pop" : entry === "rise" || entry === "drop" ? "slide" : entry === "fade" || entry === "blur" ? "fade" : "none",
    active: s.highlight === "reveal" || s.highlight === "dim" ? "none" : "color", position: { x: 0.5, y: s.y }, size: s.fontSize < 60 ? "S" : s.fontSize < 85 ? "M" : "L", sizeFine: 1,
  };
}
/** Valida un estilo v2, o convierte un v1, o devuelve el predeterminado: nunca lanza y siempre deja los 9 controles en rango. */
export function validateCaptionStyle(raw: unknown): CaptionStyleV2 {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (o.rafagaStyle !== 2 && typeof o.fontName === "string" && typeof o.primary === "string") return validateCaptionStyle(captionFromSubtitleStyle(validateStyle(o)));
  const p = (o.position && typeof o.position === "object" ? o.position : {}) as Record<string, unknown>;
  return {
    rafagaStyle: 2, font: knownFont(o.font), weight: o.weight === 400 ? 400 : 700, case: oneOf(o.case, CASES, "asis"), color: hex(o.color, DEFAULT_CAPTION.color), activeColor: hex(o.activeColor, DEFAULT_CAPTION.activeColor),
    effect: oneOf(o.effect, EFFECTS, "shadow"), entrance: oneOf(o.entrance, ENTRANCES, "fade"), entranceBy: o.entranceBy === "line" ? "line" : "word", active: oneOf(o.active, ACTIVES, "color"),
    position: { x: clamp(p.x, 0.1, 0.9, 0.5), y: clamp(p.y, 0.1, 0.92, 0.5) }, size: oneOf(o.size, SIZES, "M"), sizeFine: Math.round(clamp(o.sizeFine, 0.6, 1.6, 1) * 100) / 100,
    ...(o.italic === true ? { italic: true } : {}), ...(Number(o.tracking) ? { tracking: Math.round(clamp(o.tracking, -0.05, 0.3, 0) * 1000) / 1000 } : {}), ...(Number(o.entranceMs) ? { entranceMs: Math.round(clamp(o.entranceMs, 100, 2000, 0)) } : {}),
    ...(typeof o.gradient === "string" && /^#[0-9a-f]{6}$/i.test(o.gradient) ? { gradient: o.gradient.toUpperCase() } : {}), ...(o.echo === 1 || o.echo === 2 || o.echo === 3 ? { echo: o.echo } : {}),
    ...(["up", "down", "left", "right"].includes(o.entranceDir as string) && o.entranceDir !== "up" ? { entranceDir: o.entranceDir as "down" | "left" | "right" } : {}), ...(["out", "in", "inout"].includes(o.ease as string) ? { ease: o.ease as "out" | "in" | "inout" } : {}),
    ...(["fade", "slide", "pop", "cut"].includes(o.exit as string) ? { exit: o.exit as "fade" | "slide" | "pop" | "cut" } : {}), ...(["float", "pulse", "wobble"].includes(o.idle as string) ? { idle: o.idle as "float" | "pulse" | "wobble" } : {}),
    ...(Number(o.chaos) > 0 ? { chaos: Math.round(clamp(o.chaos, 0, 1, 0) * 100) / 100 } : {}),
  };
}
export const captionStyleBytes = (s: CaptionStyleV2): number => new TextEncoder().encode(JSON.stringify(s)).length;
/** Para clipping y `buildAss`: el mismo esquema v2 expresado como SubtitleStyle (ya normalizado por validateStyle). */
export function captionToSubtitleStyle(v: CaptionStyleV2): SubtitleStyle {
  const s = validateCaptionStyle(v), base = { S: 54, M: 72, L: 96 }[s.size] * s.sizeFine;
  return validateStyle({
    fontName: s.font, fontSize: Math.round(base), primary: s.color, active: s.activeColor, outline: "#000000", outlineWidth: s.effect === "stroke" ? 5 : s.effect === "glow" ? 3 : 0, shadow: s.effect === "shadow" ? 3 : 0,
    y: s.position.y, maxLines: 2, maxCharsPerLine: 24, maxWordsPerGroup: 6, uppercase: s.case === "upper", lowercase: s.case === "lower", bold: s.weight === 700, highlight: "color",
    fx: { entry: s.entrance === "pop" ? "pop" : s.entrance === "slide" ? "rise" : s.entrance === "fade" ? "fade" : "none", box: s.effect === "box" ? { color: "#000000", opacity: 0.8, pad: 12 } : null },
  });
}

export type BehaviourPresetId = "frase_palabra_activa" | "palabra_a_palabra" | "escritura_progresiva" | "texto_estatico" | "entrada_deslizada";
export interface BehaviourPreset { id: BehaviourPresetId; label: string; unit: "frase" | "palabra" | "linea"; group: { words: number; lines: number }; active: CaptionStyleV2["active"]; entrance: CaptionStyleV2["entrance"]; exit: "fade" | "corte"; durationMs: number }
export const BEHAVIOUR_PRESETS: Record<BehaviourPresetId, BehaviourPreset> = {
  frase_palabra_activa: { id: "frase_palabra_activa", label: "Frase con palabra activa", unit: "frase", group: { words: 8, lines: 2 }, active: "color", entrance: "fade", exit: "fade", durationMs: 180 },
  palabra_a_palabra: { id: "palabra_a_palabra", label: "Palabra a palabra", unit: "palabra", group: { words: 1, lines: 1 }, active: "none", entrance: "pop", exit: "corte", durationMs: 120 },
  escritura_progresiva: { id: "escritura_progresiva", label: "Escritura progresiva", unit: "palabra", group: { words: 8, lines: 2 }, active: "none", entrance: "typewriter", exit: "fade", durationMs: 60 },
  texto_estatico: { id: "texto_estatico", label: "Texto estático", unit: "linea", group: { words: 10, lines: 2 }, active: "none", entrance: "none", exit: "corte", durationMs: 0 },
  entrada_deslizada: { id: "entrada_deslizada", label: "Entrada deslizada", unit: "linea", group: { words: 8, lines: 2 }, active: "scale", entrance: "slide", exit: "fade", durationMs: 260 },
};
/** «Sorpréndeme» para el estilo v2: reproducible con semilla y siempre válido. */
export function surpriseCaption(seed: number): CaptionStyleV2 {
  const r = rng(seed), pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)], [color, activeColor] = pick(PALETTES);
  return validateCaptionStyle({ rafagaStyle: 2, font: pick(CAPTION_FAMILIES), weight: pick([400, 700] as const), case: pick(CASES), color, activeColor, effect: pick(EFFECTS), entrance: pick(ENTRANCES), entranceBy: pick(["word", "line"] as const),
    active: pick(ACTIVES), position: { x: 0.5, y: 0.4 + r() * 0.4 }, size: pick(SIZES), sizeFine: 0.8 + r() * 0.6 });
}
