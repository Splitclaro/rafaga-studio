// API de subida reanudable: límites, cuota, duplicados, finalización idempotente y aislamiento entre espacios.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handle, MAX_BYTES, QUOTA_BYTES } from "./routes/uploads.ts";

let db: PGlite, wsA: string;
const ENV = { R2_ACCOUNT_ID: "acc", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "AK", R2_SECRET_ACCESS_KEY: "SK" };
const SHA = "a".repeat(64), SHA2 = "b".repeat(64);
const r2calls: string[] = [];
let completedBody = "";
const r2 = (async (u: string, init?: RequestInit) => {
  const m = init?.method ?? "GET"; r2calls.push(`${m} ${u.split("?")[0]}`);
  if (m === "POST" && /[?&]uploads=/.test(u)) return new Response("<InitiateMultipartUploadResult><UploadId>UP-1</UploadId></InitiateMultipartUploadResult>");
  if (m === "POST") { completedBody = String(init?.body ?? ""); return new Response("<CompleteMultipartUploadResult/>"); }
  if (m === "HEAD") return /part00[0-2]/.test(u) ? new Response(null, { status: 200, headers: { etag: '"x"', "content-length": "10" } }) : new Response(null, { status: 404 });
  if (m === "GET") return new Response('<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag><Size>16777216</Size></Part></ListPartsResult>');
  return new Response(null, { status: 204 });
}) as unknown as typeof fetch;

const call = (uid: string, method: string, path: string, body?: unknown, env: Record<string, string> = ENV, idem?: string) => {
  const slug = path.split("/").filter(Boolean);
  const req = new Request(`https://app/api/uploads${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return handle(req, slug, { f: fakeSupabaseFetch(db, r2), env, wake: () => {} });
};

before(async () => { ({ db, wsA } = await freshDb()); await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`); });

