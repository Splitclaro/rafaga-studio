// Utilidades de servidor para las rutas de YouTube: sesión, caché breve y límite por usuario (en memoria de la instancia).
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";

export async function userFrom(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return null;
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  return u.ok ? ((await u.json()) as { id: string }).id : null;
}
const cache = new Map<string, { at: number; v: unknown }>();
export function cached<T>(k: string, ttlMs: number): T | undefined { const h = cache.get(k); if (h && Date.now() - h.at < ttlMs) return h.v as T; if (h) cache.delete(k); return undefined; }
export function remember(k: string, v: unknown) { if (cache.size > 300) cache.delete(cache.keys().next().value as string); cache.set(k, { at: Date.now(), v }); }
const hits = new Map<string, number[]>();
/** Máximo `max` llamadas por usuario y hora: la búsqueda cuesta 100 unidades de una cuota diaria de 10 000 compartida por todos. */
export function allow(user: string, max = 40): boolean { const now = Date.now(), a = (hits.get(user) ?? []).filter((t) => now - t < 3600_000); if (a.length >= max) { hits.set(user, a); return false; } a.push(now); hits.set(user, a); return true; }
