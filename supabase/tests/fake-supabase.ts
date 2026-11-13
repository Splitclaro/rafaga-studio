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
      // Los objetos van como JSON; las listas de texto/números como arrays (columnas text[]), salvo las de objetos (jsonb).
      const values = names.map((n) => { const v = args[n]; if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) return v; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
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
    // GET /rest/v1/<tabla>?col=eq.v&col=lte.v&col=gte.v&col=is.null&order=col.desc&limit=n  (RLS como `authenticated`)
    const tbl = /\/rest\/v1\/([a-z_][a-z0-9_]*)(\?.*)?$/.exec(url);
    if (tbl && (init?.method ?? "GET") === "GET") {
      const uid = /^test:([0-9a-f-]{36})$/.exec(token)?.[1];
      if (!uid) return Response.json({ code: "PGRST301", message: "JWT required" }, { status: 401 });
      const q = new URLSearchParams(tbl[2]?.slice(1) ?? ""), where: string[] = [], vals: unknown[] = []; let order = "", limit = "";
      const OPS: Record<string, string> = { eq: "=", lte: "<=", gte: ">=" };
      for (const [k, v] of q) {
        if (k === "select") continue;
        if (k === "order") { const [c, d] = v.split("."); order = ` order by ${c.replace(/[^a-z_]/g, "")} ${d === "desc" ? "desc" : "asc"}`; continue; }
        if (k === "limit") { limit = ` limit ${Math.max(1, Math.min(1000, Number(v) || 1))}`; continue; }
        const m = /^(eq|lte|gte|is)\.(.*)$/.exec(v); if (!m) continue;
        const col = k.replace(/[^a-z_]/g, "");
        if (m[1] === "is") where.push(`${col} is ${m[2] === "null" ? "null" : "not null"}`);
        else { vals.push(m[2]); where.push(`${col} ${OPS[m[1]]} $${vals.length}`); }
      }
      try {
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
        const r = await db.query(`select * from public.${tbl[1]}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${limit}`, vals);
        return Response.json(r.rows);
      } catch (e) { return Response.json({ code: (e as { code?: string }).code ?? "42501", message: (e as Error).message }, { status: 403 }); }
      finally { await db.exec("reset role;"); }
    }
    if (other) return other(input, init);
    throw new Error(`unexpected fetch ${url}`);
  }) as Fetch;
}
