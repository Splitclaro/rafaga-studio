// URLs de lectura de exportaciones (R2) y miniaturas de clips v2: las firma el servidor tras comprobar el acceso del usuario.
import { supabase } from "./supabase";
const tok = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";
export async function renderUrl(renderId: string): Promise<string | null> {
  try { const r = await fetch(`/api/exports/${renderId}/url`, { headers: { Authorization: `Bearer ${await tok()}` } }); return r.ok ? ((await r.json()).url as string | null) ?? null : null; } catch { return null; }
}
export async function clipThumbUrl(clipId: string): Promise<string | null> {
  try { const r = await fetch(`/api/uploads/clips/${clipId}/thumb`, { headers: { Authorization: `Bearer ${await tok()}` } }); return r.ok ? ((await r.json()).url as string | null) ?? null : null; } catch { return null; }
}
/** Ejecuta `fn` sobre `items` con un máximo de `n` a la vez (no saturar la API con 10+ firmas). */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { for (let x = q.shift(); x; x = q.shift()) await fn(x); })); }
