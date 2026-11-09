// Detección de los momentos más destacables de una canción SIN IA de pago: energía del audio + repetición de versos.
// Es una estimación (no un modelo de gusto): se rotula así en la interfaz.

export interface Moment { start: number; end: number; score: number; why: string[] }

/** RMS por ventana de `hop` segundos (entrada: PCM mono). */
export function rmsEnvelope(pcm: Float32Array, sampleRate: number, hop = 0.5): number[] {
  const n = Math.max(1, Math.floor(sampleRate * hop));
  const out: number[] = [];
  for (let i = 0; i + n <= pcm.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += pcm[j] * pcm[j]; out.push(Math.sqrt(s / n)); }
  return out;
}

/** Picos para dibujar la forma de onda (valor absoluto máximo por columna). */
export function peaks(pcm: Float32Array, columns: number): number[] {
  const step = Math.max(1, Math.floor(pcm.length / columns));
  const out: number[] = [];
  for (let c = 0; c < columns; c++) { let m = 0; const a = c * step, b = Math.min(pcm.length, a + step); for (let i = a; i < b; i += 8) { const v = Math.abs(pcm[i]); if (v > m) m = v; } out.push(m); }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, "").trim();

/** Intervalos (s) de versos que se repiten ≥2 veces en la letra alineada. */
export function repeatedLineSpans(words: { text: string; start: number; end: number; line: number }[]): { start: number; end: number }[] {
  const lines = new Map<number, { text: string; start: number; end: number }>();
  for (const w of words) { const l = lines.get(w.line); if (l) { l.text += " " + w.text; l.end = w.end; } else lines.set(w.line, { text: w.text, start: w.start, end: w.end }); }
  const byText = new Map<string, number>();
  for (const l of lines.values()) { const k = norm(l.text); if (k.split(" ").length >= 3) byText.set(k, (byText.get(k) ?? 0) + 1); }
  return [...lines.values()].filter((l) => (byText.get(norm(l.text)) ?? 0) >= 2).map((l) => ({ start: l.start, end: l.end }));
}

/**
 * Los k mejores tramos de `len` s: puntúa energía media (70 %), estabilidad (10 %) y repetición de versos (20 %).
 * Los tramos no se solapan y se ajustan a un silencio cercano para no cortar a mitad de nota.
 */
export function topMoments(env: number[], o: { hop?: number; len?: number; k?: number; repeated?: { start: number; end: number }[]; duration?: number } = {}): Moment[] {
  const hop = o.hop ?? 0.5, len = o.len ?? 30, k = o.k ?? 3;
  const win = Math.max(2, Math.round(len / hop));
  if (env.length < win) return env.length ? [{ start: 0, end: +(env.length * hop).toFixed(1), score: 0, why: ["La canción es más corta que el tramo pedido"] }] : [];
  const max = Math.max(...env) || 1;
  const e = env.map((v) => v / max);
  const cand: { i: number; score: number; mean: number; rep: number }[] = [];
  for (let i = 0; i + win <= e.length; i++) {
    let sum = 0, sq = 0; for (let j = i; j < i + win; j++) { sum += e[j]; sq += e[j] * e[j]; }
    const mean = sum / win, sd = Math.sqrt(Math.max(0, sq / win - mean * mean));
    let rep = 0;
    if (o.repeated?.length) { const a = i * hop, b = (i + win) * hop; let ov = 0; for (const r of o.repeated) ov += Math.max(0, Math.min(b, r.end) - Math.max(a, r.start)); rep = Math.min(1, ov / (b - a)); }
    cand.push({ i, mean, rep, score: 0.7 * mean + 0.1 * (1 - Math.min(1, sd * 2)) + 0.2 * rep });
  }
  cand.sort((x, y) => y.score - x.score);
  const taken: typeof cand = [];
  for (const c of cand) { if (taken.every((t) => Math.abs(t.i - c.i) >= win)) taken.push(c); if (taken.length >= k) break; }
  const quietest = (idx: number, radius: number) => { let best = idx, bv = Infinity; for (let j = Math.max(0, idx - radius); j <= Math.min(e.length - 1, idx + radius); j++) if (e[j] < bv) { bv = e[j]; best = j; } return best; };
  return taken.sort((a, b) => b.score - a.score).map((c) => {
    const s = quietest(c.i, 3) * hop;
    const end = Math.min(o.duration ?? e.length * hop, s + len);
    const why = [`Energía media ${Math.round(c.mean * 100)} % del máximo de la canción`];
    if (c.rep > 0.3) why.push("Contiene versos que se repiten (estribillo probable)");
    return { start: +s.toFixed(1), end: +end.toFixed(1), score: Math.round(c.score * 100), why };
  });
}
