// Bucle del worker v2: reclama una etapa, reutiliza la caché por huella o la ejecuta con latido, y la cierra.
import { loadStage, StageError, type StageCtx, type StageRow, type StageImpl, type StageName } from "./registry.ts";
import { inputHash } from "./hash.ts";

export interface RunnerDeps { load?: (n: StageName) => Promise<StageImpl>; now?: () => number; cores?: number; memGib?: number; heartbeatMs?: number }

/** Ejecuta UNA etapa reclamable. Devuelve null si no había ninguna. */
export async function runOnce(ctx: StageCtx, d: RunnerDeps = {}): Promise<{ id: string; stage: string; status: string } | null> {
  const rows = await ctx.rpc<StageRow[]>("claim_stage", { p_worker: ctx.workerId, p_lease_s: 90 });
  const claimed = rows?.[0];
  if (!claimed) return null;
  // Parámetros del trabajo (generation_id, analysis_id, rango, source_id…) + los propios de la etapa (mandan estos).
  const jobParams = await ctx.rpc<Record<string, unknown> | null>("job_params", { p_job: claimed.job_id }).catch(() => null);
  const row: StageRow = { ...claimed, params: { ...(jobParams ?? {}), ...(claimed.params ?? {}) } };
  const now = d.now ?? Date.now, cores = d.cores ?? Number(process.env.RAFAGA_CPU_CORES ?? 2), mem = d.memGib ?? Number(process.env.RAFAGA_MEM_GIB ?? 4);
  const t0 = now();
  const finish = async (status: string, output: Record<string, unknown> | null, hash: string | null, code: string | null, msg: string | null) => {
    const s = Math.max(0, (now() - t0) / 1000);
    await ctx.rpc("finish_stage", { p_stage: row.id, p_worker: ctx.workerId, p_status: status, p_output: output, p_input_hash: hash, p_core_s: +(s * cores).toFixed(2), p_mem_gib_s: +(s * mem).toFixed(2), p_error_code: code, p_error_message: msg?.slice(0, 500) ?? null });
    return { id: row.id, stage: row.stage, status };
  };
  let impl: StageImpl, hash: string;
  try {
    impl = await (d.load ?? loadStage)(row.stage);
    hash = inputHash(await impl.inputs(ctx, row), ctx.componentVersions);
  } catch (e) { return finish("failed", null, null, (e as StageError).code ?? "stage_error", (e as Error).message); }
  const cached = await ctx.rpc<Record<string, unknown> | null>("find_cached_stage", { p_ws: row.workspace_id, p_stage: row.stage, p_hash: hash });
  if (cached) return finish("skipped", cached, hash, null, null);
  const ac = new AbortController();
  const hb = setInterval(async () => {
    try { const alive = await ctx.rpc<boolean>("heartbeat_stage", { p_stage: row.id, p_worker: ctx.workerId, p_lease_s: 90 }); if (alive === false) ac.abort(); } catch { /* el siguiente latido lo reintenta */ }
  }, d.heartbeatMs ?? 15_000);
  try {
    const run = impl.run({ ...ctx, signal: ac.signal }, row);
    const cancelled = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new StageError("cancelled", "Trabajo cancelado"))));
    const r = await Promise.race([run, cancelled]);
    return finish("done", { ...r.output, ...(r.units_actual != null ? { units_actual: r.units_actual } : {}) }, hash, null, null);
  } catch (e) {
    const code = (e as StageError).code ?? "stage_error";
    return finish(code === "cancelled" ? "cancelled" : "failed", null, hash, code, (e as Error).message);
  } finally { clearInterval(hb); }
}

/** Vacía la cola: sigue reclamando hasta quedar `maxIdleS` sin trabajo. */
export async function drain(ctx: StageCtx, maxIdleS = 60, d: RunnerDeps & { sleep?: (ms: number) => Promise<void> } = {}): Promise<number> {
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let done = 0, idleSince = Date.now();
  for (;;) {
    const r = await runOnce(ctx, d);
    if (r) { done++; idleSince = Date.now(); continue; }
    if ((Date.now() - idleSince) / 1000 >= maxIdleS) return done;
    await sleep(2000);
  }
}
