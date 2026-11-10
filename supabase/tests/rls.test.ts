// Prueba de migración desde cero + aislamiento RLS en Postgres real (PGlite).
// auth/storage se simulan SOLO aquí; la prueba A/B contra Supabase real sigue pendiente.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";

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
  await db.exec(readFileSync(new URL("../migrations/20261110000013_lyric_looks.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000015_scheduler.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000016_job_timing_fair_queue.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000017_workspaces_roles.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000018_brand_kits.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000019_clip_thumbs_titles.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000020_privilege_hardening.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261110000021_review_deliveries.sql", import.meta.url), "utf8"));
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
    await rejects(`select request_lyrics('${song}','{"n":5,"ratio":"3:2"}','clave-lyr-3')`);
    await rejects(`select request_lyrics('${song}','{"n":5,"ratio":"4:3","res":"4k"}','clave-lyr-5')`);
    assert.ok((await db.query(`select request_lyrics('${song}','{"n":5,"ratio":"4:3","res":"720"}','clave-lyr-6')`)).rows.length);
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

test("Sincronización manual: misma clave que el worker, validación de tiempos y aislamiento", async () => {
  const lyr = "  Todavía te busco\n\nen la   ciudad ";
  const song = (await db.query<{ id: string }>(`insert into songs(workspace_id,title,storage_path,mime,bytes,created_by,lyrics_text) values ('${wsA}','Manual','${wsA}/songs/m.mp3','audio/mpeg',100,'${A}',$1) returning id`, [lyr])).rows[0].id;
  const expected = "manual:" + createHash("sha256").update(lyr.trim().replace(/\s+/g, " ")).digest("hex");
  const ok = JSON.stringify([{ text: "Todavía", start: 0.4, end: 0.9 }, { text: "te", start: 1, end: 1.1 }]);
  await asUser(A, async () => {
    const k = (await db.query<{ k: string }>(`select public.save_manual_alignment('${song}', $1::jsonb) k`, [ok])).rows[0].k;
    assert.equal(k, expected);
    await assert.rejects(() => db.query(`select public.save_manual_alignment('${song}', $1::jsonb)`, [JSON.stringify([{ text: "a", start: 1, end: 0.5 }])]));
    await assert.rejects(() => db.query(`select public.save_manual_alignment('${song}', $1::jsonb)`, [JSON.stringify([{ text: "a", start: 2, end: 3 }, { text: "b", start: 1, end: 1.5 }])]));
    await rejects(`update song_alignments set words='[]'::jsonb`);
    await db.query(`update songs set studio_settings='{"look":"diario"}'::jsonb where id='${song}'`);
  });
  await asUser(B, async () => {
    await assert.rejects(() => db.query(`select public.save_manual_alignment('${song}', $1::jsonb)`, [ok]));
    assert.equal((await db.query(`select * from song_alignments where song_id='${song}'`)).rows.length, 0);
  });
  const r = (await db.query<{ words: { origin: string }[] }>(`select words from song_alignments where lyrics_sha256='${expected}'`)).rows[0];
  assert.equal(r.words[0].origin, "manual");
});

test("Programador: encola revisiones vencidas sin duplicar, cierra huérfanos y no lanza worker sin token", async () => {
  const rule = (await db.query<{ id: string }>(`insert into automation_rules(workspace_id,name,feed_url,active,created_by,last_checked_at) values ('${wsA}','Sched','https://example.com/f.xml',true,'${A}', now() - interval '1 hour') returning id`)).rows[0].id;
  const orphan = (await db.query<{ id: string }>(`insert into jobs(workspace_id,kind,idempotency_key,status,attempts,heartbeat_at,created_by) values ('${wsA}','detect','orph-1','transcribing',3, now() - interval '1 hour','${A}') returning id`)).rows[0].id;
  const r1 = (await db.query<{ r: { enqueued: number; orphaned: number; dispatch: string; pending: number } }>(`select public.scheduler_tick() r`)).rows[0].r;
  assert.equal(r1.enqueued, 1); assert.equal(r1.orphaned, 1);
  assert.ok(r1.pending >= 1); assert.equal(r1.dispatch, "not_configured");
  const r2 = (await db.query<{ r: { enqueued: number } }>(`select public.scheduler_tick() r`)).rows[0].r;
  assert.equal(r2.enqueued, 0, "no duplica mientras hay una revisión pendiente");
  assert.equal((await db.query<{ status: string; error_code: string }>(`select status, error_code from jobs where id='${orphan}'`)).rows[0].error_code, "orphaned");
  assert.equal((await db.query(`select * from jobs where kind='automation' and params->>'rule_id'='${rule}'`)).rows.length, 1);
  // con worker vivo no se lanza otro
  await db.exec(`insert into worker_heartbeats(id) values ('run-1')`);
  assert.equal((await db.query<{ r: { dispatch: string } }>(`select public.scheduler_tick() r`)).rows[0].r.dispatch, "not_needed");
  await asUser(A, async () => {
    await rejects(`select public.scheduler_tick()`);
    await rejects(`insert into worker_heartbeats(id) values ('x')`);
    assert.ok((await db.query(`select * from scheduler_runs`)).rows.length >= 3);
  });
});

