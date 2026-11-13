// Subida reanudable directa a R2. El servidor nunca toca los bytes: solo firma, y cada firma va DESPUÉS de una
// comprobación de acceso hecha con el JWT del usuario (RLS en la base de datos).
//  POST   /api/uploads                         → crea fuente + proyecto + sesión (413 tamaño · 507 cuota · 409 duplicado)
//  GET    /api/uploads?workspace_id=           → { used_bytes, quota_bytes }
//  POST   /api/uploads/:id/parts               → URLs firmadas por parte (900 s)
//  GET    /api/uploads/:id                     → partes ya subidas (reanudar)
//  POST   /api/uploads/:id/complete            → 202 { job_id } (validate → mezzanine → proxy)
//  DELETE /api/uploads/:id                     → 204
//  GET    /api/uploads/sources/:sourceId/proxy → URL de lectura de la copia ligera (3600 s)
import { r2FromEnv, r2Multipart, r2Url, partsKey, type R2Config } from "@rafaga/providers/r2";
import { bearer, rpc, json, fail, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";

export const MAX_BYTES = 4294967296, QUOTA_BYTES = 10737418240;
export const PART_SIZE = { multipart: 16777216, parts: 47185920 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);

export interface UploadDeps { f?: Fetch; env?: Record<string, string | undefined>; wake?: (req: Request, jobId: string) => void }
type Session = { id: string; workspace_id: string; source_id: string; project_id: string; strategy: "multipart" | "parts"; r2_upload_id: string | null; object_key: string; part_size: number; total_parts: number; bytes: number; state: string; job_id: string | null };

const strategyOf = (env: Record<string, string | undefined>) => (env.UPLOAD_STRATEGY === "parts" ? "parts" : "multipart") as "multipart" | "parts";
function defaultWake(req: Request, jobId: string) {
  fetch(new URL("/api/wake", req.url), { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {});
}

export async function handle(req: Request, slug: string[], d: UploadDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, env = d.env ?? process.env, wake = d.wake ?? defaultWake;
  const user = await sessionUser(req, f);
  if (!user) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req);
  const cfg = r2FromEnv(env);
  const m = req.method;
  const [a, b, c] = slug;

  // GET /api/uploads?workspace_id=  → cuota
  if (m === "GET" && !a) {
    const ws = new URL(req.url).searchParams.get("workspace_id");
    if (!UUID.test(ws ?? "")) return json({ error: { code: "bad_request", message: "Falta workspace_id." } }, 400);
    const r = await rpc<{ used_bytes: number; quota_bytes: number }>(token, "storage_summary", { p_ws: ws }, f);
    if (r.error) return mapDbError(r.error);
    return json({ used_bytes: Number((r.data as Record<string, unknown>)?.used_bytes ?? 0), quota_bytes: QUOTA_BYTES, ...(r.data as object) });
  }

  // POST /api/uploads → nueva sesión
  if (m === "POST" && !a) {
    if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado en el servidor." } }, 503);
    const body = (await req.json().catch(() => ({}))) as { workspace_id?: string; project_id?: string; name?: string; bytes?: number; mime?: string; sha256_prefix?: string; force?: boolean };
    const bytes = Number(body.bytes);
    if (!Number.isFinite(bytes) || bytes < 1) return json({ error: { code: "bad_request", message: "Tamaño no válido." } }, 400);
    if (bytes > MAX_BYTES) return json({ error: { code: "file_too_large", message: "El archivo supera los 4 GB." }, limit: MAX_BYTES }, 413);
    if (body.sha256_prefix && !/^[0-9a-f]{64}$/.test(body.sha256_prefix)) return json({ error: { code: "bad_request", message: "Huella no válida." } }, 400);
    const strategy = strategyOf(env);
    const idem = idempotencyKey(req) ?? `upload:${user}:${body.sha256_prefix ?? ""}:${bytes}:${body.name ?? ""}`.slice(0, 120);
    const r = await rpc<Record<string, unknown>>(token, "create_upload_session", {
      p_ws: UUID.test(body.workspace_id ?? "") ? body.workspace_id : null, p_name: String(body.name ?? "Proyecto").slice(0, 200), p_bytes: bytes,
      p_mime: String(body.mime ?? "video/mp4").slice(0, 100), p_sha256_prefix: body.sha256_prefix ?? null,
      p_project: UUID.test(body.project_id ?? "") ? body.project_id : null, p_force: body.force === true,
      p_strategy: strategy, p_part_size: PART_SIZE[strategy], p_idem: idem.length >= 8 ? idem : `upload-${idem}`,
    }, f);
    if (r.error) {
      if (r.error.message === "file_too_large") return json({ error: { code: "file_too_large", message: "El archivo supera los 4 GB." }, limit: MAX_BYTES }, 413);
      if (r.error.message === "quota_exceeded") return json({ error: { code: "quota_exceeded", message: "No queda espacio de almacenamiento." }, quota: QUOTA_BYTES }, 507);
      return mapDbError(r.error);
    }
    const s = r.data!;
    if (s.duplicate_of_project) return json({ duplicate_of_project: s.duplicate_of_project }, 409);
    if (strategy === "multipart" && !s.replay) {
      const sess = (await rpc<Session>(token, "upload_session", { p_upload: s.upload_id }, f)).data!;
      const uploadId = await r2Multipart(cfg, f).create(sess.object_key);
      const set = await rpc(token, "set_upload_r2_id", { p_upload: s.upload_id, p_r2_id: uploadId }, f);
      if (set.error) return mapDbError(set.error);
    }
    return json({ upload_id: s.upload_id, source_id: s.source_id, project_id: s.project_id, part_size: s.part_size, parts: s.parts, strategy: s.strategy }, 201);
  }

  // GET /api/uploads/sources/:sourceId/proxy
  if (m === "GET" && a === "sources" && UUID.test(b ?? "") && c === "proxy" && slug.length === 3) {
    const r = await rpc<{ key: string }>(token, "source_object", { p_source: b, p_kind: "proxy" }, f);
    if (r.error) return r.error.code === "P0002" ? notFound() : mapDbError(r.error);
    if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
    return json({ url: await r2Url(cfg, "GET", r.data!.key, 3600), expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }

  if (!UUID.test(a ?? "")) return notFound();
  // Toda operación sobre una sesión empieza por leerla con el JWT del usuario: sin acceso → 404 sin firmar nada.
  const sr = await rpc<Session>(token, "upload_session", { p_upload: a }, f);
  if (sr.error || !sr.data) return notFound();
  const s = sr.data;
  if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
  const mp = r2Multipart(cfg, f);

  if (m === "GET" && slug.length === 1) {
    let uploaded: { n: number; etag: string; size: number }[] = [];
    if (s.state === "active") {
      if (s.strategy === "multipart" && s.r2_upload_id) uploaded = await mp.list(s.object_key, s.r2_upload_id);
      else if (s.strategy === "parts") {
        const heads = await Promise.all(Array.from({ length: s.total_parts }, async (_, i) => {
          const r = await f(await r2Url(cfg as R2Config, "HEAD", partsKey(s.object_key, i), 300), { method: "HEAD" });
          return r.ok ? { n: i + 1, etag: (r.headers.get("etag") ?? "").replace(/"/g, ""), size: Number(r.headers.get("content-length") ?? 0) } : null;
        }));
        uploaded = heads.filter((x): x is { n: number; etag: string; size: number } => !!x);
      }
    }
    return json({ uploaded_parts: uploaded, state: s.state, part_size: s.part_size, parts: s.total_parts, strategy: s.strategy });
  }

  if (m === "POST" && b === "parts" && slug.length === 2) {
    if (s.state !== "active") return fail("upload_interrupted", { state: s.state }, 409);
    const body = (await req.json().catch(() => ({}))) as { part_numbers?: unknown };
    const nums = Array.isArray(body.part_numbers) ? body.part_numbers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= s.total_parts) : [];
    if (!nums.length || nums.length > 64) return json({ error: { code: "bad_request", message: "Partes no válidas." } }, 400);
    const urls: Record<number, string> = {};
    for (const n of nums) urls[n] = s.strategy === "multipart" ? await mp.partUrl(s.object_key, s.r2_upload_id!, n, 900) : await r2Url(cfg, "PUT", partsKey(s.object_key, n - 1), 900);
    return json({ urls, expires_in: 900 });
  }

  if (m === "POST" && b === "complete" && slug.length === 2) {
    const body = (await req.json().catch(() => ({}))) as { parts?: { n: number; etag: string }[]; sha256?: string };
    if (!/^[0-9a-f]{64}$/.test(body.sha256 ?? "")) return json({ error: { code: "bad_request", message: "Falta la huella sha256." } }, 400);
    if (s.state === "active") {
      if (s.strategy === "multipart") {
        const parts = Array.isArray(body.parts) ? body.parts : [];
        if (parts.length !== s.total_parts) return json({ error: { code: "bad_request", message: `Faltan partes (${parts.length}/${s.total_parts}).` } }, 400);
        try { await mp.complete(s.object_key, s.r2_upload_id!, parts); }
        catch (e) { if (!/NoSuchUpload/.test((e as Error).message)) return fail("upload_interrupted", { detail: (e as Error).message.slice(0, 120) }, 409); }
      } else {
        for (let i = 0; i < s.total_parts; i++) {
          const h = await f(await r2Url(cfg, "HEAD", partsKey(s.object_key, i), 300), { method: "HEAD" });
          if (!h.ok) return fail("upload_interrupted", { missing_part: i + 1 }, 409);
        }
      }
    }
    const r = await rpc<{ job_id: string; duplicate_of_project: string | null }>(token, "complete_upload", { p_upload: a, p_sha256: body.sha256 }, f);
    if (r.error) return mapDbError(r.error);
    wake(req, r.data!.job_id);
    return json(r.data, 202);
  }

  if (m === "DELETE" && slug.length === 1) {
    if (s.state === "active" && s.strategy === "multipart" && s.r2_upload_id) await mp.abort(s.object_key, s.r2_upload_id).catch(() => {});
    const r = await rpc(token, "abort_upload", { p_upload: a }, f);
    if (r.error) return mapDbError(r.error);
    return new Response(null, { status: 204 });
  }
  return notFound();
}
