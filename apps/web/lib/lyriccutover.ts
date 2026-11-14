// Transición v1 → v2 (puro): los Looks clásicos como presets de estilo v2, la biblioteca de vídeos con origen y la insignia «Clásica».
import { LOOKS } from "@rafaga/lyrics";
import { validateCaptionStyle, type CaptionStyleV2 } from "@rafaga/composition";
import { validateLyricSettings, type LyricUi } from "./lyricsettings.ts";

export interface ClassicPreset { id: string; name: string; description: string; style: CaptionStyleV2; settings: LyricUi }
/** `archivo`, `diario` y `panoramico` convertidos en presets «Looks clásicos»; `LOOKS` de v1 no se toca. */
export function classicPresets(): ClassicPreset[] {
  return ["archivo", "diario", "panoramico"].map((id) => {
    const look = LOOKS[id], t = look.text, tr = look.treatment, aspect = look.image.aspect;
    const style = validateCaptionStyle({ rafagaStyle: 2, font: "Inter", weight: t.weight, case: "lower", color: t.color, activeColor: t.color, effect: t.shadow > 0.3 ? "shadow" : "none", entrance: look.flow.fadeIn > 0 ? "fade" : "none", entranceBy: "word", active: "none",
      position: { x: 0.5, y: t.y }, size: t.size < 0.075 ? "S" : t.size < 0.1 ? "M" : "L", sizeFine: Math.min(1.6, Math.max(0.6, t.size / 0.06 / (t.size < 0.075 ? 0.75 : t.size < 0.1 ? 1.2 : 1.6))) });
    const settings = validateLyricSettings({ fit: aspect >= 1.7 ? "band" : "fill", crop: look.image.fit === "cover" ? 0 : 0.15, dim: Math.min(0.8, Math.max(0, 0.15 + (tr.vignette + tr.soften) * 0.2 - tr.brightness)), interval: look.montage.interval, filter: tr.desaturate > 0.8 ? "bn" : "none", shake: tr.instability > 0.3, order: "fijo" });
    return { id, name: look.name, description: look.description, style, settings };
  });
}

export type LibraryVideo = { id: string; title: string; status: string; origin: "anterior" | "v2"; download: "storage" | "export" | null; path?: string | null };
/** Une los vídeos del flujo anterior (`lyric_videos`) y las exportaciones v2. Los anteriores listos conservan su ruta de Supabase Storage. */
export function libraryVideos(legacy: { id: string; variant: number; status: string; storage_path: string | null; song_title?: string | null }[], v2: { id: string; status: string; title?: string | null }[]): LibraryVideo[] {
  const old = legacy.map<LibraryVideo>((r) => ({ id: r.id, title: `${r.song_title ?? "Canción"} · variante ${r.variant}`, status: r.status, origin: "anterior", download: r.status === "ready" && r.storage_path ? "storage" : null, path: r.storage_path }));
  const now = v2.map<LibraryVideo>((r) => ({ id: r.id, title: r.title ?? "Variante", status: r.status, origin: "v2", download: r.status === "ready" ? "export" : null }));
  return [...now, ...old];
}
export const songBadge = (s: { source_id?: string | null }): "Clásica" | null => (s.source_id ? null : "Clásica");
export const offerToV2 = (s: { source_id?: string | null }) => !!s.source_id;
