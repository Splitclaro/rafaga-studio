// Estilos v2 del workspace: guardar (≤ 20, ≤ 4000 bytes), listar, aplicar presets de comportamiento por capas y comparar A/B.
import { BEHAVIOUR_PRESETS, validateCaptionStyle, type BehaviourPresetId, type CaptionStyleV2 } from "@rafaga/composition";

export const MAX_STYLES = 20, MAX_STYLE_BYTES = 4000;
export type RpcFn = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
export interface StyleDoc { rafagaStyle: 2; style: CaptionStyleV2; preset: BehaviourPresetId }
export type SaveResult = { ok: true; id: string } | { ok: false; error: "style_too_large" | "style_limit" | "invalid_style" | "invalid_params" | "not_found" | "unknown"; message: string };
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const MESSAGES: Record<string, string> = {
  style_too_large: "El estilo es demasiado grande (máximo 4000 bytes).", style_limit: "Ya tienes 20 estilos. Borra uno para guardar otro.",
  invalid_style: "El estilo no es válido.", invalid_params: "Revisa el nombre del estilo (1–60 caracteres).", not_found: "No se encontró el espacio de trabajo.", unknown: "No se pudo guardar el estilo.",
};

/** Guarda un estilo v2. El tamaño se comprueba ANTES de llamar a la base de datos; el límite de 20 lo impone la base de datos. */
export async function saveStyle(rpc: RpcFn, ws: string, id: string | null, name: string, style: unknown, preset: BehaviourPresetId): Promise<SaveResult> {
  if (bytes(style) > MAX_STYLE_BYTES) return { ok: false, error: "style_too_large", message: MESSAGES.style_too_large };
  const doc: StyleDoc = { rafagaStyle: 2, style: validateCaptionStyle(style), preset: preset in BEHAVIOUR_PRESETS ? preset : "frase_palabra_activa" };
  if (bytes(doc) > MAX_STYLE_BYTES) return { ok: false, error: "style_too_large", message: MESSAGES.style_too_large };
  const { data, error } = await rpc("save_caption_style", { p_ws: ws, p_id: id, p_name: name.trim(), p_style: doc });
  if (error?.code === "23505" || /duplicate key|text_styles_workspace_id_name_key/.test(error?.message ?? "")) return { ok: false, error: "invalid_params", message: "Ya tienes un estilo con ese nombre." };
  if (error) { const k = (Object.keys(MESSAGES).find((m) => error.message.includes(m)) ?? "unknown") as keyof typeof MESSAGES; return { ok: false, error: k as never, message: MESSAGES[k] }; }
  return { ok: true, id: String(data) };
}
export async function deleteStyle(rpc: RpcFn, id: string): Promise<boolean> { return !(await rpc("delete_caption_style", { p_id: id })).error; }

/** Filas de `text_styles` → solo los estilos v2 (los v1 se ignoran aquí y siguen viviendo en su pantalla). */
export function listStylesV2(rows: { id: string; name: string; style: unknown }[]): { id: string; name: string; style: CaptionStyleV2; preset: BehaviourPresetId }[] {
  return rows.flatMap((r) => {
    const d = r.style as Partial<StyleDoc> | null;
    return d && d.rafagaStyle === 2 && d.style ? [{ id: r.id, name: r.name, style: validateCaptionStyle(d.style), preset: d.preset && d.preset in BEHAVIOUR_PRESETS ? d.preset : "frase_palabra_activa" }] : [];
  });
}

/** Las tres capas del estilo: lo que un preset de comportamiento NO debe tocar (fuente, posición) y lo que sí (animación). */
export function styleLayers(s: CaptionStyleV2) {
  return { font: { font: s.font, weight: s.weight, case: s.case, size: s.size, sizeFine: s.sizeFine }, layout: { position: s.position }, animation: { entrance: s.entrance, entranceBy: s.entranceBy, active: s.active } };
}
/** Aplica un preset de comportamiento: solo cambia la entrada y la palabra activa (la agrupación vive en el preset). */
export function applyPreset(s: CaptionStyleV2, id: BehaviourPresetId): CaptionStyleV2 {
  const p = BEHAVIOUR_PRESETS[id];
  return { ...s, entrance: p.entrance, active: p.active, entranceBy: p.unit === "linea" ? "line" : "word" };
}

export interface ABState { a: CaptionStyleV2; b: CaptionStyleV2; which: "a" | "b"; t: number; lyrics: string; background: string }
export const abState = (a: CaptionStyleV2, b: CaptionStyleV2, t = 0, lyrics = "", background = "#000000"): ABState => ({ a, b, which: "a", t, lyrics, background });
/** Alterna A/B: cambia solo el estilo visible; el instante, la letra y el fondo se quedan igual. */
export const toggleAB = (s: ABState): ABState => ({ ...s, which: s.which === "a" ? "b" : "a" });
export const currentStyle = (s: ABState): CaptionStyleV2 => (s.which === "a" ? s.a : s.b);
