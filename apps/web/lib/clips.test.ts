// API de clips: versiones con control de conflictos, borrador, revisión de transcripción y regeneración que conserva lo editado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { viralTemplate } from "@rafaga/composition";
import { freshDb, A, B } from "../../../supabase/tests/migrate.ts";
import { fakeSupabaseFetch, tokenFor } from "../../../supabase/tests/fake-supabase.ts";
import { handleClips } from "./routes/clips.ts";

let db: PGlite, wsA: string, proj: string, gen: string, tid: string, c1: string, c2: string, c3: string;
const call = (uid: string, method: string, path: string, body?: unknown, idem?: string) => {
  const req = new Request(`https://app/api/clips${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(uid)}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return handleClips(req, path.split("/").filter(Boolean), fakeSupabaseFetch(db));
};
const counts = async () => Object.fromEntries(await Promise.all(["jobs", "job_stages", "credit_ledger"].map(async (t) => [t, (await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n])));
const spec = (t = "hablante_seguimiento") => viralTemplate(t as never, "9:16", { duration: 8, fragments: [{ start: 10, end: 18 }] });

before(async () => {
  ({ db, wsA } = await freshDb());
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by) values ('${wsA}','upload','validated','${A}') returning id`);
  proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','E','${A}') returning id`);
  tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[{"text":"hola","start":1,"end":2}]') returning id`);
  gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`);
  for (const [i, edited] of [false, true, false].entries()) {
    const id = await one(`insert into clips(workspace_id, project_id, generation_id, title, user_edited) values ('${wsA}','${proj}','${gen}','Clip ${i}', ${edited}) returning id`);
    await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template) values ('${id}','${wsA}',1,'${JSON.stringify(spec())}','9:16','single_track','hablante_seguimiento')`);
    if (i === 0) c1 = id; else if (i === 1) c2 = id; else c3 = id;
  }
});

test("versiones: base obsoleta → 409 con la versión vigente y sin crear versión; base vigente → 201; otra plantilla no crea trabajos, etapas ni movimientos (criterio 3)", async () => {
  const before = await counts();
  const body = (base: number, t: string) => ({ composition: spec(t), aspect: "9:16", layout: spec(t).layout, template: t, base_version: base });
  const stale = await call(A, "POST", `/${c3}/versions`, body(7, "video_completo"));
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { conflict: { current_version: 1 } });
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from clip_versions where clip_id='${c3}'`)).rows[0].n, 1);
  const ok = await call(A, "POST", `/${c3}/versions`, body(1, "video_completo"));
  assert.equal(ok.status, 201); assert.deepEqual(await ok.json(), { version: 2 });
  assert.deepEqual(await counts(), before);
  assert.equal((await call(A, "POST", `/${c3}/versions`, { ...body(2, "video_completo"), layout: "collage" })).status, 400);
});

test("borrador del autoguardado: una fila por clip y se reemplaza", async () => {
  for (let v = 0; v < 3; v++) assert.equal((await call(A, "PUT", `/${c2}/draft`, { base_version: 1, spec: { ...spec(), duration: 8 + v } })).status, 200);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from clip_drafts where clip_id='${c2}'`)).rows[0].n, 1);
  assert.equal((await db.query<{ d: number }>(`select (spec->>'duration')::int d from clip_drafts where clip_id='${c2}'`)).rows[0].d, 10);
});

test("criterio 4: la revisión del transcript crea versión solo para clips sin editar; los editados quedan idénticos", async () => {
  const snapshot = async (id: string) => JSON.stringify((await db.query(`select version, composition from clip_versions where clip_id='${id}' order by version`)).rows);
  const edited0 = await snapshot(c2);
  const r = await call(A, "POST", `/${c1}/transcript`, { words: [{ text: "hola", start: 1, end: 2 }, { text: "mundo", start: 2, end: 3 }] });
  assert.equal(r.status, 201); const b = (await r.json()) as { revision: number; updated: string[] };
  assert.equal(b.revision, 2); assert.deepEqual(b.updated, [c1]);
  const v = (await db.query<{ composition: { transcript_revision: number } }>(`select composition from clip_versions where clip_id='${c1}' order by version desc limit 1`)).rows[0];
  assert.equal(v.composition.transcript_revision, 2);
  assert.equal(await snapshot(c2), edited0, "el clip editado por el usuario no cambia");
  assert.equal((await db.query<{ user_edited: boolean }>(`select user_edited from clips where id='${c1}'`)).rows[0].user_edited, false, "la versión automática no lo marca como editado");
});

test("regenerar sobre el mismo proyecto deja intactas las filas anteriores de clips y clip_versions (criterio 4)", async () => {
  const snap = async () => JSON.stringify([(await db.query(`select id, title, user_edited, current_version, generation_id from clips order by id`)).rows, (await db.query(`select clip_id, version, composition from clip_versions order by clip_id, version`)).rows]);
  const before = await snap();
  const g2 = (await db.query<{ id: string }>(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tid}','r','m') returning id`)).rows[0].id;
  await db.exec(`insert into clip_candidates(workspace_id, generation_id, start_ms, end_ms, title, scores) values ('${wsA}','${g2}',1000,9000,'Nuevo','{}')`);
  await db.query(`select public.save_selection('${g2}', '[{"start_ms":20000,"end_ms":30000,"title":"Otro","reason":"r","scores":{}}]'::jsonb, '[]'::jsonb, 1)`).catch(() => {});
  const after = JSON.parse(await snap()) as [{ id: string }[], unknown[]], prev = JSON.parse(before) as [{ id: string }[], unknown[]];
  for (const row of prev[0]) assert.deepEqual(after[0].find((x) => x.id === row.id), row);
  assert.deepEqual(prev[1].filter((x) => (x as { version: number }).version <= 2).map((x) => JSON.stringify(x)), after[1].filter((x) => prev[1].some((p) => JSON.stringify(p) === JSON.stringify(x))).map((x) => JSON.stringify(x)));
});

test("otro usuario no puede leer ni escribir los clips de A (404)", async () => {
  assert.equal((await call(B, "POST", `/${c1}/versions`, { composition: spec(), aspect: "9:16", layout: "fit_full", base_version: 1 })).status, 404);
  assert.equal((await call(B, "PUT", `/${c1}/draft`, { base_version: 1, spec: {} })).status, 404);
  assert.equal((await call(B, "POST", `/${c1}/transcript`, { words: [] })).status, 404);
});

test("traducir: cobra 0,1 × minutos y es idempotente", async () => {
  await db.exec(`update platform_settings set value = '{"usd_per_core_s":0.001,"usd_per_gib_s":0.0001}' where key='modal_rate_card'`);
  await db.exec(`select public.grant_units('${wsA}', 5, 'pruebas', 'grant-clips-0001')`);
  const g = [{ start: 0, end: 30, text: "Hola" }, { start: 30, end: 60, text: "Mundo" }];
  const a = await call(A, "POST", `/${c1}/translate`, { groups: g, target_language: "en" }, "translate-key-001"), b = await call(A, "POST", `/${c1}/translate`, { groups: g, target_language: "en" }, "translate-key-001");
  assert.equal(a.status, 202); const ja = (await a.json()) as { job_id: string; units: number }, jb = (await b.json()) as { job_id: string };
  assert.equal(ja.units, 0.1); assert.equal(ja.job_id, jb.job_id);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from credit_ledger where kind='reserve'`)).rows[0].n, 1);
  assert.equal((await call(A, "POST", `/${c1}/translate`, { groups: g, target_language: "en" })).status, 400, "sin Idempotency-Key");
});
