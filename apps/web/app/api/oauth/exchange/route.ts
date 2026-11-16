import { NextResponse } from "next/server";
import { exchangeCode, whoami, SCOPES, PROVIDER_OF, OAuthError } from "@rafaga/providers/oauth";
import { providerConfig, redirectUri, isCap, bearer, rpcAs } from "../../../../lib/oauthserver";
import { userFrom } from "../../../../lib/ytserver";
export const dynamic = "force-dynamic";

/** POST {capability, code, verifier} → canjea el código (secreto de cliente en servidor), comprueba la cuenta y guarda los tokens en la base de datos como el usuario. El navegador solo recibe el estado. */
export async function POST(req: Request) {
  if (!(await userFrom(req))) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { capability?: unknown; code?: string; verifier?: string; alias?: string };
  if (!isCap(b.capability) || !b.code || !b.verifier) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const provider = PROVIDER_OF[b.capability], cfg = providerConfig(provider);
  if (!cfg) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  try {
    const t = await exchangeCode(provider, cfg, { code: b.code, redirectUri: redirectUri(req), verifier: b.verifier, scopes: SCOPES[b.capability] });
    let label = "";
    try { label = await whoami(provider, t.accessToken); } catch { label = provider === "google" ? "Cuenta de Google" : "Cuenta de Dropbox"; }
    const alias = typeof b.alias === "string" ? b.alias.trim().slice(0, 60) : "";
    if (provider === "tiktok" && !t.openId) return NextResponse.json({ error: "exchange_failed", message: "TikTok no devolvió el identificador de la cuenta; vuelve a intentarlo." }, { status: 502 });
    const r = await rpcAs(bearer(req), "oauth_save", { p_provider: provider, p_label: label, p_scopes: t.scopes, p_access: t.accessToken, p_refresh: t.refreshToken, p_expires_at: t.expiresAt, p_account: provider === "tiktok" ? t.openId : "", p_alias: alias || null });
    if (r.error) return NextResponse.json({ error: "save_failed", message: r.error.includes("account_limit") ? "Ya tienes 5 cuentas de TikTok conectadas. Desconecta una para añadir otra." : r.error.includes("not_found") ? "Solo un responsable del espacio puede conectar cuentas." : r.error }, { status: 403 });
    return NextResponse.json({ ok: true, provider, account_label: label, scopes: t.scopes });
  } catch (e) {
    const err = e as OAuthError;
    return NextResponse.json({ error: "exchange_failed", message: err.message.replace(/[A-Za-z0-9_-]{30,}/g, "…") }, { status: 502 });
  }
}
