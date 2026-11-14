// Formatos de letra con tiempos: LRC de línea, LRC mejorado (por palabra), SRT, VTT, ASS karaoke y texto. Código puro.
// Cada exportación tiene su lectura (`parseLrc`, `parseSrtCues`) para comprobar la ida y vuelta (tolerancia: 10 ms).
import type { SyncWord } from "./sync.ts";

export interface LineGroup { line: number; words: SyncWord[]; text: string; start: number; end: number }
/** Agrupa las palabras por línea conservando el orden. */
export function groupLines(words: Pick<SyncWord, "text" | "start" | "end" | "line">[]): LineGroup[] {
  const out: LineGroup[] = [];
  for (const w of words as SyncWord[]) {
    const g = out.at(-1);
    if (g && g.line === w.line) { g.words.push(w); g.text += ` ${w.text}`; g.end = w.end; }
    else out.push({ line: w.line, words: [w], text: w.text, start: w.start, end: w.end });
  }
  return out;
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** [mm:ss.xx] sin corchetes. */
const lrcTime = (s: number) => { const cs = Math.max(0, Math.round(s * 100)); return `${p2(Math.floor(cs / 6000))}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}`; };
const msParts = (s: number) => { const ms = Math.max(0, Math.round(s * 1000)); return { h: Math.floor(ms / 3600000), m: Math.floor(ms / 60000) % 60, s: Math.floor(ms / 1000) % 60, ms: ms % 1000 }; };
const srtTime = (s: number, sep: "," | ".") => { const t = msParts(s); return `${p2(t.h)}:${p2(t.m)}:${p2(t.s)}${sep}${String(t.ms).padStart(3, "0")}`; };
const assTime = (s: number) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${p2(Math.floor(cs / 6000) % 60)}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}`; };

export function toLrc(words: SyncWord[], meta: { title?: string; artist?: string } = {}): string {
  const head = [meta.title ? `[ti:${meta.title}]` : "", meta.artist ? `[ar:${meta.artist}]` : ""].filter(Boolean);
  return [...head, ...groupLines(words).map((g) => `[${lrcTime(g.start)}]${g.text}`)].join("\n") + "\n";
}
/** `[mm:ss.xx]<mm:ss.xx>palabra <mm:ss.xx>palabra <mm:ss.xx>`: la última marca es el fin de la línea. */
export function toLrcEnhanced(words: SyncWord[], meta: { title?: string; artist?: string } = {}): string {
  const head = [meta.title ? `[ti:${meta.title}]` : "", meta.artist ? `[ar:${meta.artist}]` : ""].filter(Boolean);
  return [...head, ...groupLines(words).map((g) => `[${lrcTime(g.start)}]${g.words.map((w) => `<${lrcTime(w.start)}>${w.text}`).join(" ")} <${lrcTime(g.end)}>`)].join("\n") + "\n";
}
export function toSrtLyrics(words: SyncWord[]): string {
  return groupLines(words).map((g, i) => `${i + 1}\n${srtTime(g.start, ",")} --> ${srtTime(g.end, ",")}\n${g.text}\n`).join("\n");
}
export function toVttLyrics(words: SyncWord[]): string {
  return "WEBVTT\n\n" + groupLines(words).map((g) => `${srtTime(g.start, ".")} --> ${srtTime(g.end, ".")}\n${g.text}\n`).join("\n");
}
export const toTxtLyrics = (words: SyncWord[]): string => groupLines(words).map((g) => g.text).join("\n") + "\n";

/** ASS con un `Dialogue` por línea y `{\kN}` (centésimas) por palabra; los huecos entre palabras son `{\kN}` vacíos. */
export function toAssKaraoke(words: SyncWord[], opt: { width?: number; height?: number; font?: string; size?: number } = {}): string {
  const W = opt.width ?? 1920, H = opt.height ?? 1080;
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${opt.font ?? "Inter"},${opt.size ?? 64},&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,60,60,80,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev = groupLines(words).map((g) => {
    let cur = 0; const parts: string[] = [];                         // cur = centésimas relativas al inicio de la línea ya cubiertas
    g.words.forEach((w, i) => {
      const a = Math.round((w.start - g.start) * 100), b = Math.round((w.end - g.start) * 100);
      if (a > cur) { parts.push(`{\\k${a - cur}}`); cur = a; }       // hueco antes de la palabra
      parts.push(`{\\k${Math.max(0, b - cur)}}${w.text}${i < g.words.length - 1 ? " " : ""}`); cur = Math.max(cur, b);
    });
    return `Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Default,,0,0,0,,${parts.join("")}`;
  });
  return head + ev.join("\n") + "\n";
}

// ───────── Lectura ─────────
export interface LrcLine { start: number; text: string; end: number | null; words?: { text: string; start: number }[] }
const TAG = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]/;
const toSec = (m: string, s: string) => Number(m) * 60 + Number(s);
/** LRC de línea o mejorado. Ignora `[ar:]`, `[ti:]`…; varias marcas en una línea = repeticiones. */
export function parseLrc(text: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    let rest = raw; const starts: number[] = [];
    for (let m = TAG.exec(rest); m; m = TAG.exec(rest)) { starts.push(toSec(m[1], m[2])); rest = rest.slice(m[0].length); }
    if (!starts.length) continue;
    const marks = [...rest.matchAll(/<(\d+):(\d+(?:\.\d+)?)>/g)];
    let words: { text: string; start: number }[] | undefined, end: number | null = null, line = rest.trim();
    if (marks.length) {
      words = []; const segs = rest.split(/<\d+:\d+(?:\.\d+)?>/);        // segs[0] antes de la primera marca; segs[i] sigue a marks[i-1]
      marks.forEach((mk, i) => { const t = (segs[i + 1] ?? "").trim(); const st = toSec(mk[1], mk[2]); if (t) words!.push({ text: t, start: st }); else if (i === marks.length - 1) end = st; });
      line = words.map((w) => w.text).join(" ");
    }
    for (const st of starts) out.push({ start: st, text: line, end, ...(words ? { words } : {}) });
  }
  return out.sort((a, b) => a.start - b.start);
}
export interface Cue { start: number; end: number; text: string }
/** SRT y VTT: tiempos `HH:MM:SS,mmm` o `HH:MM:SS.mmm` (y `MM:SS.mmm` en VTT). */
export function parseSrtCues(text: string): Cue[] {
  const out: Cue[] = [], T = String.raw`(?:(\d+):)?(\d+):(\d+)[,.](\d+)`;
  const re = new RegExp(`${T}\\s*-->\\s*${T}[^\\n]*\\n((?:(?!\\n\\s*\\n).+\\n?)*)`, "g");
  const sec = (h: string | undefined, m: string, s: string, ms: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0").slice(0, 3)) / 1000;
  for (const m of text.replace(/\r/g, "").matchAll(re)) out.push({ start: sec(m[1], m[2], m[3], m[4]), end: sec(m[5], m[6], m[7], m[8]), text: m[9].trim().replace(/\n+/g, " ") });
  return out;
}
