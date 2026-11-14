// Ajustes de fondo y de imagen de Lyric Studio (puro): validación, filtros con etiquetas propias, clasificación y paquetes oficiales.
import type { LyricComposition } from "@rafaga/composition";

export const FILTER_OPTIONS = [["none", "Ninguno"], ["noche", "Noche"], ["super8", "Super 8"], ["bn", "Blanco y negro"], ["vapor", "Vapor"]] as const;
export type FilterId = (typeof FILTER_OPTIONS)[number][0];
export interface LyricUi { crop: number; dim: number; interval: number; sizeFine: number; filter: FilterId; fit: "preserve" | "fill" | "band"; order: "aleatorio" | "fijo"; loop: boolean; shake: boolean; blend: number; variation: number; color: string }
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Valida los ajustes de la interfaz: recorte 0–1, oscurecer 0–0,8, intervalo 2–15 s, tamaño fino 0,6–1,6; filtro desconocido → ninguno. */
export function validateLyricSettings(raw: unknown): LyricUi {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    crop: num(o.crop, 0, 1, 0), dim: num(o.dim, 0, 0.8, 0.2), interval: num(o.interval, 2, 15, 3), sizeFine: num(o.sizeFine, 0.6, 1.6, 1),
    filter: FILTER_OPTIONS.some(([id]) => id === o.filter) ? (o.filter as FilterId) : "none", fit: o.fit === "fill" || o.fit === "band" ? o.fit : "preserve",
    order: o.order === "fijo" ? "fijo" : "aleatorio", loop: o.loop !== false, shake: o.shake === true, blend: num(o.blend, 0, 2, 0), variation: Math.round(num(o.variation, 0, 100, 0)),
    color: typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toUpperCase() : "#000000",
  };
}
/** Aplica los ajustes a una composición: solo cambian `background` y `settings`; letra, estilo, tramo y semilla quedan idénticos. */
export function settingsToComposition(c: LyricComposition, ui: LyricUi): LyricComposition {
  const u = validateLyricSettings(ui);
  return { ...c, background: { ...c.background, color: u.color, interval: u.interval, order: u.order, loop: u.loop, fit: u.fit },
    settings: { ...c.settings, crop: u.crop, dim: u.dim, filter: u.filter, shake: u.shake, blend: u.blend, variation: u.variation } };
}
export const orientationOf = (w: number, h: number): "vertical" | "horizontal" | "cuadrado" => (Math.abs(w - h) / Math.max(w, h, 1) < 0.05 ? "cuadrado" : h > w ? "vertical" : "horizontal");
export interface MediaClass { category?: string | null; motion?: string | null; mood?: string | null; width?: number | null; height?: number | null }
/** Devuelve solo los elementos que cumplen TODOS los filtros elegidos (los no elegidos no filtran). */
export function filterByClass<T extends MediaClass>(items: T[], f: { category?: string; motion?: string; mood?: string; orientation?: "vertical" | "horizontal" | "cuadrado" }): T[] {
  return items.filter((i) => (!f.category || i.category === f.category) && (!f.motion || i.motion === f.motion) && (!f.mood || i.mood === f.mood) && (!f.orientation || (i.width && i.height && orientationOf(i.width, i.height) === f.orientation)));
}
export const OFFICIAL_EMPTY = "Todavía no hay colecciones Ráfaga. Para crear una, abre uno de tus paquetes de medios y márcalo como oficial: aparecerá aquí.";
export function officialCollections<T extends { official?: boolean | null }>(rows: T[]): { items: T[]; empty: string | null } {
  const items = rows.filter((r) => r.official === true);
  return items.length ? { items, empty: null } : { items: [], empty: OFFICIAL_EMPTY };
}
