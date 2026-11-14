// Sincronización de letra (código puro): alinear una letra aprobada con el ASR, conservar lo corregido a mano,
// banderas de revisión, ediciones palabra a palabra e importación de TXT/LRC/SRT/VTT. Reutiliza `alignLyrics` de index.ts.
import { alignLyrics, lyricsFromAsr, parseLyrics, type LyricLine } from "./index.ts";
import { parseLrc, parseSrtCues } from "./formats.ts";

export type SyncFlag = "doubtful" | "not_heard" | "vocalisation" | "sustained";
export interface SyncWord { text: string; start: number; end: number; line: number; occurrence: number; manual: boolean; confidence: number; origin: "asr" | "interpolated" | "manual" | "hint"; flags: SyncFlag[] }
export interface AsrWord { text: string; start: number; end: number }
export interface Hint { line: number; start: number; end: number | null }
export interface Instrumental { start: number; end: number }
export interface SyncResult { words: SyncWord[]; extras: AsrWord[]; instrumentals: Instrumental[] }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]/g, "");
const VOCAL = /^(o+h*|a+h+|u+h+|m+|la+|na+|ye+a+h*|eh)$/i;
const r3 = (n: number) => +n.toFixed(3);

/** Número de aparición de cada línea (por texto normalizado): el estribillo repetido cuenta 1, 2… */
export function lineOccurrences(lines: LyricLine[]): number[] {
  const seen = new Map<string, number>();
  return lines.map((l) => { const k = l.words.map(norm).join(" "); const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return n; });
}

/** Lee TXT, LRC (de línea o mejorado), SRT o VTT. Las marcas de tiempo salen como pistas (`hints`), no como verdad. */
export function importLyrics(raw: string): { format: "txt" | "lrc" | "srt" | "vtt"; lines: LyricLine[]; hints: Hint[]; words?: { line: number; text: string; start: number }[] } {
  const toLines = (texts: string[]): LyricLine[] => texts.map((text) => ({ text, words: text.split(/\s+/).filter(Boolean) }));
  if (/-->/.test(raw)) {
    const cues = parseSrtCues(raw);
    return { format: /^\s*WEBVTT/i.test(raw) ? "vtt" : "srt", lines: toLines(cues.map((c) => c.text)), hints: cues.map((c, i) => ({ line: i, start: c.start, end: c.end })) };
  }
  if (/^\s*\[\d+:\d+(?:\.\d+)?\]/m.test(raw)) {
    const ls = parseLrc(raw);
    const words = ls.flatMap((l, i) => (l.words ?? []).map((w) => ({ line: i, text: w.text, start: w.start })));
    return { format: "lrc", lines: toLines(ls.map((l) => l.text)), hints: ls.map((l, i) => ({ line: i, start: l.start, end: l.end ?? ls[i + 1]?.start ?? null })), ...(words.length ? { words } : {}) };
  }
  return { format: "txt", lines: parseLyrics(raw), hints: [] };
}

const flagsOf = (w: { text: string; start: number; end: number; confidence: number; origin: SyncWord["origin"] }): SyncFlag[] => {
  const f: SyncFlag[] = [];
  if (w.confidence < 0.5) f.push("doubtful");
  if (w.origin === "interpolated") f.push("not_heard");
  if (VOCAL.test(norm(w.text))) f.push("vocalisation");
  if (w.end - w.start > 1.5) f.push("sustained");
  return f;
};

/**
 * Alinea una letra aprobada con el ASR. Devuelve exactamente las palabras de la letra, en su orden y con su texto.
 * Las palabras `manual` de `anchors` (misma posición y mismo texto) se copian tal cual; cada hueco entre anclas se alinea
 * solo con las palabras del ASR cuyo tiempo cae en ese hueco.
 */
