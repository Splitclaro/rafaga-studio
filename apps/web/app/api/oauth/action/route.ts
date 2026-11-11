import { NextResponse } from "next/server";
import { refreshTokens, needsRefresh, whoami, revoke, listYouTubeVideos, listDriveVideos, listDropboxVideos, type OAuthProvider, OAuthError } from "@rafaga/providers/oauth";
import { providerConfig, bearer, rpcAs } from "../../../../lib/oauthserver";
import { userFrom } from "../../../../lib/ytserver";
export const dynamic = "force-dynamic";
type Tok = { access_token: string; refresh_token: string | null; expires_at: string | null; scopes: string[]; status: string };

/** POST {provider, action: "test"|"list"|"disconnect"} — acciones reales con el token (nunca sale al navegador). Renueva si caduca. */
export async function POST(req: Request) {
  if (!(await userFrom(req))) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { provider?: string; action?: string; what?: string };
  const provider = b.provider as OAuthProvider;
  if (!["google", "dropbox"].includes(provider) || !["test", "list", "disconnect"].includes(b.action ?? "")) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const jwt = bearer(req);
  const tr = await rpcAs(jwt, "oauth_token", { p_provider: provider });
  if (tr.error) return NextResponse.json({ error: tr.error.includes("not_connected") ? "not_connected" : "forbidden", message: tr.error.includes("not_connected") ? "No hay conexión con este proveedor." : "Solo un responsable del espacio puede hacerlo." }, { status: 403 });
  const t = tr.data as Tok;
  let access = t.access_token;
  try {
    if (b.action === "disconnect") {
      await revoke(provider, t.refresh_token ?? access);
      await rpcAs(jwt, "oauth_disconnect", { p_provider: provider });
      return NextResponse.json({ ok: true });
    }
    if (needsRefresh(t.expires_at)) {
      const cfg = providerConfig(provider);
      if (!cfg || !t.refresh_token) { await rpcAs(jwt, "oauth_touch", { p_provider: provider, p_access: null, p_expires_at: null, p_status: "expired", p_error: "Token caducado y sin renovación posible" }); return NextResponse.json({ error: "expired", message: "La conexión ha caducado: vuelve a conectar." }, { status: 409 }); }
      const n = await refreshTokens(provider, cfg, t.refresh_token, t.scopes);
      access = n.accessToken; await rpcAs(jwt, "oauth_touch", { p_provider: provider, p_access: n.accessToken, p_expires_at: n.expiresAt, p_status: "connected", p_error: null });
    }
    if (b.action === "test") {
      const label = await whoami(provider, access);
      await rpcAs(jwt, "oauth_touch", { p_provider: provider, p_access: null, p_expires_at: null, p_status: "connected", p_error: null });
      return NextResponse.json({ ok: true, account_label: label, checked_at: new Date().toISOString() });
    }
    const what = b.what ?? (provider === "dropbox" ? "dropbox" : "youtube");
    const items = what === "drive" ? await listDriveVideos(access) : what === "dropbox" ? await listDropboxVideos(access) : await listYouTubeVideos(access);
    return NextResponse.json({ ok: true, what, items });
  } catch (e) {
    const err = e as OAuthError, msg = err.message.replace(/[A-Za-z0-9_-]{30,}/g, "…");
    const status = err.status === 401 ? "expired" : "error";
    await rpcAs(jwt, "oauth_touch", { p_provider: provider, p_access: null, p_expires_at: null, p_status: status, p_error: msg });
    return NextResponse.json({ error: status, message: status === "expired" ? "El proveedor rechazó el token: vuelve a conectar." : msg }, { status: 502 });
  }
}
