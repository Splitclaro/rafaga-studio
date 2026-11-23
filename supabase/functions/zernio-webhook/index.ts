// Edge Function de Supabase: receptor del webhook de Zernio. Se despliega SIN verificación de JWT (Zernio no tiene sesión de Supabase): la autenticidad
// la da la firma HMAC `X-Zernio-Signature` con ZERNIO_WEBHOOK_SECRET. La clave de servicio la inyecta Supabase en el entorno de la función; la web nunca la tiene.
import { handle } from "./events.ts";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void };

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return Response.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  const out = await handle(raw, req.headers.get("x-zernio-signature"), Deno.env.get("ZERNIO_WEBHOOK_SECRET"), async (args) => {
    const r = await fetch(`${url}/rest/v1/rpc/zernio_event`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`rpc_${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  }).catch(() => ({ http: 500, result: "webhook_failed" }));
  return Response.json(out.http === 200 ? { ok: true, result: out.result } : { error: out.result }, { status: out.http });
});