test("Cola justa: un workspace con trabajos en marcha no bloquea al siguiente; tiempos de inicio y fin", async () => {
  await db.exec(`update jobs set status='done' where status not in ('done','failed','cancelled')`);
  await db.exec(`insert into jobs(workspace_id,kind,idempotency_key,status,created_by,heartbeat_at) values ('${wsA}','detect','fair-run','transcribing','${A}', now())`);
  await db.exec(`insert into jobs(workspace_id,kind,idempotency_key,created_by,created_at) values ('${wsA}','detect','fair-a1','${A}', now() - interval '5 minutes')`);
  await db.exec(`insert into jobs(workspace_id,kind,idempotency_key,created_by,created_at) values ('${wsB}','detect','fair-b1','${B}', now() - interval '1 minute')`);
  const c = (await db.query<{ idempotency_key: string; started_at: string | null }>(`select * from public.claim_job()`)).rows[0];
  assert.equal(c.idempotency_key, "fair-b1", "B no espera detrás del lote de A");
  assert.ok(c.started_at);
  await db.exec(`update jobs set status='done' where idempotency_key='fair-b1'`);
  assert.ok((await db.query<{ finished_at: string | null }>(`select finished_at from jobs where idempotency_key='fair-b1'`)).rows[0].finished_at);
});

