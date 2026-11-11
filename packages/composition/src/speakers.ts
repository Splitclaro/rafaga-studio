// Hablantes detectados (diarización del reconocimiento de voz) y reencuadre que sigue al que habla.
// Puro y determinista: el editor y el export usan la misma trayectoria `reframe.kf`, así que vista previa = export.
import type { Word } from "./subtitles.ts";
import type { ReframeKf } from "./reframe.ts";

export interface SpeakerStat { speaker: number; words: number; seconds: number; share: number }
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Palabras y tiempo de habla por hablante. Vacío si la transcripción no tiene diarización. */
export function speakerStats(words: Word[]): SpeakerStat[] {
  const m = new Map<number, { words: number; seconds: number }>();
  for (const w of words) if (typeof w.speaker === "number") { const a = m.get(w.speaker) ?? { words: 0, seconds: 0 }; a.words++; a.seconds += Math.max(0, w.end - w.start); m.set(w.speaker, a); }
  const total = [...m.values()].reduce((t, a) => t + a.seconds, 0) || 1;
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([speaker, a]) => ({ speaker, words: a.words, seconds: r3(a.seconds), share: a.seconds / total }));
}

export interface Run { speaker: number; start: number; end: number }
/** Tramos continuos de cada hablante. Las pausas cortas no parten un tramo y los tramos más cortos que `minRun` se funden con el anterior. */
export function speakerRuns(words: Word[], minRun = 1.2, maxGap = 1.0): Run[] {
  const runs: Run[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (typeof w.speaker !== "number") continue;
    const p = runs[runs.length - 1];
    if (p && p.speaker === w.speaker && w.start - p.end <= maxGap) p.end = Math.max(p.end, w.end); else runs.push({ speaker: w.speaker, start: w.start, end: w.end });
  }
  const out: Run[] = [];
  for (const r of runs) {
    const p = out[out.length - 1];
    if (p && r.end - r.start < minRun) { p.end = Math.max(p.end, r.end); continue; }   // interjección breve: se queda el plano del que hablaba
    if (p && p.speaker === r.speaker) { p.end = Math.max(p.end, r.end); continue; }
    out.push({ ...r });
  }
  return out;
}

/** Posiciones por defecto: hablantes repartidos de izquierda a derecha. */
export function defaultSpeakerX(speakers: number[]): Record<number, number> {
  const s = [...new Set(speakers)].sort((a, b) => a - b), n = s.length;
  return Object.fromEntries(s.map((id, i) => [id, n === 1 ? 0.5 : clamp(0.2 + (0.6 * i) / (n - 1), 0, 1)]));
}

/** Trayectoria de recorte horizontal que va al hablante activo (x con la semántica de `crop.x`). `glide` = duración del desplazamiento entre planos. */
export function planSpeakerReframe(words: Word[], xBySpeaker: Record<number, number>, len: number, o: { glide?: number; minRun?: number } = {}): ReframeKf[] {
  const glide = o.glide ?? 0.45, runs = speakerRuns(words, o.minRun ?? 1.2).filter((r) => typeof xBySpeaker[r.speaker] === "number");
  if (!runs.length) return [];
  const kf: ReframeKf[] = [{ t: 0, x: clamp(xBySpeaker[runs[0].speaker], 0, 1) }];
  const push = (t: number, x: number) => { const l = kf[kf.length - 1]; if (t <= l.t + 0.01) t = l.t + 0.02; if (t < len) kf.push({ t: r3(t), x: r3(clamp(x, 0, 1)) }); };
  for (let i = 1; i < runs.length; i++) {
    const prev = clamp(xBySpeaker[runs[i - 1].speaker], 0, 1), nx = clamp(xBySpeaker[runs[i].speaker], 0, 1);
    if (Math.abs(nx - prev) < 0.01) continue;
    const mid = (runs[i - 1].end + runs[i].start) / 2;           // el cambio ocurre en la pausa entre ambos, no en medio de una frase
    push(mid - glide / 2, prev); push(mid + glide / 2, nx);
  }
  const last = kf[kf.length - 1];
  if (last.t < len) kf.push({ t: r3(len), x: last.x });
  return kf;
}
