// CLI del worker v2 (lo invoca Modal). Solo aquí se crea el cliente de Supabase.
//   node workers/media/src/stage.ts --list | --list-flags | <etapa> <jobId> | --drain [--max-idle-s N] | --sweep | --keep-alive | --plan | --purge
// Salidas: 0 bien · 1 etapa fallida · 64 uso · 78 configuración.
import { pathToFileURL } from "node:url";
import { hostname } from "node:os";
import { STAGES, isStage, type Rpc, type StageCtx } from "./stages/registry.ts";
import { runOnce, drain } from "./stages/runner.ts";
import { realR2 } from "./stages/media.ts";
import { r2FromEnv } from "@rafaga/providers/r2";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FLAGS = ["--list", "--list-flags", "--drain", "--max-idle-s", "--sweep", "--keep-alive", "--plan", "--purge"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const COMPONENT_VERSIONS = { worker: "stage-v1", asr_model: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo", llm_model: process.env.GROQ_EDITORIAL_MODEL || "openai/gpt-oss-120b" };

export interface MainDeps { rpc?: Rpc; out?: (s: string) => void; err?: (s: string) => void; env?: Record<string, string | undefined> }

async function makeRpc(env: Record<string, string | undefined>): Promise<Rpc | number> {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) return 78; if (!key) return 79;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  return (async (fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  }) as Rpc;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => process.stdout.write(s + "\n")), err = deps.err ?? ((s: string) => process.stderr.write(s + "\n"));
  const env = deps.env ?? process.env;
  const [a, b] = argv;
  if (a === "--list") { STAGES.forEach((s) => out(s)); return 0; }
  if (a === "--list-flags") { FLAGS.forEach((s) => out(s)); return 0; }
  // Comprobación de uso ANTES de leer el entorno.
  const known = ["--drain", "--sweep", "--keep-alive", "--plan", "--purge"];
  if (!a || (!known.includes(a) && !isStage(a))) { err(`Uso: stage.ts ${FLAGS.join(" | ")} | <etapa> <jobId>`); return 64; }
  if (isStage(a) && !UUID.test(b ?? "")) { err("Falta el id del trabajo (uuid)."); return 64; }
  let rpc = deps.rpc;
  if (!rpc) {
    const r = await makeRpc(env);
    if (typeof r === "number") { err(r === 78 ? "Falta SUPABASE_URL" : "Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY)"); return 78; }
    rpc = r;
  }
  const r2cfg = r2FromEnv(env);
  const ctx: StageCtx = { rpc, workerId: `${hostname()}-${process.pid}`, componentVersions: COMPONENT_VERSIONS, log: (m) => err(m), env, fetch, tmpDir: join(tmpdir(), "rafaga-stages"), ...(r2cfg ? { r2: realR2(r2cfg) } : {}) };
  try {
    if (a === "--plan") { const p = await rpc<{ ready: number; legacy: number }>("dispatch_plan"); out(JSON.stringify({ ready: Number(p?.ready ?? 0), legacy: Number(p?.legacy ?? 0) })); return 0; }
    if (a === "--sweep") { await rpc("sweep_stale"); await rpc("enqueue_due_publications"); return 0; }
    if (a === "--keep-alive") { await rpc("keep_alive"); return 0; }
    if (a === "--drain") { const i = argv.indexOf("--max-idle-s"); const n = await drain(ctx, i > 0 ? Number(argv[i + 1]) || 60 : 60); out(JSON.stringify({ processed: n })); return 0; }
    if (a === "--purge") {
      let mod: { purge?: (r: Rpc) => Promise<unknown> };
      try { mod = await import(new URL("./stages/purge.ts", import.meta.url).href); } catch { err("not_implemented"); return 1; }
      if (!mod.purge) { err("not_implemented"); return 1; }
      out(JSON.stringify(await mod.purge(rpc))); return 0;
    }
    const r = await runOnce(ctx);
    if (!r) { out(JSON.stringify({ claimed: false })); return 0; }
    out(JSON.stringify(r));
    return r.status === "failed" ? 1 : 0;
  } catch (e) { err((e as Error).message); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((c) => process.exit(c));
