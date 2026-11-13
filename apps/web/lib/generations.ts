// Parámetros de una generación: validación, rangos de duración, estimación de unidades y resumen. Pura y sin red.
export const MODES = ["automatico", "por_tema", "pregunta_respuesta", "educativo", "historia", "destacados", "manual"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = { automatico: "Automático", por_tema: "Por tema", pregunta_respuesta: "Pregunta y respuesta", educativo: "Educativo", historia: "Historia o anécdota", destacados: "Destacados", manual: "Manual" };

/** Rangos de duración de cada clip, en segundos. La etiqueta «Auto» del panel dice «10 s–3 min». */
export const DURATION_BUCKETS = { auto: [10, 180], lt30: [10, 30], "30_60": [30, 60], "60_90": [60, 90], "90_180": [90, 180] } as const;
export type Bucket = keyof typeof DURATION_BUCKETS;
export const BUCKET_LABEL: Record<Bucket, string> = { auto: "Auto (10 s–3 min)", lt30: "Menos de 30 s", "30_60": "30–60 s", "60_90": "60–90 s", "90_180": "90 s–3 min" };

export const RECIPES = ["clips", "captions", "reframe", "cleanup"] as const;
export type Recipe = (typeof RECIPES)[number];
export const RECIPE_LABEL: Record<Recipe, string> = { clips: "Clips de vídeo largo", captions: "Solo subtítulos", reframe: "Solo reencuadre", cleanup: "Limpiar grabación" };

/** Plantillas virales (composición del paso 13). Los ids cumplen `^[a-z0-9_]{1,40}$` como exige clip_versions.template. */
export const VIRAL_TEMPLATES = ["titular_video_subtitulos", "pantalla_dividida", "hablante_seguimiento", "cambio_hablante", "presentacion_ponente", "presentacion_sola", "titular_en_caja", "titular_sobre_desenfoque", "video_completo"] as const;
export const TEMPLATE_LABEL: Record<string, string> = { titular_video_subtitulos: "Titular + vídeo + subtítulos", pantalla_dividida: "Pantalla dividida (2 hablantes)", hablante_seguimiento: "Hablante con seguimiento", cambio_hablante: "Cambio de hablante activo", presentacion_ponente: "Presentación + ponente", presentacion_sola: "Presentación sola", titular_en_caja: "Titular en caja", titular_sobre_desenfoque: "Titular sobre desenfoque", video_completo: "Vídeo completo ajustado" };
export const ASPECTS = ["9:16", "16:9", "1:1"] as const;

export const CAPTION_PRESETS = ["palabra_a_palabra", "corte_por_palabra", "barrido_marcador", "palabras_clave", "karaoke", "caja", "contorno", "neon"] as const;
export interface CaptionStyle { preset: (typeof CAPTION_PRESETS)[number]; font: string; color: string; active_color: string; outline_color: string; size: "S" | "M" | "L"; position: "top" | "middle" | "bottom"; y?: number }
export const CAPTION_DEFAULT: CaptionStyle = { preset: "palabra_a_palabra", font: "Inter", color: "#FFFFFF", active_color: "#FFD60A", outline_color: "#000000", size: "M", position: "bottom" };
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface GenerationParams {
  recipe: Recipe; mode: Mode; count: number | null; duration: Bucket; range_start_ms: number; range_end_ms: number;
  language: "auto" | "es" | "en"; subtitle_language?: string; brief?: string; exclude?: string; aspect: (typeof ASPECTS)[number]; template?: string;
  subtitles: boolean; caption_style?: CaptionStyle; hook?: { enabled: boolean; top_n: number; template?: string }; brand_kit_id?: string;
  component_versions?: Record<string, string>; min_s?: number; max_s?: number;
}

export interface Invalid { field: string; message: string }
const bad = (field: string, message: string): { ok: false; error: Invalid } => ({ ok: false, error: { field, message } });

export function validateParams(p: unknown, sourceDurationS: number): { ok: true; params: GenerationParams } | { ok: false; error: Invalid } {
  const x = (p ?? {}) as Record<string, unknown>;
  const recipe = (x.recipe ?? "clips") as Recipe; if (!RECIPES.includes(recipe)) return bad("recipe", "Receta desconocida.");
  const mode = (x.mode ?? "automatico") as Mode; if (!MODES.includes(mode)) return bad("mode", "Modo de selección desconocido.");
  const duration = (x.duration ?? "auto") as Bucket; if (!(duration in DURATION_BUCKETS)) return bad("duration", "Rango de duración desconocido.");
  const count = x.count == null || x.count === "auto" ? null : Number(x.count);
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 20)) return bad("count", "Pide entre 1 y 20 clips, o deja la selección automática.");
  const start = Number(x.range_start_ms ?? 0), end = Number(x.range_end_ms ?? Math.round(sourceDurationS * 1000));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Math.round(sourceDurationS * 1000) + 500) return bad("range", "El tramo está fuera del vídeo.");
  const language = (x.language ?? "auto") as string; if (!["auto", "es", "en"].includes(language)) return bad("language", "Idioma no admitido.");
  const aspect = (x.aspect ?? "9:16") as string; if (!(ASPECTS as readonly string[]).includes(aspect)) return bad("aspect", "Formato no admitido.");
  const template = x.template == null || x.template === "" ? undefined : String(x.template);
  if (template && !/^[a-z0-9_]{1,40}$/.test(template)) return bad("template", "Plantilla no válida.");
  const brief = x.brief == null ? undefined : String(x.brief); if (brief && brief.length > 2000) return bad("brief", "El encargo supera los 2.000 caracteres.");
  const exclude = x.exclude == null ? undefined : String(x.exclude); if (exclude && exclude.length > 1000) return bad("exclude", "Las exclusiones superan los 1.000 caracteres.");
  let caption_style: CaptionStyle | undefined;
  if (x.caption_style != null) {
    const c = { ...CAPTION_DEFAULT, ...(x.caption_style as object) } as CaptionStyle;
    if (!CAPTION_PRESETS.includes(c.preset)) return bad("caption_style.preset", "Estilo de subtítulos desconocido.");
    for (const k of ["color", "active_color", "outline_color"] as const) if (!HEX.test(c[k])) return bad(`caption_style.${k}`, "Color no válido (usa #RRGGBB).");
    if (!["S", "M", "L"].includes(c.size) || !["top", "middle", "bottom"].includes(c.position) || typeof c.font !== "string" || c.font.length > 60) return bad("caption_style", "Estilo de subtítulos no válido.");
    caption_style = c;
  }
  const h = x.hook as { enabled?: boolean; top_n?: number; template?: string } | undefined;
  const hook = h ? { enabled: h.enabled === true, top_n: Math.max(0, Math.min(20, Math.floor(Number(h.top_n ?? 0)))), ...(h.template ? { template: String(h.template).slice(0, 40) } : {}) } : undefined;
  const [min_s, max_s] = DURATION_BUCKETS[duration];
  return { ok: true, params: { recipe, mode, count, duration, range_start_ms: Math.round(start), range_end_ms: Math.round(end), language: language as GenerationParams["language"], ...(typeof x.subtitle_language === "string" ? { subtitle_language: x.subtitle_language.slice(0, 8) } : {}),
    ...(brief ? { brief } : {}), ...(exclude ? { exclude } : {}), aspect: aspect as GenerationParams["aspect"], ...(template ? { template } : {}), subtitles: x.subtitles !== false, ...(caption_style ? { caption_style } : {}), ...(hook ? { hook } : {}),
    ...(typeof x.brand_kit_id === "string" && /^[0-9a-f-]{36}$/.test(x.brand_kit_id) ? { brand_kit_id: x.brand_kit_id } : {}), min_s, max_s } };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export interface Estimate { processing: number; clipping: number; subtitles: number; hook: number; total: number }
