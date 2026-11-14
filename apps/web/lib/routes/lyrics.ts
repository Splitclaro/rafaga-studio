// API de Lyric Studio v2.
//  POST /api/lyrics/songs               {upload_id,title,artist?,lyrics?} → 201 {song_id,project_id} (repetible)
//  GET  /api/lyrics/songs/:id/audio     → {url,expires_at} (URL de R2, 3600 s) tras comprobar acceso como el usuario
//  POST /api/lyrics/projects            {song_id,mode,name?}  → 201 {project_id}
//  PUT  /api/lyrics/projects/:id        parche de la pieza    → 200 {saved_at}
import { r2FromEnv, r2Url } from "@rafaga/providers/r2";
import { bearer, rpc, json, mapDbError, sessionUser, type Fetch, type DbError } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface LyricDeps { f?: Fetch; env?: Record<string, string | undefined> }
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);

/** Errores propios de letra; lo demás pasa por `mapDbError` (catálogo común). */
const LYRIC_ERRORS: Record<string, [number, string]> = {
  file_too_large: [413, "La canción supera los 60 MiB. Exporta una versión más ligera (MP3 o M4A) y vuelve a subirla."],
  unsupported_file: [415, "Sube un archivo de audio: MP3, WAV, M4A, AAC, FLAC u OGG."],
  legacy_song: [409, "Esta canción es del flujo anterior. Súbela de nuevo para usarla aquí."],
  not_ready: [409, "La canción aún se está preparando."],
  invalid_params: [400, "Revisa los datos enviados."],
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
  const f = d.f ?? fetch, env = d.env ?? process.env;
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
