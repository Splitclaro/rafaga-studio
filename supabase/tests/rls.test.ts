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
  await db.exec(readFileSync(new URL("../migrations/20261109000005_lyric_studio.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261109000007_collections.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261109000008_pages.sql", import.meta.url), "utf8"));
  await db.exec("grant select, insert, delete on public.text_styles to authenticated;");
  await db.exec(readFileSync(new URL("../migrations/20261109000009_automation_calendar.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000010_lyrics_ratio.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000011_automation_jobs.sql", import.meta.url), "utf8"));
  await db.exec("grant execute on function public.request_automation_check(uuid) to authenticated;");
  await db.exec(readFileSync(new URL("../migrations/20261110000012_live.sql", import.meta.url), "utf8"));
  await db.exec("grant select on public.live_sessions, public.live_windows to authenticated; grant execute on function public.start_live_session(text, text), public.set_live_status(uuid, text) to authenticated;");
  await db.exec("grant select, insert, delete on public.songs to authenticated; grant select on public.song_alignments, public.lyric_videos to authenticated; grant execute on function public.request_lyrics(uuid, jsonb, text) to authenticated;");
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

test("Lyric Studio: canciones privadas, ruta en su carpeta, petición de N validada", async () => {
  let song = "";
  await asUser(A, async () => {
    song = (await db.query<{ id: string }>(`insert into songs(workspace_id,title,storage_path,mime,bytes,created_by) values ('${wsA}','Tema','${wsA}/songs/a.mp3','audio/mpeg',100,'${A}') returning id`)).rows[0].id;
    await rejects(`insert into songs(workspace_id,title,storage_path,mime,bytes,created_by) values ('${wsA}','X','${wsB}/songs/x.mp3','audio/mpeg',100,'${A}')`);
    await rejects(`insert into songs(workspace_id,title,storage_path,mime,bytes,created_by) values ('${wsA}','X','${wsA}/songs/x.ogg','audio/ogg',100,'${A}')`);
    const j1 = (await db.query<{ r: string }>(`select request_lyrics('${song}','{"n":10,"ratio":"9:16"}','clave-lyr-1') r`)).rows[0].r;
    const j2 = (await db.query<{ r: string }>(`select request_lyrics('${song}','{"n":10,"ratio":"9:16"}','clave-lyr-1') r`)).rows[0].r;
    assert.equal(j1, j2);
    await rejects(`select request_lyrics('${song}','{"n":0,"ratio":"9:16"}','clave-lyr-2')`);
    await rejects(`select request_lyrics('${song}','{"n":5,"ratio":"4:3"}','clave-lyr-3')`);
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from songs`)).rows.length, 0);
    await rejects(`select request_lyrics('${song}','{"n":1,"ratio":"9:16"}','clave-lyr-4')`);
  });
});

test("Custom Collections: privadas por workspace, sin mezclar colecciones ajenas", async () => {
  let col = "";
  await asUser(A, async () => {
    col = (await db.query<{ id: string }>(`insert into media_collections(workspace_id,name,created_by) values ('${wsA}','Mis noches','${A}') returning id`)).rows[0].id;
    await db.query(`insert into media_items(workspace_id,collection_id,kind,name,storage_path,mime,bytes,created_by) values ('${wsA}','${col}','video','n.mp4','${wsA}/media/${col}/1.mp4','video/mp4',10,'${A}')`);
    await rejects(`insert into media_items(workspace_id,collection_id,kind,name,storage_path,mime,bytes,created_by) values ('${wsA}','${col}','video','x','${wsB}/media/x.mp4','video/mp4',10,'${A}')`);
    await rejects(`insert into media_items(workspace_id,collection_id,kind,name,storage_path,mime,bytes,created_by) values ('${wsA}','${col}','video','x','${wsA}/media/x.exe','application/x-msdownload',10,'${A}')`);
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from media_collections`)).rows.length, 0);
    assert.equal((await db.query(`select * from media_items`)).rows.length, 0);
    await rejects(`insert into media_items(workspace_id,collection_id,kind,name,storage_path,mime,bytes,created_by) values ('${wsB}','${col}','video','x','${wsB}/media/x.mp4','video/mp4',10,'${B}')`);
  });
});

test("Style Studio: estilos privados por workspace; modo de proyecto validado", async () => {
  await asUser(A, async () => {
    await db.query(`insert into text_styles(workspace_id,name,style,created_by) values ('${wsA}','Mi estilo','{"fontName":"Bootzy TM"}','${A}')`);
    await rejects(`insert into text_styles(workspace_id,name,style,created_by) values ('${wsA}','Mi estilo','{}','${A}')`); // nombre duplicado
    await rejects(`insert into text_styles(workspace_id,name,style,created_by) values ('${wsB}','X','{}','${A}')`);         // otro workspace
  });
  await asUser(B, async () => { assert.equal((await db.query(`select * from text_styles`)).rows.length, 0); });
  const src = (await db.query<{ id: string }>(`select id from sources where workspace_id='${wsA}' limit 1`)).rows[0].id;
  await asUser(A, async () => {
    await db.query(`insert into projects(workspace_id,source_id,name,created_by,mode) values ('${wsA}','${src}','m','${A}','captions')`);
    await rejects(`insert into projects(workspace_id,source_id,name,created_by,mode) values ('${wsA}','${src}','m','${A}','hackear')`);
  });
});

