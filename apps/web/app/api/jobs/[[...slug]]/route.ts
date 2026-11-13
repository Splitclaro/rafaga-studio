// POST /api/jobs/:id/cancel → cancel_job (detiene tareas nuevas, devuelve lo no empezado y explica qué se conserva).
import { bearer, rpc, json, mapDbError, sessionUser, type Fetch } from "../../../../lib/api.ts";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function handlePost(req: Request, slug: string[], f: Fetch = fetch): Promise<Response> {
  const user = await sessionUser(req, f);
  if (!user) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  const [id, action] = slug;
  if (!UUID.test(id ?? "") || action !== "cancel" || slug.length !== 2) return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
  const r = await rpc<{ kept: string[]; refunded_units: number }>(bearer(req), "cancel_job", { p_job: id }, f);
  if (r.error) return mapDbError(r.error);
  return json(r.data, 202);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  return handlePost(req, (await ctx.params).slug ?? []);
}
