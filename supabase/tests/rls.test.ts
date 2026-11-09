// Prueba de migración desde cero + aislamiento RLS en Postgres real (PGlite).
// auth/storage se simulan SOLO aquí; la prueba A/B contra Supabase real sigue pendiente.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
let db: PGlite;
let wsA: string, wsB: string;

const asUser = async (uid: string | null, fn: () => Promise<void>) => {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try { await fn(); } finally { await db.exec("reset role;"); }
};
const rejects = async (sql: string) => { await assert.rejects(() => db.query(sql)); };

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  await db.exec(readFileSync(new URL("../migrations/20261109000001_core.sql", import.meta.url), "utf8"));
  await db.exec("grant all on all tables in schema public to authenticated; grant all on all functions in schema public to authenticated;");
  // grants amplios arriba; los REVOKE/column GRANT de la migración deben seguir mandando:
  await db.exec(readFileSync(new URL("../migrations/20261109000001_core.sql", import.meta.url), "utf8").split("-- Los privilegios")[1].split("-- ───────── Storage")[0].replace(/^[^\n]*\n/, ""));
  await db.exec(readFileSync(new URL("../migrations/20261109000002_detection.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261109000003_render_requests.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261109000004_workspace_fonts.sql", import.meta.url), "utf8"));
  await db.exec("grant select, insert, delete on public.workspace_fonts to authenticated;");
  await db.exec("grant execute on function public.request_detection(uuid, text) to authenticated; grant execute on function public.request_render(uuid, int, text, boolean) to authenticated;");
  await db.exec(`insert into auth.users values ('${A}','a@test.dev'),('${B}','b@test.dev');`);
  wsA = (await db.query<{ id: string }>(`select id from workspaces where created_by='${A}'`)).rows[0].id;
  wsB = (await db.query<{ id: string }>(`select id from workspaces where created_by='${B}'`)).rows[0].id;
});

test("signup crea un único workspace y membresía owner", async () => {
  const r = await db.query<{ n: number }>(`select count(*)::int n from workspace_members where user_id='${A}' and role='owner'`);
  assert.equal(r.rows[0].n, 1);
  // re-ejecutar el trigger no duplica
  await db.exec(`select public.handle_new_user() from (select * from auth.users where id='${A}') u limit 0`);
});

test("A crea fuente y proyecto; B no los ve ni los edita", async () => {
  let srcId = "", prjId = "";
  await asUser(A, async () => {
    srcId = (await db.query<{ id: string }>(`insert into sources(workspace_id,kind,created_by) values ('${wsA}','upload','${A}') returning id`)).rows[0].id;
  });
  await db.exec(`update sources set status='validated' where id='${srcId}'`); // servidor
  await asUser(A, async () => {
    prjId = (await db.query<{ id: string }>(`insert into projects(workspace_id,source_id,name,created_by,project_brief) values ('${wsA}','${srcId}','P','${A}','consejos de venta') returning id`)).rows[0].id;
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from projects`)).rows.length, 0);
    assert.equal((await db.query(`select * from sources`)).rows.length, 0);
    const u = await db.query(`update projects set name='hack' where id='${prjId}' returning id`);
    assert.equal(u.rows.length, 0);
    await rejects(`insert into projects(workspace_id,source_id,name,created_by) values ('${wsA}','${srcId}','x','${B}')`);
  });
});

test("FK compuesta: proyecto de B no puede usar fuente de A", async () => {
  const srcA = (await db.query<{ id: string }>(`select id from sources where workspace_id='${wsA}' limit 1`)).rows[0].id;
  await asUser(B, async () => {
    await rejects(`insert into projects(workspace_id,source_id,name,created_by) values ('${wsB}','${srcA}','x','${B}')`);
  });
});

test("cliente no puede autootorgarse rol, membresía, cuota ni jobs", async () => {
  await asUser(B, async () => {
    await rejects(`update workspace_members set role='owner' where user_id='${B}'`);
    await rejects(`insert into workspace_members(workspace_id,user_id,role) values ('${wsA}','${B}','member')`);
    await rejects(`insert into usage_ledger(workspace_id,kind,input_seconds,idempotency_key) values ('${wsB}','release',999999,'k')`);
    await rejects(`insert into jobs(workspace_id,kind,idempotency_key) values ('${wsB}','detect','k')`);
    await rejects(`update sources set status='validated'`);
  });
});

test("brief limitado a 2000 caracteres", async () => {
  const src = (await db.query<{ id: string }>(`select id from sources where workspace_id='${wsA}' limit 1`)).rows[0].id;
  await asUser(A, async () => {
    await rejects(`insert into projects(workspace_id,source_id,name,created_by,project_brief) values ('${wsA}','${src}','x','${A}','${"a".repeat(2001)}')`);
  });
});

test("Storage: B no lee ni sube en la carpeta de A", async () => {
  await db.exec(`insert into storage.objects(bucket_id,name) values ('originals','${wsA}/s1/video.mp4')`);
  await asUser(A, async () => { assert.equal((await db.query(`select * from storage.objects`)).rows.length, 1); });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from storage.objects`)).rows.length, 0);
    await rejects(`insert into storage.objects(bucket_id,name) values ('originals','${wsA}/s1/evil.mp4')`);
    await db.query(`insert into storage.objects(bucket_id,name) values ('originals','${wsB}/s1/ok.mp4')`);
  });
});