export function alignWithAnchors(lines: LyricLine[], asr: AsrWord[], o: { anchors?: SyncWord[]; hints?: Hint[] } = {}): SyncResult {
  const L = lines.flatMap((l, li) => l.words.map((w) => ({ w, li }))), n = L.length, occ = lineOccurrences(lines);
  const anchor = (i: number): SyncWord | null => { const a = o.anchors?.[i]; return a?.manual && norm(a.text) === norm(L[i].w) ? a : null; };
  const out: (SyncWord | null)[] = new Array(n).fill(null), used = new Set<AsrWord>();
  for (let i = 0; i < n; i++) { const a = anchor(i); if (a) out[i] = { ...a, line: L[i].li, occurrence: occ[L[i].li], flags: [] }; }
  // Huecos entre anclas
  for (let s = 0; s < n;) {
    if (out[s]) { s++; continue; }
    let e = s; while (e < n && !out[e]) e++;
    const lo = s > 0 && out[s - 1] ? out[s - 1]!.end : -Infinity, hi = e < n && out[e] ? out[e]!.start : Infinity;
    const sub = asr.filter((a) => a.start >= lo - 1e-6 && a.end <= hi + 1e-6);
    const groups: LyricLine[] = []; let cur = -1;
    for (let k = s; k < e; k++) { if (L[k].li !== cur) { cur = L[k].li; groups.push({ text: "", words: [] }); } groups.at(-1)!.words.push(L[k].w); }
    const timed = alignLyrics(groups.map((g) => ({ ...g, text: g.words.join(" ") })), sub);
    timed.forEach((t, k) => { out[s + k] = { text: L[s + k].w, start: t.start, end: t.end, line: L[s + k].li, occurrence: occ[L[s + k].li], manual: false, confidence: t.confidence, origin: t.origin, flags: [] }; });
    for (const a of sub) if (timed.some((t) => t.origin === "asr" && Math.abs(t.start - a.start) < 1e-3 && Math.abs(t.end - a.end) < 1e-3)) used.add(a);
    s = e;
  }
  const words = out as SyncWord[];
  // Las palabras interpoladas se recolocan DENTRO de su hueco real (alignLyrics interpola desde 0 si el subconjunto era pequeño)
  const audioEnd = Math.max(0, ...asr.map((a) => a.end), ...words.filter((w) => w.origin !== "interpolated").map((w) => w.end));
  for (let i = 0; i < n;) {
    if (words[i].origin !== "interpolated") { i++; continue; }
    let j = i; while (j < n && words[j].origin === "interpolated") j++;
    let from = i > 0 ? words[i - 1].end : 0;
    const hint = o.hints?.find((h) => h.line === words[i].line), firstOfLine = i === 0 || words[i - 1].line !== words[i].line;
    if (hint && firstOfLine && hint.start >= from) { from = hint.start; words.slice(i, j).forEach((w) => (w.origin = "hint")); }
    const to = j < n ? words[j].start : Math.max(audioEnd, from + (j - i) * 0.4), step = Math.max(0.05, (to - from) / (j - i));
    for (let k = i; k < j; k++) { words[k].start = r3(from + (k - i) * step); words[k].end = r3(Math.max(words[k].start + 0.04, from + (k - i + 1) * step - 0.01)); words[k].confidence = Math.min(words[k].confidence, 0.2); }
    i = j;
  }
  for (const w of words) { w.flags = flagsOf({ ...w, origin: w.origin === "hint" ? "interpolated" : w.origin }); if (w.manual) w.flags = w.flags.filter((f) => f !== "doubtful" && f !== "not_heard"); }
  const inAnchor = (a: AsrWord) => words.some((w) => w.manual && a.start >= w.start - 1e-6 && a.end <= w.end + 1e-6);
  const extras = asr.filter((a) => !used.has(a) && !inAnchor(a));
  const instrumentals: Instrumental[] = [];
  for (let i = 1; i < n; i++) if (words[i].start - words[i - 1].end > 4) instrumentals.push({ start: r3(words[i - 1].end), end: r3(words[i].start) });
  return { words, extras, instrumentals };
}

/** Vuelve a alinear tras cambiar el ASR o la letra: lo corregido a mano (misma posición y texto) no se mueve. */
export function resyncKeepingManual(prev: SyncWord[], lines: LyricLine[], asr: AsrWord[]): SyncResult {
  return alignWithAnchors(lines, asr, { anchors: prev.filter((w) => w.manual).length ? prev : undefined });
}

