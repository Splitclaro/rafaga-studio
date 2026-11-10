// «Más versiones como esta»: variantes derivadas de un vídeo ya generado con elementos bloqueados, y sustitución de un plano concreto.
// Audio, tramo y letra son siempre los de la canción (no se tocan); se pueden bloquear estilo, fondo/colección y montaje (planos).
import { planVariants, rng, type VariantSpec } from "./index.ts";
import type { Shot, ShotItem } from "./looks.ts";

export interface MoreLock { style: boolean; background: boolean; shots: boolean }
export interface SavedShot { start: number; dur: number; entry: number; src: string | null }

/** Con todo bloqueado solo cambiaría la semilla de grano/posición: se trata como copia y no se ofrece. */
export function moreIsCopy(l: MoreLock) { return l.style && l.background && l.shots; }

/**
 * N variantes nuevas a partir de una base. Lo bloqueado se mantiene; lo libre se reparte entre los estilos/fondos del grupo.
 * Nunca reutiliza la semilla de la base, y evita (si hay alternativa) repetir la combinación estilo+fondo de la base.
 */
export function planMore(base: { style: string; background: string; seed: number }, n: number, lock: MoreLock, pools: { styles: string[]; backgrounds: string[] }, seed: number): VariantSpec[] {
  if (moreIsCopy(lock)) throw new Error("Desbloquea al menos estilo, fondo o planos para crear versiones distintas.");
  const styles = lock.style || !pools.styles.length ? [base.style] : pools.styles;
  const backgrounds = lock.background || !pools.backgrounds.length ? [base.background] : pools.backgrounds;
  // Se pide una de más y se descarta la combinación idéntica a la base si existe otra posible
  const hasAlt = styles.length * backgrounds.length > 1;
  const plan = planVariants(n + (hasAlt ? 1 : 0), styles, backgrounds, seed).variants;
  const pick = hasAlt ? plan.filter((v) => !(v.style === base.style && v.background === base.background)).slice(0, n) : plan.slice(0, n);
  const filled = pick.length >= n ? pick : [...pick, ...plan.filter((v) => !pick.includes(v))].slice(0, n);
  return filled.map((v, i) => ({ ...v, index: i + 1, seed: v.seed === base.seed ? v.seed + 7919 : v.seed }));
}

/** Reconstruye los planos guardados contra los clips actuales. Devuelve null si algo no cuadra (otro tramo, clip borrado, sin identidad). */
export function restoreShots(saved: SavedShot[] | null | undefined, items: ShotItem[], srcs: (string | null)[], len: number): Shot[] | null {
  if (!saved?.length || items.length !== srcs.length) return null;
  const out: Shot[] = [];
  for (const s of saved) {
    if (!s.src) return null;
    const k = srcs.indexOf(s.src);
    if (k < 0) return null;
    out.push({ item: items[k], start: s.start, dur: s.dur, entry: s.entry });
  }
  const last = out[out.length - 1];
  if (!last || Math.abs(last.start + last.dur - len) > 0.15) return null;   // el tramo cambió: los cortes ya no valen
  return out;
}

/**
 * Cambia solo los planos indicados: otro clip distinto del actual y de sus vecinos si hay alternativa, con otro punto de entrada.
 * `changed` es false si no se pudo cambiar nada (un único clip y es foto).
 */
export function swapShots(shots: Shot[], indices: number[], items: ShotItem[], seed: number): { shots: Shot[]; changed: number[] } {
  const r = rng(seed), out = shots.map((s) => ({ ...s })), changed: number[] = [];
  for (const i of [...new Set(indices)].filter((x) => x >= 0 && x < out.length)) {
    const cur = out[i], avoid = new Set([cur.item, out[i - 1]?.item, out[i + 1]?.item]);
    let pool = items.filter((it) => !avoid.has(it));
    if (!pool.length) pool = items.filter((it) => it !== cur.item);
    const it = pool.length ? pool[Math.floor(r() * pool.length)] : cur.item;
    const room = it.kind === "video" && it.duration ? Math.max(0, it.duration - cur.dur - 0.1) : 0;
    const entry = room ? +(room * r()).toFixed(2) : 0;
    if (it !== cur.item || (room > 0.3 && Math.abs(entry - cur.entry) > 0.3)) { out[i] = { ...cur, item: it, entry }; changed.push(i); }
  }
  return { shots: out, changed };
}
