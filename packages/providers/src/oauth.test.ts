import { test } from "node:test";
import assert from "node:assert/strict";
import { pkce, randomState, authUrl, exchangeCode, refreshTokens, needsRefresh, whoami, revoke, parseTokens, listYouTubeVideos, listDropboxVideos, SCOPES, OAuthError } from "./oauth.ts";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
test("PKCE: verificador y reto S256 válidos (base64url, sin relleno)", async () => {
  const { verifier, challenge } = await pkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/); assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  const again = await pkce(); assert.notEqual(again.verifier, verifier);
  assert.match(randomState(), /^[A-Za-z0-9_-]{32}$/);
});
test("URL de autorización: permisos mínimos, offline y PKCE; sin secreto", () => {
  const u = new URL(authUrl("google", { clientId: "cid", redirectUri: "https://app/cb", scopes: SCOPES.import_youtube, state: "st", challenge: "ch" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/youtube.readonly"); assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256"); assert.equal(u.searchParams.get("state"), "st"); assert.ok(!u.search.includes("secret"));
  const d = new URL(authUrl("dropbox", { clientId: "cid", redirectUri: "https://app/cb", scopes: SCOPES.import_dropbox, state: "st", challenge: "ch" }));
  assert.equal(d.searchParams.get("token_access_type"), "offline"); assert.ok(d.searchParams.get("scope")!.includes("files.content.read"));
});
test("canje de código: cuerpo correcto y tokens con caducidad; los errores no filtran secretos", async () => {
  let body = "";
  const f = (async (_u: string, init: RequestInit) => { body = String(init.body); return json({ access_token: "A", refresh_token: "R", expires_in: 3600, scope: "a b" }); }) as unknown as typeof fetch;
  const t = await exchangeCode("google", { clientId: "cid", clientSecret: "SECRETO" }, { code: "c", redirectUri: "https://app/cb", verifier: "v", scopes: [], fetchImpl: f });
  const p = new URLSearchParams(body); assert.equal(p.get("grant_type"), "authorization_code"); assert.equal(p.get("code_verifier"), "v"); assert.equal(p.get("client_secret"), "SECRETO");
  assert.equal(t.accessToken, "A"); assert.equal(t.refreshToken, "R"); assert.deepEqual(t.scopes, ["a", "b"]); assert.ok(t.expiresAt && new Date(t.expiresAt).getTime() > Date.now() + 3500_000);
  const bad = (async () => new Response("client_secret=SECRETO&error=invalid_grant", { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(exchangeCode("dropbox", { clientId: "c", clientSecret: "SECRETO" }, { code: "c", redirectUri: "u", verifier: "v", scopes: [], fetchImpl: bad }), (e: OAuthError) => e.status === 400 && !/SECRETO/.test(e.message));
});
test("renovación conserva el refresh token anterior cuando el proveedor no devuelve otro", async () => {
  const f = (async () => json({ access_token: "A2", expires_in: 1800 })) as unknown as typeof fetch;
  const t = await refreshTokens("google", { clientId: "c", clientSecret: "s" }, "R-old", ["x"], f);
  assert.equal(t.accessToken, "A2"); assert.equal(t.refreshToken, "R-old"); assert.deepEqual(t.scopes, ["x"]);
  assert.throws(() => parseTokens({ error: "invalid_grant" }), /invalid_grant/);
});
test("needsRefresh: margen de 2 minutos; sin caducidad no se renueva", () => {
  const now = Date.now();
  assert.equal(needsRefresh(new Date(now + 60_000).toISOString(), now), true);
  assert.equal(needsRefresh(new Date(now + 600_000).toISOString(), now), false);
  assert.equal(needsRefresh(null, now), false);
});
test("prueba real de cuenta y revocación tolerante", async () => {
  const g = (async () => json({ email: "ana@ejemplo.com" })) as unknown as typeof fetch;
  assert.equal(await whoami("google", "A", g), "ana@ejemplo.com");
  const d = (async () => json({ name: { display_name: "Ana" } })) as unknown as typeof fetch;
  assert.equal(await whoami("dropbox", "A", d), "Ana");
  assert.equal(await revoke("google", "A", (async () => new Response("", { status: 200 })) as unknown as typeof fetch), true);
  assert.equal(await revoke("dropbox", "A", (async () => { throw new Error("red"); }) as unknown as typeof fetch), false);
});
test("acciones permitidas: lista de vídeos propios de YouTube y búsqueda en Dropbox", async () => {
  const calls: string[] = [];
  const yt = (async (u: string) => { calls.push(u); return u.includes("channels") ? json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] }) : json({ items: [{ snippet: { title: "Mi vídeo", publishedAt: "2026-11-01T00:00:00Z", resourceId: { videoId: "dQw4w9WgXcQ" } } }] }); }) as unknown as typeof fetch;
  const v = await listYouTubeVideos("A", yt); assert.deepEqual(v, [{ id: "dQw4w9WgXcQ", title: "Mi vídeo", publishedAt: "2026-11-01T00:00:00Z" }]); assert.ok(calls[1].includes("playlistId=UU1"));
  const db = (async () => json({ matches: [{ metadata: { metadata: { path_display: "/Vídeos/a.mp4", name: "a.mp4", size: 10 } } }] })) as unknown as typeof fetch;
  assert.deepEqual(await listDropboxVideos("A", db), [{ path: "/Vídeos/a.mp4", name: "a.mp4", size: 10 }]);
});
