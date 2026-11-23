// Cliente mínimo de Zernio (publicación orgánica en TikTok). Sin SDK: `fetch` inyectable, sin red en las pruebas.
// La clave (ZERNIO_API_KEY) solo se envía a la API de Zernio; nunca a la URL de subida firmada ni al navegador.
import { createHmac, timingSafeEqual } from "node:crypto";

export const ZERNIO_BASE = "https://zernio.com/api/v1";
export const MAX_TARGETS = 2;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ZernioTarget { accountId: string; username: string }
export type ZernioConfig = { ok: true; key: string; targets: ZernioTarget[]; workspaceId: string; webhookSecret: string | null } | { ok: false; reason: string };
const norm = (u: string) => `@${u.trim().replace(/^@+/, "").toLowerCase()}`;

/** Lee la configuración del servidor: clave, espacio autorizado y la lista cerrada de destinos (máximo 2). */
export function zernioConfig(env: Record<string, string | undefined>): ZernioConfig {
  const key = env.ZERNIO_API_KEY?.trim();
  if (!key) return { ok: false, reason: "ZERNIO_API_KEY no está configurada" };
  const ws = env.ZERNIO_WORKSPACE_ID?.trim().toLowerCase();
  if (!ws || !UUID_RE.test(ws)) return { ok: false, reason: "ZERNIO_WORKSPACE_ID no es un UUID válido" };
  let raw: unknown;
  try { raw = JSON.parse(env.ZERNIO_TARGETS ?? ""); } catch { return { ok: false, reason: "ZERNIO_TARGETS no es JSON válido" }; }
  if (!Array.isArray(raw) || raw.length < 1) return { ok: false, reason: "ZERNIO_TARGETS debe listar los destinos autorizados" };
  if (raw.length > MAX_TARGETS) return { ok: false, reason: `ZERNIO_TARGETS admite como máximo ${MAX_TARGETS} destinos` };
  const targets: ZernioTarget[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    const id = typeof t?.accountId === "string" ? t.accountId.trim() : "", u = typeof t?.username === "string" ? t.username.trim() : "";
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id) || !u) return { ok: false, reason: "Cada destino necesita accountId y username" };
    targets.push({ accountId: id, username: norm(u) });
  }
  if (new Set(targets.map((t) => t.accountId)).size !== targets.length) return { ok: false, reason: "ZERNIO_TARGETS repite una cuenta" };
  return { ok: true, key, targets, workspaceId: ws, webhookSecret: env.ZERNIO_WEBHOOK_SECRET?.trim() || null };
}
export const findTarget = (c: Extract<ZernioConfig, { ok: true }>, accountId: string) => c.targets.find((t) => t.accountId === accountId);
export const sameUser = (a: string, b: string) => norm(a) === norm(b);

export type ZernioErrorKind = "rate" | "payment" | "auth" | "conflict" | "invalid" | "server" | "network";
export class ZernioError extends Error {
  kind: ZernioErrorKind; status: number; retryAfterS?: number; body?: unknown;
  constructor(kind: ZernioErrorKind, status: number, message: string, retryAfterS?: number, body?: unknown) { super(message); this.name = "ZernioError"; this.kind = kind; this.status = status; this.retryAfterS = retryAfterS; this.body = body; }
}
const scrub = (s: string, key: string) => (key ? s.split(key).join("…") : s).slice(0, 300);

