// Lyric Studio: importar letra, alinearla con el ASR del canto y planificar exactamente N variantes.
export interface TimedWord { text: string; start: number; end: number; line: number; confidence: number; origin: "asr" | "interpolated" }
export interface LyricLine { text: string; words: string[] }

/** Importa TXT, LRC, SRT o VTT a líneas de letra (sin marcas de tiempo; el alineador las recalcula). */
export function parseLyrics(raw: string): LyricLine[] {
  const lines = raw.replace(/\r/g, "").split("\n")
    .map((l) => l.replace(/^\s*\[[0-9:.]+\]\s*/g, ""))                     // LRC [mm:ss.xx]
    .filter((l) => !/^\s*\d+\s*$/.test(l))                                  // índices SRT
    .filter((l) => !/-->/.test(l) && !/^WEBVTT/i.test(l) && !/^\s*\[(ar|ti|al|by|length|offset):/i.test(l))
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .filter((l) => l.length > 0);
  return lines.map((text) => ({ text, words: text.split(/\s+/).filter(Boolean) }));
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]/g, "");

/**
 * Alinea la letra aportada (texto de verdad) con las palabras del ASR (tiempos) mediante programación dinámica
 * (Needleman-Wunsch). Las palabras sin pareja se interpolan entre vecinas emparejadas y se marcan con confianza baja.
 * Nunca inventa palabras: el resultado contiene exactamente las palabras de la letra.
 */
export function alignLyrics(lines: LyricLine[], asr: { text: string; start: number; end: number }[]): TimedWord[] {
  const L = lines.flatMap((l, li) => l.words.map((w) => ({ w, li })));
  const n = L.length, m = asr.length;
  if (!n) return [];
  const a = L.map((x) => norm(x.w)), b = asr.map((x) => norm(x.text));
  const sim = (i: number, j: number) => (a[i] && a[i] === b[j] ? 2 : a[i] && b[j] && (a[i].startsWith(b[j]) || b[j].startsWith(a[i])) && Math.min(a[i].length, b[j].length) >= 3 ? 1 : -1);
  const GAP = -1;
  const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) S[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) S[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) S[i][j] = Math.max(S[i - 1][j - 1] + sim(i - 1, j - 1), S[i - 1][j] + GAP, S[i][j - 1] + GAP);
  const match = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (S[i][j] === S[i - 1][j - 1] + sim(i - 1, j - 1)) { if (sim(i - 1, j - 1) > 0) match[i - 1] = j - 1; i--; j--; }
    else if (S[i][j] === S[i - 1][j] + GAP) i--; else j--;
  }
  const out: TimedWord[] = L.map((x, i) => match[i] >= 0
    ? { text: x.w, start: asr[match[i]].start, end: asr[match[i]].end, line: x.li, confidence: sim(i, match[i]) === 2 ? 1 : 0.6, origin: "asr" as const }
    : { text: x.w, start: NaN, end: NaN, line: x.li, confidence: 0, origin: "interpolated" as const });
  // Interpolación de huecos entre anclas (o extremos del audio)
  const total = asr.length ? asr[asr.length - 1].end : n * 0.5;
  for (let i = 0; i < n;) {
    if (!Number.isNaN(out[i].start)) { i++; continue; }
    let j = i; while (j < n && Number.isNaN(out[j].start)) j++;
    const from = i > 0 ? out[i - 1].end : 0, to = j < n ? out[j].start : total;
    const step = Math.max(0.05, (to - from) / (j - i));
    for (let k = i; k < j; k++) { out[k].start = +(from + (k - i) * step).toFixed(3); out[k].end = +(from + (k - i + 1) * step - 0.01).toFixed(3); out[k].confidence = 0.2; }
    i = j;
  }
  // Monotonía estricta
  for (let i = 1; i < n; i++) if (out[i].start < out[i - 1].end) { out[i].start = out[i - 1].end; if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.05; }
  return out;
}

/** Sin letra aportada: las palabras del ASR forman la letra (líneas por pausas >0,8 s o puntuación). */
export function lyricsFromAsr(asr: { text: string; start: number; end: number }[]): TimedWord[] {
  let line = 0;
  return asr.map((w, i) => {
    if (i && (w.start - asr[i - 1].end > 0.8 || /[.!?]$/.test(asr[i - 1].text))) line++;
    return { ...w, line, confidence: 0.8, origin: "asr" as const };
  });
}

/** PRNG reproducible (mulberry32). */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

export interface VariantSpec { index: number; style: string; background: string; seed: number }
/**
 * Plan con EXACTAMENTE n salidas. Round-robin sobre combinaciones estilo×fondo (barajadas con seed reproducible).
 * Si n supera las combinaciones distintas, se informa: las repeticiones solo cambian la seed.
 */
export function planVariants(n: number, styles: string[], backgrounds: string[], seed = 1): { variants: VariantSpec[]; distinct: number; repeats: number } {
  if (!Number.isInteger(n) || n < 1) throw new Error("N debe ser un entero positivo");
  if (!styles.length || !backgrounds.length) throw new Error("Elige al menos un estilo y un fondo");
  const combos = styles.flatMap((s) => backgrounds.map((b) => [s, b] as const));
  const r = rng(seed);
  for (let i = combos.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; }
  const variants = Array.from({ length: n }, (_, i) => ({ index: i + 1, style: combos[i % combos.length][0], background: combos[i % combos.length][1], seed: seed * 1000 + i }));
  return { variants, distinct: Math.min(n, combos.length), repeats: Math.max(0, n - combos.length) };
}
