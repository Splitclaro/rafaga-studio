// Registro de etapas v2: cada etapa vive en un módulo que se carga solo cuando hace falta.
export const STAGES = ["validate", "mezzanine", "proxy", "prepare", "transcribe", "scenes", "speakers", "candidates", "select", "compose", "previews", "checks", "render", "zip", "import", "publish", "translate"] as const;
export type StageName = (typeof STAGES)[number];
export const isStage = (s: string): s is StageName => (STAGES as readonly string[]).includes(s);

export interface StageRow { id: string; workspace_id: string; job_id: string; stage: StageName; seq: number; attempts: number; params: Record<string, unknown>; units: number; worker_id: string | null }
export type Rpc = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;
export interface MediaR2 { download(key: string, dest: string): Promise<void>; upload(key: string, file: string, contentType: string): Promise<void>; remove(keys: string[]): Promise<void> }
export interface StageCtx {
  rpc: Rpc; workerId: string; componentVersions: Record<string, string>; log: (msg: string) => void; signal?: AbortSignal; deps?: Record<string, unknown>;
  r2?: MediaR2; fetch?: typeof fetch; tmpDir?: string; env?: Record<string, string | undefined>;
}
export interface StageResult { output: Record<string, unknown>; units_actual?: number }
export interface StageImpl { inputs(ctx: StageCtx, row: StageRow): Promise<unknown> | unknown; run(ctx: StageCtx, row: StageRow): Promise<StageResult> }

const MODULE: Record<StageName, string> = {
  validate: "./validate.ts", mezzanine: "./validate.ts", proxy: "./validate.ts",
  prepare: "./analysis.ts", transcribe: "./analysis.ts", scenes: "./analysis.ts", speakers: "./analysis.ts",
  candidates: "./select.ts", select: "./select.ts",
  compose: "./compose.ts", previews: "./compose.ts", checks: "./compose.ts",
  render: "./export.ts", zip: "./export.ts",
  import: "./integrations.ts", publish: "./integrations.ts", translate: "./integrations.ts",
};

export class StageError extends Error { code: string; constructor(code: string, message?: string) { super(message ?? code); this.code = code; } }

/** Carga perezosa: si el módulo de la etapa aún no existe, `not_implemented` (sin romper las demás). */
export async function loadStage(name: StageName, loader: (p: string) => Promise<Record<string, unknown>> = (p) => import(new URL(p, import.meta.url).href)): Promise<StageImpl> {
  let mod: Record<string, unknown>;
  try { mod = await loader(MODULE[name]); } catch (e) {
    if (/Cannot find module|ERR_MODULE_NOT_FOUND|not found/i.test((e as Error).message)) throw new StageError("not_implemented", `La etapa ${name} aún no está implementada`);
    throw e;
  }
  const impl = (mod.STAGE_IMPLS as Record<string, StageImpl> | undefined)?.[name];
  if (!impl) throw new StageError("not_implemented", `La etapa ${name} aún no está implementada`);
  return impl;
}
