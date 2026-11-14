-- Paso 17: importación (enlace/Drive/Dropbox) y publicación (YouTube/TikTok). Aditiva: dos columnas de idempotencia en
-- `imports` y `publications` (tablas de 034) y funciones nuevas.
--   cliente:  request_import, request_publication, cancel_publication
--   worker:   import_job, finish_import, publication_job, finish_publication, oauth_token_for, oauth_touch_for
-- Los tokens OAuth solo los lee el worker (service_role); el navegador nunca los ve. Impacto: ninguno sobre datos existentes.

alter table public.imports add column if not exists idempotency_key text;
alter table public.publications add column if not exists idempotency_key text;
create unique index if not exists imports_idem_uq on public.imports(workspace_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists publications_idem_uq on public.publications(workspace_id, idempotency_key) where idempotency_key is not null;

-- Crea fuente (kind 'url') + proyecto + importación y encola import → validate → mezzanine → proxy.
create or replace function public.request_import(p_kind text, p_ref text, p_name text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid; prev record; sid uuid := gen_random_uuid(); pid uuid; iid uuid := gen_random_uuid(); r jsonb; k text;
begin
  if p_kind not in ('link','drive','dropbox') or p_ref is null or char_length(p_ref) not between 1 and 2048 then raise exception 'invalid_import' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  ws := coalesce((select active_workspace_id from public.profiles where id = auth.uid()),
                 (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'owner' limit 1));
  if ws is null or not public.can_edit(ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.imports where workspace_id = ws and idempotency_key = p_idem;
  if found then return jsonb_build_object('import_id', prev.id, 'job_id', prev.job_id, 'source_id', prev.source_id, 'replay', true); end if;
  if public.storage_used(ws) >= 10737418240 then raise exception 'quota_exceeded' using errcode = 'P0001', detail = json_build_object('quota', 10737418240, 'used', public.storage_used(ws))::text; end if;
  k := ws || '/' || sid || '/original';
  insert into public.sources(id, workspace_id, kind, storage_path, status, storage_backend, parts, created_by)
    values (sid, ws, 'url', k, 'pending', 'r2', 0, auth.uid());
  insert into public.projects(workspace_id, source_id, name, created_by)
    values (ws, sid, left(coalesce(nullif(btrim(p_name), ''), 'Importado'), 120), auth.uid()) returning id into pid;
  insert into public.imports(id, workspace_id, kind, ref, state, source_id, created_by, idempotency_key) values (iid, ws, p_kind, p_ref, 'queued', sid, auth.uid(), p_idem);
  r := public.enqueue_job(ws, 'import', jsonb_build_array(
         jsonb_build_object('stage','import','seq',1,'units',0,'params', jsonb_build_object('import_id', iid, 'source_id', sid)),
         jsonb_build_object('stage','validate','seq',2,'units',0,'params', jsonb_build_object('source_id', sid)),
         jsonb_build_object('stage','mezzanine','seq',3,'units',0,'params', jsonb_build_object('source_id', sid)),
         jsonb_build_object('stage','proxy','seq',4,'units',0,'params', jsonb_build_object('source_id', sid))),
       'import:' || iid, jsonb_build_object('source_id', sid, 'import_id', iid), pid, null);
  update public.imports set job_id = (r->>'job_id')::uuid where id = iid;
  return jsonb_build_object('import_id', iid, 'job_id', r->>'job_id', 'source_id', sid, 'project_id', pid, 'replay', false);
end $$;

-- Publicación de una exportación MP4 lista. Con `scheduled_at` futuro queda en 'scheduled' (sin llamar a la plataforma
-- hasta que enqueue_due_publications() la encuentre vencida); si no, se encola ya.
create or replace function public.request_publication(p_render uuid, p_platform text, p_title text, p_description text, p_privacy text,
  p_scheduled_at timestamptz, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd record; prev record; pid uuid := gen_random_uuid(); priv text; r jsonb;
begin
  if p_platform not in ('youtube','tiktok') or p_title is null or char_length(btrim(p_title)) not between 1 and 100 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  select id, workspace_id, status, kind, storage_path into rd from public.renders where id = p_render;
  if not found or not public.can_edit(rd.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.publications where workspace_id = rd.workspace_id and idempotency_key = p_idem;
  if found then return jsonb_build_object('publication_id', prev.id, 'state', prev.state, 'job_id', prev.job_id, 'replay', true); end if;
  if rd.kind <> 'mp4' or rd.status <> 'ready' or rd.storage_path is null then raise exception 'render_not_ready' using errcode = 'P0001'; end if;
  priv := coalesce(p_privacy, case p_platform when 'youtube' then 'private' else 'SELF_ONLY' end);
  if (p_platform = 'youtube' and priv not in ('private','unlisted','public'))
     or (p_platform = 'tiktok' and priv not in ('SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','PUBLIC_TO_EVERYONE')) then raise exception 'invalid_privacy' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.oauth_connections where workspace_id = rd.workspace_id and status = 'connected'
                   and provider = case p_platform when 'youtube' then 'google' else 'tiktok' end) then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  insert into public.publications(id, workspace_id, render_id, platform, title, description, privacy, state, scheduled_at, created_by, idempotency_key)
    values (pid, rd.workspace_id, p_render, p_platform, btrim(p_title), left(p_description, 5000), priv,
            case when p_scheduled_at is not null and p_scheduled_at > now() then 'scheduled' else 'queued' end, p_scheduled_at, auth.uid(), p_idem);
  if p_scheduled_at is not null and p_scheduled_at > now() then
    return jsonb_build_object('publication_id', pid, 'state', 'scheduled', 'job_id', null, 'replay', false);
  end if;
  r := public.enqueue_job(rd.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
         'params', jsonb_build_object('publication_id', pid))), 'publish:' || pid, '{}', null, null);
  update public.publications set job_id = (r->>'job_id')::uuid where id = pid;
  return jsonb_build_object('publication_id', pid, 'state', 'queued', 'job_id', r->>'job_id', 'replay', false);
end $$;

create or replace function public.cancel_publication(p_publication uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select id, workspace_id, state into p from public.publications where id = p_publication;
  if not found or not public.can_edit(p.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.state not in ('scheduled','queued','failed','requiere_auditoria') then raise exception 'not_cancellable' using errcode = 'P0001'; end if;
  update public.publications set state = 'cancelled' where id = p_publication;
  return jsonb_build_object('publication_id', p_publication, 'state', 'cancelled');
end $$;

-- ───────── Worker ─────────
create or replace function public.import_job(p_import uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('import_id', i.id, 'workspace_id', i.workspace_id, 'kind', i.kind, 'ref', i.ref, 'source_id', i.source_id,
    'object_key', s.storage_path, 'project_id', (select p.id from public.projects p where p.source_id = s.id limit 1))
  from public.imports i join public.sources s on s.id = i.source_id where i.id = p_import $$;

create or replace function public.finish_import(p_import uuid, p_state text, p_bytes bigint, p_mime text, p_parts int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare i record; pid uuid;
begin
  if p_state not in ('downloading','done','failed') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  select * into i from public.imports where id = p_import; if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.imports set state = p_state, bytes = coalesce(p_bytes, bytes), error_code = left(p_error, 80) where id = p_import;
  if p_state = 'done' then
    update public.sources set status = 'uploaded', bytes = p_bytes, mime = coalesce(p_mime, mime), parts = coalesce(p_parts, 0) where id = i.source_id;
    select id into pid from public.projects where source_id = i.source_id limit 1;
    insert into public.storage_objects(workspace_id, key, bytes, kind, project_id, source_id)
      values (i.workspace_id, (select storage_path from public.sources where id = i.source_id), p_bytes, 'original', pid, i.source_id)
      on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
  elsif p_state = 'failed' then
    update public.sources set status = 'failed' where id = i.source_id;
  end if;
end $$;

create or replace function public.publication_job(p_publication uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('publication_id', p.id, 'workspace_id', p.workspace_id, 'platform', p.platform, 'title', p.title,
    'description', p.description, 'privacy', p.privacy, 'state', p.state, 'object_key', r.storage_path, 'bytes', r.bytes)
  from public.publications p join public.renders r on r.id = p.render_id where p.id = p_publication $$;

create or replace function public.finish_publication(p_publication uuid, p_state text, p_external text, p_code text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_state not in ('uploading','processing','private_pending_review','requiere_auditoria','published','failed') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  update public.publications set state = p_state, external_id = coalesce(p_external, external_id), error_code = left(p_code, 80), error_message = left(p_message, 500)
   where id = p_publication and state <> 'cancelled';
end $$;

create or replace function public.oauth_token_for(p_ws uuid, p_provider text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.oauth_connections;
begin
  select * into c from public.oauth_connections where workspace_id = p_ws and provider = p_provider;
  if c.id is null then raise exception 'not_connected' using errcode = 'P0001'; end if;
  return jsonb_build_object('access_token', c.access_token, 'refresh_token', c.refresh_token, 'expires_at', c.expires_at, 'scopes', c.scopes, 'status', c.status);
end $$;
create or replace function public.oauth_touch_for(p_ws uuid, p_provider text, p_access text, p_expires_at timestamptz, p_status text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('connected','expired','revoked','error') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  update public.oauth_connections set access_token = coalesce(p_access, access_token), expires_at = coalesce(p_expires_at, expires_at), status = p_status,
    last_error = left(p_error, 300), last_checked_at = now(), updated_at = now() where workspace_id = p_ws and provider = p_provider;
end $$;

revoke all on function public.request_import(text,text,text,text), public.request_publication(uuid,text,text,text,text,timestamptz,text), public.cancel_publication(uuid),
  public.import_job(uuid), public.finish_import(uuid,text,bigint,text,int,text), public.publication_job(uuid), public.finish_publication(uuid,text,text,text,text),
  public.oauth_token_for(uuid,text), public.oauth_touch_for(uuid,text,text,timestamptz,text,text) from public, anon;
grant execute on function public.request_import(text,text,text,text), public.request_publication(uuid,text,text,text,text,timestamptz,text), public.cancel_publication(uuid) to authenticated;
grant execute on function public.import_job(uuid), public.finish_import(uuid,text,bigint,text,int,text), public.publication_job(uuid), public.finish_publication(uuid,text,text,text,text),
  public.oauth_token_for(uuid,text), public.oauth_touch_for(uuid,text,text,timestamptz,text,text) to service_role;
