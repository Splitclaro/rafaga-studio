// API de Lyric Studio v2.
//  POST /api/lyrics/songs               {upload_id,title,artist?,lyrics?} → 201 {song_id,project_id} (repetible)
//  GET  /api/lyrics/songs/:id/audio     → {url,expires_at} (URL de R2, 3600 s) tras comprobar acceso como el usuario
//  POST /api/lyrics/projects            {song_id,mode,name?}  → 201 {project_id}
//  PUT  /api/lyrics/projects/:id        parche de la pieza    → 200 {saved_at}
import { runAfter } from "../after.ts";
import { r2FromEnv, r2Url } from "@rafaga/providers/r2";
import { bearer, rpc, json, mapDbError, idempotencyKey, sessionUser, type Fetch, type DbError } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface LyricDeps { f?: Fetch; env?: Record<string, string | undefined>; wake?: (req: Request, jobId: string) => void }
const SYNC_MODEL = "whisper-large-v3-turbo";
function defaultWake(req: Request, jobId: string) {
  runAfter(() => fetch(new URL("/api/wake", req.url), { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }));
}
/** Palabras de una revisión: texto 1–80, start/end numéricos crecientes, line entero ≥ 0, manual booleano. */
export function validWords(w: unknown): boolean {
  if (!Array.isArray(w) || !w.length || w.length > 4000) return false;
  let prev = -1;
  for (const x of w as Record<string, unknown>[]) {
    if (typeof x?.text !== "string" || x.text.length < 1 || x.text.length > 80 || typeof x.start !== "number" || typeof x.end !== "number") return false;
    if (!(x.start >= 0) || !(x.end > x.start) || x.start < prev || !Number.isInteger(x.line) || (x.line as number) < 0 || typeof x.manual !== "boolean") return false;
    prev = x.start;
  }
  return true;
}
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);

/** Errores propios de letra; lo demás pasa por `mapDbError` (catálogo común). */
const LYRIC_ERRORS: Record<string, [number, string]> = {
  file_too_large: [413, "La canción supera los 60 MiB. Exporta una versión más ligera (MP3 o M4A) y vuelve a subirla."],
  unsupported_file: [415, "Sube un archivo de audio: MP3, WAV, M4A, AAC, FLAC u OGG."],
  legacy_song: [409, "Esta canción es del flujo anterior. Súbela de nuevo para usarla aquí."],
  not_ready: [409, "La canción aún se está preparando."],
  invalid_params: [400, "Revisa los datos enviados."],
  lyrics_required: [409, "Pega o importa la letra antes de sincronizarla."],
  song_not_ready: [409, "La canción aún se está preparando."],
  hints_too_large: [400, "Las marcas de tiempo importadas son demasiadas."],
  invalid_words: [400, "Los tiempos de las palabras no son válidos: deben ir en orden y cada palabra debe durar algo."],
  quota_exceeded: [507, "No queda espacio de almacenamiento. Borra o archiva proyectos."],
  source_not_ready: [409, "El vídeo todavía se está preparando."],
  no_original: [409, "Todavía no hay una sincronización automática que restaurar."],
};
function dbFail(e: DbError): Response {
  const known = LYRIC_ERRORS[e.message];
  if (known) {
    let extra: Record<string, unknown> = {}; try { extra = e.details ? (JSON.parse(e.details) as Record<string, unknown>) : {}; } catch { /* detalle no JSON */ }
    return json({ error: { code: e.message, message: known[1] }, ...extra }, known[0]);
  }
  return e.code === "P0002" ? notFound() : mapDbError(e);
}

