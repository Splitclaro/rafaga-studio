// Núcleo de subtítulos compartido por preview (web) y export (worker).
// Tiempos en segundos RELATIVOS AL CLIP. Una sola función decide la palabra activa.

export interface Word {
  /** Hablante (0, 1, 2…) si la transcripción tiene diarización. */
  speaker?: number;
  text: string;
  start: number; // s, relativo al clip
  end: number;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number; // px sobre la altura de salida
  primary: string; // #RRGGBB
  active: string; // #RRGGBB palabra activa
  outline: string; // #RRGGBB
  outlineWidth: number;
  shadow: number;
  /** Posición normalizada 0..1 (centro horizontal, base del bloque vertical) */
  x: number;
  y: number;
  maxLines: number;
  maxCharsPerLine: number;
  maxWordsPerGroup: number;
  uppercase?: boolean;
  bold?: boolean;
  /** color: la palabra activa cambia de color · reveal: las palabras aparecen al cantarse · dim: las siguientes se ven atenuadas */
  highlight?: "color" | "reveal" | "dim";
  lowercase?: boolean;
  /** Compositor por evento (ASS): entrada/salida animadas, caja, palabras clave, tracking y suavizado. Todo opcional. */
  fx?: Partial<SubtitleFx>;
}

export type EntryFx = "none" | "fade" | "pop" | "rise" | "drop" | "blur";
export interface SubtitleFx {
  entry: EntryFx; entryMs: number;      // animación de entrada del bloque (aparece cuando empieza el primer intervalo)
  exitFade: number;                      // ms de fundido de salida (0 = corte)
  box: { color: string; opacity: number; pad: number } | null;   // caja de color detrás del texto
  keywords: string[]; keywordsAuto: boolean; keywordColor: string;                       // palabras clave coloreadas (no activas)
  spacing: number;                       // tracking en px (−2..12)
  italic: boolean;
  soften: number;                        // desenfoque de bordes 0..6 (sensación analógica/neón suave)
}
export const FX_DEFAULT: SubtitleFx = { entry: "none", entryMs: 180, exitFade: 0, box: null, keywords: [], keywordsAuto: false, keywordColor: "#FFD400", spacing: 0, italic: false, soften: 0 };
export const fxOf = (s: Pick<SubtitleStyle, "fx">): SubtitleFx => ({ ...FX_DEFAULT, ...(s.fx ?? {}) });
const kw = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

export interface Group {
  words: Word[];
  start: number;
  end: number;
  lines: Word[][]; // palabras por línea (saltos fijados aquí, no por el renderer)
}

/** Valida y normaliza: sin duraciones negativas ni solapes accidentales. */
export function normalizeWords(words: Word[]): Word[] {
  const out: Word[] = [];
  let prevEnd = 0;
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) throw new Error("NaN en tiempos de palabra");
    const start = Math.max(w.start, prevEnd);
    const end = Math.max(w.end, start + 0.04);
    out.push({ text: w.text.trim(), start, end });
    prevEnd = end;
  }
  return out.filter((w) => w.text.length > 0);
}

const SENTENCE_END = /[.!?…]$/;
const SOFT_BREAK = /[,;:]$/;

/** Agrupa en unidades breves: corta por puntuación, pausas, nº de palabras y ancho. */
export function groupWords(input: Word[], style: Pick<SubtitleStyle, "maxLines" | "maxCharsPerLine" | "maxWordsPerGroup">): Group[] {
  const words = normalizeWords(input);
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const fits = (ws: Word[]) => layoutLines(ws, style.maxCharsPerLine).length <= style.maxLines;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (cur.length && (cur.length >= style.maxWordsPerGroup || gap > 0.6 || !fits([...cur, w]))) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text) || (SOFT_BREAK.test(w.text) && cur.length >= 3)) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups.map((ws) => ({
    words: ws,
    start: ws[0].start,
    end: ws[ws.length - 1].end,
    lines: layoutLines(ws, style.maxCharsPerLine),
  }));
}

