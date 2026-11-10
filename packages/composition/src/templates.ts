import { PRESETS, type SubtitleStyle } from "./subtitles.ts";

/** Plantillas iniciales de estilo (propias). Cada una reúne subtítulos, look de letra, encuadre, montaje y formatos; el usuario las adapta y guarda como kit. */
export interface StyleTemplate {
  id: string; name: string; description: string; sector: string;
  subtitle: string | null;                                   // nombre de preset de subtítulos para clips
  lyric: { look: "archivo" | "diario" | "panoramico" | null; style: string | null } | null;   // look de referencia o preset de letra
  layout: "blur" | "fill" | "fit";
  montage: "continuo" | "frases" | "fotos";                  // frases = cortes de fondo en cambios de frase de la letra (no «al beat»)
  ratios: string[];
  colors: Record<string, string>;
  note?: string;                                             // limitación honesta
}
export const TEMPLATES: StyleTemplate[] = [
  { id: "podcast-limpio", name: "Podcast limpio", sector: "Podcast", description: "Subtítulos claros por frase sobre el vídeo completo con fondo desenfocado. Legible y sobrio.", subtitle: "Limpio", lyric: null, layout: "blur", montage: "continuo", ratios: ["9:16"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" } },
  { id: "podcast-dinamico", name: "Podcast dinámico", sector: "Podcast", description: "Palabra activa y palabras clave resaltadas (cifras y palabras largas) con entrada rápida.", subtitle: "Palabras clave", lyric: null, layout: "fill", montage: "continuo", ratios: ["9:16", "1:1"], colors: { primary: "#111111", accent: "#FFD400", text: "#FFFFFF", background: "#000000" } },
  { id: "artista-editorial", name: "Artista editorial", sector: "Artista", description: "Imagen contenida sobre negro y letra blanca discreta, con subtítulos en cursiva suave.", subtitle: "Cine", lyric: { look: "diario", style: null }, layout: "fit", montage: "frases", ratios: ["9:16", "4:5"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" } },
  { id: "lyrics-minimal", name: "Lyrics minimal", sector: "Artista", description: "Letra en minúsculas que aparece al cantarse, sin contorno ni caja.", subtitle: "Letra", lyric: { look: null, style: "Tune" }, layout: "blur", montage: "frases", ratios: ["9:16"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" } },
  { id: "lyrics-karaoke", name: "Lyrics karaoke", sector: "Artista", description: "Palabra activa en amarillo sobre caja oscura, pensada para cantar encima.", subtitle: "Karaoke con caja", lyric: { look: null, style: "Karaoke con caja" }, layout: "blur", montage: "frases", ratios: ["9:16"], colors: { primary: "#111111", accent: "#FFD400", text: "#FFFFFF", background: "#000000" } },
  { id: "montaje-musical", name: "Montaje musical", sector: "Discográfica", description: "Archivo analógico: textura VHS suave, imagen a pantalla completa y cortes en cambios de frase.", subtitle: "Cine", lyric: { look: "archivo", style: null }, layout: "fill", montage: "frases", ratios: ["4:3", "9:16"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" }, note: "Los cortes siguen las frases de la letra; el montaje «al ritmo» (beats) aún no está disponible." },
  { id: "campana-marca", name: "Campaña de marca", sector: "Agencia", description: "Caja negra con texto blanco, logo en una esquina y varios formatos para campaña.", subtitle: "Caja negra", lyric: null, layout: "blur", montage: "continuo", ratios: ["9:16", "1:1", "16:9"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" }, note: "Añade el logo y los colores de tu marca después de crear el kit." },
  { id: "fotos-movimiento", name: "Fotos en movimiento", sector: "Artista", description: "Banda panorámica con tus fotos y letra blanca anclada a la imagen.", subtitle: "Letra suave", lyric: { look: "panoramico", style: null }, layout: "fit", montage: "fotos", ratios: ["9:16"], colors: { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" }, note: "Las fotos se muestran fijas con corte por frase; el movimiento (zoom/paneo) aún no está implementado." },
];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;
/** Contenido de un brand kit creado desde una plantilla. */
export function kitFromTemplate(t: StyleTemplate): { name: string; colors: Record<string, string>; subtitle_style: SubtitleStyle | null; config: Record<string, unknown> } {
  const st = t.subtitle ? PRESETS[t.subtitle] : null;
  return { name: t.name, colors: { ...t.colors }, subtitle_style: st ? structuredClone(st) : null,
    config: { template: t.id, layout: t.layout, montage: t.montage, export: { ratios: t.ratios, res: 1080 }, ...(t.lyric ? { lyric: t.lyric } : {}) } };
}
