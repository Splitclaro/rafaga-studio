alter table public.sources add column if not exists sha256_prefix text check (sha256_prefix is null or sha256_prefix ~ '^[0-9a-f]{64}$');
create index if not exists sources_dup_idx on public.sources(workspace_id, bytes, sha256_prefix) where sha256_prefix is not null;
alter table public.projects add column if not exists purge_at timestamptz;

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade, source_id uuid not null, project_id uuid,
  strategy text not null check (strategy in ('multipart','parts')), r2_upload_id text,
  object_key text not null check (object_key like workspace_id::text || '/%'),
  part_size int not null check (part_size between 5242880 and 47185920), total_parts int not null check (total_parts between 1 and 400),
  bytes bigint not null check (bytes between 1 and 4294967296),
  sha256_prefix text, sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active','completed','aborted','expired')),
  idempotency_key text not null, job_id uuid, created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  unique (workspace_id, id), unique (workspace_id, idempotency_key),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id) on delete cascade);
create table if not exists public.storage_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null unique check (key like workspace_id::text || '/%'), bytes bigint not null check (bytes >= 0),
  kind text not null check (kind in ('original','original_part','mezzanine','proxy','audio','thumb','preview','export','zip','sidecar','stage_output')),
  project_id uuid, source_id uuid, render_id uuid, expires_at timestamptz, purged_at timestamptz,
  created_at timestamptz not null default now(), unique (workspace_id, id));
create index if not exists storage_objects_live_idx on public.storage_objects(workspace_id) where purged_at is null;
alter table public.upload_sessions enable row level security;
alter table public.storage_objects enable row level security;
drop policy if exists upload_sessions_select on public.upload_sessions;
drop policy if exists storage_objects_select on public.storage_objects;
create policy upload_sessions_select on public.upload_sessions for select to authenticated using (public.is_member(workspace_id));
create policy storage_objects_select on public.storage_objects for select to authenticated using (public.is_member(workspace_id));
revoke all on public.upload_sessions, public.storage_objects from anon, authenticated;
grant select on public.upload_sessions, public.storage_objects to authenticated;

create or replace function public.storage_used(p_ws uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(bytes), 0)::bigint from public.storage_objects where workspace_id = p_ws and purged_at is null $$;

