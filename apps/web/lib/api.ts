// Núcleo común de las rutas v2: sesión, idempotencia, llamadas RPC con el JWT del usuario y catálogo de errores en español.
import { bearer } from "./oauthserver.ts";
import { userFrom } from "./ytserver.ts";

export { bearer, userFrom };
const SB = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";

export interface DbError { code: string; message: string; details?: string | null; hint?: string | null }
export type Fetch = typeof fetch;

/** RPC de Supabase como el usuario; devuelve el error estructurado de PostgREST (código, mensaje, detalle). */
export async function rpc<T = unknown>(token: string, fn: string, args: Record<string, unknown>, f: Fetch = fetch): Promise<{ data: T | null; error: DbError | null; status: number }> {
  const r = await f(`${SB()}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY(), Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const text = await r.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (r.ok) return { data: data as T, error: null, status: r.status };
  const d = (data ?? {}) as Partial<DbError>;
  return { data: null, error: { code: d.code ?? String(r.status), message: d.message ?? `supabase ${r.status}`, details: d.details ?? null, hint: d.hint ?? null }, status: r.status };
}

export async function sessionUser(req: Request, f: Fetch = fetch): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  const u = await f(`${SB()}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${token}` } });
  return u.ok ? ((await u.json()) as { id: string }).id : null;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Clave de idempotencia: cabecera `Idempotency-Key` (8–160 caracteres imprimibles) o null. */
export function idempotencyKey(req: Request): string | null {
  const k = req.headers.get("idempotency-key")?.trim();
  return k && /^[\x21-\x7e]{8,160}$/.test(k) ? k : null;
}

export interface ErrorInfo { status: number; message: string; kept: string; action: string; consumption: string }
export const ERROR_CODES: Record<string, ErrorInfo> = {
  upload_interrupted: { status: 409, message: "La subida se interrumpió.", kept: "Las partes ya subidas.", action: "Reanudar la subida desde donde se quedó.", consumption: "Ninguno." },
  unsupported_file: { status: 415, message: "El archivo no es un vídeo compatible.", kept: "Nada.", action: "Convertirlo a MP4 (H.264 + AAC) o recortarlo y volver a subirlo.", consumption: "Ninguno." },
  no_audio: { status: 422, message: "El vídeo no tiene audio.", kept: "El vídeo.", action: "Usar los modos Manual o Destacados (por imagen y escenas).", consumption: "Sin cargo de transcripción." },
  wrong_language: { status: 422, message: "El idioma detectado no parece correcto.", kept: "El análisis visual.", action: "Corregir el idioma y volver a analizar.", consumption: "El nuevo análisis se cobra." },
  no_moments: { status: 200, message: "No se encontraron momentos que cumplan lo pedido.", kept: "El análisis completo.", action: "Cambiar el tema, el modo o la duración.", consumption: "Se devuelve la parte de selección." },
  transcription_failed: { status: 502, message: "La transcripción falló.", kept: "El audio y la copia ligera.", action: "Reintentar.", consumption: "Se devuelve lo reservado." },
  tracking_failed: { status: 200, message: "El seguimiento perdió al sujeto.", kept: "Un encuadre de respaldo.", action: "Revisar el encuadre del clip.", consumption: "Ninguno." },
  render_failed: { status: 502, message: "El renderizado falló.", kept: "La versión y el resto del lote.", action: "Reintentar solo este clip.", consumption: "Ninguno." },
  job_stalled: { status: 504, message: "El trabajo se detuvo.", kept: "Las etapas terminadas.", action: "Reanudar.", consumption: "Se devuelve lo no realizado." },
  insufficient_units: { status: 402, message: "No tienes saldo suficiente para esta operación.", kept: "Tu configuración.", action: "Pedir más saldo o reducir la duración analizada.", consumption: "No se ha reservado nada." },
  quota_exceeded: { status: 507, message: "No queda espacio de almacenamiento.", kept: "Todos tus archivos.", action: "Borrar o archivar proyectos.", consumption: "Ninguno." },
  download_expired: { status: 410, message: "El enlace de descarga caducó.", kept: "La versión exportada.", action: "Renovar el enlace (si hace falta se vuelve a renderizar gratis).", consumption: "Ninguno." },
  connection_lost: { status: 503, message: "Se perdió la conexión.", kept: "Todo; el servidor sigue trabajando.", action: "Reconectar; el estado se recupera solo.", consumption: "Ninguno." },
  compute_budget_exhausted: { status: 429, message: "Se ha alcanzado el presupuesto de cómputo gratuito de este mes.", kept: "Todo.", action: "Esperar al mes siguiente.", consumption: "No se ha reservado nada." },
};
export const ERROR_ALIASES: Record<string, string> = { corrupt_file: "unsupported_file", unsupported_container: "unsupported_file", too_long: "unsupported_file", too_large: "unsupported_file" };

export function errorFor(code: string): ErrorInfo & { code: string } {
  const c = ERROR_ALIASES[code] ?? code;
  const e = ERROR_CODES[c];
  return e ? { code: c, ...e } : { code: "internal", status: 500, message: "Error interno.", kept: "Todo lo guardado hasta ahora.", action: "Reintentar más tarde.", consumption: "Ninguno." };
}

export function fail(code: string, extra: Record<string, unknown> = {}, status?: number): Response {
  const e = errorFor(code);
  return json({ error: { code: e.code, message: e.message, kept: e.kept, action: e.action, consumption: e.consumption }, ...extra }, status ?? e.status);
}

/** Traduce un error de base de datos a una respuesta HTTP del catálogo. */
export function mapDbError(err: DbError): Response {
  const known = errorFor(err.message);
  if (known.code !== "internal") {
    let extra: Record<string, unknown> = {};
    if (err.details) { try { const d = JSON.parse(err.details); if (d && typeof d === "object") extra = d as Record<string, unknown>; } catch { /* detalle no JSON */ } }
    return fail(known.code, extra);
  }
  if (err.code === "P0002" || err.message === "not_found") return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
  if (err.code === "42501" || err.message === "forbidden") return json({ error: { code: "forbidden", message: "No tienes permiso para esta acción." } }, 403);
  if (err.code === "23505") return json({ error: { code: "conflict", message: "Ya existe." } }, 409);
  return json({ error: { code: "internal", message: "Error interno." } }, 500);
}