/** Llamada autenticada a la API. Clasifica los errores: 429 (con Retry-After), 402 (pago), 409, 4xx, 5xx y fallos de red (resultado indeterminado). */
export async function zernioFetch<T = Record<string, unknown>>(f: typeof fetch, key: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; data: T }> {
  let r: Response;
  try {
    r = await f(`${ZERNIO_BASE}${path}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${key}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers }, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  } catch (e) { throw new ZernioError("network", 0, scrub((e as Error).message, key)); }
  const data = (await r.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown; details?: { retryAfterSeconds?: number } };
  if (r.status >= 200 && r.status < 300) return { status: r.status, data };
  const msg = scrub(String(typeof data?.error === "string" ? data.error : data?.message ?? `Zernio respondió ${r.status}`), key);
  if (r.status === 429) { const h = Number(r.headers.get("retry-after")), d = Number(data?.details?.retryAfterSeconds); throw new ZernioError("rate", 429, msg, Math.max(1, Number.isFinite(h) && h > 0 ? h : Number.isFinite(d) && d > 0 ? d : 60), data); }
  if (r.status === 402) throw new ZernioError("payment", 402, msg, undefined, data);
  if (r.status === 401 || r.status === 403) throw new ZernioError("auth", r.status, msg, undefined, data);
  if (r.status === 409) throw new ZernioError("conflict", 409, msg, Number(r.headers.get("retry-after")) || undefined, data);
  if (r.status >= 500) throw new ZernioError("server", r.status, msg, undefined, data);
  throw new ZernioError("invalid", r.status, msg, undefined, data);
}

// ───────── Cuentas ─────────
export interface AccountHealth { accountId: string; platform?: string; username?: string; status?: string; canPost?: boolean; tokenValid?: boolean; needsReconnect?: boolean; issues?: unknown[] }
export async function accountHealth(f: typeof fetch, key: string): Promise<{ summary?: { total?: number }; accounts: AccountHealth[] }> {
  const r = await zernioFetch<{ summary?: { total?: number }; accounts?: AccountHealth[] }>(f, key, "/accounts/health");
  return { summary: r.data.summary, accounts: r.data.accounts ?? [] };
}
/** Cruza los destinos configurados con la salud real: el @usuario debe coincidir y la cuenta debe poder publicar. `extra` = conexiones de más en el equipo (el plan gratuito cuenta todas). */
export function checkTargets(cfg: Extract<ZernioConfig, { ok: true }>, h: { summary?: { total?: number }; accounts: AccountHealth[] }) {
  const targets = cfg.targets.map((t) => {
    const a = h.accounts.find((x) => x.accountId === t.accountId);
    const problems: string[] = [];
    if (!a) problems.push("La cuenta no aparece en Zernio (¿se reconectó con otro ID?).");
    else {
      if (a.platform && a.platform !== "tiktok") problems.push("La cuenta no es de TikTok.");
      if (a.username && !sameUser(a.username, t.username)) problems.push(`El usuario en Zernio es ${norm(a.username)}, no ${t.username}. Verifica la identidad antes de actualizar el destino.`);
      if (a.canPost === false || a.needsReconnect || a.tokenValid === false) problems.push("La cuenta no puede publicar ahora; reconéctala en Zernio.");
    }
    return { accountId: t.accountId, username: t.username, ok: problems.length === 0, problems };
  });
  const total = h.summary?.total ?? h.accounts.length;
  return { targets, total, extra: Math.max(0, total - cfg.targets.length) };
}

// ───────── Datos del creador ─────────
export interface CreatorInfo {
  creator?: { nickname?: string; isVerified?: boolean; canPostMore?: boolean };
  privacyLevels?: { value: string; label?: string }[];
  postingLimits?: { maxVideoDurationSec?: number; interactionSettings?: Record<string, { enabled?: boolean; required?: boolean; default?: boolean } | null> };
  commercialContentTypes?: { value: string; label?: string }[];
}
export const creatorInfo = async (f: typeof fetch, key: string, accountId: string) =>
  (await zernioFetch<CreatorInfo>(f, key, `/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=video`)).data;
/** ¿Puede esa cuenta publicar un vídeo público de esa duración? Devuelve el motivo si no. */
export function publicBlocker(ci: CreatorInfo, durationS?: number | null): string | null {
  if (ci.creator?.canPostMore === false) return "TikTok indica que esta cuenta no puede publicar más vídeos ahora (límite diario).";
  if (!(ci.privacyLevels ?? []).some((p) => p.value === "PUBLIC_TO_EVERYONE")) return "Esta cuenta no admite publicaciones públicas (¿cuenta privada o app sin auditar?).";
  const max = ci.postingLimits?.maxVideoDurationSec;
  if (durationS && max && durationS > max) return `El vídeo dura ${Math.round(durationS)} s y esta cuenta admite como máximo ${max} s.`;
  return null;
}

// ───────── Medios y publicación ─────────
/** Sube el MP4 a un almacén temporal de Zernio con una URL firmada. La clave de API NO viaja al `uploadUrl`. */
export async function uploadMedia(f: typeof fetch, key: string, filename: string, bytes: Uint8Array): Promise<string> {
  const p = await zernioFetch<{ uploadUrl?: string; publicUrl?: string }>(f, key, "/media/presign", { method: "POST", body: { filename, contentType: "video/mp4", size: bytes.byteLength } });
  const { uploadUrl, publicUrl } = p.data;
  if (!uploadUrl || !publicUrl || !/^https:\/\//.test(uploadUrl) || !/^https:\/\//.test(publicUrl)) throw new ZernioError("invalid", p.status, "Zernio no devolvió URLs de subida válidas.");
  let r: Response;
  try { r = await f(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes as unknown as BodyInit }); } catch (e) { throw new ZernioError("network", 0, scrub((e as Error).message, key)); }
  if (!r.ok) throw new ZernioError(r.status >= 500 ? "server" : "invalid", r.status, `La subida del vídeo a Zernio falló (${r.status}).`);
  return publicUrl;
}

export interface PostOptions { comment?: boolean; duet?: boolean; stitch?: boolean; commercial?: boolean; own_brand?: boolean; paid_partner?: boolean }
export function buildPostBody(a: { content: string; mediaUrl: string; accountId: string; scheduledForIso: string | null; publishNow: boolean; options?: PostOptions; externalId: string }) {
  const o = a.options ?? {};
  return {
    content: a.content.slice(0, 2200),
    mediaItems: [{ type: "video", url: a.mediaUrl }],
    platforms: [{ platform: "tiktok", accountId: a.accountId }],
    externalId: a.externalId,
    tiktokSettings: {
      privacy_level: "PUBLIC_TO_EVERYONE", draft: false,
      allow_comment: !!o.comment, allow_duet: !!o.duet, allow_stitch: !!o.stitch,
      content_preview_confirmed: true, express_consent_given: true,
      ...(o.commercial ? { commercialContentType: o.paid_partner ? "brand_content" : "brand_organic", isBrandOrganicPost: !!o.own_brand, brandPartnerPromote: !!o.paid_partner } : {}),
    },
    ...(a.publishNow ? { publishNow: true } : { scheduledFor: a.scheduledForIso }),
  };
}
/** ID del post en la respuesta de creación (Zernio usa `_id`; se acepta `id`). */
export const postIdOf = (data: { post?: { _id?: string; id?: string } }) => data.post?._id ?? data.post?.id ?? null;

// ───────── Webhooks ─────────
/** HMAC-SHA256 en hex del cuerpo original con el secreto del endpoint, comparado en tiempo constante. */
export function verifySignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"), got = header.trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
export interface EventUpdate { event_id: string; event: string; zernio_post: string; state: "processing" | "scheduled" | "published" | "failed" | null; url: string | null; code: string | null; message: string | null }
interface RawEvent { id?: string; event?: string; post?: { id?: string; _id?: string; status?: string; platforms?: { platform?: string; status?: string; publishedUrl?: string | null; error?: string | null }[] }; platform?: { name?: string; status?: string; publishedUrl?: string | null; platformPostId?: string; error?: string | null } }
/** Traduce un evento a la actualización de estado que aplica la base de datos. Devuelve null si no es de TikTok o no se puede identificar. */
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
