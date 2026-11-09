// Operaciones de edición de subtítulos compartidas por editor y tests. Siempre devuelven palabras válidas
// (sin duración negativa ni solapes) y conservan el intervalo de una palabra al corregir su texto.
import { groupWords, normalizeWords, type SubtitleStyle, type Word } from "./subtitles.ts";
import type { Ratio } from "./composition.ts";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function editText(ws: Word[], i: number, text: string): Word[] {
  return ws.map((w, j) => (j === i ? { ...w, text } : w));
}

/** Divide la palabra i por su primer espacio; reparte el intervalo en proporción a los caracteres. */
export function splitWord(ws: Word[], i: number): Word[] {
  const w = ws[i];
  const parts = w.text.trim().split(/\s+/);
  if (parts.length < 2) {
    const mid = Math.ceil(w.text.length / 2);
    if (w.text.length < 2) return ws;
    parts.splice(0, parts.length, w.text.slice(0, mid), w.text.slice(mid));
  }
  const a = parts[0], b = parts.slice(1).join(" ");
  const cut = r3(w.start + ((w.end - w.start) * a.length) / (a.length + b.length));
  return [...ws.slice(0, i), { text: a, start: w.start, end: cut }, { text: b, start: cut, end: w.end }, ...ws.slice(i + 1)];
}

/** Une la palabra i con la siguiente. */
export function mergeWithNext(ws: Word[], i: number): Word[] {
  if (i < 0 || i >= ws.length - 1) return ws;
  const a = ws[i], b = ws[i + 1];
  return [...ws.slice(0, i), { text: `${a.text} ${b.text}`, start: a.start, end: b.end }, ...ws.slice(i + 2)];
}

/** Ajusta inicio/fin de una palabra dentro de los límites de sus vecinas (nunca solapa ni invierte). */
export function setTiming(ws: Word[], i: number, start: number, end: number, clipLen: number): Word[] {
  const lo = i > 0 ? ws[i - 1].end : 0;
  const hi = i < ws.length - 1 ? ws[i + 1].start : clipLen;
  const s = r3(Math.min(Math.max(start, lo), hi - 0.04));
  const e = r3(Math.max(Math.min(end, hi), s + 0.04));
  return ws.map((w, j) => (j === i ? { ...w, start: s, end: e } : w));
}

/** Desplazamiento global; las palabras que queden fuera del clip se recortan a sus límites. */
export function offsetAll(ws: Word[], delta: number, clipLen: number): Word[] {
  return normalizeWords(ws.map((w) => ({ ...w, start: r3(Math.max(0, w.start + delta)), end: r3(Math.min(clipLen, w.end + delta)) })).filter((w) => w.end > w.start));
}

/** Estilo efectivo por formato: misma regla en preview y export (saltos de línea idénticos). */
export function styleForRatio(s: SubtitleStyle, ratio: Ratio): SubtitleStyle {
  const k = ratio === "16:9" ? 1920 / 1080 : 1;
  return { ...s, maxCharsPerLine: Math.round(s.maxCharsPerLine * k) };
}

const pad = (n: number, l = 2) => String(n).padStart(l, "0");
function ts(s: number, sep: "," | ".") {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}${sep}${pad(ms % 1000, 3)}`;
}

/** SRT/VTT con los MISMOS grupos y saltos de línea que el render. */
export function toSRT(ws: Word[], style: SubtitleStyle): string {
  return groupWords(ws, style).map((g, i) => `${i + 1}\n${ts(g.start, ",")} --> ${ts(g.end, ",")}\n${g.lines.map((l) => l.map((w) => w.text).join(" ")).join("\n")}\n`).join("\n");
}
export function toVTT(ws: Word[], style: SubtitleStyle): string {
  return "WEBVTT\n\n" + groupWords(ws, style).map((g) => `${ts(g.start, ".")} --> ${ts(g.end, ".")}\n${g.lines.map((l) => l.map((w) => w.text).join(" ")).join("\n")}\n`).join("\n");
}
export const toTranscript = (ws: Word[]) => ws.map((w) => w.text).join(" ");
