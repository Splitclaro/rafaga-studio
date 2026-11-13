// POST /api/clips/:id/versions   → nueva versión inmutable (409 con la versión vigente si la base está obsoleta)
// PUT  /api/clips/:id/draft      → borrador del autoguardado (una fila por clip)
// POST /api/clips/:id/transcript → revisión de la transcripción: nueva versión SOLO para los clips que el usuario no ha editado
// POST /api/clips/:id/translate  → traducción de subtítulos (0,1 unidades por minuto de texto afectado)
import { bearer, rpc, rest, json, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASPECTS = ["9:16", "16:9", "1:1"], LAYOUTS = ["single_track", "split_two", "active_speaker", "screen_presenter", "fit_full", "manual"];
interface ClipRow { id: string; workspace_id: string; project_id: string; current_version: number; generation_id: string; user_edited: boolean }
interface VerRow { composition: Record<string, unknown>; aspect: string | null; layout: string | null; template: string | null }

export async function handleClips(req: Request, slug: string[], f: Fetch = fetch): Promise<Response> {
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req), [id, action] = slug;
  if (!UUID.test(id ?? "") || slug.length !== 2) return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
  const clip = (await rest<ClipRow>(token, `clips?id=eq.${id}&limit=1`, f))[0];
  if (!clip) return json({ error: { code: "not_found", message: "No encontrado." } }, 404);          // sin acceso o inexistente: igual respuesta
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "draft" && req.method === "PUT") {
    if (!Number.isInteger(body.base_version) || typeof body.spec !== "object" || !body.spec) return json({ error: { code: "invalid_params", message: "Borrador no válido." } }, 400);
    const r = await rpc<string>(token, "save_clip_draft", { p_clip: id, p_base_version: body.base_version, p_spec: body.spec }, f);
    return r.error ? mapDbError(r.error) : json({ saved_at: r.data });
  }

  if (action === "versions" && req.method === "POST") {
    const c = body.composition as Record<string, unknown> | undefined;
    if (!Number.isInteger(body.base_version) || !c || c.v !== 2 || !ASPECTS.includes(String(body.aspect)) || !LAYOUTS.includes(String(body.layout))) return json({ error: { code: "invalid_params", message: "Versión no válida." } }, 400);
    const r = await rpc<{ version?: number; conflict?: boolean; current_version?: number }>(token, "save_clip_version", {
      p_clip: id, p_base_version: body.base_version, p_aspect: body.aspect, p_layout: body.layout, p_template: body.template ?? null, p_spec: c, p_user_edit: body.user_edit !== false }, f);
    if (r.error) return mapDbError(r.error);
    if (r.data?.conflict) return json({ conflict: { current_version: r.data.current_version } }, 409);
    return json({ version: r.data!.version }, 201);
  }

  if (action === "transcript" && req.method === "POST") {
    const gen = (await rest<{ transcript_id: string }>(token, `generations?id=eq.${clip.generation_id}&limit=1`, f))[0];
    if (!gen || !Array.isArray(body.words)) return json({ error: { code: "invalid_params", message: "Transcripción no válida." } }, 400);
    const rev = await rpc<{ revision: number; follow_clips: string[] }>(token, "apply_transcript_revision", { p_transcript: gen.transcript_id, p_words: body.words }, f);
    if (rev.error) return mapDbError(rev.error);
    const updated: string[] = [];
    for (const cid of rev.data!.follow_clips) {            // solo clips con user_edited = false: los editados por el usuario conservan sus versiones
      const c = (await rest<ClipRow>(token, `clips?id=eq.${cid}&limit=1`, f))[0]; if (!c || c.user_edited) continue;
      const v = (await rest<VerRow & { version: number }>(token, `clip_versions?clip_id=eq.${cid}&version=eq.${c.current_version}&limit=1`, f))[0]; if (!v) continue;
      const r = await rpc<{ version?: number }>(token, "save_clip_version", { p_clip: cid, p_base_version: c.current_version, p_aspect: v.aspect ?? "9:16", p_layout: v.layout ?? "fit_full", p_template: v.template, p_spec: { ...v.composition, transcript_revision: rev.data!.revision }, p_user_edit: false }, f);
      if (r.data?.version) updated.push(cid);
    }
    return json({ revision: rev.data!.revision, updated }, 201);
  }

  if (action === "translate" && req.method === "POST") {
    const idem = idempotencyKey(req); if (!idem) return json({ error: { code: "invalid_params", field: "Idempotency-Key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    const groups = body.groups, lang = String(body.target_language ?? "");
    if (!Array.isArray(groups) || !groups.length || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang) || JSON.stringify(groups).length > 7000) return json({ error: { code: "invalid_params", message: "Grupos o idioma no válidos." } }, 400);
    const minutes = Math.max(0.1, (groups as { end: number; start: number }[]).reduce((t, g) => t + Math.max(0, g.end - g.start), 0) / 60), units = Math.round(minutes * 0.1 * 100) / 100;
    const r = await rpc<{ job_id: string }>(token, "enqueue_job", { p_ws: clip.workspace_id, p_kind: "translate", p_stages: [{ stage: "translate", seq: 1, units, params: { groups, target_language: lang, clip_id: id } }], p_idem: idem, p_params: { clip_id: id, target_language: lang }, p_project: clip.project_id, p_generation: null }, f);
    return r.error ? mapDbError(r.error) : json({ job_id: r.data!.job_id, units }, 202);
  }
  return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
}
