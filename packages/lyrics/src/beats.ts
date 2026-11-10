// Detección de tempo y beats sin dependencias: flujo espectral → autocorrelación → seguimiento por programación dinámica (Ellis, 2007).
// Pura y determinista: la misma función corre en el navegador (aviso al usuario) y en el worker (montaje). Informa de su confianza:
// con poca confianza el montaje NO se presenta como «al ritmo» y se usa una cadencia estable.
export interface BeatResult { bpm: number; confidence: number; beats: number[]; period: number }
export const BEAT_CONFIDENCE_MIN = 0.45;

const HOP = 512, WIN = 1024;
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Envolvente de inicios (onset strength): suma de aumentos de energía por bandas (escala logarítmica). */
export function onsetEnvelope(x: Float32Array, sr: number): { env: Float32Array; fps: number } {
  const frames = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1);
  const hann = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const bins = WIN / 2, bands = 32;
  const edge = Array.from({ length: bands + 1 }, (_, b) => Math.min(bins, Math.round(2 + (bins - 2) * (Math.pow(2, (b / bands) * 7) - 1) / (Math.pow(2, 7) - 1))));
  const env = new Float32Array(frames); let prev = new Float64Array(bands);
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WIN; i++) { re[i] = x[f * HOP + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const cur = new Float64Array(bands);
    for (let b = 0; b < bands; b++) { let e = 0; const lo = edge[b], hi = Math.max(edge[b + 1], lo + 1); for (let k = lo; k < hi && k < bins; k++) e += Math.hypot(re[k], im[k]); cur[b] = Math.log1p(10 * e / (hi - lo)); }
    let flux = 0; if (f > 0) for (let b = 0; b < bands; b++) flux += Math.max(0, cur[b] - prev[b]);
    env[f] = flux; prev = cur;
  }
  // Quitar la media local (≈0,5 s) y rectificar; normalizar por desviación
  const fps = sr / HOP, w = Math.max(3, Math.round(fps * 0.5)); const out = new Float32Array(frames);
  let acc = 0; for (let i = 0; i < Math.min(frames, w); i++) acc += env[i];
  for (let i = 0; i < frames; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(frames - 1, i + w);
    let s = 0; for (let k = lo; k <= hi; k++) s += env[k];
    out[i] = Math.max(0, env[i] - s / (hi - lo + 1));
  }
  void acc;
  let m = 0, v = 0; for (const e of out) m += e; m /= Math.max(1, frames); for (const e of out) v += (e - m) ** 2; const sd = Math.sqrt(v / Math.max(1, frames)) || 1;
  for (let i = 0; i < frames; i++) out[i] /= sd;
  return { env: out, fps };
}

/** Tempo por autocorrelación con una preferencia suave por ~120 BPM (evita saltos de octava). */
export function estimateTempo(env: Float32Array, fps: number): { bpm: number; confidence: number } {
  const n = env.length; if (n < fps * 4) return { bpm: 0, confidence: 0 };
  const minLag = Math.floor((60 * fps) / 200), maxLag = Math.ceil((60 * fps) / 60);
  let e0 = 0; for (let i = 0; i < n; i++) e0 += env[i] * env[i]; if (e0 <= 0) return { bpm: 0, confidence: 0 };
  const ac = new Float64Array(maxLag + 2);
  for (let l = minLag - 1; l <= maxLag + 1; l++) { let s = 0; for (let i = l; i < n; i++) s += env[i] * env[i - l]; ac[l] = s / e0 * (n / (n - l)); }
  let best = -1, bs = -Infinity;
  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * fps) / l;
    // refuerzo con múltiplos (2×, 4×): un pulso real repite a sus subarmónicos
    const sc = (ac[l] + 0.5 * (ac[l * 2] ?? 0) + 0.25 * (ac[l * 4] ?? 0)) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (sc > bs) { bs = sc; best = l; }
  }
  if (best < 0) return { bpm: 0, confidence: 0 };
  // interpolación parabólica
  const a = ac[best - 1], b = ac[best], c = ac[best + 1]; const d = a - 2 * b + c; const off = d !== 0 ? (0.5 * (a - c)) / d : 0;
  const lag = best + Math.max(-1, Math.min(1, off));
  const conf = Math.max(0, Math.min(1, (ac[best] - 0.12) / 0.4));
  return { bpm: (60 * fps) / lag, confidence: conf };
}

/** Seguimiento de beats por programación dinámica sobre la envolvente. */
export function trackBeats(env: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  const n = env.length, P = (60 * fps) / bpm; if (!n || !(P > 2)) return [];
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let bestS = 0, bestJ = -1;
    const lo = Math.max(0, Math.floor(i - 2 * P)), hi = Math.floor(i - P / 2);
    for (let j = lo; j <= hi; j++) { const s = score[j] - tightness * Math.log((i - j) / P) ** 2; if (bestJ < 0 || s > bestS) { bestS = s; bestJ = j; } }
    score[i] = env[i] + (bestJ >= 0 ? bestS : 0); back[i] = bestJ;
  }
  let end = Math.max(0, n - Math.round(P)), m = -Infinity; for (let i = end; i < n; i++) if (score[i] > m) { m = score[i]; end = i; }
  const out: number[] = []; for (let i = end; i >= 0; i = back[i]) { out.push(i); if (back[i] < 0) break; }
  return out.reverse().map((f) => (f * HOP + WIN / 2) / (fps * HOP));   // centro de la ventana, en segundos
}

export function detectBeats(x: Float32Array, sr: number): BeatResult {
  const { env, fps } = onsetEnvelope(x, sr);
  const t = estimateTempo(env, fps);
  if (!t.bpm) return { bpm: 0, confidence: 0, beats: [], period: 0 };
  const beats = trackBeats(env, fps, t.bpm);
  return { bpm: +t.bpm.toFixed(1), confidence: +t.confidence.toFixed(3), beats: beats.map((b) => +b.toFixed(3)), period: +(60 / t.bpm).toFixed(4) };
}
export const beatsReliable = (r: BeatResult) => r.bpm > 0 && r.confidence >= BEAT_CONFIDENCE_MIN && r.beats.length >= 8;
