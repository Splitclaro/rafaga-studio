// Lógica pura de la vista previa de letra: arrastre y teclado normalizados, recorte, bucle, reinicio y otra variante.
const r2 = (n: number) => Math.round(n * 100) / 100, clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export interface Pos { x: number; y: number }
/** Puntero (px del lienzo) → posición normalizada [0,1] en pasos de 0,01; fuera del lienzo se acota al borde. */
export const pointerToPosition = (px: number, py: number, frame: { width: number; height: number }): Pos => ({ x: r2(clamp01(px / frame.width)), y: r2(clamp01(py / frame.height)) });
/** Flechas del teclado: 0,01 por pulsación (Mayús: 0,05). */
export function keyNudge(pos: Pos, key: string, shift = false): Pos {
  const d = shift ? 0.05 : 0.01, dx = key === "ArrowLeft" ? -d : key === "ArrowRight" ? d : 0, dy = key === "ArrowUp" ? -d : key === "ArrowDown" ? d : 0;
  return { x: r2(clamp01(pos.x + dx)), y: r2(clamp01(pos.y + dy)) };
}
export const clampCrop = (v: number) => r2(clamp01(Number.isFinite(v) ? v : 0));
/** Tiempo de reproducción: con bucle vuelve a 0 al pasar del final; sin bucle se queda en el final. */
export const loopTime = (t: number, duration: number, loop: boolean) => (t < duration ? Math.max(0, t) : loop ? 0 : duration);
export const restart = () => 0;
/** «Otra variante»: otra semilla; la letra y el estilo no se tocan. */
export const nextVariantSeed = (seed: number) => ((seed * 1103515245 + 12345) >>> 0) % 2147483647 || 1;
