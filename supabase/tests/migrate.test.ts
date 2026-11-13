// El arnés aplica todas las migraciones, en orden, sin omitir ninguna.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, listMigrations } from "./migrate.ts";

test("applyMigrations aplica exactamente la lista ordenada de supabase/migrations/*.sql", async () => {
  const { applied } = await freshDb();
  assert.deepEqual(applied, listMigrations());
  for (const n of ["006", "014", "028", "031", "032", "033"]) assert.ok(applied.some((f) => f.slice(11, 14) === n), `falta la migración ${n}`);
});

test("el esquema resultante expone lo añadido por 031–033 y los roles de Supabase", async () => {
  const { db } = await freshDb();
  const col = async (t: string, c: string) => (await db.query(`select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`)).rows.length;
  assert.equal(await col("sources", "parts"), 1);
  assert.equal(await col("sources", "storage_backend"), 1);
  assert.equal(await col("clips", "preview_path"), 1);
  assert.equal((await db.query(`select 1 from information_schema.tables where table_schema='public' and table_name='project_folders'`)).rows.length, 1);
  const roles = (await db.query<{ rolname: string }>(`select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`)).rows.map((r) => r.rolname);
  assert.deepEqual(roles, ["anon", "authenticated", "service_role"]);
});
