// «Me gusta / No me gusta» (migración 112): solo quien puede editar marca; «no me gusta» oculta el clip; la lectura para el worker no está abierta a usuarios.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";

let db: PGlite, wsA: string, proj: string, c1: string, c2: string;
let asUser: (uid: string | null, fn: () => Promise<void>) => Promise<void>;
const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;

before(async () => {
  ({ db, wsA, asUser } = await freshDb());
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, duration_ms) values ('${wsA}','upload','validated','${A}', 600000) returning id`);
  proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','P','${A}') returning id`);
  const tr = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}','[]') returning id`);
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model) values ('${wsA}','${proj}','${tr}','r1','m') returning id`);
  c1 = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','Anécdota larga') returning id`);
  c2 = await one(`insert into clips(workspace_id, project_id, generation_id, title) values ('${wsA}','${proj}','${gen}','Consejo claro') returning id`);
});

test("el dueño marca me gusta / no me gusta; no me gusta oculta el clip y quitar la señal lo restaura", async () => {
  await asUser(A, async () => {
    await db.query(`select public.set_clip_feedback('${c2}','like')`);
    await db.query(`select public.set_clip_feedback('${c1}','dislike')`);
    const r = await db.query<{ id: string; feedback: string; discarded: boolean }>(`select id, feedback, discarded from public.clips where project_id='${proj}'`);
    assert.equal(r.rows.find((x) => x.id === c2)!.feedback, "like"); assert.equal(r.rows.find((x) => x.id === c2)!.discarded, false);
    assert.equal(r.rows.find((x) => x.id === c1)!.feedback, "dislike"); assert.equal(r.rows.find((x) => x.id === c1)!.discarded, true);
    await assert.rejects(db.query(`select public.set_clip_feedback('${c1}','meh')`));
    await db.query(`select public.set_clip_feedback('${c1}', null)`);
    assert.equal((await db.query<{ d: boolean }>(`select discarded d from public.clips where id='${c1}'`)).rows[0].d, false);
  });
});

test("otro usuario no puede marcar clips ajenos y los usuarios no leen project_feedback (solo el worker)", async () => {
  await asUser(B, async () => { await assert.rejects(db.query(`select public.set_clip_feedback('${c2}','dislike')`)); });
  await asUser(A, async () => { await assert.rejects(db.query(`select public.project_feedback('${proj}')`)); });
  const fb = (await db.query<{ f: { disliked: unknown[]; liked: { title: string }[] } }>(`select public.project_feedback('${proj}') f`)).rows[0].f;
  assert.equal(fb.liked[0].title, "Consejo claro"); assert.ok(Array.isArray(fb.disliked));
});
