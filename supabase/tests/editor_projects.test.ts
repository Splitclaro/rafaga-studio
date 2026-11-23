// Migración 120: proyectos del editor avanzado. Crear, guardar con versión, conflicto, borrar y aislamiento entre espacios.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";

let db: PGlite;
const as = async <T>(uid: string, sql: string) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}', false);`);
  try { return (await db.query<T & object>(sql)).rows; } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); }
};
const err = async (uid: string, sql: string) => { try { await as(uid, sql); return null; } catch (e) { return (e as Error).message; } };
before(async () => { ({ db } = (await freshDb()) as unknown as { db: PGlite }); });

test("crear un proyecto vacío, guardarlo con su versión y reabrirlo igual", async () => {
  const [{ id }] = await as<{ id: string }>(A, `select public.create_editor_project('Mi montaje', '9:16') as id`);
  const doc = JSON.stringify({ v: 1, tracks: [{ id: "t1", kind: "video", items: [{ id: "i1", src: { kind: "media_item", id: "x" }, at: 0, in: 2, out: 5 }] }] });
  const [{ r }] = await as<{ r: { version: number } }>(A, `select public.save_editor_project('${id}', 1, '${doc}'::jsonb) as r`);
  assert.equal(r.version, 2);
  const [row] = await as<{ doc: { tracks: { items: unknown[] }[] }; version: number; name: string; aspect: string }>(A, `select doc, version, name, aspect from editor_projects where id = '${id}'`);
  assert.equal(row.version, 2); assert.equal(row.doc.tracks[0].items.length, 1); assert.deepEqual([row.name, row.aspect], ["Mi montaje", "9:16"]);
});

test("guardar desde una versión vieja devuelve conflicto y no pisa nada", async () => {
  const [{ id }] = await as<{ id: string }>(A, `select public.create_editor_project('', '16:9') as id`);
  await as(A, `select public.save_editor_project('${id}', 1, '{"a":1}'::jsonb)`);
  const [{ r }] = await as<{ r: { conflict: boolean; current_version: number } }>(A, `select public.save_editor_project('${id}', 1, '{"a":2}'::jsonb) as r`);
  assert.deepEqual(r, { conflict: true, current_version: 2 });
  const [row] = await as<{ doc: { a: number }; name: string }>(A, `select doc, name from editor_projects where id = '${id}'`);
  assert.equal(row.doc.a, 1); assert.equal(row.name, "Proyecto sin título");
});

test("formato inválido y documento que no es objeto se rechazan", async () => {
  assert.match((await err(A, `select public.create_editor_project('x', '3:2')`))!, /invalid_params/);
  assert.match((await err(A, `select public.create_editor_project('x', '1:1', '[1]'::jsonb)`))!, /invalid_params/);
});

test("otro espacio no ve, no guarda ni borra; borrar lo oculta de la lista", async () => {
  const [{ id }] = await as<{ id: string }>(A, `select public.create_editor_project('Privado', '1:1') as id`);
  assert.equal((await as(B, `select 1 from editor_projects where id = '${id}'`)).length, 0);
  assert.match((await err(B, `select public.save_editor_project('${id}', 1, '{}'::jsonb)`))!, /not_found/);
  assert.match((await err(B, `select public.delete_editor_project('${id}')`))!, /not_found/);
  await as(A, `select public.delete_editor_project('${id}')`);
  assert.equal((await as(A, `select 1 from editor_projects where id = '${id}'`)).length, 0);
});

test("anon no puede ejecutar las funciones ni leer la tabla", async () => {
  const r = (await db.query<{ n: string; anon: boolean }>(`select p.proname n, has_function_privilege('anon', p.oid, 'execute') anon from pg_proc p where proname in ('create_editor_project','save_editor_project','delete_editor_project')`)).rows;
  assert.equal(r.length, 3); for (const x of r) assert.equal(x.anon, false, x.n);
  assert.equal((await db.query<{ s: boolean }>(`select has_table_privilege('anon', 'public.editor_projects', 'select') s`)).rows[0].s, false);
});
