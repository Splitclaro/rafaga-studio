-- Canciones v2 con el cargador compartido (paso 2). Aditiva; recrea complete_upload (037) copiando su cuerpo y
-- añadiendo solo la rama de audio. Mismo contrato y mismos errores.
create or replace function public.register_song(p_upload uuid, p_title text, p_artist text, p_lyrics text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u record; sid uuid; m text;
begin
  select * into u from public.upload_sessions where id = p_upload;
  if not found or u.created_by <> auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id into sid from public.songs where source_id = u.source_id;
  if found then return jsonb_build_object('song_id', sid, 'project_id', u.project_id, 'replay', true); end if;
  select mime into m from public.sources where id = u.source_id;
  if m is null or m not in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/mp4','audio/x-m4a','audio/aac',
                            'audio/flac','audio/x-flac','audio/ogg') then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if u.bytes > 62914560 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":62914560}'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"title"}'; end if;
  insert into public.songs(workspace_id, title, artist, storage_path, mime, bytes, lyrics_text, created_by, source_id, status)
    values (u.workspace_id, btrim(p_title), nullif(btrim(coalesce(p_artist, '')), ''), u.object_key, m, u.bytes, nullif(p_lyrics, ''), auth.uid(), u.source_id, 'pending')
    returning id into sid;
  update public.projects set mode = 'lyrics', name = left(btrim(p_title), 120) where id = u.project_id;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (u.project_id, u.workspace_id, sid, 'letra') on conflict (project_id) do nothing;
  return jsonb_build_object('song_id', sid, 'project_id', u.project_id, 'replay', false);
end $$;

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
  if coalesce((select mime from public.sources where id = u.source_id), '') like 'audio/%' then   -- canción: una sola etapa
    r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
           jsonb_build_object('stage','song_validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
         'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  else
    r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
           jsonb_build_object('stage','validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
           jsonb_build_object('stage','mezzanine','seq',2,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
           jsonb_build_object('stage','proxy','seq',3,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
         'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  end if;
  update public.upload_sessions set job_id = (r->>'job_id')::uuid where id = p_upload;
  select p.id into dup from public.sources s join public.projects p on p.source_id = s.id
   where s.workspace_id = u.workspace_id and s.sha256 = p_sha256 and s.id <> u.source_id and p.deleted_at is null limit 1;
  return jsonb_build_object('job_id', r->>'job_id', 'duplicate_of_project', dup);
end $$;

create or replace function public.song_by_source(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('song_id', s.id, 'workspace_id', s.workspace_id, 'source_id', s.source_id, 'key', s.storage_path,
    'mime', s.mime, 'bytes', s.bytes, 'demo', s.demo, 'title', s.title,
    'project_id', (select p.id from public.projects p where p.source_id = s.source_id limit 1))
  from public.songs s where s.source_id = p_source $$;

create or replace function public.finish_song_validate(p_song uuid, p_status text, p_bytes bigint, p_duration_ms bigint, p_sample_rate int,
  p_channels int, p_lufs numeric, p_codec text, p_lyrics text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, source_id, lyrics_text into s from public.songs where id = p_song for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status not in ('ready','failed') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  update public.songs set status = p_status, bytes = coalesce(p_bytes, bytes), duration_ms = coalesce(p_duration_ms, duration_ms),
         sample_rate = coalesce(p_sample_rate, sample_rate), channels = coalesce(p_channels, channels), loudness_lufs = coalesce(p_lufs, loudness_lufs),
         codec = coalesce(p_codec, codec), error_code = p_error, lyrics_text = coalesce(s.lyrics_text, p_lyrics) where id = p_song;
  update public.sources set status = case when p_status = 'ready' then 'validated' else 'failed' end,
         duration_ms = coalesce(p_duration_ms, duration_ms), has_audio = (p_status = 'ready'), bytes = coalesce(p_bytes, bytes) where id = s.source_id;
end $$;

create or replace function public.song_object(p_song uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id, storage_path, status, source_id, duration_ms into s from public.songs where id = p_song;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', s.storage_path, 'status', s.status, 'backend', case when s.source_id is null then 'supabase' else 'r2' end,
    'duration_ms', s.duration_ms);
end $$;

-- Demo: copia al abrir. Cada llamada crea su propia canción, fuente y pieza; el ejemplo compartido es la constante DEMO_SONG.
create or replace function public.open_lyric_demo(p_ws uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := gen_random_uuid(); song uuid; pid uuid; r jsonb; prev record; k text;
begin
  p_ws := coalesce(p_ws, (select active_workspace_id from public.profiles where id = auth.uid()),
                   (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'owner' limit 1));
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 120 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  select id, params into prev from public.jobs where workspace_id = p_ws and idempotency_key = 'demo:' || p_idem;
  if found then return jsonb_build_object('job_id', prev.id, 'song_id', prev.params->>'song_id', 'project_id', prev.params->>'project_id', 'replay', true); end if;
  k := p_ws || '/' || sid || '/original';
  insert into public.sources(id, workspace_id, kind, storage_path, status, mime, storage_backend, created_by)
    values (sid, p_ws, 'upload', k, 'uploaded', 'audio/mp4', 'r2', auth.uid());
  insert into public.songs(workspace_id, title, artist, storage_path, mime, bytes, created_by, source_id, status, demo)
    values (p_ws, 'Canción de demostración', 'Ráfaga', k, 'audio/mp4', 1, auth.uid(), sid, 'pending', true) returning id into song;
  insert into public.projects(workspace_id, source_id, name, mode, created_by) values (p_ws, sid, 'Demo · Canción de demostración', 'lyrics', auth.uid()) returning id into pid;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (pid, p_ws, song, 'letra');
  r := public.enqueue_job(p_ws, 'ingest', jsonb_build_array(jsonb_build_object('stage','song_validate','seq',1,'units',0,
         'params', jsonb_build_object('source_id', sid, 'demo', true))), 'demo:' || p_idem,
       jsonb_build_object('source_id', sid, 'song_id', song, 'project_id', pid), pid, null);
  return jsonb_build_object('job_id', r->>'job_id', 'song_id', song, 'project_id', pid, 'replay', false);
end $$;

revoke all on function public.register_song(uuid,text,text,text), public.song_by_source(uuid),
  public.finish_song_validate(uuid,text,bigint,bigint,int,int,numeric,text,text,text), public.song_object(uuid), public.open_lyric_demo(uuid,text)
  from public, anon, authenticated;
grant execute on function public.register_song(uuid,text,text,text), public.song_object(uuid), public.open_lyric_demo(uuid,text) to authenticated;
grant execute on function public.song_by_source(uuid), public.finish_song_validate(uuid,text,bigint,bigint,int,int,numeric,text,text,text) to service_role;
grant execute on function public.complete_upload(uuid,text) to authenticated;
