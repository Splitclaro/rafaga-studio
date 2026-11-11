// OAuth 2.0 (código de autorización + PKCE) para Google (YouTube, Drive) y Dropbox. Módulo PURO: construye URLs, intercambia y
// renueva tokens con `fetch`. Los secretos de cliente solo viven en el servidor; los tokens nunca llegan al navegador (ver docs/integrations.md).
export type OAuthProvider = "google" | "dropbox";
export type Capability = "import_youtube" | "import_drive" | "import_dropbox";
export interface ProviderConfig { clientId: string; clientSecret: string }
export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: string | null; scopes: string[]; accountLabel: string | null }

/** Permisos mínimos por capacidad. Publicar en YouTube exige `youtube.upload` y revisión de Google: no se pide hasta que esté autorizado. */
export const SCOPES: Record<Capability, string[]> = {
  import_youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
  import_drive: ["https://www.googleapis.com/auth/drive.readonly"],
  import_dropbox: ["files.metadata.read", "files.content.read", "account_info.read"],
};
export const PROVIDER_OF: Record<Capability, OAuthProvider> = { import_youtube: "google", import_drive: "google", import_dropbox: "dropbox" };
export const ENDPOINTS: Record<OAuthProvider, { auth: string; token: string; revoke: string; whoami: string }> = {
  google: { auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", revoke: "https://oauth2.googleapis.com/revoke", whoami: "https://www.googleapis.com/oauth2/v3/userinfo" },
  dropbox: { auth: "https://www.dropbox.com/oauth2/authorize", token: "https://api.dropboxapi.com/oauth2/token", revoke: "https://api.dropboxapi.com/2/auth/token/revoke", whoami: "https://api.dropboxapi.com/2/users/get_current_account" },
};

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** PKCE: verificador aleatorio y su reto S256. Funciona en navegador y en Node. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(48); crypto.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}
export const randomState = () => { const r = new Uint8Array(24); crypto.getRandomValues(r); return b64url(r); };

/** URL de autorización. `state` ata la petición al usuario (anti-CSRF); el reto PKCE evita el robo del código. */
export function authUrl(provider: OAuthProvider, o: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string }): string {
  const p = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", state: o.state, code_challenge: o.challenge, code_challenge_method: "S256" });
  if (provider === "google") { p.set("scope", o.scopes.join(" ")); p.set("access_type", "offline"); p.set("prompt", "consent"); p.set("include_granted_scopes", "true"); }
  else { p.set("scope", o.scopes.join(" ")); p.set("token_access_type", "offline"); }
  return `${ENDPOINTS[provider].auth}?${p}`;
}

