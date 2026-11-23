// Backend simulado para los guiones e2e: sesión falsa en localStorage y respuestas fijas de Supabase. Ninguna petición sale a la red.
import type { Page, Route } from "@playwright/test";

export const REF = "attrnwbcgascvppncucl";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
const USER = { id: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated", email: "prueba@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, role: "authenticated", exp })}.firma`;
const WS = "00000000-0000-4000-8000-0000000000bb";

type Handler = (route: Route, url: URL) => Promise<boolean> | boolean;
export interface MockOpts { rest?: Record<string, unknown>; rpc?: Record<string, unknown>; extra?: Handler }

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "content-range": "0-0/*" }, body: JSON.stringify(body) });

export async function mockBackend(page: Page, o: MockOpts = {}) {
  await page.addInitScript(([ref, session]) => { try { localStorage.setItem(`sb-${ref}-auth-token`, session as string); } catch { /* sin almacenamiento */ } },
    [REF, JSON.stringify({ access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER })]);
  await page.route(/\.supabase\.co\//, async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (o.extra && (await o.extra(route, url))) return;
    if (url.pathname.startsWith("/auth/v1/user")) return json(route, USER);
    if (url.pathname.startsWith("/auth/v1/")) return json(route, { access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: exp, user: USER });
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop()!;
      return json(route, fn in (o.rpc ?? {}) ? o.rpc![fn] : fn === "current_workspace" ? WS : []);
    }
    if (url.pathname.startsWith("/rest/v1/")) { const t = url.pathname.split("/").pop()!; return json(route, t in (o.rest ?? {}) ? o.rest![t] : []); }
    return json(route, {});
  });
  await page.route(/\/api\//, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accounts: [] }) }));
}

/** Falla ante errores de consola de la propia app y ante respuestas 5xx (E8). */
export function watchErrors(page: Page) {
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR|favicon/i.test(m.text())) bad.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });
  return bad;
}
