// Esquema v2 (migración 034): aislamiento por espacio de trabajo, versiones inmutables y guardado con control de conflictos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";

let db: PGlite, wsA: string, wsB: string;
let asUser: (uid: string | null, fn: () => Promise<void>) => Promise<void>;
let clipId: string, transcriptId: string, sourceId: string;

before(async () => {
  ({ db, wsA, wsB, asUser } = await freshDb());
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  sourceId = await one(`insert into sources(workspace_id, kind, status, created_by, duration_ms) values ('${wsA}','upload','validated','${A}', 600000) returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${sourceId}','P','${A}') returning id`);
  transcriptId = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${sourceId}','[{"text":"hola","start":0,"end":0.5}]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${transcriptId}','r1','m') returning id`);
  clipId = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','C') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition) values ('${clipId}','${wsA}',1,'{}')`);
  await db.exec(`insert into analyses(workspace_id, source_id, version, range_end_ms) values ('${wsA}','${sourceId}',1,600000)`);
  await db.exec(`insert into generation_recipes(workspace_id, name, params, created_by) values ('${wsA}','Mi receta','{}','${A}')`);
  await db.exec(`insert into clip_collections(workspace_id, name, created_by) values ('${wsA}','Colección','${A}')`);
});

const V2_TABLES = ["analyses", "transcript_revisions", "generation_recipes", "clip_collections", "clip_drafts", "export_batches", "publications", "imports"];

test("criterio 9 (base de datos): B no ve ni escribe nada del espacio de A en las tablas v2", async () => {
  await asUser(B, async () => {
    for (const t of V2_TABLES) {
      const r = await db.query<{ n: number }>(`select count(*)::int n from public.${t} where workspace_id='${wsA}'`);
      assert.equal(r.rows[0].n, 0, t);
    }
    await assert.rejects(() => db.query(`insert into generation_recipes(workspace_id, name, params, created_by) values ('${wsA}','x','{}','${B}')`));
    await assert.rejects(() => db.query(`insert into clip_collections(workspace_id, name, created_by) values ('${wsA}','x','${B}')`));
    await assert.rejects(() => db.query(`insert into analyses(workspace_id, source_id, version, range_end_ms) values ('${wsA}','${sourceId}',9,1000)`));
  });
  await asUser(A, async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from public.generation_recipes where workspace_id='${wsA}'`);
    assert.equal(r.rows[0].n, 1);
  });
  void wsB;
});

test("criterio 5 (base de datos): clip_versions es inmutable, también para el dueño de la tabla", async () => {
  await assert.rejects(() => db.query(`update clip_versions set composition='{"x":1}' where clip_id='${clipId}'`), /clip_versions_immutable/);
  await assert.rejects(() => db.query(`delete from clip_versions where clip_id='${clipId}'`), /clip_versions_immutable/);
  const r = await db.query<{ composition: unknown }>(`select composition from clip_versions where clip_id='${clipId}' and version=1`);
  assert.deepEqual(r.rows[0].composition, {});
});

test("save_clip_version: conflicto con versión base antigua; con la vigente crea n+1 y marca user_edited", async () => {
  await asUser(A, async () => {
    const bad = await db.query<{ r: { conflict: boolean; current_version: number } }>(`select public.save_clip_version('${clipId}', 7, '9:16', 'single_track', 'titular_video', '{}'::jsonb) r`);
    assert.deepEqual(bad.rows[0].r, { conflict: true, current_version: 1 });
    const ok = await db.query<{ r: { version: number } }>(`select public.save_clip_version('${clipId}', 1, '1:1', 'fit_full', 'titular_video', '{"a":1}'::jsonb) r`);
    assert.equal(ok.rows[0].r.version, 2);
  });
  const c = await db.query<{ current_version: number; user_edited: boolean }>(`select current_version, user_edited from clips where id='${clipId}'`);
  assert.deepEqual(c.rows[0], { current_version: 2, user_edited: true });
  const v = await db.query<{ aspect: string; layout: string; template: string }>(`select aspect, layout, template from clip_versions where clip_id='${clipId}' and version=2`);
  assert.deepEqual(v.rows[0], { aspect: "1:1", layout: "fit_full", template: "titular_video" });
  await asUser(B, async () => { await assert.rejects(() => db.query(`select public.save_clip_version('${clipId}', 2, '9:16', 'fit_full', null, '{}'::jsonb)`), /not_found/); });
});

test("save_clip_version con p_user_edit=false no marca el clip como editado por el usuario", async () => {
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const proj = (await db.query<{ project_id: string; generation_id: string }>(`select project_id, generation_id from clips where id='${clipId}'`)).rows[0];
  const c2 = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj.project_id}','${proj.generation_id}','C2') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition) values ('${c2}','${wsA}',1,'{}')`);
  await asUser(A, async () => { await db.query(`select public.save_clip_version('${c2}', 1, '9:16', 'single_track', null, '{}'::jsonb, false)`); });
  assert.equal((await db.query<{ user_edited: boolean }>(`select user_edited from clips where id='${c2}'`)).rows[0].user_edited, false);
});

test("borrar el clip borra sus versiones en cascada", async () => {
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const proj = (await db.query<{ project_id: string; generation_id: string }>(`select project_id, generation_id from clips where id='${clipId}'`)).rows[0];
  const c3 = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj.project_id}','${proj.generation_id}','C3') returning id`);
  await db.exec(`insert into clip_versions(clip_id, workspace_id, version, composition) values ('${c3}','${wsA}',1,'{}')`);
  await db.exec(`delete from clips where id='${c3}'`);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from clip_versions where clip_id='${c3}'`)).rows[0].n, 0);
});

test("restricciones: análisis duplicado, estado editorial y diseño fuera de lista se rechazan", async () => {
  await assert.rejects(() => db.query(`insert into analyses(workspace_id, source_id, version, range_end_ms) values ('${wsA}','${sourceId}',1,600000)`));
  await assert.rejects(() => db.query(`update clips set editorial_state='publicado' where id='${clipId}'`));
  await assert.rejects(() => db.query(`insert into clip_versions(clip_id, workspace_id, version, composition, layout) values ('${clipId}','${wsA}',99,'{}','collage')`));
});

test("oauth_connections admite tiktok", async () => {
  const r = await db.query<{ def: string }>(`select pg_get_constraintdef(oid) def from pg_constraint where conname='oauth_connections_provider_check'`);
  assert.match(r.rows[0].def, /tiktok/);
});
