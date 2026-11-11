import { NextResponse } from "next/server";
import { authUrl, SCOPES, PROVIDER_OF } from "@rafaga/providers/oauth";
import { providerConfig, redirectUri, isCap, bearer } from "../../../../lib/oauthserver";
import { userFrom } from "../../../../lib/ytserver";
export const dynamic = "force-dynamic";

/** POST {capability, state, challenge} → {url}. El navegador genera PKCE y el estado; aquí solo se añade el client_id (público) y los permisos mínimos. */
export async function POST(req: Request) {
  if (!(await userFrom(req))) return NextResponse.json({ error: "no_session" }, { status: 401 });
  void bearer;
  const b = (await req.json().catch(() => ({}))) as { capability?: unknown; state?: string; challenge?: string };
  if (!isCap(b.capability) || !b.state || !b.challenge) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const provider = PROVIDER_OF[b.capability], cfg = providerConfig(provider);
  if (!cfg) return NextResponse.json({ error: "not_configured", message: `Falta configurar ${provider === "google" ? "GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET" : "DROPBOX_CLIENT_ID y DROPBOX_CLIENT_SECRET"} en el servidor.` }, { status: 503 });
  return NextResponse.json({ url: authUrl(provider, { clientId: cfg.clientId, redirectUri: redirectUri(req), scopes: SCOPES[b.capability], state: b.state, challenge: b.challenge }) });
}
