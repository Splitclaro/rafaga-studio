-- Paquetes de medios en R2 y «Crear desde vídeo» (paso 12). Aditiva.
create or replace function public.create_media_item(p_collection uuid, p_name text, p_kind text, p_mime text, p_bytes bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; iid uuid := gen_random_uuid(); used bigint; ext text;
begin
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_kind, '') not in ('video','photo') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"kind"}'; end if;
  ext := case p_mime when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' when 'image/jpeg' then 'jpg'
                     when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if ext is null then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 209715200 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":209715200}'; end if;
  used := public.storage_used(c.workspace_id);
  if used + p_bytes > 10737418240 then raise exception 'quota_exceeded' using errcode = 'P0001', detail = json_build_object('quota', 10737418240, 'used', used)::text; end if;
  insert into public.media_items(id, workspace_id, collection_id, kind, name, storage_path, mime, bytes, created_by, storage_backend, status)
    values (iid, c.workspace_id, p_collection, p_kind, left(coalesce(nullif(btrim(p_name), ''), 'Elemento'), 120),
            c.workspace_id || '/media/' || iid || '.' || ext, p_mime, p_bytes, auth.uid(), 'r2', 'pending');
  return jsonb_build_object('item_id', iid, 'key', c.workspace_id || '/media/' || iid || '.' || ext);
end $$;
create or replace function public.complete_media_item(p_item uuid, p_duration_ms bigint, p_width int, p_height int) returns text
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  select * into i from public.media_items where id = p_item for update;
  if not found or not public.can_edit(i.workspace_id) or i.storage_backend <> 'r2' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.media_items set status = 'ready', duration_ms = p_duration_ms, width = p_width, height = p_height where id = p_item;
  insert into public.storage_objects(workspace_id, key, bytes, kind) values (i.workspace_id, i.storage_path, i.bytes, 'media')
    on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
  return 'ready';
end $$;
create or replace function public.media_item_object(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i record;
begin
  select id, workspace_id, storage_path, storage_backend, status, kind into i from public.media_items where id = p_item;
  if not found or not public.is_member(i.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', i.storage_path, 'backend', i.storage_backend, 'status', i.status, 'kind', i.kind);
end $$;

-- p_params = {start_ms, end_ms, length_s ∈ 3|5|10|15|30, min_s, max_s}. Propone segmentos (sin cortar nada).
create or replace function public.request_media_split(p_source uuid, p_collection uuid, p_params jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; c record; r jsonb; a bigint; b bigint;
begin
  select id, workspace_id, status, duration_ms, width into s from public.sources where id = p_source;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or c.workspace_id <> s.workspace_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.status <> 'validated' then raise exception 'source_not_ready' using errcode = 'P0001'; end if;
  if s.width is null then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if coalesce((p_params->>'length_s')::int, 0) not in (3,5,10,15,30) then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"length_s"}'; end if;
  a := coalesce((p_params->>'start_ms')::bigint, 0); b := coalesce((p_params->>'end_ms')::bigint, s.duration_ms);
  if a < 0 or b <= a or b > s.duration_ms then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"end_ms"}'; end if;
  r := public.enqueue_job(s.workspace_id, 'ingest', jsonb_build_array(jsonb_build_object('stage','media_split','seq',1,'units',0,
         'params', p_params || jsonb_build_object('mode','propose','source_id', p_source, 'collection_id', p_collection, 'start_ms', a, 'end_ms', b))),
       p_idem, jsonb_build_object('source_id', p_source), null, null);
  return jsonb_build_object('job_id', r->>'job_id', 'replay', coalesce((r->>'replay')::boolean, false));
end $$;
-- p_segments = [{start_ms, end_ms}] (1–60), los revisados; p_cut_mode: 'rapido' (copia de flujo) | 'exacto' (recodifica).
create or replace function public.request_media_cut(p_source uuid, p_collection uuid, p_segments jsonb, p_cut_mode text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; c record; g jsonb; r jsonb;
begin
  select id, workspace_id, status, duration_ms into s from public.sources where id = p_source;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or c.workspace_id <> s.workspace_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_cut_mode, '') not in ('rapido','exacto') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"cut_mode"}'; end if;
  if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) not between 1 and 60 then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"segments"}'; end if;
  for g in select * from jsonb_array_elements(p_segments) loop
    if (g->>'start_ms')::bigint < 0 or (g->>'end_ms')::bigint <= (g->>'start_ms')::bigint or (g->>'end_ms')::bigint > s.duration_ms then
      raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"segments"}'; end if;
  end loop;
  r := public.enqueue_job(s.workspace_id, 'ingest', jsonb_build_array(jsonb_build_object('stage','media_split','seq',1,'units',0,
         'params', jsonb_build_object('mode','cut','source_id', p_source, 'collection_id', p_collection, 'segments', p_segments, 'cut_mode', p_cut_mode))),
       p_idem, jsonb_build_object('source_id', p_source), null, null);
  return jsonb_build_object('job_id', r->>'job_id', 'replay', coalesce((r->>'replay')::boolean, false));
end $$;
create or replace function public.media_split_context(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('source_id', s.id, 'workspace_id', s.workspace_id, 'key', s.storage_path, 'duration_ms', s.duration_ms, 'created_by', s.created_by)
  from public.sources s where s.id = p_source $$;
create or replace function public.add_split_item(p_collection uuid, p_source uuid, p_item uuid, p_start_ms bigint, p_end_ms bigint, p_cut_mode text,
  p_key text, p_bytes bigint, p_duration_ms bigint, p_width int, p_height int, p_created_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_key not like c.workspace_id::text || '/media/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  insert into public.media_items(id, workspace_id, collection_id, kind, name, storage_path, mime, bytes, created_by, storage_backend, status,
                                 duration_ms, width, height, source_id, segment_start_ms, segment_end_ms, cut_mode, audio_muted)
    values (p_item, c.workspace_id, p_collection, 'video', 'Segmento ' || round(p_start_ms / 1000.0, 1) || ' s', p_key, 'video/mp4', p_bytes, p_created_by,
            'r2', 'ready', p_duration_ms, p_width, p_height, p_source, p_start_ms, p_end_ms, p_cut_mode, true) on conflict (id) do nothing;
  insert into public.storage_objects(workspace_id, key, bytes, kind, source_id) values (c.workspace_id, p_key, p_bytes, 'media', p_source)
    on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
end $$;

revoke all on function public.create_media_item(uuid,text,text,text,bigint), public.complete_media_item(uuid,bigint,int,int), public.media_item_object(uuid),
  public.request_media_split(uuid,uuid,jsonb,text), public.request_media_cut(uuid,uuid,jsonb,text,text), public.media_split_context(uuid),
  public.add_split_item(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,int,int,uuid) from public, anon, authenticated;
grant execute on function public.create_media_item(uuid,text,text,text,bigint), public.complete_media_item(uuid,bigint,int,int), public.media_item_object(uuid),
  public.request_media_split(uuid,uuid,jsonb,text), public.request_media_cut(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function public.media_split_context(uuid), public.add_split_item(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,int,int,uuid),
  public.media_item_object(uuid) to service_role;