test("anon no ve nada", async () => {
  await asUser(null, async () => {
    await rejects(`select * from projects`); // sin privilegios o sin filas
  });
});

test("request_detection: idempotente, solo miembros; claim_job cerrado al cliente", async () => {
  const prj = (await db.query<{ id: string }>(`select id from projects where workspace_id='${wsA}' limit 1`)).rows[0].id;
  let j1 = "", j2 = "";
  await asUser(A, async () => {
    j1 = (await db.query<{ r: string }>(`select request_detection('${prj}','clave-uno-1234') r`)).rows[0].r;
    j2 = (await db.query<{ r: string }>(`select request_detection('${prj}','clave-dos-5678') r`)).rows[0].r; // doble clic con otra clave
    await rejects(`select request_detection('${prj}','x')`); // clave inválida
  });
  assert.equal(j1, j2);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from jobs where project_id='${prj}'`)).rows[0].n, 1);
  await asUser(B, async () => { await rejects(`select request_detection('${prj}','clave-tres-9999')`); await rejects(`select * from claim_job()`); });
  await asUser(A, async () => { await rejects(`select * from claim_job()`); });
  const c = await db.query<{ id: string; attempts: number }>(`select id, attempts from claim_job()`); // servidor
  assert.equal(c.rows[0].attempts, 1);
  assert.equal((await db.query(`select * from claim_job()`)).rows.length, 0); // ya reclamado
});

test("request_render: idempotente, reutiliza export listo, solo miembros", async () => {
  const prj = (await db.query<{ id: string; source_id: string }>(`select id, source_id from projects where workspace_id='${wsA}' limit 1`)).rows[0];
  await db.exec(`insert into transcripts(workspace_id,source_id,words) values ('${wsA}','${prj.source_id}','[]')`);
  const tr = (await db.query<{ id: string }>(`select id from transcripts where workspace_id='${wsA}' limit 1`)).rows[0].id;
  const gen = (await db.query<{ id: string }>(`insert into generations(workspace_id,project_id,transcript_id,rubric_version,model) values ('${wsA}','${prj.id}','${tr}','r','m') returning id`)).rows[0].id;
  const clip = (await db.query<{ id: string }>(`insert into clips(workspace_id,project_id,generation_id,title) values ('${wsA}','${prj.id}','${gen}','c') returning id`)).rows[0].id;
  await db.exec(`insert into clip_versions(clip_id,workspace_id,version,composition) values ('${clip}','${wsA}',1,'{}')`);
  let a: any, b: any;
  await asUser(A, async () => {
    a = (await db.query<{ r: any }>(`select request_render('${clip}',1,'1:1',true) r`)).rows[0].r;
    b = (await db.query<{ r: any }>(`select request_render('${clip}',1,'1:1',true) r`)).rows[0].r;
    await rejects(`select request_render('${clip}',9,'1:1',true)`);
    await rejects(`select request_render('${clip}',1,'4:3',true)`);
  });
  assert.equal(a.job_id, b.job_id);
  await asUser(B, async () => { await rejects(`select request_render('${clip}',1,'1:1',true)`); });
  await db.exec(`insert into renders(workspace_id,clip_id,clip_version,ratio,burn_subtitles,spec_sha256,status) values ('${wsA}','${clip}',1,'16:9',true,'x','ready')`);
  await asUser(A, async () => {
    const c = (await db.query<{ r: any }>(`select request_render('${clip}',1,'16:9',true) r`)).rows[0].r;
    assert.equal(c.reused, true);
  });
});

test("fuentes propias: privadas por workspace y con ruta obligatoria en su carpeta", async () => {
  await asUser(A, async () => {
    await db.query(`insert into workspace_fonts(workspace_id,family,storage_path,bytes,created_by) values ('${wsA}','Bootzy TM','${wsA}/fonts/a.ttf',1000,'${A}')`);
    await rejects(`insert into workspace_fonts(workspace_id,family,storage_path,bytes,created_by) values ('${wsA}','X','${wsB}/fonts/x.ttf',1000,'${A}')`);
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from workspace_fonts`)).rows.length, 0);
    await rejects(`insert into workspace_fonts(workspace_id,family,storage_path,bytes,created_by) values ('${wsA}','Y','${wsA}/fonts/y.ttf',1000,'${B}')`);
    const d = await db.query(`delete from workspace_fonts returning id`); assert.equal(d.rows.length, 0);
  });
});