export async function handleLyrics(req: Request, slug: string[], d: LyricDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, env = d.env ?? process.env, wake = d.wake ?? defaultWake;
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req), [a, id, action] = slug, m = req.method;
  const body = m === "POST" || m === "PUT" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (a === "songs" && m === "POST" && !id) {
    if (!UUID.test(str(body.upload_id))) return json({ error: { code: "invalid_params", message: "Falta la subida." }, field: "upload_id" }, 400);
    const r = await rpc<{ song_id: string; project_id: string; replay: boolean }>(token, "register_song", { p_upload: body.upload_id, p_title: str(body.title).trim(), p_artist: str(body.artist) || null, p_lyrics: str(body.lyrics) || null }, f);
    if (r.error) return dbFail(r.error);
    return json({ song_id: r.data!.song_id, project_id: r.data!.project_id }, 201);
  }
  if (a === "songs" && m === "GET" && UUID.test(id ?? "") && action === "audio") {
    const r = await rpc<{ key: string; status: string; backend: string }>(token, "song_object", { p_song: id }, f);
    if (r.error) return dbFail(r.error);                                    // de otro usuario: 404 sin firmar
    if (r.data!.backend !== "r2") return dbFail({ code: "P0001", message: "legacy_song" });
    if (r.data!.status !== "ready") return dbFail({ code: "P0001", message: "not_ready" });
    const cfg = r2FromEnv(env); if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
    return json({ url: await r2Url(cfg, "GET", r.data!.key, 3600), expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
  if (a === "songs" && UUID.test(id ?? "")) {
    if (m === "PUT" && action === "lyrics") {
      const r = await rpc(token, "set_song_lyrics", { p_song: id, p_text: str(body.text) }, f);
      return r.error ? dbFail(r.error) : json({ ok: true }, 200);
    }
    if (m === "POST" && action === "sync") {
      const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
      const r = await rpc<{ job_id: string; units_reserved: number; cached: boolean; replay: boolean }>(token, "request_lyric_sync", { p_song: id, p_mode: str(body.mode), p_hints: Array.isArray(body.hints) ? body.hints : null, p_model: SYNC_MODEL, p_idem: idem }, f);
      if (r.error) return dbFail(r.error);
      if (!r.data!.replay) wake(req, r.data!.job_id);
      return json({ job_id: r.data!.job_id, units_reserved: Number(r.data!.units_reserved), cached: r.data!.cached }, 202);
    }
    if (m === "GET" && action === "alignment") {
      const rev = Number(new URL(req.url).searchParams.get("revision"));
      const r = await rpc(token, "song_alignment", { p_song: id, p_revision: Number.isInteger(rev) && rev > 0 ? rev : null }, f);
      return r.error ? dbFail(r.error) : json(r.data);
    }
    if (m === "PUT" && action === "alignment") {
      if (!validWords(body.words)) return dbFail({ code: "P0001", message: "invalid_words" });
      const r = await rpc<{ revision?: number; conflict?: boolean; current_revision?: number }>(token, "save_song_alignment", { p_song: id, p_base_revision: Number.isInteger(body.base_revision) ? body.base_revision : null, p_words: body.words, p_kind: "manual", p_flags: Array.isArray(body.flags) ? body.flags : [] }, f);
      if (r.error) return dbFail(r.error);
      if (r.data!.conflict) return json({ conflict: { current_revision: r.data!.current_revision } }, 409);
      return json({ revision: r.data!.revision }, 201);
    }
    if (m === "POST" && action === "alignment" && slug[3] === "restore") {
      const r = await rpc<{ revision: number }>(token, "restore_original_alignment", { p_song: id }, f);
      return r.error ? dbFail(r.error) : json({ revision: r.data!.revision }, 201);
    }
  }
  if (a === "demo" && m === "POST" && !id) {
    const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    const r = await rpc<{ song_id: string; project_id: string; job_id: string; replay: boolean }>(token, "open_lyric_demo", { p_ws: null, p_idem: idem }, f);
    if (r.error) return dbFail(r.error);
    if (!r.data!.replay) wake(req, r.data!.job_id);
    return json({ song_id: r.data!.song_id, project_id: r.data!.project_id, job_id: r.data!.job_id }, 202);
  }
  if (a === "media") {
    const sub = id, rest = slug.slice(2);
    if (sub === "items" && m === "POST" && !rest.length) {
      const r = await rpc<{ item_id: string; key: string }>(token, "create_media_item", { p_collection: body.collection_id, p_name: str(body.name), p_kind: str(body.kind), p_mime: str(body.mime), p_bytes: Number(body.bytes) }, f);
      if (r.error) return dbFail(r.error);
      const cfg = r2FromEnv(env); if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
      return json({ item_id: r.data!.item_id, url: await r2Url(cfg, "PUT", r.data!.key, 900), expires_at: new Date(Date.now() + 900_000).toISOString() }, 201);
    }
    if (sub === "items" && UUID.test(rest[0] ?? "") && rest[1] === "complete" && m === "POST") {
      const r = await rpc(token, "complete_media_item", { p_item: rest[0], p_duration_ms: Number(body.duration_ms) || null, p_width: Number(body.width) || null, p_height: Number(body.height) || null }, f);
      return r.error ? dbFail(r.error) : json({ status: r.data }, 200);
    }
    if (sub === "items" && UUID.test(rest[0] ?? "") && rest[1] === "url" && m === "GET") {
      const r = await rpc<{ key: string; backend: string; status: string }>(token, "media_item_object", { p_item: rest[0] }, f);
      if (r.error) return dbFail(r.error);                                // de otro usuario: 404 sin firmar
      if (r.data!.backend !== "r2") return dbFail({ code: "P0001", message: "legacy_song" });
      if (r.data!.status !== "ready") return dbFail({ code: "P0001", message: "not_ready" });
      const cfg = r2FromEnv(env); if (!cfg) return json({ error: { code: "not_configured", message: "El almacenamiento no está configurado." } }, 503);
      return json({ url: await r2Url(cfg, "GET", r.data!.key, 3600), expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if ((sub === "split" || sub === "cut") && m === "POST" && !rest.length) {
      const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
      const r = sub === "split"
        ? await rpc<{ job_id: string; replay: boolean }>(token, "request_media_split", { p_source: body.source_id, p_collection: body.collection_id, p_params: { length_s: body.length_s, min_s: body.min_s, max_s: body.max_s, start_ms: body.start_ms, end_ms: body.end_ms }, p_idem: idem }, f)
        : await rpc<{ job_id: string; replay: boolean }>(token, "request_media_cut", { p_source: body.source_id, p_collection: body.collection_id, p_segments: body.segments, p_cut_mode: str(body.cut_mode), p_idem: idem }, f);
      if (r.error) return dbFail(r.error);
      if (!r.data!.replay) wake(req, r.data!.job_id);
      return json({ job_id: r.data!.job_id }, 202);
    }
  }
  if (a === "projects" && m === "POST" && UUID.test(id ?? "") && action === "variants") {
    const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "missing_idempotency_key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    const v = body.variants;
    if (!Array.isArray(v) || v.length < 1 || v.length > 10) return json({ error: { code: "invalid_params", message: "Pide entre 1 y 10 variantes." }, field: "variants" }, 400);
    const r = await rpc<{ generation_id: string; clip_ids: string[]; export_ids: string[]; batch_id: string | null; job_id: string | null; warnings: unknown[]; replay: boolean }>(token, "request_lyric_variants", { p_project: id, p_variants: v, p_zip: body.zip !== false, p_idem: idem }, f);
    if (r.error) return dbFail(r.error);
    if (r.data!.job_id && !r.data!.replay) wake(req, r.data!.job_id);
    const { replay: _r, ...out } = r.data!; void _r;
    return json(out, 202);
  }
  if (a === "projects" && m === "POST" && !id) {
    if (!UUID.test(str(body.song_id))) return json({ error: { code: "invalid_params", message: "Elige una canción." }, field: "song_id" }, 400);
    const r = await rpc<string>(token, "create_lyric_project", { p_song: body.song_id, p_mode: str(body.mode), p_name: str(body.name) || null }, f);
    if (r.error) return dbFail(r.error);
    return json({ project_id: r.data }, 201);
  }
  if (a === "projects" && m === "PUT" && UUID.test(id ?? "") && !action) {
    const r = await rpc<string>(token, "save_lyric_project", { p_project: id, p_patch: body }, f);
    if (r.error) return dbFail(r.error);
    return json({ saved_at: r.data }, 200);
  }
  return notFound();
}
