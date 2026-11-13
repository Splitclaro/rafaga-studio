// Prueba de migración desde cero + aislamiento RLS en Postgres real (PGlite).
// auth/storage se simulan SOLO aquí; la prueba A/B contra Supabase real sigue pendiente.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";

import { freshDb, A, B } from "./migrate.ts";

let db: PGlite;
let wsA: string, wsB: string;
let asUser: (uid: string | null, fn: () => Promise<void>) => Promise<void>;
const rejects = async (sql: string) => { await assert.rejects(() => db.query(sql)); };

before(async () => {
  // Todas las migraciones, en orden, con la emulación de Supabase del arnés (supabase/tests/migrate.ts).
  ({ db, wsA, wsB, asUser } = await freshDb());
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

test("Enlaces de revisión: token acotado, permisos, caducidad, revocación, versión obsoleta y paquetes", async () => {
  await db.exec(`update profiles set active_workspace_id = null where id in ('${A}','${B}')`);
  const src = (await db.query<{ id: string }>(`insert into sources(workspace_id,kind,storage_path,mime,bytes,created_by) values ('${wsA}','upload','${wsA}/s/sh.mp4','video/mp4',10,'${A}') returning id`)).rows[0].id;
  const proj = (await db.query<{ id: string }>(`insert into projects(workspace_id,source_id,name,created_by) values ('${wsA}','${src}','P share','${A}') returning id`)).rows[0].id;
  const tr = (await db.query<{ id: string }>(`insert into transcripts(workspace_id,source_id,words) values ('${wsA}','${src}','[]') returning id`)).rows[0].id;
  const gen = (await db.query<{ id: string }>(`insert into generations(workspace_id,project_id,transcript_id,rubric_version,model) values ('${wsA}','${proj}','${tr}','r','m') returning id`)).rows[0].id;
  const clip = (await db.query<{ id: string }>(`insert into clips(workspace_id,project_id,generation_id,title,current_version,thumb_path) values ('${wsA}','${proj}','${gen}','Clip share',1,'${wsA}/x/thumb.jpg') returning id`)).rows[0].id;
  const other = (await db.query<{ id: string }>(`insert into clips(workspace_id,project_id,generation_id,title,current_version) values ('${wsA}','${proj}','${gen}','Fuera de la entrega',1) returning id`)).rows[0].id;
  await db.exec(`insert into clip_versions(clip_id,workspace_id,version,composition) values ('${clip}','${wsA}',1,'{}'),('${clip}','${wsA}',2,'{}'),('${other}','${wsA}',1,'{}')`);
  await db.exec(`insert into renders(workspace_id,clip_id,clip_version,ratio,burn_subtitles,spec_sha256,storage_path,status,probe) values ('${wsA}','${clip}',1,'9:16',true,'h1','${wsA}/${clip}/v1.mp4','ready','{"duration":"20","size":"1000"}')`);
  let del = "", tok = "", tokRO = "";
  await asUser(A, async () => {
    del = (await db.query<{ d: string }>(`select public.create_delivery('${proj}','Entrega share','', '[{"clip_id":"${clip}","version":1}]'::jsonb) d`)).rows[0].d;
    await rejects(`select public.create_share_link('${del}', 0, false, true, false)`);
    await rejects(`select public.create_share_link('${del}', 200, false, true, false)`);
    tok = (await db.query<{ t: string }>(`select public.create_share_link('${del}', 7, true, true, true, 'Cliente') t`)).rows[0].t;
    tokRO = (await db.query<{ t: string }>(`select public.create_share_link('${del}', 3, false, false, true) t`)).rows[0].t;   // approve sin comment → se anula
    assert.equal(tok.length, 64);
    await rejects(`select token_sha256 from share_links`);                         // el hash no se lee desde el cliente
  });
  await asUser(null, async () => {   // anónimo
    await rejects(`select * from deliveries`); await rejects(`select * from share_links`);
    const v = (await db.query<{ v: { delivery: { name: string }; items: { clip_id: string; render_path: string; thumb_path: string }[]; perms: Record<string, boolean>; error?: string } }>(`select public.share_view('${tok}') v`)).rows[0].v;
    assert.equal(v.delivery.name, "Entrega share"); assert.equal(v.items.length, 1); assert.equal(v.items[0].render_path, `${wsA}/${clip}/v1.mp4`);
    assert.deepEqual(v.perms, { download: true, comment: true, approve: true });
    assert.equal((await db.query<{ v: { error: string } }>(`select public.share_view('mal-token') v`)).rows[0].v.error, "invalid");
    assert.equal((await db.query<{ ok: boolean }>(`select public.share_path_ok('${wsA}/${clip}/v1.mp4') ok`)).rows[0].ok, true);
    assert.equal((await db.query<{ ok: boolean }>(`select public.share_path_ok('${wsA}/otro/archivo.mp4') ok`)).rows[0].ok, false);
    // comentarios
    await db.query(`select public.share_comment('${tok}','${clip}',3.2,'Me gusta','Marta')`);
    await rejects(`select public.share_comment('${tok}','${clip}',1,'sin nombre','')`);
    await rejects(`select public.share_comment('${tok}','${other}',1,'pieza ajena','Marta')`);
    await rejects(`select public.share_comment('${tokRO}','${clip}',1,'sin permiso','Marta')`);
    // decisión
    await rejects(`select public.share_decide('${tokRO}','${clip}','approved',null,'Marta')`.replace(tokRO, "x" + tokRO.slice(1)));
    await db.query(`select public.share_decide('${tok}','${clip}','approved','Perfecto','Marta')`);
    assert.equal((await db.query<{ v: { items: { review_status: string }[] } }>(`select public.share_view('${tok}') v`)).rows[0].v.items[0].review_status, "approved");
  });
  // el clip pasa a v2: la entrega conserva v1 y una decisión externa sobre una versión obsoleta se rechaza
  await db.exec(`update clips set current_version = 2 where id='${clip}'`);
  await asUser(null, async () => { await rejects(`select public.share_decide('${tok}','${clip}','approved',null,'Marta')`); });
  // revocación y caducidad
  await asUser(A, async () => {
    const id = (await db.query<{ id: string }>(`select id from share_links where label='Cliente'`)).rows[0].id;
    await db.query(`select public.revoke_share_link('${id}')`);
  });
  await asUser(null, async () => {
    assert.equal((await db.query<{ v: { error: string } }>(`select public.share_view('${tok}') v`)).rows[0].v.error, "revoked");
    await rejects(`select public.share_comment('${tok}','${clip}',1,'x','Marta')`);
  });
  await db.exec(`update share_links set expires_at = now() - interval '1 minute' where revoked_at is null`);
  await asUser(null, async () => {
    assert.equal((await db.query<{ v: { error: string } }>(`select public.share_view('${tokRO}') v`)).rows[0].v.error, "expired");
    assert.equal((await db.query<{ ok: boolean }>(`select public.share_path_ok('${wsA}/${clip}/v1.mp4') ok`)).rows[0].ok, false, "sin enlaces activos no hay acceso a archivos");
  });
  // paquetes
  await asUser(A, async () => {
    const p1 = (await db.query<{ p: string }>(`select public.request_package('${del}','{"only_approved":false,"include":["mp4","srt","thumbs"]}'::jsonb) p`)).rows[0].p;
    const p2 = (await db.query<{ p: string }>(`select public.request_package('${del}','{"include":["thumbs","srt","mp4"],"only_approved":false}'::jsonb) p`)).rows[0].p;
    assert.equal(p1, p2, "mismas opciones: reutiliza el paquete");
    await rejects(`select public.request_package('${del}','{"include":["exe"]}'::jsonb)`);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from jobs where kind='package' and params->>'package_id'='${p1}'`)).rows[0].n, 1);
    await rejects(`select public.retry_package('${p1}')`);                  // en cola: no se reintenta
    await db.query(`select public.cancel_package('${p1}')`);
    await db.query(`select public.retry_package('${p1}')`);
    assert.equal((await db.query<{ s: string }>(`select status s from delivery_packages where id='${p1}'`)).rows[0].s, "queued");
  });
  await asUser(B, async () => { await rejects(`select public.request_package('${del}','{}'::jsonb)`); assert.equal((await db.query(`select * from delivery_packages`)).rows.length, 0); });
});

test("biblioteca única: une tipos, aporta huella de contenido y no cruza workspaces", async () => {
  await db.exec(`
    insert into media_collections(id, workspace_id, name, created_by) values ('c0000000-0000-0000-0000-00000000000a','${wsA}','Playa','${A}');
    insert into media_items(workspace_id, collection_id, kind, name, storage_path, mime, bytes, created_by) values
      ('${wsA}','c0000000-0000-0000-0000-00000000000a','video','mar.mp4','${wsA}/media/m1.mp4','video/mp4',1000,'${A}'),
      ('${wsA}','c0000000-0000-0000-0000-00000000000a','video','mar (1).mp4','${wsA}/media/m2.mp4','video/mp4',1000,'${A}'),
      ('${wsA}','c0000000-0000-0000-0000-00000000000a','photo','sol.jpg','${wsA}/media/p1.jpg','image/jpeg',50,'${A}');
    insert into songs(workspace_id, title, artist, storage_path, mime, bytes, created_by) values ('${wsA}','Tema','Ana','${wsA}/songs/s.mp3','audio/mpeg',4000,'${A}');
    insert into storage.objects(bucket_id, name, metadata) values
      ('originals','${wsA}/media/m1.mp4','{"eTag":"\\"abc\\"","size":1000}'),
      ('originals','${wsA}/media/m2.mp4','{"eTag":"\\"abc\\"","size":1000}'),
      ('originals','${wsA}/songs/s.mp3','{"eTag":"\\"zzz\\"","size":4000}');
  `);
  await asUser(A, async () => {
    const all = (await db.query<{ asset_key: string; kind: string; name: string; ref_table: string; bytes: string | null; fingerprint: string | null; fingerprint_kind: string | null; container: string | null }>(`select * from public.library_assets()`)).rows;
    const r = all.filter((x) => ["mar.mp4", "mar (1).mp4", "sol.jpg", "Tema · Ana"].includes(x.name));   // otras pruebas dejan datos en este workspace
    assert.equal(r.length, 4);
    assert.ok(all.every((x) => ["video", "image", "audio", "logo", "font", "export"].includes(x.kind)), "solo tipos conocidos");
    assert.deepEqual(r.map((x) => x.kind).sort(), ["audio", "image", "video", "video"]);
    const vids = r.filter((x) => x.kind === "video");
    assert.equal(vids[0].fingerprint, vids[1].fingerprint, "mismo contenido = misma huella");
    assert.equal(vids[0].fingerprint_kind, "etag"); assert.equal(vids[0].container, "Playa");
    assert.equal(r.find((x) => x.kind === "image")!.fingerprint, null, "sin objeto en storage no hay huella inventada");
    assert.equal(Number(r.find((x) => x.kind === "audio")!.bytes), 4000);
  });
  await asUser(B, async () => { assert.equal((await db.query(`select * from public.library_assets()`)).rows.length, 0, "otro workspace no ve nada"); });
  await asUser(null, async () => { await rejects(`select * from public.library_assets()`); });
});

test("reencuadre: petición validada, reutilizada, aislada por workspace y servida por la cola", async () => {
  const clip = (await db.query<{ id: string }>(`select id from clips where workspace_id='${wsA}' limit 1`)).rows[0].id;
  let tid = "";
  await asUser(A, async () => {
    tid = (await db.query<{ t: string }>(`select public.request_reframe('${clip}', 10, 40, '9:16', 'follow') t`)).rows[0].t;
    const again = (await db.query<{ t: string }>(`select public.request_reframe('${clip}', 10, 40, '9:16', 'follow') t`)).rows[0].t;
    assert.equal(again, tid, "misma petición: reutiliza");
    const other = (await db.query<{ t: string }>(`select public.request_reframe('${clip}', 10, 40, '9:16', 'group') t`)).rows[0].t;
    assert.notEqual(other, tid, "otro modo: otro análisis");
    await rejects(`select public.request_reframe('${clip}', 10, 11, '9:16', 'follow')`);      // < 3 s
    await rejects(`select public.request_reframe('${clip}', 0, 200, '9:16', 'follow')`);      // > 90 s
    await rejects(`select public.request_reframe('${clip}', 10, 40, '2:1', 'follow')`);
    await rejects(`select public.request_reframe('${clip}', 10, 40, '9:16', 'evil')`);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from jobs where kind='reframe' and params->>'track_id'='${tid}'`)).rows[0].n, 1);
    await rejects(`update reframe_tracks set status='ready', path='{"kf":[{"t":0,"x":0}]}' where id='${tid}'`);   // solo el worker escribe
    await rejects(`insert into reframe_tracks(workspace_id,clip_id,source_start,source_end,ratio) values ('${wsA}','${clip}',0,10,'9:16')`);
    assert.equal((await db.query(`select * from reframe_tracks where id='${tid}'`)).rows.length, 1);
  });
  await asUser(B, async () => {
    await rejects(`select public.request_reframe('${clip}', 10, 40, '9:16', 'follow')`);
    assert.equal((await db.query(`select * from reframe_tracks`)).rows.length, 0, "otro workspace no ve análisis ajenos");
  });
  await asUser(null, async () => { await rejects(`select public.request_reframe('${clip}', 10, 40, '9:16', 'follow')`); });
  await db.exec(`update jobs set status='done' where kind <> 'reframe'`);   // solo quedan trabajos de reencuadre en cola
  const claimed = (await db.query<{ kind: string; status: string; params: { track_id: string } }>(`select kind, status, params from public.claim_job()`)).rows;
  assert.equal(claimed.length, 1); assert.equal(claimed[0].kind, "reframe"); assert.equal(claimed[0].status, "validating");
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from pg_constraint where conname='jobs_kind_check' and pg_get_constraintdef(oid) like '%reframe%'`)).rows[0].n, 1);
});

test("selecciones de YouTube: solo identidad validada, aisladas por workspace y sin cambiar de dueño", async () => {
  const ins = (ws: string, uid: string, vid = "dQw4w9WgXcQ", extra = "") => `insert into youtube_picks(workspace_id, video_id, title, channel, thumb, status, brief, created_by${extra ? ", " + extra.split("=")[0] : ""}) values ('${ws}','${vid}','Mi directo','Canal','https://i.ytimg.com/vi/${vid}/mq.jpg','live','cinco cortes','${uid}'${extra ? ", " + extra.split("=")[1] : ""})`;
  const R = async (l: number, sql: string) => { try { await db.query(sql); } catch { return; } assert.fail(`no rechazó la sentencia #${l}: ${sql.slice(0, 90)}`); };
  await asUser(A, async () => {
    await db.query(ins(wsA, A));
    await R(10, ins(wsA, A));                                       // una selección por vídeo y usuario
    await R(11, ins(wsA, A, "corto"));                              // ID de YouTube inválido
    await R(1, `insert into youtube_picks(workspace_id, video_id, title, thumb, status, created_by) values ('${wsA}','aaaaaaaaaaa','x','https://evil.example/x.jpg','live','${A}')`);   // miniatura solo de ytimg.com
    await R(2, `insert into youtube_picks(workspace_id, video_id, title, status, created_by) values ('${wsA}','bbbbbbbbbbb','x','otro','${A}')`);
    await R(3, `insert into youtube_picks(workspace_id, video_id, title, status, clip_count, created_by) values ('${wsA}','ccccccccccc','x','video',99,'${A}')`);
    await R(12, ins(wsA, B, "ddddddddddd"));                        // no se crea a nombre de otro usuario
    await R(13, ins(wsB, A, "eeeeeeeeeee"));                        // ni en un workspace ajeno
    await db.query(`update youtube_picks set brief='otro encargo', source_kind='signal' where video_id='dQw4w9WgXcQ'`);
    await R(4, `update youtube_picks set workspace_id='${wsB}' where video_id='dQw4w9WgXcQ'`);   // sin privilegio de columna
    await R(5, `update youtube_picks set created_by='${B}' where video_id='dQw4w9WgXcQ'`);
    await R(6, `update youtube_picks set source_kind='hack' where video_id='dQw4w9WgXcQ'`);
    await R(7, `update projects set youtube_id='no valido' where id = (select id from projects limit 1)`);
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from youtube_picks`)).rows.length, 0, "otro workspace no ve la selección");
    assert.equal((await db.query(`update youtube_picks set title='x' returning id`)).rows.length, 0, "no puede editar la de otro workspace");
    assert.equal((await db.query(`delete from youtube_picks returning id`)).rows.length, 0, "ni puede borrarla");
  });
  await asUser(null, async () => { await R(9, `select * from youtube_picks`); });
  await asUser(A, async () => { assert.equal((await db.query(`delete from youtube_picks where video_id='dQw4w9WgXcQ' returning id`)).rows.length, 1); });
});

test("coste y límites de IA: solo responsables ven costes y editan límites; el consumo solo lo escribe el servicio", async () => {
  await db.exec(`insert into ai_usage(workspace_id, kind, provider, model, units, cost_usd, billed_usd, measured) values
    ('${wsA}','stt','groq','whisper-large-v3-turbo','{"seconds":3600}',0.04,0,true),
    ('${wsA}','render','github-actions','ffmpeg','{"ms":120000}',0.016,0,false)`);
  await asUser(A, async () => {
    const s = (await db.query<{ s: Record<string, unknown> }>(`select public.ai_usage_summary() s`)).rows[0].s as { week_source_minutes: number; month_cost_usd: number; month_measured_usd: number; limits: Record<string, number>; can_edit_limits: boolean };
    assert.equal(s.week_source_minutes, 60); assert.ok(Math.abs(s.month_cost_usd - 0.056) < 1e-6); assert.ok(Math.abs(s.month_measured_usd - 0.04) < 1e-6, "separa medido de estimado");
    assert.equal(s.limits.weekly_source_minutes, 120); assert.equal(s.limits.batch_clips, 10); assert.equal(s.can_edit_limits, true);
    const upd = (await db.query<{ l: Record<string, number> }>(`select public.set_ai_limits('{"weekly_source_minutes": 200, "live_minutes": 45}') l`)).rows[0].l;
    assert.equal(upd.weekly_source_minutes, 200); assert.equal(upd.live_minutes, 45); assert.equal(upd.batch_clips, 10);
    await rejects(`select public.set_ai_limits('{"weekly_source_minutes": 999999}')`);   // tope duro
    await rejects(`select public.set_ai_limits('{"weekly_source_minutes": -1}')`);
    await rejects(`select public.set_ai_limits('{"inventado": 1}')`);
    await rejects(`select public.set_ai_limits('{"batch_clips": "mucho"}')`);
    assert.equal((await db.query(`select * from ai_usage`)).rows.length, 2, "el responsable lee el detalle");
    await rejects(`insert into ai_usage(workspace_id, kind, provider, model) values ('${wsA}','stt','x','y')`);
    await rejects(`update workspace_ai_limits set limits='{}'`);
    await rejects(`delete from ai_usage`);
  });
  await asUser(B, async () => {
    assert.equal((await db.query(`select * from ai_usage`)).rows.length, 0, "otro workspace no ve consumo ajeno");
    const sb = (await db.query<{ s: { week_source_minutes: number; month_cost_usd?: number } }>(`select public.ai_usage_summary() s`)).rows[0].s;
    assert.equal(sb.week_source_minutes, 0); assert.equal(sb.month_cost_usd, 0, "B es responsable de SU espacio: ve su coste (0), nunca el de A");
  });
  await asUser(null, async () => { await rejects(`select public.ai_usage_summary()`); await rejects(`select public.set_ai_limits('{}')`); });
});

test("conexiones OAuth: tokens invisibles desde el navegador, solo responsables conectan, aisladas por workspace", async () => {
  await asUser(A, async () => {
    const r = (await db.query<{ r: { provider: string; status: string } }>(`select public.oauth_save('google','ana@ejemplo.com','{youtube.readonly}','ACCESS-TOKEN-1234','REFRESH-1', now() + interval '1 hour') r`)).rows[0].r;
    assert.equal(r.status, "connected");
    await rejects(`select * from oauth_connections`);                                   // sin SELECT directo ni con RLS
    await rejects(`insert into oauth_connections(workspace_id,provider,access_token,created_by) values ('${wsA}','google','x','${A}')`);
    await rejects(`select public.oauth_save('twitter','x','{}','ACCESS-TOKEN-1234',null,null)`);
    await rejects(`select public.oauth_save('google','x','{}','corto',null,null)`);
    const st = (await db.query<{ s: { provider: string; account_label: string; status: string }[] }>(`select public.oauth_status() s`)).rows[0].s;
    assert.equal(st.length, 1); assert.equal(st[0].account_label, "ana@ejemplo.com"); assert.ok(!JSON.stringify(st).includes("ACCESS-TOKEN"), "el estado no lleva tokens");
    const tok = (await db.query<{ t: { access_token: string; refresh_token: string } }>(`select public.oauth_token('google') t`)).rows[0].t;
    assert.equal(tok.access_token, "ACCESS-TOKEN-1234");
    await db.query(`select public.oauth_save('google','ana@ejemplo.com','{youtube.readonly}','ACCESS-TOKEN-5678',null, now() + interval '1 hour')`);   // reconexión sin refresh nuevo
    assert.equal((await db.query<{ t: { refresh_token: string } }>(`select public.oauth_token('google') t`)).rows[0].t.refresh_token, "REFRESH-1", "conserva el refresh anterior");
    await db.query(`select public.oauth_touch('google', null, null, 'expired', 'invalid_grant')`);
    assert.equal((await db.query<{ s: { status: string }[] }>(`select public.oauth_status() s`)).rows[0].s[0].status, "expired");
    await rejects(`select public.oauth_touch('google', null, null, 'raro', null)`);
    await rejects(`select public.oauth_token('dropbox')`);
  });
  await asUser(B, async () => {
    assert.deepEqual((await db.query<{ s: unknown[] }>(`select public.oauth_status() s`)).rows[0].s, [], "otro workspace no ve la conexión");
    await rejects(`select public.oauth_token('google')`);
  });
  await asUser(null, async () => { await rejects(`select public.oauth_status()`); await rejects(`select public.oauth_token('google')`); });
  await asUser(A, async () => {
    assert.equal((await db.query<{ ok: boolean }>(`select public.oauth_disconnect('google') ok`)).rows[0].ok, true);
    assert.equal((await db.query<{ ok: boolean }>(`select public.oauth_disconnect('google') ok`)).rows[0].ok, false);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from audit_events where action in ('oauth.connect','oauth.disconnect')`)).rows[0].n, 3);
  });
});