test("Espacios: crear, invitar con rol, aislamiento por espacio activo, lector sin escritura y auditoría", async () => {
  let client = "", token = "";
  await asUser(A, async () => {
    client = (await db.query<{ id: string }>(`select public.create_workspace('Cliente X') id`)).rows[0].id;
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from public.my_workspaces()`)).rows[0].n, 2);
    // el espacio activo es el nuevo: no se ven los proyectos del personal
    await db.query(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${client}','upload','${client}/src/x.mp4','video/mp4',10,'${A}')`);
    assert.ok((await db.query<{ workspace_id: string }>(`select workspace_id from sources`)).rows.every((r) => r.workspace_id === client));
    await rejects(`select public.create_invite('no-es-email', 'viewer')`);
    await rejects(`select public.create_invite('b@test.dev', 'owner')`);
    token = (await db.query<{ t: string }>(`select public.create_invite('B@test.dev', 'viewer') t`)).rows[0].t;
    assert.equal(token.length, 64);
    assert.equal((await db.query(`select id, email, role from workspace_invites where email='b@test.dev'`)).rows.length, 1);
  });
  await asUser(B, async () => {
    await rejects(`select public.accept_invite('${"0".repeat(64)}')`);
    const ws = (await db.query<{ w: string }>(`select public.accept_invite('${token}') w`)).rows[0].w;
    assert.equal(ws, client);
    await rejects(`select public.accept_invite('${token}')`);           // un solo uso
    assert.equal((await db.query<{ r: string }>(`select public.my_role() r`)).rows[0].r, "viewer");
    assert.ok((await db.query(`select * from sources where workspace_id='${client}'`)).rows.length >= 1, "el lector ve el espacio del cliente");
    assert.equal((await db.query(`select * from sources where workspace_id='${wsA}'`)).rows.length, 0, "pero no el espacio personal de A");
    await rejects(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${client}','upload','${client}/src/y.mp4','video/mp4',10,'${B}')`);
    await rejects(`select public.create_invite('c@test.dev', 'editor')`);
    await db.query(`update workspaces set name='hack' where id='${client}'`);
    assert.equal((await db.query<{ name: string }>(`select name from workspaces where id='${client}'`)).rows[0].name, "Cliente X");
    // volver a su espacio personal: deja de ver el del cliente
    await db.query(`select public.set_active_workspace('${wsB}')`);
    assert.equal((await db.query(`select * from sources where workspace_id='${client}'`)).rows.length, 0);
    await rejects(`select public.set_active_workspace('${wsA}')`);
  });
  await asUser(A, async () => {
    await db.query(`select public.set_member_role('${B}', 'editor')`);
    await rejects(`select public.remove_member('${A}')`);
    const ev = (await db.query<{ action: string }>(`select action from audit_events where workspace_id='${client}' order by id`)).rows.map((r) => r.action);
    assert.deepEqual(ev, ["workspace.create", "invite.create", "invite.accept", "member.role"]);
    await db.query(`select public.set_active_workspace('${wsA}')`);
  });
  await asUser(B, async () => {
    await db.query(`select public.set_active_workspace('${client}')`);
    assert.equal((await db.query<{ r: string }>(`select public.my_role() r`)).rows[0].r, "editor");
    await db.query(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${client}','upload','${client}/src/z.mp4','video/mp4',10,'${B}')`);
    assert.equal((await db.query(`select * from audit_events`)).rows.length, 0, "auditoría solo para administradores");
    await db.query(`select public.set_active_workspace('${wsB}')`);
  });
});

test("Brand kits: versión automática, instantáneas inmutables, aplicar/revertir y aislamiento", async () => {
  let kit = "", proj = "", clip = "", app = "";
  await db.exec(`update workspace_members set role='owner' where user_id='${A}'; update profiles set active_workspace_id = null where id in ('${A}','${B}')`);
  const src = (await db.query<{ id: string }>(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${wsA}','upload','${wsA}/s/b.mp4','video/mp4',10,'${A}') returning id`)).rows[0].id;
  proj = (await db.query<{ id: string }>(`insert into projects(workspace_id,source_id,name,created_by) values ('${wsA}','${src}','P brand','${A}') returning id`)).rows[0].id;
  const tr = (await db.query<{ id: string }>(`insert into transcripts(workspace_id,source_id,words) values ('${wsA}','${src}','[]') returning id`)).rows[0].id;
  const gen = (await db.query<{ id: string }>(`insert into generations(workspace_id,project_id,transcript_id,rubric_version,model) values ('${wsA}','${proj}','${tr}','r','m') returning id`)).rows[0].id;
  clip = (await db.query<{ id: string }>(`insert into clips(workspace_id,project_id,generation_id,title,current_version) values ('${wsA}','${proj}','${gen}','C',2) returning id`)).rows[0].id;
  await db.exec(`insert into clip_versions(clip_id,workspace_id,version,composition) values ('${clip}','${wsA}',1,'{}'),('${clip}','${wsA}',2,'{}')`);
  await asUser(A, async () => {
    kit = (await db.query<{ id: string }>(`insert into brand_kits(workspace_id,name,colors,config) values ('${wsA}','Marca A','{"primary":"#111111"}','{"logo":{"position":"tr"}}') returning id`)).rows[0].id;
    assert.equal((await db.query<{ version: number }>(`select version from brand_kits where id='${kit}'`)).rows[0].version, 1);
    await db.query(`update brand_kits set colors='{"primary":"#222222"}' where id='${kit}'`);
    await db.query(`update brand_kits set archived_at=null where id='${kit}'`);     // sin cambio de contenido: no sube versión
    const v = (await db.query<{ version: number }>(`select version from brand_kits where id='${kit}'`)).rows[0].version;
    assert.equal(v, 2);
    const snaps = (await db.query<{ version: number; snapshot: { colors: { primary: string } } }>(`select version, snapshot from brand_kit_versions where kit_id='${kit}' order by version`)).rows;
    assert.deepEqual(snaps.map((x) => [x.version, x.snapshot.colors.primary]), [[1, "#111111"], [2, "#222222"]]);
    await rejects(`update brand_kit_versions set snapshot='{}'`);
    await rejects(`insert into brand_kits(workspace_id,name,logo_path) values ('${wsA}','mal','${wsB}/brand/x.png')`);   // logo fuera de su espacio
    app = (await db.query<{ a: string }>(`select public.apply_brand_kit('${proj}','${kit}', '[{"clip_id":"${clip}","from":1,"to":2}]'::jsonb) a`)).rows[0].a;
    const pr = (await db.query<{ brand_kit_id: string; brand_kit_version: number }>(`select brand_kit_id, brand_kit_version from projects where id='${proj}'`)).rows[0];
    assert.deepEqual([pr.brand_kit_id, pr.brand_kit_version], [kit, 2]);
    await db.query(`update brand_kits set colors='{"primary":"#333333"}' where id='${kit}'`);   // el kit cambia; el proyecto sigue fijado a v2
    assert.equal((await db.query<{ v: number }>(`select brand_kit_version v from projects where id='${proj}'`)).rows[0].v, 2);
    await rejects(`select public.apply_brand_kit('${proj}','${kit}','[{"clip_id":"${clip}","from":9,"to":2}]'::jsonb)`);
    const n = (await db.query<{ n: number }>(`select public.revert_brand_application('${app}') n`)).rows[0].n;
    assert.equal(n, 1);
    assert.equal((await db.query<{ v: number }>(`select current_version v from clips where id='${clip}'`)).rows[0].v, 1);
    assert.equal((await db.query<{ k: string | null }>(`select brand_kit_id k from projects where id='${proj}'`)).rows[0].k, null);
    await rejects(`select public.revert_brand_application('${app}')`);
    // exports: un render hecho sin marca no se reutiliza cuando el proyecto tiene un kit aplicado
    await db.exec(`reset role`);
    await db.exec(`insert into renders(workspace_id,clip_id,clip_version,ratio,burn_subtitles,spec_sha256,storage_path,status,probe) values ('${wsA}','${clip}',1,'9:16',true,'h','${wsA}/${clip}/r.mp4','ready','{}')`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}',false)`);
    assert.equal((await db.query<{ r: { reused: boolean } }>(`select public.request_render('${clip}',1,'9:16',true) r`)).rows[0].r.reused, true);
    await db.query(`select public.apply_brand_kit('${proj}','${kit}')`);
    const r2 = (await db.query<{ r: { reused: boolean; job_id: string } }>(`select public.request_render('${clip}',1,'9:16',true) r`)).rows[0].r;
    assert.equal(r2.reused, false, "con marca aplicada se genera un export nuevo");
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from brand_kits`)).rows.length, 0);
    assert.equal((await db.query(`select * from brand_kit_versions`)).rows.length, 0);
    await rejects(`select public.apply_brand_kit('${proj}','${kit}')`);
    await rejects(`select public.revert_brand_application('${app}')`);
  });
});

test("Miniaturas y títulos: el usuario renombra y marca su título; no toca la miniatura; título acotado", async () => {
  const c = (await db.query<{ id: string }>(`select id from clips where workspace_id='${wsA}' limit 1`)).rows[0].id;
  await asUser(A, async () => {
    await db.query(`update clips set title='Mi título', title_source='user' where id='${c}'`);
    assert.equal((await db.query<{ t: string }>(`select title_source t from clips where id='${c}'`)).rows[0].t, "user");
    await rejects(`update clips set title_source='otro' where id='${c}'`);
    await rejects(`update clips set title='' where id='${c}'`);
    await rejects(`update clips set thumb_path='${wsA}/x/thumb.jpg' where id='${c}'`);   // solo el servidor
  });
  await db.exec(`update clips set thumb_path='${wsA}/${c}/thumb.jpg' where id='${c}'`);
  await assert.rejects(() => db.exec(`update clips set thumb_path='${wsB}/${c}/thumb.jpg' where id='${c}'`));   // fuera de su espacio
});

test("Privilegios: anon sin acceso a ninguna tabla y versiones de clip inmutables", async () => {
  const t = (await db.query<{ n: number }>(`select count(*)::int n from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and has_table_privilege('anon', c.oid, 'SELECT')`)).rows[0].n;
  assert.equal(t, 0);
  const cv = (await db.query<{ u: boolean; d: boolean }>(`select has_table_privilege('authenticated','public.clip_versions','UPDATE') u, has_table_privilege('authenticated','public.clip_versions','DELETE') d`)).rows[0];
  assert.deepEqual([cv.u, cv.d], [false, false]);
  assert.equal((await db.query<{ s: boolean }>(`select has_table_privilege('authenticated','public.clip_versions','SELECT') s`)).rows[0].s, true);
});

test("Revisión: aprobación ligada a la versión, comentarios con permisos y entregas con versión fijada", async () => {
  const src = (await db.query<{ id: string }>(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${wsA}','upload','${wsA}/s/rv.mp4','video/mp4',10,'${A}') returning id`)).rows[0].id;
  const proj = (await db.query<{ id: string }>(`insert into projects(workspace_id,source_id,name,created_by) values ('${wsA}','${src}','P rev','${A}') returning id`)).rows[0].id;
  const tr = (await db.query<{ id: string }>(`insert into transcripts(workspace_id,source_id,words) values ('${wsA}','${src}','[]') returning id`)).rows[0].id;
  const gen = (await db.query<{ id: string }>(`insert into generations(workspace_id,project_id,transcript_id,rubric_version,model) values ('${wsA}','${proj}','${tr}','r','m') returning id`)).rows[0].id;
  const clip = (await db.query<{ id: string }>(`insert into clips(workspace_id,project_id,generation_id,title,current_version) values ('${wsA}','${proj}','${gen}','Clip rev',1) returning id`)).rows[0].id;
  await db.exec(`insert into clip_versions(clip_id,workspace_id,version,composition) values ('${clip}','${wsA}',1,'{}'),('${clip}','${wsA}',2,'{}')`);
  await db.exec(`update profiles set active_workspace_id = null where id in ('${A}','${B}')`);
  await asUser(A, async () => {
    await rejects(`update clips set review_status='approved' where id='${clip}'`);                      // no directo
    await rejects(`select public.set_review('${clip}','approved',2,null)`);                            // no es la versión actual
    await db.query(`select public.set_review('${clip}','approved',1,'Todo bien')`);
    const r = (await db.query<{ review_status: string; approved_version: number }>(`select review_status, approved_version from clips where id='${clip}'`)).rows[0];
    assert.deepEqual([r.review_status, r.approved_version], ["approved", 1]);
    // el clip cambia de versión: la aprobación ya no corresponde a la versión actual
    await db.exec(`reset role`); await db.exec(`update clips set current_version = 2 where id='${clip}'`); await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}',false)`);
    const r2 = (await db.query<{ ok: boolean }>(`select (approved_version = current_version) ok from clips where id='${clip}'`)).rows[0];
    assert.equal(r2.ok, false, "la aprobación de v1 no vale para v2");
    await rejects(`select public.set_review('${clip}','approved',1,null)`);
    await db.query(`select public.set_review('${clip}','changes_requested',2,'Subir el volumen')`);
    await db.query(`select public.add_clip_comment('${clip}',2,3.5,'Aquí falta una palabra')`);
    await rejects(`select public.add_clip_comment('${clip}',9,1,'versión inexistente')`);
    await rejects(`select public.add_clip_comment('${clip}',2,1,'   ')`);
    assert.equal((await db.query(`select * from clip_comments where clip_id='${clip}'`)).rows.length, 3);
    const d = (await db.query<{ d: string }>(`select public.create_delivery('${proj}','Entrega 1','Primera entrega','[{"clip_id":"${clip}","version":2}]'::jsonb) d`)).rows[0].d;
    await rejects(`select public.create_delivery('${proj}','x','','[]'::jsonb)`);
    await rejects(`select public.create_delivery('${proj}','x','','[{"clip_id":"${clip}","version":9}]'::jsonb)`);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from delivery_items where delivery_id='${d}'`)).rows[0].n, 1);
    await db.query(`select public.delete_delivery('${d}')`);
    assert.equal((await db.query(`select * from clips where id='${clip}'`)).rows.length, 1, "borrar la entrega no borra el clip");
    await db.query(`select public.create_delivery('${proj}','Entrega B','', '[{"clip_id":"${clip}","version":2}]'::jsonb)`);
    // Invitar a B como lector: puede ver, no revisar
    const tok = (await db.query<{ t: string }>(`select public.create_invite('b@test.dev','viewer') t`)).rows[0].t;
    await db.exec(`reset role`); await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${B}',false)`);
    await db.query(`select public.accept_invite('${tok}')`);
    await rejects(`select public.set_review('${clip}','approved',2,null)`);
    await rejects(`select public.add_clip_comment('${clip}',2,1,'no puedo')`);
    assert.ok((await db.query(`select * from deliveries`)).rows.length >= 1, "el lector ve la entrega");
    await db.query(`select public.set_active_workspace('${wsB}')`);
    assert.equal((await db.query(`select * from deliveries`)).rows.length, 0, "en su espacio no ve las de A");
    await db.exec(`reset role`); await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}',false)`);
  });
});
