// POST /api/import/link     {url,name?}      → 202 {job_id,import_id,project_id} · 400 {reason: not_https|private_address|redirect_private|bad_url}
// POST /api/import/drive    {file_id,name?}  → 202   (requiere conexión de Google con Drive)
// POST /api/import/dropbox  {path,name?}     → 202   (requiere conexión de Dropbox)
// POST /api/publish         {export_id,platform,title,description?,privacy?,scheduled_at?,connection_id?,music_origin?} → 202 {publication_id,state}  (Idempotency-Key)
// GET  /api/tiktok                       → {accounts:[{id,alias,account_label,status,profile,…}]}   (sin tokens)
// PATCH /api/tiktok/:id {alias?,profile?} → guarda alias y perfil de contenido de una cuenta
// POST /api/tiktok/:id/disconnect        → revoca en TikTok y borra la conexión (cancela sus programadas)
// POST /api/tiktok/copy {account_name,profile?,songs:[{title,artist?,genre?,line?}]} → {copies:[{title,description,hashtags,source}]}  (IA si hay clave; si no, plantilla)
// POST /api/publish/:id/cancel → cancela una publicación programada o fallida
// Cualquier otro valor de [integration] → 404.
import { runAfter } from "../after.ts";
import { preflightLink, LinkError, type PreflightDeps } from "@rafaga/providers/net";
import { revoke } from "@rafaga/providers/oauth";
import { aiConfig, groqChat } from "@rafaga/providers/groq";
import { copyPrompt, parseCopy, templateCopy, type AccountProfile, type SongInfo } from "../tiktokplan.ts";
import { bearer, rpc, json, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface IntegrationDeps { f?: Fetch; ai?: Fetch; provider?: Fetch; net?: PreflightDeps; wake?: (req: Request, jobId: string) => void }
const notFound = () => json({ error: { code: "not_found", message: "No encontrado." } }, 404);
const bad = (code: string, message: string, extra: Record<string, unknown> = {}) => json({ error: { code, message }, ...extra }, 400);
const missingIdem = () => bad("missing_idempotency_key", "Falta la cabecera Idempotency-Key.");
function defaultWake(req: Request, jobId: string) {
  runAfter(() => fetch(new URL("/api/wake", req.url), { method: "POST", headers: { Authorization: req.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }));
}
const LINK_TEXT: Record<string, string> = {
  not_https: "El enlace debe empezar por https://.", private_address: "Ese enlace apunta a una dirección privada o interna; no se puede importar.",
  redirect_private: "El enlace redirige a una dirección privada; no se puede importar.", bad_url: "El enlace no es válido.",
};
const DB_TEXT: Record<string, [number, string]> = {
  not_connected: [409, "Conecta primero la cuenta en Conexiones."], render_not_ready: [409, "La exportación todavía no está lista."],
  invalid_privacy: [400, "Esa privacidad no existe en la plataforma elegida."], invalid_publication: [400, "Revisa el título y la plataforma."],
  invalid_import: [400, "Revisa el origen de la importación."], not_cancellable: [409, "Esta publicación ya no se puede cancelar."],
  account_required: [409, "Elige la cuenta de TikTok donde publicar."], account_paused: [409, "Esa cuenta está en pausa."], music_origin_required: [400, "Indica el origen de la música antes de publicar."],
  daily_cap: [409, "Esa cuenta ya tiene el máximo de publicaciones de ese día."], duplicate_publication: [409, "Ese vídeo ya está programado o publicado en esa cuenta."], invalid_profile: [400, "El perfil de la cuenta no es válido."],
};
function dbFail(e: { code: string; message: string; details?: string | null }) {
  const t = DB_TEXT[e.message]; if (t) return json({ error: { code: e.message, message: t[1] } }, t[0]);
  return e.code === "P0002" ? notFound() : mapDbError(e);
}

export async function handleIntegrations(req: Request, integration: string, rest: string[], d: IntegrationDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, wake = d.wake ?? defaultWake;
  if (integration === "tiktok") return handleTikTok(req, rest, d);
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
  const conn = str(b.connection_id), music = str(b.music_origin);
  if (conn && !UUID.test(conn)) return bad("invalid_publication", "La cuenta elegida no es válida.");
  if (music && !["own", "licensed", "free", "risk"].includes(music)) return bad("invalid_publication", "El origen de la música no es válido.");
  const r = await rpc<{ publication_id: string; state: string; job_id: string | null; replay: boolean }>(token, "request_publication", {
    p_render: str(b.export_id), p_platform: platform, p_title: str(b.title), p_description: str(b.description) || null, p_privacy: str(b.privacy) || null, p_scheduled_at: at, p_idem: idem,
    p_connection: conn || null, p_music: music || null }, f);
  if (r.error) return dbFail(r.error);
  if (r.data?.job_id && !r.data.replay) wake(req, r.data.job_id);
  return json(r.data, 202);
}

// ───────── Cuentas de TikTok y textos ─────────
async function handleTikTok(req: Request, rest: string[], d: IntegrationDeps): Promise<Response> {
  const f = d.f ?? fetch;
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const token = bearer(req), id = rest[0] ?? "", str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (req.method === "GET" && !rest.length) {
    const r = await rpc<Record<string, unknown>[]>(token, "oauth_status", {}, f);
    if (r.error) return dbFail(r.error);
    return json({ accounts: (r.data ?? []).filter((c) => c.provider === "tiktok") });
  }
  if (req.method !== "POST" && req.method !== "PATCH") return json({ error: { code: "method_not_allowed", message: "Método no permitido." } }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (req.method === "PATCH" && UUID.test(id) && rest.length === 1) {
    const prof = b.profile && typeof b.profile === "object" && !Array.isArray(b.profile) ? cleanProfile(b.profile as Record<string, unknown>) : null;
    const r = await rpc(token, "oauth_set_profile", { p_conn: id, p_alias: str(b.alias) || null, p_profile: prof }, f);
    return r.error ? dbFail(r.error) : json({ ok: true });
  }
  if (req.method === "POST" && UUID.test(id) && rest[1] === "disconnect") {
    const r = await rpc<{ token: string }>(token, "oauth_disconnect_account", { p_conn: id }, f);
    if (r.error) return dbFail(r.error);
    if (r.data?.token) await revoke("tiktok", r.data.token, d.provider).catch(() => false);   // un fallo del proveedor no impide la desconexión local
    return json({ ok: true });
  }
  if (req.method === "POST" && id === "copy" && rest.length === 1) {
    const songs = (Array.isArray(b.songs) ? b.songs : []).slice(0, 20).map((s) => { const o = (s ?? {}) as Record<string, unknown>; return { title: str(o.title).slice(0, 120), artist: str(o.artist).slice(0, 120) || null, genre: str(o.genre).slice(0, 40) || null, line: str(o.line).slice(0, 200) || null } as SongInfo; }).filter((s) => s.title);
    if (!songs.length) return bad("invalid_copy", "Indica al menos una canción.");
    const profile = cleanProfile((b.profile ?? {}) as Record<string, unknown>), name = str(b.account_name).slice(0, 60) || "TikTok";
    const cfg = aiConfig(process.env);
    if (cfg.key) {
      try {
        const p = copyPrompt(songs, profile, name), out = await groqChat(cfg, { system: p.system, user: p.user, json: true, maxTokens: 3000, fetchImpl: d.ai });
        return json({ copies: parseCopy(out.text, songs, profile), model: out.model });
      } catch { /* sin IA disponible: plantilla, indicada como tal */ }
    }
    return json({ copies: songs.map((s, i) => templateCopy(s, profile, i)), note: cfg.key ? "La IA no respondió; se usó la plantilla." : "La IA no está configurada en el servidor; se usó la plantilla." });
  }
  return notFound();
}
export function cleanProfile(p: Record<string, unknown>): AccountProfile {
  const o: AccountProfile = {}, s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);
  if (s(p.tone, 300)) o.tone = s(p.tone, 300); if (s(p.language, 8)) o.language = s(p.language, 8); if (s(p.emoji, 8)) o.emoji = s(p.emoji, 8); if (s(p.bio, 300)) o.bio = s(p.bio, 300);
  if (Array.isArray(p.hashtags)) o.hashtags = p.hashtags.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^#+/, "").trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  if (Array.isArray(p.slots)) o.slots = p.slots.filter((x): x is string => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).slice(0, 10);
  if (typeof p.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/.test(p.tz)) o.tz = p.tz;
  if (Number.isFinite(Number(p.daily_cap))) o.daily_cap = Math.max(1, Math.min(30, Math.round(Number(p.daily_cap))));
  if (Number.isFinite(Number(p.hashtag_count))) o.hashtag_count = Math.max(3, Math.min(8, Math.round(Number(p.hashtag_count))));
  if (typeof p.privacy === "string" && ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"].includes(p.privacy)) o.privacy = p.privacy as AccountProfile["privacy"];
  if (typeof p.paused === "boolean") o.paused = p.paused;
  return o;
}
