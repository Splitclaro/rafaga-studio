// POST /api/generations/estimate → estimación (unidades, saldo, tiempo, clips viables)
// POST /api/generations          → request_generation (reserva + trabajo en una transacción; idempotente por Idempotency-Key)
import { bearer, rpc, rest, json, mapDbError, idempotencyKey, sessionUser, type Fetch } from "../api.ts";
import { validateParams, estimateUnits, viableCount, summary, componentVersions } from "../generations.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
interface Proj { id: string; workspace_id: string; source_id: string }
interface Src { id: string; status: string; duration_ms: number | null }
interface Ana { id: string; component_versions: Record<string, string> | null }
export interface GenDeps { f?: Fetch; env?: Record<string, string | undefined>; wake?: (req: Request, jobId: string) => void }

async function context(req: Request, body: { project_id?: string; params?: unknown }, f: Fetch) {
  const token = bearer(req);
  if (!UUID.test(body.project_id ?? "")) return { err: json({ error: { code: "invalid_params", field: "project_id", message: "Falta el proyecto." } }, 400) };
  const proj = (await rest<Proj>(token, `projects?id=eq.${body.project_id}&limit=1`, f))[0];
  if (!proj) return { err: json({ error: { code: "not_found", message: "No encontrado." } }, 404) };
  const src = (await rest<Src>(token, `sources?id=eq.${proj.source_id}&limit=1`, f))[0];
  if (!src) return { err: json({ error: { code: "not_found", message: "No encontrado." } }, 404) };
  const v = validateParams(body.params, (src.duration_ms ?? 0) / 1000);
  if (!v.ok) return { err: json({ error: { code: "invalid_params", field: v.error.field, message: v.error.message } }, 400) };
  return { token, proj, src, params: v.params };
}

export async function handleGenerations(req: Request, slug: string[], d: GenDeps = {}): Promise<Response> {
  const f = d.f ?? fetch, env = d.env ?? process.env;
  const wake = d.wake ?? ((r: Request, jobId: string) => { fetch(new URL("/api/wake", r.url), { method: "POST", headers: { Authorization: r.headers.get("authorization") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {}); });
  if (!(await sessionUser(req, f))) return json({ error: { code: "no_session", message: "Inicia sesión." } }, 401);
  if (req.method !== "POST") return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
  const body = (await req.json().catch(() => ({}))) as { project_id?: string; params?: unknown };
  const c = await context(req, body, f);
  if ("err" in c) return c.err!;
  const { token, proj, src, params } = c;
  const minutes = Math.round(((params.range_end_ms - params.range_start_ms) / 60000) * 100) / 100;

  if (slug[0] === "estimate" && slug.length === 1) {
    const cv = componentVersions(env);
    const ana = (await rest<Ana>(token, `analyses?source_id=eq.${src.id}&status=eq.done&range_start_ms=lte.${params.range_start_ms}&range_end_ms=gte.${params.range_end_ms}&order=version.desc&limit=5`, f))
      .find((a) => (a.component_versions?.asr_model ?? cv.asr_model) === cv.asr_model);
    const units = estimateUnits({ minutes, hasAnalysis: !!ana, hook: params.hook ?? null });
    const stages = ana ? ["candidates", "select", "compose", "previews", "checks"] : ["prepare", "transcribe", "scenes", "speakers", "candidates", "select", "compose", "previews", "checks"];
    const [bal, eta] = await Promise.all([rpc<number>(token, "units_balance", { p_ws: proj.workspace_id }, f), rpc<{ p50_s: number; p90_s: number } | null>(token, "stage_eta", { p_minutes: minutes, p_stages: stages }, f)]);
    if (bal.error) return mapDbError(bal.error);
    const viable = viableCount((params.range_end_ms - params.range_start_ms) / 1000, params.min_s ?? 10);
    return json({ minutes, units, balance: Number(bal.data ?? 0), eta: eta.data ?? null, reusable_analysis: !!ana, viable_count: viable, requested_count: params.count, summary: summary(params) });
  }

  if (slug.length === 0) {
    const idem = idempotencyKey(req);
    if (!idem) return json({ error: { code: "invalid_params", field: "Idempotency-Key", message: "Falta la cabecera Idempotency-Key." } }, 400);
    if (src.status !== "validated") return json({ error: { code: "source_not_ready", message: "El vídeo todavía se está preparando. Espera a que termine la validación." } }, 409);
    const r = await rpc<{ generation_id: string; job_id: string }>(token, "request_generation", { p_project: proj.id, p_params: { ...params, component_versions: componentVersions(env) }, p_idem: idem }, f);
    if (r.error) return mapDbError(r.error);
    wake(req, r.data!.job_id);
    return json({ generation_id: r.data!.generation_id, job_id: r.data!.job_id }, 202);
  }
  return json({ error: { code: "not_found", message: "No encontrado." } }, 404);
}
