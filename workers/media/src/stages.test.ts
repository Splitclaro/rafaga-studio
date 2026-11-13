import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "./stage.ts";
import { inputHash } from "./stages/hash.ts";
import { runOnce } from "./stages/runner.ts";
import { STAGES, StageError, type Rpc, type StageCtx, type StageImpl, type StageRow } from "./stages/registry.ts";

const CLI = fileURLToPath(new URL("./stage.ts", import.meta.url));
const run = (args: string[], env: Record<string, string | undefined> = {}) => {
  const e = { ...process.env, ...env }; for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: e });
};

test("--list imprime las etapas en orden y no lee el entorno; --list-flags imprime todas las opciones", () => {
  const r = run(["--list"], { SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  assert.equal(r.status, 0); assert.deepEqual(r.stdout.trim().split("\n"), [...STAGES]);
  const f = run(["--list-flags"]);
  assert.deepEqual(f.stdout.trim().split("\n"), ["--list", "--list-flags", "--drain", "--max-idle-s", "--sweep", "--keep-alive", "--plan", "--purge"]);
});

test("sin credenciales sale con 78 nombrando la variable; etapa desconocida sale con 64", () => {
  const r = run(["validate", "00000000-0000-0000-0000-000000000000"], { SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  assert.equal(r.status, 78); assert.match(r.stderr, /SUPABASE_URL/);
  assert.equal(run(["no-such-stage", "00000000-0000-0000-0000-000000000000"]).status, 64);
});

test("--plan, --sweep y --keep-alive con rpc simulado", async () => {
  const calls: string[] = []; const outs: string[] = [];
  const rpc = (async (fn: string) => { calls.push(fn); return fn === "dispatch_plan" ? { ready: 3, legacy: "1" } : null; }) as Rpc;
  assert.equal(await main(["--plan"], { rpc, out: (s) => outs.push(s) }), 0);
  const plan = JSON.parse(outs[0]); assert.equal(typeof plan.ready, "number"); assert.equal(typeof plan.legacy, "number"); assert.deepEqual(plan, { ready: 3, legacy: 1 });
  assert.equal(await main(["--sweep"], { rpc }), 0);
  assert.equal(await main(["--keep-alive"], { rpc }), 0);
  assert.deepEqual(calls, ["dispatch_plan", "sweep_stale", "enqueue_due_publications", "keep_alive"]);
});

test("inputHash: estable, 64 hex, y cambia con la versión de componente", () => {
  const a = inputHash({ x: 1, y: [1, 2] }, { asr: "a" }), b = inputHash({ y: [1, 2], x: 1 }, { asr: "a" });
  assert.equal(a, b); assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, inputHash({ x: 1, y: [1, 2] }, { asr: "b" }));
});

const row: StageRow = { id: "s1", workspace_id: "w", job_id: "j", stage: "transcribe", seq: 1, attempts: 1, params: {}, units: 1, worker_id: "wk" };
function fakeCtx(over: Partial<Record<string, unknown>> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = (async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === "claim_stage") return [row];
    if (fn === "find_cached_stage") return over.cached ?? null;
    if (fn === "heartbeat_stage") return over.alive ?? true;
    return null;
  }) as Rpc;
  const ctx: StageCtx = { rpc, workerId: "wk", componentVersions: { v: "1" }, log: () => {} };
  return { ctx, calls };
}

test("acierto de caché: se cierra como skipped sin ejecutar la etapa", async () => {
  const { ctx, calls } = fakeCtx({ cached: { words: 10 } });
  let ran = false;
  const impl: StageImpl = { inputs: () => ({ a: 1 }), run: async () => { ran = true; return { output: {} }; } };
  const r = await runOnce(ctx, { load: async () => impl });
  assert.equal(r?.status, "skipped"); assert.equal(ran, false);
  const fin = calls.find((c) => c.fn === "finish_stage")!;
  assert.equal(fin.args.p_status, "skipped"); assert.deepEqual(fin.args.p_output, { words: 10 });
});

test("error de la etapa → finish_stage failed con su código", async () => {
  const { ctx, calls } = fakeCtx();
  const impl: StageImpl = { inputs: () => ({}), run: async () => { throw new StageError("transcription_failed", "boom"); } };
  const r = await runOnce(ctx, { load: async () => impl });
  assert.equal(r?.status, "failed");
  assert.equal(calls.find((c) => c.fn === "finish_stage")!.args.p_error_code, "transcription_failed");
});

test("latido cada 15 s; si heartbeat devuelve false se aborta como cancelled", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { ctx, calls } = fakeCtx({ alive: false });
    const impl: StageImpl = { inputs: () => ({}), run: () => new Promise(() => {}) };   // nunca termina por sí sola
    const p = runOnce(ctx, { load: async () => impl });
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    mock.timers.tick(15_000);
    const r = await p;
    assert.equal(r?.status, "cancelled");
    assert.ok(calls.some((c) => c.fn === "heartbeat_stage"));
  } finally { mock.timers.reset(); }
});

test("etapa sin módulo todavía → not_implemented", async () => {
  const { ctx, calls } = fakeCtx();
  const r = await runOnce(ctx, { load: async () => { throw new StageError("not_implemented"); } });
  assert.equal(r?.status, "failed"); assert.equal(calls.find((c) => c.fn === "finish_stage")!.args.p_error_code, "not_implemented");
});
