// Seguridad (auditoría 2026-11-16): las funciones del worker NO las puede ejecutar un usuario (leerían tokens OAuth o moverían dinero de otro espacio),
// las auxiliares de acceso no las ejecuta `anon` y borrar una canción con piezas funciona y deja los proyectos en purga inmediata.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, A, B } from "./migrate.ts";

let db: PGlite, ws: string;
const q = async <T = Record<string, unknown>>(s: string) => (await db.query<T>(s)).rows;
const WORKER_ONLY = ["import_job", "finish_import", "publication_job", "finish_publication", "oauth_token_for", "oauth_touch_for", "export_job_item", "finish_render", "finish_batch", "set_batch_zip", "batch_renders",
  "grant_units", "reserve_units", "compute_meter", "handle_new_user", "_ledger_write", "add_generation_warning", "add_split_item", "claim_job", "claim_stage", "clip_version_spec", "compose_clip", "dispatch_plan",
  "enqueue_due_publications", "enqueue_job", "finalize_deleted_projects", "find_cached_stage", "finish_generation", "finish_song_validate", "finish_stage", "generation_clips", "generation_context", "heartbeat_stage",
  "job_params", "lyric_sync_context", "mark_purged", "media_split_context", "project_feedback", "purge_candidates", "record_object", "refund_units", "save_analysis_part", "save_selection", "save_song_asr",
  "save_transcript", "scheduler_dispatch", "scheduler_tick", "set_clip_scene", "set_clip_thumb", "set_source_ready", "settle_units", "song_by_source", "source_info", "storage_used", "sweep_stale"];
const HELPERS = ["brand_kit_snapshot", "brand_kit_version_bump", "can_admin", "can_edit", "can_review", "current_workspace", "is_member", "my_role"];
const execBy = async (role: string, names: string[]) => (await q<{ sig: string }>(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any(array[${names.map((n) => `'${n}'`).join(",")}]) and has_function_privilege('${role}', p.oid, 'execute')`)).map((r) => r.sig);

before(async () => { ({ db, wsA: ws } = (await freshDb()) as unknown as { db: PGlite; wsA: string }); });

test("ninguna función de worker es ejecutable por authenticated ni anon; service_role sí las conserva", async () => {
  assert.deepEqual(await execBy("authenticated", WORKER_ONLY), []); assert.deepEqual(await execBy("anon", WORKER_ONLY), []);
  const svc = await execBy("service_role", WORKER_ONLY); assert.ok(svc.length >= 40, `service_role conserva ${svc.length} funciones`);
});
test("las funciones auxiliares de acceso no son ejecutables por anon (authenticated sí, las usa RLS)", async () => {
  assert.deepEqual(await execBy("anon", HELPERS), []); assert.ok((await execBy("authenticated", HELPERS)).length >= 6);
});
test("delete_song: borra la canción con piezas, marca la purga inmediata de sus proyectos y un extraño no puede", async () => {
  const one = async (s: string) => (await q<{ id: string }>(s))[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, bytes) values ('${ws}','upload','validated','${A}', 1000) returning id`);
  const song = await one(`insert into songs(workspace_id, title, storage_path, mime, bytes, created_by, source_id) values ('${ws}','S','${ws}/${src}/original','audio/flac',2000,'${A}','${src}') returning id`);
  const pid = await one(`insert into projects(workspace_id, source_id, name, mode, created_by) values ('${ws}','${src}','L','lyrics','${A}') returning id`);
  await db.exec(`insert into lyric_projects(workspace_id, project_id, song_id, mode) values ('${ws}','${pid}','${song}','letra')`);
  const as = async (uid: string, sql: string) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}', false);`); try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);"); } };
  await assert.rejects(as(B, `select public.delete_song('${song}')`), /not_found/);
  assert.equal((await q(`select 1 from songs where id='${song}'`)).length, 1);
  await as(A, `select public.delete_song('${song}')`);
  assert.equal((await q(`select 1 from songs where id='${song}'`)).length, 0); assert.equal((await q(`select 1 from lyric_projects where song_id='${song}'`)).length, 0);
  const [p] = await q<{ deleted_at: string | null; purge: boolean }>(`select deleted_at, purge_at < now() as purge from projects where id='${pid}'`); assert.ok(p.deleted_at && p.purge);
});
