// Lógica pura del webhook de Zernio (sin APIs de Deno: se prueba en Node). Debe coincidir con `eventToUpdate`/`verifySignature` de
// packages/providers/src/zernio.ts; `apps/web/lib/zernio.test.ts` comprueba la equivalencia.
const enc = new TextEncoder();
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifySignature(rawBody: string, header: string | null | undefined, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const expected = await hmacHex(secret, rawBody), got = header.trim().toLowerCase().replace(/^sha256=/, "");
  if (expected.length !== got.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
interface RawEvent { id?: string; event?: string; post?: { id?: string; _id?: string; platforms?: { platform?: string; publishedUrl?: string | null; error?: string | null }[] }; platform?: { name?: string; publishedUrl?: string | null; error?: string | null } }
export interface EventUpdate { event_id: string; event: string; zernio_post: string; state: "processing" | "scheduled" | "published" | "failed" | null; url: string | null; code: string | null; message: string | null }
export function eventToUpdate(e: RawEvent): EventUpdate | null {
  const post = e.post?.id ?? e.post?._id; if (!e.id || !e.event || !post) return null;
  const plat = e.platform?.name ?? e.post?.platforms?.[0]?.platform;
  if (plat && plat !== "tiktok") return null;
  const url = e.platform?.publishedUrl ?? e.post?.platforms?.find((p) => p.platform === "tiktok")?.publishedUrl ?? null;
  const err = e.platform?.error ?? e.post?.platforms?.[0]?.error ?? null;
  const base = { event_id: e.id, event: e.event, zernio_post: post, url: url && /^https:\/\//.test(url) ? url : null, code: null as string | null, message: null as string | null };
  switch (e.event) {
    case "post.scheduled": return { ...base, state: "scheduled" };
    case "post.platform.published": case "post.published": return { ...base, state: "published" };
    case "post.tiktok.url_resolved": return { ...base, state: null };
    case "post.platform.failed": case "post.failed": case "post.partial": return { ...base, state: "failed", code: "zernio_failed", message: err ? String(err).slice(0, 300) : "TikTok o Zernio no pudieron publicar el vídeo." };
    default: return null;
  }
}
export interface Handled { http: number; result: string }
/** Verifica, traduce y aplica un evento. `rpc` llama a la función SQL `zernio_event` con la clave de servicio que Supabase inyecta en la Edge Function. */
export async function handle(raw: string, signature: string | null, secret: string | undefined, rpc: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>): Promise<Handled> {
  if (!secret) return { http: 503, result: "not_configured" };
  if (!(await verifySignature(raw, signature, secret))) return { http: 401, result: "bad_signature" };
  let ev: unknown; try { ev = JSON.parse(raw); } catch { return { http: 400, result: "bad_json" }; }
  const u = eventToUpdate(ev as RawEvent);
  if (!u) return { http: 200, result: "ignored" };   // otro tipo de evento o de plataforma: se acepta para que Zernio no reintente
  const r = await rpc({ p_event_id: u.event_id, p_event: u.event, p_zernio_post: u.zernio_post, p_state: u.state, p_url: u.url, p_code: u.code, p_message: u.message });
  return { http: 200, result: r?.duplicate ? "duplicate" : r?.ignored ? "unknown_post" : "applied" };
}
