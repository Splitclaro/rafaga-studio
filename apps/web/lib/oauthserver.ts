// Servidor OAuth: configuración por proveedor (secretos solo aquí) y acceso a Supabase con el JWT del usuario (sin clave de servicio en Vercel).
import { type OAuthProvider, type Capability, PROVIDER_OF } from "@rafaga/providers/oauth";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";

export function providerConfig(p: OAuthProvider): { clientId: string; clientSecret: string } | null {
  const id = p === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.DROPBOX_CLIENT_ID;
  const secret = p === "google" ? process.env.GOOGLE_CLIENT_SECRET : process.env.DROPBOX_CLIENT_SECRET;
  const real = (v: string | undefined) => (v && v.trim() && !v.trim().toUpperCase().startsWith("PEGAR") ? v.trim() : undefined);   // un marcador no cuenta como configurado
  return real(id) && real(secret) ? { clientId: real(id)!, clientSecret: real(secret)! } : null;
}
export const redirectUri = (req: Request) => `${process.env.OAUTH_REDIRECT_BASE ?? new URL(req.url).origin}/app/conexiones/callback`;
export const CAPS: Capability[] = ["import_youtube", "import_drive", "import_dropbox"];
export const isCap = (x: unknown): x is Capability => typeof x === "string" && (CAPS as string[]).includes(x);
export { PROVIDER_OF };

/** Llama a una RPC de Supabase como el usuario (RLS y can_admin se aplican en la base de datos). */
export async function rpcAs(token: string, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null; status: number }> {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const text = await r.text(); let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return r.ok ? { data, error: null, status: r.status } : { data: null, error: (data as { message?: string })?.message ?? `supabase ${r.status}`, status: r.status };
}
export const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
