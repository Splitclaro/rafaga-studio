// Zonas seguras de TikTok, Instagram Reels y YouTube Shorts en 9:16 (1080×1920). Solo se DIBUJAN en la vista previa (nunca salen en el vídeo)
// y sirven para colocar textos y avisar si alguno invade la interfaz de la plataforma.
//
// ATENCIÓN — origen de los valores (medido el 2026-11-13): ninguna de las tres plataformas publica márgenes exactos en píxeles para vídeo orgánico;
// publican plantillas descargables (Creative Center de TikTok, ayuda de anuncios de Meta y de Google) y las guías de terceros discrepan entre sí
// (p. ej. zona inferior de TikTok entre 250 y 660 px; de Reels entre 250 y 672 px). Por eso cada entrada lleva `note: "medido por nosotros, revisar"`
// y usa un valor DENTRO del rango citado, inclinado a la prudencia. El propietario las revisa con las plantillas oficiales (lista de lanzamiento LC-15).
export const SAFE_ZONES_VERSION = 1;
export type Platform = "tiktok" | "instagram_reels" | "youtube_shorts";
export interface Rect { x: number; y: number; w: number; h: number }          // normalizado 0..1 sobre el fotograma
export interface Unsafe { id: "top" | "bottom" | "right" | "left"; rect: Rect }
export interface SafeZone { platform: Platform; aspect: "9:16"; unsafe: Unsafe[]; source?: string; note?: string; references: string[]; measured_on: string }

const mk = (top: number, bottom: number, right: number, left: number): Unsafe[] => [
  { id: "top", rect: { x: 0, y: 0, w: 1, h: top } },
  { id: "bottom", rect: { x: 0, y: 1 - bottom, w: 1, h: bottom } },
  { id: "right", rect: { x: 1 - right, y: top, w: right, h: 1 - top - bottom } },
  { id: "left", rect: { x: 0, y: top, w: left, h: 1 - top - bottom } },
];
const NOTE = "medido por nosotros, revisar";
export const SAFE_ZONES: Record<Platform, SafeZone> = {
  // TikTok: guías citan arriba 120–240 px, abajo 250–660 px, derecha 120–164 px, izquierda 50–60 px (1080×1920).
  tiktok: { platform: "tiktok", aspect: "9:16", unsafe: mk(0.125, 0.30, 0.11, 0.055), note: NOTE, measured_on: "2026-11-13",
    references: ["https://www.socialync.io/tools/safe-zones/tiktok", "https://adkit.so/tools/safe-zones/tiktok", "https://www.manypixels.co/blog/social-media-design/tiktok-ad-specs"] },
  // Instagram Reels: arriba ≈250 px (14 %), abajo 250–340 px (hasta el 35–40 % con aviso legal), derecha ≈60–120 px.
  instagram_reels: { platform: "instagram_reels", aspect: "9:16", unsafe: mk(0.13, 0.22, 0.08, 0.04), note: NOTE, measured_on: "2026-11-13",
    references: ["https://www.socialync.io/tools/safe-zones/instagram-reels", "https://adkit.so/tools/safe-zones/instagram", "https://postsyncer.com/tips/instagram-reels-size-and-safe-areas"] },
  // YouTube Shorts: arriba 180–288 px, abajo ≈380 px (20 %) o más con el botón de anuncio, derecha ≈120 px.
  youtube_shorts: { platform: "youtube_shorts", aspect: "9:16", unsafe: mk(0.12, 0.20, 0.11, 0.04), note: NOTE, measured_on: "2026-11-13",
    references: ["https://www.socialync.io/tools/safe-zones/youtube-shorts", "https://adkit.so/tools/safe-zones/youtube", "https://www.poster.ly/tools/youtube-shorts-safe-zone-checker"] },
};
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram_reels: "Instagram Reels", youtube_shorts: "YouTube Shorts" };

/** Área segura común a todas las plataformas elegidas: lo que queda tras quitar los márgenes de cada una (intersección). */
export function safeArea(platforms: Platform[]): Rect {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (const p of platforms) for (const u of SAFE_ZONES[p].unsafe) {
    if (u.id === "top") top = Math.max(top, u.rect.h); else if (u.id === "bottom") bottom = Math.max(bottom, u.rect.h);
    else if (u.id === "left") left = Math.max(left, u.rect.w); else right = Math.max(right, u.rect.w);
  }
  return { x: left, y: top, w: 1 - left - right, h: 1 - top - bottom };
}
const inter = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Cajas de texto (titular, subtítulos) que invaden algún rectángulo inseguro de las plataformas elegidas. */
export function validateSafeZones(boxes: { id: string; rect: Rect }[], platforms: Platform[]): { box: string; platform: Platform; zone: Unsafe["id"] }[] {
  const out: { box: string; platform: Platform; zone: Unsafe["id"] }[] = [];
  for (const p of platforms) for (const u of SAFE_ZONES[p].unsafe) for (const b of boxes) if (inter(b.rect, u.rect) > 1e-6) out.push({ box: b.id, platform: p, zone: u.id });
  return out;
}
