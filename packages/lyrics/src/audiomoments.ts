// Momentos de música y sesiones de DJ cuando casi no hay voz: subidas de energía tras una pausa («drops»), con parte de la preparación,
// y tramos sostenidos de máxima energía. Es una estimación a partir del volumen (no entiende música ni público): se rotula así.
import { rmsEnvelope } from "./moments.ts";

export interface AudioMoment { start: number; end: number; score: number; kind: "drop" | "peak"; why: string[] }
const mean = (a: number[], i: number, j: number) => { let s = 0, n = 0; for (let k = Math.max(0, i); k < Math.min(a.length, j); k++) { s += a[k]; n++; } return n ? s / n : 0; };

export interface AudioMomentOpts { hop?: number; minSec?: number; maxSec?: number; count?: number; prepSec?: number; duration?: number }
/** `env`: RMS por ventana de `hop` s. Devuelve momentos ordenados por puntuación, sin solaparse. */
export function audioMoments(env: number[], o: AudioMomentOpts = {}): AudioMoment[] {
  const hop = o.hop ?? 0.5, minSec = o.minSec ?? 15, maxSec = o.maxSec ?? 40, count = o.count ?? 5, prep = o.prepSec ?? 8;
  if (env.length * hop < minSec) return [];
  const sorted = [...env].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)] || 1, p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const e = env.map((v) => v / p90);   // 1 ≈ nivel alto habitual
  const W = Math.round(6 / hop), cands: AudioMoment[] = [];
  // 1) subidas: la energía de los 6 s siguientes es ≥1,7× la de los 6 s previos y alcanza el nivel alto
  for (let i = W; i + W < e.length; i++) {
    const before = mean(e, i - W, i), after = mean(e, i, i + W);
    if (after < 0.65 || after < before * 1.7) continue;
    if (!(e[i - 1] < after * 0.8)) continue;
    // el punto exacto de subida: primera ventana, hacia delante, que ya supera el 60 % del nivel posterior
    let rise = i; for (let k = i; k < i + W; k++) { if (e[k] >= after * 0.6) { rise = k; break; } }
    const start = Math.max(0, rise * hop - prep);
    // fin: hasta que la energía cae por debajo del 55 % del nivel posterior o maxSec
    let end = rise * hop + minSec - prep; while (end - start < maxSec && end / hop < e.length && mean(e, Math.round(end / hop) - 2, Math.round(end / hop)) > after * 0.55) end += hop;
    end = Math.min(end, o.duration ?? env.length * hop, start + maxSec);
    if (end - start < minSec) continue;
    const ratio = after / Math.max(0.05, before);
    cands.push({ start: +start.toFixed(1), end: +end.toFixed(1), score: Math.round(Math.min(100, 35 + 25 * Math.min(2.5, ratio) + 20 * Math.min(1.2, after))), kind: "drop",
      why: [`A los ${(rise * hop).toFixed(0)} s la energía sube ×${ratio.toFixed(1)} respecto a los 6 s anteriores`, `Incluye ${Math.min(prep, rise * hop).toFixed(0)} s de preparación previa`] });
  }
  // 2) tramos sostenidos de energía alta (cuando no hay subidas claras)
  const win = Math.round(Math.max(minSec, 20) / hop);
  for (let i = 0; i + win < e.length; i += Math.round(5 / hop)) { const m = mean(e, i, i + win); if (m >= 0.85 && p50 > 0) cands.push({ start: +(i * hop).toFixed(1), end: +((i + win) * hop).toFixed(1), score: Math.round(Math.min(90, 30 + 50 * Math.min(1.2, m))), kind: "peak", why: [`Tramo sostenido de energía alta (${Math.round(m * 100)} % del nivel habitual)`] }); }
  cands.sort((a, b) => b.score - a.score);
  const taken: AudioMoment[] = [];
  for (const c of cands) { if (taken.every((t) => c.start >= t.end || c.end <= t.start)) taken.push(c); if (taken.length >= count) break; }
  return taken.sort((a, b) => b.score - a.score);
}
/** PCM mono → momentos (atajo para el worker). */
export function audioMomentsFromPcm(pcm: Float32Array, sampleRate: number, o: AudioMomentOpts = {}): AudioMoment[] {
  return audioMoments(rmsEnvelope(pcm, sampleRate, o.hop ?? 0.5), { ...o, duration: pcm.length / sampleRate });
}
