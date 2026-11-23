// Webhook de Zernio: verifica la firma sobre el cuerpo original, traduce el evento y lo aplica en la base de datos (deduplicado por id de evento).
// Lo invoca el receptor de Modal por stdin (`stage.ts --zernio-event`); la clave de servicio nunca pasa por la web.
import { verifySignature, eventToUpdate } from "@rafaga/providers/zernio";
import type { Rpc } from "./stages/registry.ts";

export interface EventResult { http: number; result: string; detail?: unknown }
export async function handleZernioEvent(rpc: Rpc, env: Record<string, string | undefined>, input: { body: string; signature: string | null }): Promise<EventResult> {
  const secret = env.ZERNIO_WEBHOOK_SECRET?.trim();
  if (!secret) return { http: 503, result: "not_configured" };
  if (!verifySignature(input.body, input.signature, secret)) return { http: 401, result: "bad_signature" };
  let ev: unknown;
  try { ev = JSON.parse(input.body); } catch { return { http: 400, result: "bad_json" }; }
  const u = eventToUpdate(ev as Parameters<typeof eventToUpdate>[0]);
  if (!u) return { http: 200, result: "ignored" };   // evento de otro tipo o de otra plataforma: se acepta para que Zernio no reintente
  const r = await rpc<Record<string, unknown>>("zernio_event", { p_event_id: u.event_id, p_event: u.event, p_zernio_post: u.zernio_post, p_state: u.state, p_url: u.url, p_code: u.code, p_message: u.message });
  return { http: 200, result: r?.duplicate ? "duplicate" : r?.ignored ? "unknown_post" : "applied", detail: r };
}