/** Reparto en líneas equilibrado; determinista, sin palabras cortadas. */
export function layoutLines(ws: Word[], maxChars: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let len = 0;
  for (const w of ws) {
    const add = (line.length ? 1 : 0) + w.text.length;
    if (line.length && len + add > maxChars) {
      lines.push(line);
      line = [];
      len = 0;
    }
    len += (line.length ? 1 : 0) + w.text.length;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Palabra activa en el instante t (s). Mismo criterio para preview y export:
 * activa = intervalo [start, end) de la palabra; en huecos entre palabras del
 * mismo grupo se mantiene la última pronunciada hasta que empiece la siguiente.
 */
export function activeWordAt(group: Group, t: number): number {
  if (t < group.start || t >= group.end) return -1;
  let idx = 0;
  for (let i = 0; i < group.words.length; i++) {
    if (group.words[i].start <= t) idx = i;
    else break;
  }
  return idx;
}

/** Intervalos [start,end) con palabra activa constante dentro de un grupo. */
export function activeIntervals(group: Group): { start: number; end: number; active: number }[] {
  const out: { start: number; end: number; active: number }[] = [];
  const ws = group.words;
  for (let i = 0; i < ws.length; i++) {
    const end = i + 1 < ws.length ? ws[i + 1].start : group.end;
    if (end > ws[i].start) out.push({ start: ws[i].start, end, active: i });
  }
  return out;
}

function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Color inválido: ${hex}`);
  const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

function assTime(s: number): string {
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Mayúsculas/minúsculas según estilo (misma regla en preview y export). */
export function caseOf(style: Pick<SubtitleStyle, "uppercase" | "lowercase">, text: string): string {
  return style.uppercase ? text.toUpperCase() : style.lowercase ? text.toLowerCase() : text;
}

/** Escapa texto de usuario para ASS: sin llaves, backslashes ni saltos libres. */
export function escapeAss(text: string): string {
  return text.replace(/\\/g, "＼").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]+/g, " ");
}

/** Grupos fijados por el llamador (p. ej. una línea de letra = un grupo). */
export function groupsFrom(blocks: Word[][], maxCharsPerLine: number): Group[] {
  return blocks.filter((b) => b.length).map((ws) => ({ words: ws, start: ws[0].start, end: ws[ws.length - 1].end, lines: layoutLines(ws, maxCharsPerLine) }));
}

export function buildAss(words: Word[], style: SubtitleStyle, out: { width: number; height: number }, fixedGroups?: Group[]): string {
  const groups = fixedGroups ?? groupWords(words, style);
  const marginV = Math.round((1 - style.y) * out.height);
  const fx = fxOf(style);
  const boxed = !!fx.box;
  const boxPad = fx.box ? Math.round(Math.min(40, Math.max(2, fx.box.pad)) * (out.height / 1920) * 2) : 0;
  const boxAlpha = fx.box ? Math.round((1 - Math.min(1, Math.max(0, fx.box.opacity))) * 255) : 0;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${out.width}`,
    `PlayResY: ${out.height}`,
    "WrapStyle: 2", // sin auto-wrap: los saltos los fija groupWords
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,${style.fontName},${style.fontSize},${assColor(style.primary)},${assColor(style.primary)},${boxed ? assColor(fx.box!.color, boxAlpha) : assColor(style.outline)},${boxed ? assColor(fx.box!.color, boxAlpha) : "&H96000000"},${style.bold === false ? 0 : 1},${fx.italic ? -1 : 0},0,0,100,100,${fx.spacing},0,${boxed ? 3 : 1},${boxed ? boxPad : style.outlineWidth},${boxed ? 0 : style.shadow},2,${Math.round(out.width * 0.06)},${Math.round(out.width * 0.06)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const events: string[] = [];
  const kwSet = new Set(fx.keywords.map((k) => kw(k)).filter(Boolean));
  const kwColor = assColor(fx.keywordColor);
  const px = Math.round(out.width / 2), py = out.height - marginV;
  for (const g of groups) {
    const ivs = activeIntervals(g);
    for (const [ii, iv] of ivs.entries()) {
      // Entrada/salida: solo en el primer/último intervalo del bloque (la palabra activa cambia sin re-animar)
      const tags: string[] = [];
      const ms = Math.round(fx.entryMs);
      if (ii === 0 && fx.entry !== "none") {
        const off = Math.round(out.height * 0.03);
        if (fx.entry === "fade") tags.push(`\\fad(${ms},0)`);
        else if (fx.entry === "pop") tags.push(`\\fscx70\\fscy70\\t(0,${ms},\\fscx100\\fscy100)\\fad(${Math.min(ms, 120)},0)`);
        else if (fx.entry === "rise") tags.push(`\\move(${px},${py + off},${px},${py},0,${ms})\\fad(${Math.min(ms, 140)},0)`);
        else if (fx.entry === "drop") tags.push(`\\move(${px},${py - off},${px},${py},0,${ms})\\fad(${Math.min(ms, 140)},0)`);
        else if (fx.entry === "blur") tags.push(`\\blur${Math.max(4, fx.soften + 6)}\\t(0,${ms},\\blur${fx.soften})\\fad(${Math.min(ms, 160)},0)`);
      }
      if (ii === ivs.length - 1 && fx.exitFade > 0) tags.push(`\\fad(0,${Math.round(fx.exitFade)})`);
      if (fx.soften > 0 && !(ii === 0 && fx.entry === "blur")) tags.push(`\\blur${fx.soften}`);
      const lead = tags.length ? `{${tags.join("").replace(/\\fad\(([^)]*)\)\\fad\(([^)]*)\)/, (_m, a, b) => `\\fad(${a.split(",")[0]},${b.split(",")[1]})`)}}` : "";
      let k = 0;
      const text = g.lines
        .map((line) =>
          line
            .map((w) => {
              const idx = k++;
              const t = escapeAss(caseOf(style, w.text));
              const mode = style.highlight ?? "color";
              const kwText = kw(w.text);
              const isKey = (kwSet.size > 0 && kwSet.has(kwText)) || (fx.keywordsAuto && (/\\d/.test(kwText) || kwText.length >= 7));
              if (isKey && idx !== iv.active && !(idx > iv.active && (mode === "reveal" || mode === "dim"))) return `{\\c${kwColor}}${t}{\\c${assColor(style.primary)}}`;
              if (isKey && idx > iv.active && mode === "dim") return `{\\c${kwColor}\\alpha&HA0&}${t}{\\c${assColor(style.primary)}\\alpha&H00&}`;
              if (idx === iv.active) return mode === "color" ? `{\\c${assColor(style.active)}}${t}{\\c${assColor(style.primary)}}` : `{\\c${assColor(style.active)}\\alpha&H00&}${t}{\\c${assColor(style.primary)}}`;
              if (idx > iv.active && mode === "reveal") return `{\\alpha&HFF&}${t}{\\alpha&H00&}`;   // aún no cantada: invisible pero ocupa su sitio (sin saltos)
              if (idx > iv.active && mode === "dim") return `{\\alpha&HA0&}${t}{\\alpha&H00&}`;
              return t;
            })
            .join(" "),
        )
        .join("\\N");
      events.push(`Dialogue: 0,${assTime(iv.start)},${assTime(iv.end)},Default,,0,0,0,,${lead}${text}`);
    }
  }
  return [...header, ...events, ""].join("\n");
}

export const PRESET_IMPACTO: SubtitleStyle = {
  fontName: "Bootzy TM",
  fontSize: 96,
  bold: false,
  primary: "#FFFFFF",
  active: "#B5F36D",
  outline: "#101216",
  outlineWidth: 6,
  shadow: 2,
  x: 0.5,
  y: 0.72,
  maxLines: 2,
  maxCharsPerLine: 18,
  maxWordsPerGroup: 5,
  uppercase: true,
};

export const PRESET_LIMPIO: SubtitleStyle = {
  fontName: "Bootzy TM", bold: false, fontSize: 64, primary: "#FFFFFF", active: "#FFFFFF", outline: "#000000", outlineWidth: 3, shadow: 1,
  x: 0.5, y: 0.82, maxLines: 2, maxCharsPerLine: 26, maxWordsPerGroup: 7, uppercase: false,
};
export const PRESET_KARAOKE: SubtitleStyle = {
  fontName: "Bootzy TM", bold: false, fontSize: 84, primary: "#D9D9D9", active: "#FFD400", outline: "#000000", outlineWidth: 5, shadow: 2,
  x: 0.5, y: 0.7, maxLines: 2, maxCharsPerLine: 20, maxWordsPerGroup: 5, uppercase: false,
};
/** Formato de letra minimalista: minúsculas, sin contorno, sombra suave, una frase centrada; las palabras aparecen al cantarse. */
export const PRESET_LETRA: SubtitleStyle = {
  fontName: "Bootzy TM", bold: false, fontSize: 76, primary: "#FFFFFF", active: "#FFFFFF", outline: "#000000", outlineWidth: 0, shadow: 3,
  x: 0.5, y: 0.53, maxLines: 2, maxCharsPerLine: 22, maxWordsPerGroup: 8, lowercase: true, highlight: "reveal",
};
/** Variante: la frase completa visible y lo que falta por cantar, atenuado. */
export const PRESET_LETRA_SUAVE: SubtitleStyle = { ...PRESET_LETRA, highlight: "dim" };
/** Formato LyricTune: pocas palabras por bloque, minúsculas, blanco con sombra suave, sobre la banda de vídeo. */
export const PRESET_TUNE: SubtitleStyle = { ...PRESET_LETRA, fontSize: 84, maxWordsPerGroup: 3, maxCharsPerLine: 16, maxLines: 2, y: 0.5, highlight: "reveal" };
/** Una palabra grande cada vez. */
export const PRESET_PALABRA: SubtitleStyle = { ...PRESET_LETRA, fontSize: 130, maxWordsPerGroup: 1, maxCharsPerLine: 12, maxLines: 1, y: 0.5, highlight: "reveal" };
/** Mayúsculas con la palabra cantada resaltada en amarillo y el resto atenuado. */
export const PRESET_TUNE_MAYUS: SubtitleStyle = { ...PRESET_LETRA, fontSize: 80, uppercase: true, lowercase: false, active: "#FFE14D", maxWordsPerGroup: 4, maxCharsPerLine: 18, outlineWidth: 0, shadow: 4, y: 0.5, highlight: "dim" };
/** Tratamientos con compositor (entrada animada, caja, palabras clave, suavizado). Cada uno cambia la composición real del export. */
const IMPACT_BASE: SubtitleStyle = PRESET_IMPACTO;
export const PRESET_POP: SubtitleStyle = { ...IMPACT_BASE, fx: { entry: "pop", entryMs: 200 } };
export const PRESET_SUBIDA: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 70, fx: { entry: "rise", entryMs: 260, exitFade: 120 } };
export const PRESET_CAIDA: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 70, y: 0.3, fx: { entry: "drop", entryMs: 260, exitFade: 120 } };
export const PRESET_DESENFOQUE: SubtitleStyle = { ...PRESET_LETRA, fontSize: 80, highlight: "color", active: "#FFFFFF", fx: { entry: "blur", entryMs: 320, exitFade: 160, soften: 1 } };
export const PRESET_CAJA_NEGRA: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 62, outlineWidth: 0, shadow: 0, primary: "#FFFFFF", active: "#FFFFFF", highlight: "color", fx: { box: { color: "#000000", opacity: 0.78, pad: 12 }, entry: "fade", entryMs: 140 } };
export const PRESET_CAJA_AMARILLA: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 66, bold: true, outlineWidth: 0, shadow: 0, primary: "#111111", active: "#111111", highlight: "color", fx: { box: { color: "#FFD400", opacity: 1, pad: 12 }, entry: "pop", entryMs: 160 } };
export const PRESET_CLAVES: SubtitleStyle = { ...IMPACT_BASE, active: "#FFFFFF", highlight: "color", fx: { keywordsAuto: true, keywordColor: "#FFD400", entry: "fade", entryMs: 120 } };
export const PRESET_NEON: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 74, primary: "#E8FBFF", active: "#7AD7FF", outline: "#00A3D9", outlineWidth: 4, shadow: 0, highlight: "color", fx: { soften: 2, entry: "fade", entryMs: 180, spacing: 2 } };
export const PRESET_CINE: SubtitleStyle = { ...PRESET_LETRA, fontSize: 70, bold: false, highlight: "reveal", fx: { italic: true, entry: "fade", entryMs: 300, exitFade: 300, spacing: 3 } };
export const PRESET_TITULAR: SubtitleStyle = { ...IMPACT_BASE, fontSize: 112, y: 0.5, maxWordsPerGroup: 3, maxCharsPerLine: 12, active: "#FFFFFF", highlight: "color", fx: { entry: "pop", entryMs: 220 } };
export const PRESET_KARAOKE_CAJA: SubtitleStyle = { ...PRESET_KARAOKE, outlineWidth: 0, shadow: 0, primary: "#FFFFFF", active: "#FFD400", fx: { box: { color: "#000000", opacity: 0.7, pad: 14 } } };
export const PRESET_MAQUINA: SubtitleStyle = { ...PRESET_LIMPIO, fontSize: 66, highlight: "reveal", fx: { entry: "fade", entryMs: 80, exitFade: 100, spacing: 1 } };
export const PRESET_FANTASMA: SubtitleStyle = { ...PRESET_LETRA, fontSize: 78, highlight: "dim", fx: { entry: "fade", entryMs: 260, exitFade: 260, soften: 1 } };
export const PRESETS: Record<string, SubtitleStyle> = { Tune: PRESET_TUNE, Palabra: PRESET_PALABRA, "Tune mayúsculas": PRESET_TUNE_MAYUS, Letra: PRESET_LETRA, "Letra suave": PRESET_LETRA_SUAVE, Impacto: PRESET_IMPACTO, Limpio: PRESET_LIMPIO, Karaoke: PRESET_KARAOKE, Pop: PRESET_POP, "Subida suave": PRESET_SUBIDA, Caída: PRESET_CAIDA, Desenfoque: PRESET_DESENFOQUE, "Caja negra": PRESET_CAJA_NEGRA, "Caja amarilla": PRESET_CAJA_AMARILLA, "Palabras clave": PRESET_CLAVES, Neón: PRESET_NEON, Cine: PRESET_CINE, Titular: PRESET_TITULAR, "Karaoke con caja": PRESET_KARAOKE_CAJA, Máquina: PRESET_MAQUINA, Fantasma: PRESET_FANTASMA };