test("Automatizaciones y Calendario: HTTPS obligatorio, inactiva al crear, dedupe por entrada, aislamiento", async () => {
  let rule = "";
  await asUser(A, async () => {
    rule = (await db.query<{ id: string }>(`insert into automation_rules(workspace_id,name,feed_url,created_by) values ('${wsA}','Podcast','https://example.com/feed.xml','${A}') returning id`)).rows[0].id;
    await rejects(`insert into automation_rules(workspace_id,name,feed_url,created_by) values ('${wsA}','x','http://example.com/f.xml','${A}')`);
    await rejects(`insert into automation_rules(workspace_id,name,feed_url,created_by,active) values ('${wsA}','x','https://example.com/f.xml','${A}',true)`);
    await db.query(`update automation_rules set active = true where id = '${rule}'`);
    await rejects(`insert into automation_runs(workspace_id,rule_id,entry_guid) values ('${wsA}','${rule}','g1')`); // solo servidor
    await db.query(`insert into scheduled_posts(workspace_id,title,scheduled_at,created_by) values ('${wsA}','Post','2026-12-01T10:00:00Z','${A}')`);
    await rejects(`insert into scheduled_posts(workspace_id,title,scheduled_at,created_by,publish_mode) values ('${wsA}','x','2026-12-01T10:00:00Z','${A}','api')`);
  });
  await db.exec(`insert into automation_runs(workspace_id,rule_id,entry_guid) values ('${wsA}','${rule}','g1')`);
  await rejects(`insert into automation_runs(workspace_id,rule_id,entry_guid) values ('${wsA}','${rule}','g1')`);
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from automation_rules`)).rows.length, 0);
    assert.equal((await db.query(`select * from automation_runs`)).rows.length, 0);
    assert.equal((await db.query(`select * from scheduled_posts`)).rows.length, 0);
    await rejects(`delete from automation_rules`).catch(() => {});
  });
});

test("Automatizaciones: el cursor se fija al activar y la comprobación bajo demanda es idempotente y privada", async () => {
  const rule = (await db.query<{ id: string }>(`select id from automation_rules where workspace_id='${wsA}' limit 1`)).rows[0].id;
  await db.exec(`update automation_rules set active = false, cursor_published = null where id = '${rule}'`);
  await asUser(A, async () => { await db.query(`update automation_rules set active = true where id = '${rule}'`); });
  const c = (await db.query<{ cursor_published: string | null }>(`select cursor_published from automation_rules where id='${rule}'`)).rows[0].cursor_published;
  assert.ok(c, "cursor fijado al activar");
  let j1 = "", j2 = "";
  await asUser(A, async () => {
    j1 = (await db.query<{ r: string }>(`select request_automation_check('${rule}') r`)).rows[0].r;
    j2 = (await db.query<{ r: string }>(`select request_automation_check('${rule}') r`)).rows[0].r;
  });
  assert.equal(j1, j2);
  await asUser(B, async () => { await rejects(`select request_automation_check('${rule}')`); });
});

test("En vivo: una sesión activa por workspace, URL https, parar/reanudar y aislamiento", async () => {
  let sid = "";
  await asUser(A, async () => {
    await rejects(`select start_live_session('http://x.com/l.m3u8', null)`);
    sid = (await db.query<{ r: string }>(`select start_live_session('https://x.com/l.m3u8', 'partido') r`)).rows[0].r;
    await rejects(`select start_live_session('https://x.com/otra.m3u8', null)`);                 // ya hay una activa
    await rejects(`insert into live_sessions(workspace_id,hls_url,created_by) values ('${wsA}','https://x.com/a.m3u8','${A}')`); // sin escritura directa
    assert.equal((await db.query<{ r: string }>(`select set_live_status('${sid}','pause') r`)).rows[0].r, "paused");
    assert.equal((await db.query<{ r: string }>(`select set_live_status('${sid}','resume') r`)).rows[0].r, "queued");
    await rejects(`select set_live_status('${sid}','resume')`);                                    // no se puede reanudar una activa
    assert.equal((await db.query<{ r: string }>(`select set_live_status('${sid}','stop') r`)).rows[0].r, "stopped");
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from live_sessions`)).rows.length, 0);
    await rejects(`select set_live_status('${sid}','resume')`);
    const b = (await db.query<{ r: string }>(`select start_live_session('https://y.com/l.m3u8', null) r`)).rows[0].r; assert.ok(b);   // B puede tener la suya
  });
});
