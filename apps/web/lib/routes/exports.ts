// POST /api/exports            → pide exportaciones {items:[{clip_id,version,aspect,burn_subtitles,kind}], zip}  (Idempotency-Key)
// POST /api/exports/:id/retry  → reintenta solo esa exportación fallida
// POST /api/exports/:id/renew  → si el archivo se purgó, lo vuelve a renderizar desde su versión (sin coste)
// GET  /api/exports/:id/url    → URL firmada tras comprobar acceso; marca la primera descarga
import { r2FromEnv, r2Url } from "@rafaga/providers/r2";
import { bearer, rpc, json, fail, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface ExportDeps { f?: Fetch; env?: Record<string, string | undefined>; wake?: (req: Request, jobId: string) => void }
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);
function defaultWake(req: Request, jobId: string) {
  fetch(new URL("/api/wake", req.url), { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {});
}

export async function handleExports(req: Request, slug: string[], d: ExportDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, env = d.env ?? process.env, wake = d.wake ?? defaultWake;
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req), [id, action] = slug;

  if (req.method === "POST" && !id) {
    const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    const b = (await req.json().catch(() => ({}))) as { items?: unknown; zip?: boolean };
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return json({ error: { code: "invalid_params", message: "Elige entre 1 y 50 clips." } }, 400);
    const r = await rpc<{ export_ids: string[]; batch_id: string | null; job_id: string | null; reused: number; replay?: boolean }>(token, "request_exports", { p_items: b.items, p_zip: b.zip === true, p_idem: idem }, f);
    if (r.error) return r.error.code === "P0002" ? notFound() : mapDbError(r.error);
    if (r.data?.job_id && !r.data.replay) wake(req, r.data.job_id);
    return json(r.data, 202);
  }
  if (!UUID.test(id ?? "")) return notFound();

  if (req.method === "POST" && (action === "retry" || action === "renew")) {
    const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    const r = await rpc<{ job_id: string | null; status: string }>(token, action === "retry" ? "retry_export" : "rerender_export", { p_render: id, p_idem: idem }, f);
    if (r.error) return r.error.code === "P0002" ? notFound() : mapDbError(r.error);
    if (r.data?.job_id) wake(req, r.data.job_id);
    return json(r.data, 202);
  }

  if (req.method === "GET" && action === "url") {
    const r = await rpc<{ key: string | null; status: string; kind: string; expires_at: string | null; purged: boolean; expired: boolean }>(token, "export_object", { p_render: id }, f);
    if (r.error) return r.error.code === "P0002" ? notFound() : mapDbError(r.error);       // de otro usuario: 404 sin firmar
    const o = r.data!;
    if (o.status !== "ready") return json({ error: { code: "not_ready", message: "La exportación aún no está lista." }, status: o.status }, 409);
    if (o.purged || o.expired || !o.key) return fail("download_expired", { renewable: true });
    const cfg = r2FromEnv(env); if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
    await rpc(token, "mark_export_downloaded", { p_render: id }, f);
    return json({ url: await r2Url(cfg, "GET", o.key, 3600), expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  return notFound();
}
