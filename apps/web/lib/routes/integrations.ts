// POST /api/import/link     {url,name?}      → 202 {job_id,import_id,project_id} · 400 {reason: not_https|private_address|redirect_private|bad_url}
// POST /api/import/drive    {file_id,name?}  → 202   (requiere conexión de Google con Drive)
// POST /api/import/dropbox  {path,name?}     → 202   (requiere conexión de Dropbox)
// POST /api/publish         {export_id,platform,title,description?,privacy?,scheduled_at?} → 202 {publication_id,state}  (Idempotency-Key)
// POST /api/publish/:id/cancel → cancela una publicación programada o fallida
// Cualquier otro valor de [integration] → 404.
import { preflightLink, LinkError, type PreflightDeps } from "@rafaga/providers/net";
import { bearer, rpc, json, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface IntegrationDeps { f?: Fetch; net?: PreflightDeps; wake?: (req: Request, jobId: string) => void }
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);
const bad = (code: string, message: string, extra: Record<string, unknown> = {}) => json({ error: { code, message }, ...extra }, 400);
const missingIdem = () => bad("missing_idempotency_key", "Falta la cabecera Idempotency-Key.");
function defaultWake(req: Request, jobId: string) {
  fetch(new URL("/api/wake", req.url), { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {});
}
const LINK_TEXT: Record<string, string> = {
  not_https: "El enlace debe empezar por https://.", private_address: "Ese enlace apunta a una dirección privada o interna; no se puede importar.",
  redirect_private: "El enlace redirige a una dirección privada; no se puede importar.", bad_url: "El enlace no es válido.",
};
const DB_TEXT: Record<string, [number, string]> = {
  not_connected: [409, "Conecta primero la cuenta en Conexiones."], render_not_ready: [409, "La exportación todavía no está lista."],
  invalid_privacy: [400, "Esa privacidad no existe en la plataforma elegida."], invalid_publication: [400, "Revisa el título y la plataforma."],
  invalid_import: [400, "Revisa el origen de la importación."], not_cancellable: [409, "Esta publicación ya no se puede cancelar."],
};
function dbFail(e: { code: string; message: string; details?: string | null }) {
  const t = DB_TEXT[e.message]; if (t) return json({ error: { code: e.message, message: t[1] } }, t[0]);
  return e.code === "P0002" ? notFound() : mapDbError(e);
}

export async function handleIntegrations(req: Request, integration: string, rest: string[], d: IntegrationDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, wake = d.wake ?? defaultWake;
  if (integration !== "import" && integration !== "publish") return notFound();
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Método no permitido." } }, 405);
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req), b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (integration === "import") {
    const kind = rest[0];
    if (kind !== "link" && kind !== "drive" && kind !== "dropbox") return notFound();
    const idem = idempotencyKey(req); if (!idem) return missingIdem();
    const ref = kind === "link" ? str(b.url) : kind === "drive" ? str(b.file_id) : str(b.path);
    if (!ref) return bad("invalid_import", "Falta el origen de la importación.");
    if (kind === "link") {
      try { await preflightLink(ref, d.net); } catch (e: unknown) {
        if (e instanceof LinkError) return bad("invalid_link", LINK_TEXT[e.reason] ?? e.message, { reason: e.reason });
        return bad("invalid_link", "No se pudo comprobar el enlace.", { reason: "bad_url" });
      }
    }
    const r = await rpc<{ import_id: string; job_id: string; project_id?: string; replay: boolean }>(token, "request_import", { p_kind: kind, p_ref: ref, p_name: str(b.name) || null, p_idem: idem }, f);
    if (r.error) return dbFail(r.error);
    if (r.data?.job_id && !r.data.replay) wake(req, r.data.job_id);
    return json(r.data, 202);
  }

  // publish
  if (rest[1] === "cancel" && UUID.test(rest[0] ?? "")) {
    const r = await rpc(token, "cancel_publication", { p_publication: rest[0] }, f);
    return r.error ? dbFail(r.error) : json(r.data, 200);
  }
  if (rest.length) return notFound();
  const idem = idempotencyKey(req); if (!idem) return missingIdem();
  if (!UUID.test(str(b.export_id))) return bad("invalid_publication", "Elige una exportación válida.");
  const platform = str(b.platform);
  if (platform !== "youtube" && platform !== "tiktok") return bad("invalid_publication", "Plataforma no admitida.");
  let at: string | null = null;
  if (b.scheduled_at != null) { const t = Date.parse(str(b.scheduled_at)); if (!Number.isFinite(t)) return bad("invalid_publication", "La fecha programada no es válida."); at = new Date(t).toISOString(); }
  const r = await rpc<{ publication_id: string; state: string; job_id: string | null; replay: boolean }>(token, "request_publication", {
    p_render: str(b.export_id), p_platform: platform, p_title: str(b.title), p_description: str(b.description) || null, p_privacy: str(b.privacy) || null, p_scheduled_at: at, p_idem: idem }, f);
  if (r.error) return dbFail(r.error);
  if (r.data?.job_id && !r.data.replay) wake(req, r.data.job_id);
  return json(r.data, 202);
}
