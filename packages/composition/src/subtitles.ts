// Núcleo de subtítulos compartido por preview (web) y export (worker).
// Tiempos en segundos RELATIVOS AL CLIP. Una sola función decide la palabra activa.

export interface Word {
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
}

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

/** Escapa texto de usuario para ASS: sin llaves, backslashes ni saltos libres. */
export function escapeAss(text: string): string {
  return text.replace(/\\/g, "＼").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]+/g, " ");
}

export function buildAss(words: Word[], style: SubtitleStyle, out: { width: number; height: number }): string {
  const groups = groupWords(words, style);
  const marginV = Math.round((1 - style.y) * out.height);
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
    `Style: Default,${style.fontName},${style.fontSize},${assColor(style.primary)},${assColor(style.primary)},${assColor(style.outline)},&H80000000,1,0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadow},2,${Math.round(out.width * 0.06)},${Math.round(out.width * 0.06)},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  const events: string[] = [];
  for (const g of groups) {
    for (const iv of activeIntervals(g)) {
      let k = 0;
      const text = g.lines
        .map((line) =>
          line
            .map((w) => {
              const idx = k++;
              const t = escapeAss(style.uppercase ? w.text.toUpperCase() : w.text);
              return idx === iv.active ? `{\\c${assColor(style.active)}}${t}{\\c${assColor(style.primary)}}` : t;
            })
            .join(" "),
        )
        .join("\\N");
      events.push(`Dialogue: 0,${assTime(iv.start)},${assTime(iv.end)},Default,,0,0,0,,${text}`);
    }
  }
  return [...header, ...events, ""].join("\n");
}

export const PRESET_IMPACTO: SubtitleStyle = {
  fontName: "Arial",
  fontSize: 96,
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
  fontName: "Arial", fontSize: 64, primary: "#FFFFFF", active: "#FFFFFF", outline: "#000000", outlineWidth: 3, shadow: 1,
  x: 0.5, y: 0.82, maxLines: 2, maxCharsPerLine: 26, maxWordsPerGroup: 7, uppercase: false,
};
export const PRESET_KARAOKE: SubtitleStyle = {
  fontName: "Arial", fontSize: 84, primary: "#D9D9D9", active: "#FFD400", outline: "#000000", outlineWidth: 5, shadow: 2,
  x: 0.5, y: 0.7, maxLines: 2, maxCharsPerLine: 20, maxWordsPerGroup: 5, uppercase: false,
};
export const PRESETS: Record<string, SubtitleStyle> = { Impacto: PRESET_IMPACTO, Limpio: PRESET_LIMPIO, Karaoke: PRESET_KARAOKE };
