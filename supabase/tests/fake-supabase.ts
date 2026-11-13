// Emulación mínima de la API REST de Supabase sobre PGlite para probar rutas y etapas sin red ni secretos.
//  · GET  …/auth/v1/user           → token «test:<uuid>» ⇒ {id}; cualquier otro ⇒ 401
//  · POST …/rest/v1/rpc/<fn>       → ejecuta public.<fn>(arg => valor, …) como `authenticated` (o como servicio con «test:service»)
//  · Errores al estilo PostgREST {code, message, details, hint}: P0001→400, P0002→404, 42501→403, 23505→409.
import type { PGlite } from "@electric-sql/pglite";

export const tokenFor = (uid: string) => `test:${uid}`;
export const SERVICE_TOKEN = "test:service";
type Fetch = typeof fetch;

const STATUS: Record<string, number> = { P0001: 400, P0002: 404, "42501": 403, "23505": 409 };

export function fakeSupabaseFetch(db: PGlite, other?: Fetch): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const token = headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
    if (/\/auth\/v1\/user$/.test(url)) {
      const m = /^test:([0-9a-f-]{36})$/.exec(token);
      return m ? Response.json({ id: m[1] }) : Response.json({ msg: "invalid JWT" }, { status: 401 });
    }
    const rpc = /\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url);
    if (rpc) {
      const fn = rpc[1];
      const args = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
      const names = Object.keys(args);
      const params = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      const values = names.map((n) => { const v = args[n]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
      const uid = /^test:([0-9a-f-]{36})$/.exec(token)?.[1] ?? null;
      const service = token === SERVICE_TOKEN;
      if (!uid && !service) return Response.json({ code: "PGRST301", message: "JWT required", details: null, hint: null }, { status: 401 });
      try {
        if (!service) await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
        else await db.exec(`set role service_role; select set_config('request.jwt.claim.sub', '', false);`);
        const r = await db.query<{ r: unknown }>(`select to_jsonb(public.${fn}(${params})) r`, values);
        return Response.json(r.rows[0]?.r ?? null);
      } catch (e) {
        const err = e as { code?: string; message: string; detail?: string; hint?: string };
        const code = err.code ?? "P0001";
        return Response.json({ code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null }, { status: STATUS[code] ?? 400 });
      } finally {
        await db.exec("reset role;");
      }
    }
    if (other) return other(input, init);
    throw new Error(`unexpected fetch ${url}`);
  }) as Fetch;
}
