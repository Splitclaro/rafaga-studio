/** Elige el mejor fotograma de varios candidatos (gris 8 bits): evita negro/quemado y prefiere detalle (varianza). */
export function frameScore(gray: Uint8Array): number {
  const n = gray.length; if (!n) return -1;
  let sum = 0; for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n; let v = 0; for (let i = 0; i < n; i++) { const d = gray[i] - mean; v += d * d; }
  const variance = v / n;
  if (mean < 22 || mean > 238) return variance * 0.05;       // casi negro o casi blanco: último recurso
  // detalle local (bordes): diferencia media con el vecino de la derecha
  let edge = 0; for (let i = 1; i < n; i++) edge += Math.abs(gray[i] - gray[i - 1]); edge /= n;
  return variance * 0.5 + edge * 20;
}
export function pickFrame(grays: Uint8Array[]): number {
  let best = 0, bs = -Infinity; grays.forEach((g, i) => { const s = frameScore(g); if (s > bs) { bs = s; best = i; } });
  return best;
}
