import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handlePost } from "./routes/jobs.ts";

let db: PGlite, wsA: string, jobId: string;
before(async () => {
  ({ db, wsA } = await freshDb());
  await db.exec(`update platform_settings set value = '{"usd_per_core_s": 0.001, "usd_per_gib_s": 0.0001}' where key = 'modal_rate_card'`);
  await db.exec(`select public.grant_units('${wsA}', 10, 'pruebas', 'grant-jobs-0001')`);
  jobId = (await db.query<{ r: { job_id: string } }>(`select public.enqueue_job($1, 'generation', '[{"stage":"transcribe","seq":1,"units":3}]'::jsonb, 'jobs-route-0001', '{}'::jsonb, null, null) r`, [wsA])).rows[0].r.job_id;
});
const req = (uid: string) => new Request(`https://app/api/jobs/${jobId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${tokenFor(uid)}` } });

test("B no puede cancelar un trabajo de A (404)", async () => {
  const r = await handlePost(req(B), [jobId, "cancel"], fakeSupabaseFetch(db));
  assert.equal(r.status, 404);
});
test("el editor cancela antes de empezar: 202 con lo conservado y las unidades devueltas", async () => {
  const r = await handlePost(req(A), [jobId, "cancel"], fakeSupabaseFetch(db));
  assert.equal(r.status, 202);
  const b = await r.json() as { kept: string[]; refunded_units: number };
  assert.deepEqual(b.kept, []); assert.equal(Number(b.refunded_units), 3);
});
test("sin sesión → 401; ruta desconocida → 404", async () => {
  const f = fakeSupabaseFetch(db);
  assert.equal((await handlePost(new Request("https://app/api/jobs/x/cancel", { method: "POST" }), [jobId, "cancel"], f)).status, 401);
  assert.equal((await handlePost(req(A), [jobId, "borrar"], f)).status, 404);
});
