import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { planParts, Sha256, mergeResume, runUpload, type UploadApi, type UploadEvent } from "./uploader.ts";

test("planParts: 4 GiB → 256 partes de 16 MiB; 20 MB → 16 MiB + resto", () => {
  const big = planParts(4294967296);
  assert.equal(big.length, 256); assert.ok(big.every((p) => p.size === 16777216));
  assert.deepEqual(planParts(20000000).map((p) => p.size), [16777216, 3222784]);
});

test("Sha256 incremental en trozos irregulares = createHash", () => {
  const buf = randomBytes(5_000_000);
  const h = new Sha256(); let i = 0, step = 1;
  while (i < buf.length) { h.update(buf.subarray(i, i + step)); i += step; step = (step * 7 + 13) % 70000 + 1; }
  assert.equal(h.hex(), createHash("sha256").update(buf).digest("hex"));
  assert.equal(new Sha256().update(new Uint8Array(0)).hex(), createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
});

test("reanudar: solo se programan las partes que el servidor no tiene", () => {
  assert.deepEqual(mergeResume(5, [{ n: 1, etag: "a" }, { n: 2, etag: "b" }, { n: 3, etag: "c" }], [{ n: 1, etag: "a" }, { n: 2, etag: "b" }]), [4, 5]);
});

const file = (size: number) => ({ size, slice: (s: number, e: number) => new Uint8Array(e - s) });
function api(done: { n: number; etag: string; size: number }[] = []) {
  const calls: string[] = [];
  const a: UploadApi = {
    status: async () => ({ uploaded_parts: done, state: "active" }),
    urls: async (_id, ps) => Object.fromEntries(ps.map((n) => [String(n), `https://r2/part/${n}`])),
    complete: async (_id, parts) => { calls.push(`complete:${parts.length}`); return { job_id: "J" }; },
    abort: async () => { calls.push("abort"); },
  };
  return { a, calls };
}

test("reintentos: una parte que falla 2 veces se completa al 3.º intento; nunca más de 3 en vuelo; eventos con progreso", async () => {
  let inflight = 0, max = 0; const fails = new Map<number, number>([[2, 2]]);
  const f = (async (u: string) => {
    inflight++; max = Math.max(max, inflight);
    await new Promise((r) => setTimeout(r, 2));
    inflight--;
    const n = Number(u.split("/").pop());
    const left = fails.get(n) ?? 0;
    if (left > 0) { fails.set(n, left - 1); throw new TypeError("network"); }
    return new Response(null, { status: 200, headers: { etag: `"e${n}"` } });
  }) as unknown as typeof fetch;
  const evs: UploadEvent[] = []; const { a, calls } = api();
  let t = 0;
  const up = runUpload({ uploadId: "U", file: file(100), partSize: 10, api: a, fetch: f, sleep: async () => {}, now: () => (t += 100), onEvent: (e) => evs.push(e), sha256: async () => "x".repeat(64) });
  const res = await up.promise;
  assert.deepEqual(res, { job_id: "J" });
  assert.equal(up.attempts.get(2), 3);
  assert.ok(max <= 3, `en vuelo ${max}`);
  assert.ok(evs.some((e) => e.state === "retrying"));
  const last = evs.filter((e) => e.state === "uploading").at(-1)!;
  assert.equal(last.bytesSent, 100); assert.equal(last.totalBytes, 100); assert.ok(last.speedBps > 0);
  assert.deepEqual(calls, ["complete:10"]);
});

test("cancel(): aborta los PUT en vuelo, envía DELETE y queda cancelled", async () => {
  const f = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
  const evs: UploadEvent[] = []; const { a, calls } = api();
  const up = runUpload({ uploadId: "U", file: file(50), partSize: 10, api: a, fetch: f, onEvent: (e) => evs.push(e) });
  await new Promise((r) => setTimeout(r, 5));
  await up.cancel();
  assert.equal(await up.promise, null);
  assert.ok(calls.includes("abort")); assert.equal(evs.at(-1)!.state, "cancelled");
});
