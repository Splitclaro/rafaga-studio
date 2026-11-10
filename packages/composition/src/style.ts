import { PRESET_LETRA, FX_DEFAULT, type SubtitleStyle, type SubtitleFx, type EntryFx } from "./subtitles.ts";

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