-- Fuente + proyecto + sesión. Errores: file_too_large (>4 GiB), quota_exceeded (uso + tamaño entrante > 10 GiB).
-- p_ws null → espacio activo del usuario o, si no hay, el suyo propio.
create or replace function public.create_upload_session(p_ws uuid, p_name text, p_bytes bigint, p_mime text, p_sha256_prefix text,
  p_project uuid, p_force boolean, p_strategy text, p_part_size int, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; dup uuid; sid uuid := gen_random_uuid(); pid uuid; uid uuid := gen_random_uuid(); k text; parts int; used bigint;
begin
  p_ws := coalesce(p_ws, (select active_workspace_id from public.profiles where id = auth.uid()),
                   (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'owner' limit 1));
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.upload_sessions where workspace_id = p_ws and idempotency_key = p_idem;
  if found then return jsonb_build_object('upload_id', prev.id, 'source_id', prev.source_id, 'project_id', prev.project_id,
    'part_size', prev.part_size, 'parts', prev.total_parts, 'strategy', prev.strategy, 'replay', true); end if;
  if p_bytes > 4294967296 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":4294967296}'; end if;
  used := public.storage_used(p_ws);
  if used + p_bytes > 10737418240 then
    raise exception 'quota_exceeded' using errcode = 'P0001', detail = json_build_object('quota', 10737418240, 'used', used)::text;
  end if;
  if not coalesce(p_force, false) then
    select p.id into dup from public.sources s join public.projects p on p.source_id = s.id and p.deleted_at is null
     where s.workspace_id = p_ws and s.bytes = p_bytes and s.sha256_prefix = p_sha256_prefix and s.status not in ('deleted','failed') limit 1;
    if dup is not null then return jsonb_build_object('duplicate_of_project', dup); end if;
  end if;
  k := p_ws || '/' || sid || '/original';
  parts := ceil(p_bytes::numeric / p_part_size);
  insert into public.sources(id, workspace_id, kind, storage_path, status, mime, bytes, sha256_prefix, storage_backend, parts, created_by)
    values (sid, p_ws, 'upload', k, 'pending', p_mime, p_bytes, p_sha256_prefix, 'r2', case when p_strategy = 'parts' then parts else 0 end, auth.uid());
  if p_project is null then
    insert into public.projects(workspace_id, source_id, name, created_by)
      values (p_ws, sid, left(coalesce(nullif(btrim(p_name), ''), 'Proyecto'), 120), auth.uid()) returning id into pid;
  else
    update public.projects set source_id = sid where id = p_project and workspace_id = p_ws returning id into pid;
  end if;
  insert into public.upload_sessions(id, workspace_id, source_id, project_id, strategy, object_key, part_size, total_parts, bytes, sha256_prefix, idempotency_key)
    values (uid, p_ws, sid, pid, p_strategy, k, p_part_size, parts, p_bytes, p_sha256_prefix, p_idem);
  return jsonb_build_object('upload_id', uid, 'source_id', sid, 'project_id', pid, 'part_size', p_part_size, 'parts', parts,
    'strategy', p_strategy, 'replay', false);
end $$;

create or replace function public.upload_session(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u record;
begin
  select * into u from public.upload_sessions where id = p_upload;
  if not found or (auth.uid() is not null and not public.is_member(u.workspace_id)) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return to_jsonb(u) - 'idempotency_key';
end $$;
create or replace function public.set_upload_r2_id(p_upload uuid, p_r2_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.upload_sessions set r2_upload_id = p_r2_id where id = p_upload and created_by = auth.uid() and state = 'active' and r2_upload_id is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Completa: fuente uploaded, objeto registrado, trabajo ingest (validate → mezzanine → proxy). Repetible.
create or replace function public.complete_upload(p_upload uuid, p_sha256 text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u record; r jsonb; dup uuid;
begin
  select * into u from public.upload_sessions where id = p_upload for update;
  if not found or u.created_by <> auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if u.state = 'aborted' then raise exception 'upload_aborted' using errcode = 'P0001'; end if;
  if u.state = 'active' then
    update public.upload_sessions set state = 'completed', sha256 = p_sha256 where id = p_upload;
    update public.sources set status = 'uploaded', sha256 = p_sha256 where id = u.source_id;
    insert into public.storage_objects(workspace_id, key, bytes, kind, project_id, source_id)
      values (u.workspace_id, u.object_key, u.bytes, 'original', u.project_id, u.source_id) on conflict (key) do nothing;
  end if;
  r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
         jsonb_build_object('stage','validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
         jsonb_build_object('stage','mezzanine','seq',2,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
         jsonb_build_object('stage','proxy','seq',3,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
       'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  update public.upload_sessions set job_id = (r->>'job_id')::uuid where id = p_upload;
  select p.id into dup from public.sources s join public.projects p on p.source_id = s.id
   where s.workspace_id = u.workspace_id and s.sha256 = p_sha256 and s.id <> u.source_id and p.deleted_at is null limit 1;
  return jsonb_build_object('job_id', r->>'job_id', 'duplicate_of_project', dup);
end $$;
create or replace function public.abort_upload(p_upload uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.upload_sessions set state = 'aborted' where id = p_upload and created_by = auth.uid() and state = 'active';
  update public.sources set status = 'deleted' where id = (select source_id from public.upload_sessions where id = p_upload) and status = 'pending';
end $$;
create or replace function public.source_object(p_source uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id into s from public.sources where id = p_source;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_kind not in ('proxy','thumb') then raise exception 'bad_request' using errcode = 'P0001'; end if;
  return jsonb_build_object('key', s.workspace_id || '/' || s.id || case p_kind when 'proxy' then '/proxy.mp4' else '/thumb.jpg' end);
end $$;
create or replace function public.record_object(p_ws uuid, p_key text, p_bytes bigint, p_kind text, p_project uuid, p_source uuid,
  p_render uuid, p_expires_at timestamptz) returns void language sql security definer set search_path = public as $$
  insert into public.storage_objects(workspace_id, key, bytes, kind, project_id, source_id, render_id, expires_at)
  values (p_ws, p_key, p_bytes, p_kind, p_project, p_source, p_render, p_expires_at)
  on conflict (key) do update set bytes = excluded.bytes, expires_at = excluded.expires_at, purged_at = null $$;

-- Retención: originales con mezzanine registrada (respaldo si el borrado inmediato falló), exportaciones caducadas, papelera vencida.
create or replace function public.purge_candidates(p_limit int default 500) returns table(key text, bytes bigint, reason text)
language sql stable security definer set search_path = public as $$
  select o.key, o.bytes, 'original_replaced' from public.storage_objects o
   where o.purged_at is null and o.kind in ('original','original_part')
     and exists (select 1 from public.storage_objects m where m.source_id = o.source_id and m.kind = 'mezzanine' and m.purged_at is null)
  union all
  select o.key, o.bytes, 'expired' from public.storage_objects o
   where o.purged_at is null and o.kind in ('export','zip','sidecar') and o.expires_at < now()
  union all
  select o.key, o.bytes, 'trash' from public.storage_objects o join public.projects p on p.id = o.project_id
   where o.purged_at is null and p.purge_at is not null and p.purge_at < now()
  limit p_limit $$;
create or replace function public.mark_purged(p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.storage_objects set purged_at = now() where key = any(p_keys) and purged_at is null;
  get diagnostics n = row_count;
  update public.renders set storage_path = null where storage_path = any(p_keys);
  return n;
end $$;
create or replace function public.trash_project(p_project uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  update public.projects set deleted_at = now(), purge_at = now() + interval '30 days'
   where id = p_project and public.can_edit(workspace_id) and deleted_at is null returning purge_at into ts;
  if ts is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return ts;
end $$;
create or replace function public.restore_project(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.projects set deleted_at = null, purge_at = null
   where id = p_project and public.can_edit(workspace_id) and deleted_at is not null and purge_at > now();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
create or replace function public.storage_summary(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('used_bytes', public.storage_used(p_ws), 'quota_bytes', 10737418240,
    'units_balance', coalesce((select balance from public.credit_accounts where workspace_id = p_ws), 0),
    'compute', public.compute_meter(),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('key', e.key, 'kind', e.kind, 'bytes', e.bytes, 'expires_at', e.expires_at) order by e.expires_at)
       from (select * from public.storage_objects where workspace_id = p_ws and purged_at is null and expires_at is not null
             order by expires_at limit 20) e), '[]'));
end $$;
-- Hipótesis de producto sobre tablas existentes; solo proyectos con generaciones v2 (excluye demos e históricos);
-- reintentos y descargas repetidas cuentan una vez (renders.downloaded_at = primera descarga).
create or replace function public.product_metrics(p_ws uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return (with g as (select g.*, j.created_by as creator from public.generations g join public.jobs j on j.generation_id = g.id and j.engine = 'v2'
                      where g.workspace_id = p_ws and g.created_at between p_from and p_to),
               c as (select c.* from public.clips c where c.generation_id in (select id from g))
    select jsonb_build_object(
      'first_approved_s', (select extract(epoch from min(cv.created_at) - (select min(created_at) from g))
                            from public.clip_versions cv join c on c.id = cv.clip_id where c.editorial_state = 'aprobado'),
      'acceptance_rate', (select round(avg((editorial_state = 'aprobado')::int)::numeric, 3) from c),
      'active_correction_s', (select round(avg(extract(epoch from cv2.created_at - cv1.created_at))) from c
                               join public.clip_versions cv1 on cv1.clip_id = c.id and cv1.version = 1
                               join public.clip_versions cv2 on cv2.clip_id = c.id and cv2.version = c.current_version and c.current_version > 1),
      'second_variant_s', (select extract(epoch from (array_agg(created_at order by created_at))[2] - min(created_at)) from g),
      'approved_downloaded_per_creator', (select count(distinct r.clip_id)::numeric / greatest((select count(distinct creator) from g), 1)
         from public.renders r join c on c.id = r.clip_id and c.editorial_state = 'aprobado' where r.downloaded_at is not null)));
end $$;

revoke all on function public.storage_used(uuid), public.create_upload_session(uuid,text,bigint,text,text,uuid,boolean,text,int,text),
  public.upload_session(uuid), public.set_upload_r2_id(uuid,text), public.complete_upload(uuid,text), public.abort_upload(uuid),
  public.source_object(uuid,text), public.record_object(uuid,text,bigint,text,uuid,uuid,uuid,timestamptz), public.purge_candidates(int),
  public.mark_purged(text[]), public.trash_project(uuid), public.restore_project(uuid), public.storage_summary(uuid),
  public.product_metrics(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.create_upload_session(uuid,text,bigint,text,text,uuid,boolean,text,int,text), public.upload_session(uuid),
  public.set_upload_r2_id(uuid,text), public.complete_upload(uuid,text), public.abort_upload(uuid), public.source_object(uuid,text),
  public.trash_project(uuid), public.restore_project(uuid), public.storage_summary(uuid), public.product_metrics(uuid,timestamptz,timestamptz)
  to authenticated;
grant execute on function public.storage_used(uuid), public.record_object(uuid,text,bigint,text,uuid,uuid,uuid,timestamptz),
  public.purge_candidates(int), public.mark_purged(text[]), public.upload_session(uuid) to service_role;