/** Propuesta a partir del ASR (sin letra aportada). No toca nada guardado. */
export function transcriptionProposal(asr: AsrWord[]): { text: string; words: SyncWord[] } {
  const t = lyricsFromAsr(asr), occ = new Map<number, number>();
  const lines: string[] = []; t.forEach((w) => { lines[w.line] = lines[w.line] ? `${lines[w.line]} ${w.text}` : w.text; });
  const lineWords: LyricLine[] = lines.map((text) => ({ text, words: text.split(/\s+/) }));
  lineOccurrences(lineWords).forEach((o, i) => occ.set(i, o));
  const words: SyncWord[] = t.map((w) => ({ text: w.text, start: w.start, end: w.end, line: w.line, occurrence: occ.get(w.line) ?? 1, manual: false, confidence: w.confidence, origin: "asr", flags: flagsOf({ ...w, origin: "asr" }) }));
  return { text: lines.join("\n"), words };
}

// ───────── Ediciones palabra a palabra (no tocan al resto) ─────────
const MIN = 0.02;
/** Inserta una palabra en `index`; usa el hueco libre entre vecinas (o los tiempos dados). */
export function insertWord(words: SyncWord[], index: number, text: string, at?: { start: number; end: number }): SyncWord[] {
  const prev = words[index - 1], next = words[index], start = at?.start ?? prev?.end ?? 0, room = (next?.start ?? start + 0.3) - start;
  const end = at?.end ?? start + Math.min(0.3, room);
  if (!(end - start >= MIN) || end > (next?.start ?? Infinity) + 1e-9 || start < (prev?.end ?? 0) - 1e-9) throw new Error("no_room");
  const src = prev ?? next, w: SyncWord = { text, start: r3(start), end: r3(end), line: src?.line ?? 0, occurrence: src?.occurrence ?? 1, manual: true, confidence: 1, origin: "manual", flags: [] };
  return [...words.slice(0, index), w, ...words.slice(index)];
}
export function deleteWord(words: SyncWord[], index: number): SyncWord[] { return words.filter((_, i) => i !== index); }
const touch = (w: SyncWord, start: number, end: number): SyncWord => ({ ...w, start: r3(start), end: r3(end), manual: true, origin: "manual", confidence: 1, flags: flagsOf({ text: w.text, start, end, confidence: 1, origin: "manual" }).filter((f) => f !== "doubtful") });
/** Mueve la palabra entera `delta` s sin pasar a las vecinas. */
export function nudgeWord(words: SyncWord[], index: number, delta: number): SyncWord[] {
  const w = words[index], lo = words[index - 1]?.end ?? 0, hi = words[index + 1]?.start ?? Infinity, d = Math.min(Math.max(delta, lo - w.start), hi - w.end);
  return words.map((x, i) => (i === index ? touch(x, w.start + d, w.end + d) : x));
}
/** Cambia el inicio o el final de una palabra, sin cruzar a las vecinas ni dejarla con menos de 20 ms. */
export function resizeWord(words: SyncWord[], index: number, edge: "start" | "end", value: number): SyncWord[] {
  const w = words[index], lo = words[index - 1]?.end ?? 0, hi = words[index + 1]?.start ?? Infinity;
  const start = edge === "start" ? Math.min(Math.max(value, lo), w.end - MIN) : w.start, end = edge === "end" ? Math.max(Math.min(value, hi), w.start + MIN) : w.end;
  return words.map((x, i) => (i === index ? touch(x, start, end) : x));
}

// ───────── Canción de demostración (constante; el audio se sintetiza al abrirla) ─────────
const DEMO_LYRICS = "Llueve sobre Madrid\ncanto sin mirar\n¿dónde vas ahora?\n¡vuelve a empezar!";
export const DEMO_SONG = {
  title: "Canción de demostración", artist: "Ráfaga", duration: 24, lyrics: DEMO_LYRICS,
  words: DEMO_LYRICS.split("\n").flatMap((l, li) => l.split(" ").map((text) => ({ text, li }))).map<SyncWord>(({ text, li }, k) => ({
    text, start: 2 * k, end: 2 * k + 1.2, line: li, occurrence: 1, manual: true, confidence: 1, origin: "manual", flags: [] })),
};
/** La `aevalsrc` de `song_wav` con 24 s: tono con pausas. */
export const DEMO_AUDIO_EXPR = "aevalsrc=exprs=0.5*sin(2*PI*440*t)*lt(mod(t\\,2)\\,1.2):s=44100:c=stereo:d=24";