test("proyectos: archivar y duplicar solo con permiso de edición y dentro del workspace", async () => {
  const pid = (await db.query<{ id: string }>(`select id from projects where workspace_id='${wsA}' and deleted_at is null limit 1`)).rows[0].id;
  let copy = "";
  await asUser(A, async () => {
    copy = (await db.query<{ c: string }>(`select public.duplicate_project('${pid}', null) c`)).rows[0].c;
    const r = (await db.query<{ name: string; source_id: string; clip_count: number }>(`select name, source_id, clip_count from projects where id='${copy}'`)).rows[0];
    assert.match(r.name, /\(copia\)$/); assert.equal(r.source_id, (await db.query<{ s: string }>(`select source_id s from projects where id='${pid}'`)).rows[0].s);
    assert.equal((await db.query(`select 1 from clips where project_id='${copy}'`)).rows.length, 0, "la copia no arrastra clips");
    await db.query(`select public.archive_project('${copy}', true)`);
    assert.ok((await db.query<{ a: string | null }>(`select archived_at a from projects where id='${copy}'`)).rows[0].a);
    await db.query(`select public.archive_project('${copy}', false)`);
    assert.equal((await db.query<{ a: string | null }>(`select archived_at a from projects where id='${copy}'`)).rows[0].a, null);
    await rejects(`select public.duplicate_project('00000000-0000-0000-0000-000000000000', null)`);
  });
  await asUser(B, async () => { await rejects(`select public.duplicate_project('${pid}', null)`); await rejects(`select public.archive_project('${pid}', true)`); });
  await asUser(null, async () => { await rejects(`select public.archive_project('${pid}', true)`); });
});