/** Unidades: análisis 1.0/min (0 si ya existe), selección 0.2/min, subtítulos 0, gancho 0.1 × clips con extras (cada clip cuenta como 1 minuto). */
export function estimateUnits(o: { minutes: number; hasAnalysis: boolean; hook?: { enabled: boolean; top_n: number } | null }): Estimate {
  const processing = o.hasAnalysis ? 0 : r2(o.minutes * 1.0), clipping = r2(o.minutes * 0.2);
  const hook = o.hook?.enabled ? r2(0.1 * o.hook.top_n) : 0;
  return { processing, clipping, subtitles: 0, hook, total: r2(processing + clipping + hook) };
}
/** Cuántos clips caben como máximo: tramo ÷ duración mínima. El número pedido es un objetivo, no una promesa. */
export const viableCount = (rangeS: number, minS: number) => Math.max(0, Math.floor(rangeS / minS));

export function summary(p: GenerationParams): string[] {
  const mins = Math.round((p.range_end_ms - p.range_start_ms) / 60000 * 10) / 10;
  return [`${RECIPE_LABEL[p.recipe]} · ${MODE_LABEL[p.mode]}`, `Tramo de ${mins} min`, `Clips de ${BUCKET_LABEL[p.duration]}${p.count ? ` · hasta ${p.count}` : " · los que haya"}`,
    p.subtitles ? `Subtítulos: ${p.caption_style?.preset ?? CAPTION_DEFAULT.preset}` : "Sin subtítulos", `Formato ${p.aspect}${p.template ? ` · ${TEMPLATE_LABEL[p.template] ?? p.template}` : ""}`,
    ...(p.hook?.enabled ? [`Gancho en los ${p.hook.top_n} mejores`] : [])];
}

/** Versiones de los componentes que producen una generación (se guardan para poder explicar y reproducir). */
export function componentVersions(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return { asr_model: env.GROQ_STT_MODEL || "whisper-large-v3-turbo", llm_model: env.GROQ_EDITORIAL_MODEL || "openai/gpt-oss-120b", rubric_version: "rubric-v2", selection_pkg: "selection-v2", composition_pkg: "composition-v2" };
}