export class OAuthError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const scrub = (s: string) => s.replace(/(client_secret|refresh_token|access_token)=[^&\s]+/g, "$1=…").slice(0, 300);
type Fetch = typeof fetch;
interface TokenResp { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
export function parseTokens(j: TokenResp, now = Date.now(), fallbackScopes: string[] = [], prevRefresh: string | null = null): Tokens {
  if (!j.access_token) throw new OAuthError(400, `${j.error ?? "token_error"}: ${j.error_description ?? "sin access_token"}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? prevRefresh, expiresAt: j.expires_in ? new Date(now + j.expires_in * 1000).toISOString() : null, scopes: j.scope ? j.scope.split(/[ ,]+/).filter(Boolean) : fallbackScopes, accountLabel: null };
}
async function post(url: string, body: URLSearchParams, f: Fetch, who: string, headers: Record<string, string> = {}): Promise<TokenResp> {
  const r = await f(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers }, body });
  const text = await r.text();
  let j: TokenResp = {}; try { j = JSON.parse(text); } catch { /* respuesta no JSON */ }
  if (!r.ok) throw new OAuthError(r.status, `${who} ${r.status}: ${scrub(j.error_description ?? j.error ?? text)}`);
  return j;
}
/** Canjea el código por tokens (servidor: usa el secreto de cliente y el verificador PKCE). */
export async function exchangeCode(provider: OAuthProvider, cfg: ProviderConfig, o: { code: string; redirectUri: string; verifier: string; scopes: string[]; fetchImpl?: Fetch }): Promise<Tokens> {
  const f = o.fetchImpl ?? fetch;
  const body = new URLSearchParams({ grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri, code_verifier: o.verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  return parseTokens(await post(ENDPOINTS[provider].token, body, f, `${provider} token`), Date.now(), o.scopes);
}
/** Renueva con el refresh token. Google no devuelve refresh nuevo: se conserva el anterior. */
export async function refreshTokens(provider: OAuthProvider, cfg: ProviderConfig, refreshToken: string, scopes: string[], fetchImpl?: Fetch): Promise<Tokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  return parseTokens(await post(ENDPOINTS[provider].token, body, fetchImpl ?? fetch, `${provider} refresh`), Date.now(), scopes, refreshToken);
}
/** ¿Hace falta renovar? Con margen de 2 minutos. Sin caducidad conocida (Dropbox sin offline) no se renueva. */
export const needsRefresh = (expiresAt: string | null, now = Date.now(), marginMs = 120_000) => !!expiresAt && new Date(expiresAt).getTime() - now < marginMs;

/** Prueba real de la conexión: identidad de la cuenta con el token. Devuelve la etiqueta que se muestra (correo o nombre). */
export async function whoami(provider: OAuthProvider, accessToken: string, fetchImpl?: Fetch): Promise<string> {
  const f = fetchImpl ?? fetch;
  if (provider === "google") {
    const r = await f(ENDPOINTS.google.whoami, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new OAuthError(r.status, `google userinfo ${r.status}`);
    const j = (await r.json()) as { email?: string; name?: string }; return j.email ?? j.name ?? "Cuenta de Google";
  }
  const r = await f(ENDPOINTS.dropbox.whoami, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new OAuthError(r.status, `dropbox account ${r.status}`);
  const j = (await r.json()) as { email?: string; name?: { display_name?: string } }; return j.email ?? j.name?.display_name ?? "Cuenta de Dropbox";
}
/** Revocación en el proveedor (además de borrar la conexión). Un fallo aquí no impide la desconexión local. */
export async function revoke(provider: OAuthProvider, token: string, fetchImpl?: Fetch): Promise<boolean> {
  const f = fetchImpl ?? fetch;
  try {
    const r = provider === "google" ? await f(`${ENDPOINTS.google.revoke}?token=${encodeURIComponent(token)}`, { method: "POST" }) : await f(ENDPOINTS.dropbox.revoke, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return r.ok;
  } catch { return false; }
}

/** Acciones reales permitidas por capacidad (lo que la API oficial deja hacer con esos permisos). */
export async function listYouTubeVideos(accessToken: string, fetchImpl?: Fetch): Promise<{ id: string; title: string; publishedAt: string }[]> {
  const f = fetchImpl ?? fetch;
  const ch = await f("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!ch.ok) throw new OAuthError(ch.status, `youtube channels ${ch.status}`);
  const uploads = ((await ch.json()) as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const pl = await f(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=25&playlistId=${uploads}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!pl.ok) throw new OAuthError(pl.status, `youtube playlist ${pl.status}`);
  return (((await pl.json()) as { items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[] }).items ?? []).flatMap((x) => (x.snippet?.resourceId?.videoId ? [{ id: x.snippet.resourceId.videoId, title: x.snippet.title ?? "", publishedAt: x.snippet.publishedAt ?? "" }] : []));
}
export async function listDriveVideos(accessToken: string, fetchImpl?: Fetch): Promise<{ id: string; name: string; size: number; mimeType: string }[]> {
  const q = encodeURIComponent("mimeType contains 'video/' and trashed = false");
  const r = await (fetchImpl ?? fetch)(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=25&fields=files(id,name,size,mimeType)&orderBy=modifiedTime desc`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new OAuthError(r.status, `drive files ${r.status}`);
  return (((await r.json()) as { files?: { id: string; name: string; size?: string; mimeType: string }[] }).files ?? []).map((x) => ({ id: x.id, name: x.name, size: Number(x.size ?? 0), mimeType: x.mimeType }));
}
export async function listDropboxVideos(accessToken: string, fetchImpl?: Fetch): Promise<{ path: string; name: string; size: number }[]> {
  const r = await (fetchImpl ?? fetch)("https://api.dropboxapi.com/2/files/search_v2", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "mp4 mov", options: { file_categories: ["video"], max_results: 25 } }) });
  if (!r.ok) throw new OAuthError(r.status, `dropbox search ${r.status}`);
  return (((await r.json()) as { matches?: { metadata?: { metadata?: { path_display?: string; name?: string; size?: number } } }[] }).matches ?? []).flatMap((m) => { const x = m.metadata?.metadata; return x?.path_display ? [{ path: x.path_display, name: x.name ?? "", size: x.size ?? 0 }] : []; });
}