test("más de 4 GB → 413 con el límite; cuota llena → 507 con la cuota; en ambos casos sin sesión", async () => {
  const big = await call(A, "POST", "", { name: "x", bytes: MAX_BYTES + 1, mime: "video/mp4", sha256_prefix: SHA });
  assert.equal(big.status, 413); assert.deepEqual(((await big.json()) as { limit: number }).limit, MAX_BYTES);
  await db.exec(`insert into storage_objects(workspace_id, key, bytes, kind) values ('${wsA}', '${wsA}/lleno', ${QUOTA_BYTES - 100}, 'mezzanine')`);
  const full = await call(A, "POST", "", { name: "x", bytes: 1000, mime: "video/mp4", sha256_prefix: SHA });
  const fb = (await full.json()) as { error: { code: string }; quota: number };
  assert.equal(full.status, 507); assert.equal(fb.error.code, "quota_exceeded"); assert.equal(fb.quota, QUOTA_BYTES);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from upload_sessions`)).rows[0].n, 0);
  await db.exec(`delete from storage_objects where key='${wsA}/lleno'`);
});

let uploadId = "", sourceId = "", projectId = "";
test("crea la sesión multiparte (R2 CreateMultipartUpload) y la reanudación lista las partes subidas", async () => {
  const r = await call(A, "POST", "", { name: "Mi vídeo", bytes: 40_000_000, mime: "video/quicktime", sha256_prefix: SHA }, ENV, "upload-key-0001");
  assert.equal(r.status, 201);
  const b = (await r.json()) as { upload_id: string; source_id: string; project_id: string; parts: number; part_size: number; strategy: string };
  assert.equal(b.strategy, "multipart"); assert.equal(b.part_size, 16777216); assert.equal(b.parts, 3);
  ({ upload_id: uploadId, source_id: sourceId, project_id: projectId } = b);
  const st = (await (await call(A, "GET", `/${uploadId}`)).json()) as { uploaded_parts: { n: number }[] };
  assert.deepEqual(st.uploaded_parts.map((p) => p.n), [1]);
  const urls = (await (await call(A, "POST", `/${uploadId}/parts`, { part_numbers: [2, 3] })).json()) as { urls: Record<string, string> };
  assert.match(urls.urls["2"], /partNumber=2/); assert.match(urls.urls["3"], /uploadId=UP-1/);
});

test("duplicado en el espacio → 409 con el proyecto, salvo force", async () => {
  const d = await call(A, "POST", "", { name: "Otra vez", bytes: 40_000_000, mime: "video/mp4", sha256_prefix: SHA });
  assert.equal(d.status, 409); assert.equal(((await d.json()) as { duplicate_of_project: string }).duplicate_of_project, projectId);
  const forced = await call(A, "POST", "", { name: "Otra vez", bytes: 40_000_000, mime: "video/mp4", sha256_prefix: SHA, force: true }, ENV, "upload-key-force1");
  assert.equal(forced.status, 201);
});

test("criterio 1 (servidor): completar crea UN trabajo v2 validate→mezzanine→proxy; repetir devuelve el mismo", async () => {
  const parts = [{ n: 1, etag: "e1" }, { n: 2, etag: "e2" }, { n: 3, etag: "e3" }];
  const r1 = await call(A, "POST", `/${uploadId}/complete`, { parts, sha256: SHA2 });
  assert.equal(r1.status, 202);
  const j1 = ((await r1.json()) as { job_id: string }).job_id;
  assert.match(completedBody, /<PartNumber>3<\/PartNumber>/);
  const r2b = await call(A, "POST", `/${uploadId}/complete`, { parts, sha256: SHA2 });
  assert.equal(((await r2b.json()) as { job_id: string }).job_id, j1);
  const job = (await db.query<{ engine: string; kind: string }>(`select engine, kind from jobs where id=$1`, [j1])).rows[0];
  assert.deepEqual(job, { engine: "v2", kind: "ingest" });
  const stages = (await db.query<{ stage: string }>(`select stage from job_stages where job_id=$1 order by seq`, [j1])).rows.map((x) => x.stage);
  assert.deepEqual(stages, ["validate", "mezzanine", "proxy"]);
  assert.equal((await db.query<{ status: string }>(`select status from sources where id=$1`, [sourceId])).rows[0].status, "uploaded");
});

test("criterio 9 (rutas): B recibe 404 y no se firma nada", async () => {
  const before = r2calls.length;
  assert.equal((await call(B, "GET", `/${uploadId}`)).status, 404);
  const parts = await call(B, "POST", `/${uploadId}/parts`, { part_numbers: [1] });
  assert.equal(parts.status, 404); assert.equal(JSON.stringify(await parts.json()).includes("X-Amz"), false);
  assert.equal((await call(B, "GET", `/sources/${sourceId}/proxy`)).status, 404);
  assert.equal(r2calls.length, before);
  const own = await call(A, "GET", `/sources/${sourceId}/proxy`);
  assert.match(((await own.json()) as { url: string }).url, /proxy\.mp4\?.*X-Amz-Expires=3600/);
});

test("estrategia parts: URLs PUT de original.partNNN y reanudación por HEAD", async () => {
  const env = { ...ENV, UPLOAD_STRATEGY: "parts" };
  const r = await call(A, "POST", "", { name: "Partes", bytes: 100_000_000, mime: "video/mp4", sha256_prefix: "c".repeat(64) }, env, "upload-parts-001");
  const b = (await r.json()) as { upload_id: string; part_size: number; parts: number; strategy: string };
  assert.equal(b.strategy, "parts"); assert.equal(b.part_size, 47185920); assert.equal(b.parts, 3);
  const urls = (await (await call(A, "POST", `/${b.upload_id}/parts`, { part_numbers: [1] }, env)).json()) as { urls: Record<string, string> };
  assert.match(urls.urls["1"], /original\.part000\?/);
  const st = (await (await call(A, "GET", `/${b.upload_id}`, undefined, env)).json()) as { uploaded_parts: { n: number }[] };
  assert.deepEqual(st.uploaded_parts.map((p) => p.n), [1, 2, 3]);
});
