import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { handleWake } from "./routes/wake.ts";

const JOB = "11111111-2222-3333-4444-555555555555";
type Call = { url: string; init?: RequestInit };
function fakeFetch(gh: { running?: number } = {}) {
  const calls: Call[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    calls.push({ url: u, init });
    if (u.endsWith("/auth/v1/user")) return Response.json({ id: "u1" });
    if (u.includes("/actions/workflows/worker.yml/runs")) return Response.json({ total_count: u.includes("in_progress") ? (gh.running ?? 0) : 0 });
    if (u.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (u.startsWith("https://modal.example")) return Response.json({ accepted: true });
    throw new Error(`unexpected ${u}`);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const req = (auth = true) => new Request("https://app/api/wake", { method: "POST", headers: auth ? { Authorization: "Bearer t" } : {}, body: JSON.stringify({ job_id: JOB }) });

test("Modal: un único POST con X-Rafaga-Wake y {job_id}, sin tocar GitHub", async () => {
  const { f, calls } = fakeFetch();
  const r = await handleWake(req(), f, { WORKER_BACKEND: "modal", MODAL_DISPATCH_URL: "https://modal.example/dispatch", WAKE_SECRET: "s3cret-wake" });
  assert.deepEqual(await r.json(), { woken: true, backend: "modal" });
  const m = calls.filter((c) => c.url.startsWith("https://modal.example"));
  assert.equal(m.length, 1);
  assert.equal(new Headers(m[0].init!.headers).get("X-Rafaga-Wake"), "s3cret-wake");
  assert.deepEqual(JSON.parse(String(m[0].init!.body)), { job_id: JOB });
  assert.equal(calls.some((c) => c.url.includes("api.github.com")), false);
});

test("Modal sin configurar → 200 not_configured; sin Bearer → 401", async () => {
  const { f } = fakeFetch();
  const r = await handleWake(req(), f, { WORKER_BACKEND: "modal" });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { woken: false, reason: "not_configured" });
  assert.equal((await handleWake(req(false), f, { WORKER_BACKEND: "modal" })).status, 401);
});

test("Actions (o sin definir): despacha solo si no hay ejecución en curso", async () => {
  const a = fakeFetch();
  assert.deepEqual(await (await handleWake(req(), a.f, { GH_DISPATCH_TOKEN: "ghp_x" })).json(), { woken: true });
  const b = fakeFetch({ running: 1 });
  assert.deepEqual(await (await handleWake(req(), b.f, { WORKER_BACKEND: "actions", GH_DISPATCH_TOKEN: "ghp_x" })).json(), { woken: false, reason: "already_running" });
  assert.equal(b.calls.some((c) => c.url.endsWith("/dispatches")), false);
});

test("app.py: secreto con compare_digest, versiones fijadas, programaciones y solo opciones que stage.ts admite", () => {
  const py = readFileSync(new URL("../../../workers/modal/app.py", import.meta.url), "utf8");
  for (const s of ["X-Rafaga-Wake", "hmac.compare_digest", "8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4", 'NODE_VERSION = "24.22.3"', "opencv-python-headless==4.10.0.84"]) assert.ok(py.includes(s), s);
  assert.match(py, /schedule=modal\.Period\(minutes=1\)\)\s*\ndef sweeper\(\):\s*\n\s*_node\("--sweep"/);
  assert.match(py, /schedule=modal\.Period\(days=1\)\)\s*\ndef keep_alive\(\):\s*\n\s*_node\("--keep-alive"/);
  const flags = spawnSync(process.execPath, [fileURLToPath(new URL("../../../workers/media/src/stage.ts", import.meta.url)), "--list-flags"], { encoding: "utf8" }).stdout.trim().split("\n");
  const used = [...new Set([...py.matchAll(/"(--[a-z-]+)"/g)].map((m) => m[1]))];
  for (const u of used) assert.ok(flags.includes(u), `app.py usa ${u}, que stage.ts no admite`);
});
