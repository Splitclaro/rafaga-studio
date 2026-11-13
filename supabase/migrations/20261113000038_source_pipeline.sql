-- Paso 9: el worker deja la fuente validada con sus metadatos y la ruta de la mezzanine (solo servicio).
-- Aditiva: una función nueva; ninguna columna ni tabla nueva.
create or replace function public.set_source_ready(p_source uuid, p_status text, p_duration_ms bigint, p_width int, p_height int,
  p_has_audio boolean, p_storage_path text, p_thumb_path text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id into s from public.sources where id = p_source for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status not in ('uploaded','validated','failed') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  if p_storage_path is not null and p_storage_path not like s.workspace_id::text || '/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  update public.sources set status = p_status,
         duration_ms = coalesce(p_duration_ms, duration_ms), width = coalesce(p_width, width), height = coalesce(p_height, height),
         has_audio = coalesce(p_has_audio, has_audio), storage_path = coalesce(p_storage_path, storage_path),
         thumb_path = coalesce(p_thumb_path, thumb_path), parts = case when p_storage_path is not null then 0 else parts end
   where id = p_source;
end $$;
revoke all on function public.set_source_ready(uuid,text,bigint,int,int,boolean,text,text) from public, anon, authenticated;
grant execute on function public.set_source_ready(uuid,text,bigint,int,int,boolean,text,text) to service_role;

-- Datos de la fuente para las etapas (solo servicio): clave del original, tamaño y número de partes.
create or replace function public.source_info(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'workspace_id', s.workspace_id, 'storage_path', s.storage_path, 'bytes', s.bytes,
    'parts', s.parts, 'mime', s.mime, 'status', s.status, 'duration_ms', s.duration_ms, 'has_audio', s.has_audio)
  from public.sources s where s.id = p_source $$;
revoke all on function public.source_info(uuid) from public, anon, authenticated;
grant execute on function public.source_info(uuid) to service_role;

-- Guarda la transcripción de un análisis (las palabras van a transcripts.words; la salida de la etapa solo lleva el recuento).
create or replace function public.save_transcript(p_analysis uuid, p_words jsonb, p_language text, p_model text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if jsonb_typeof(p_words) <> 'array' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  select id, transcript_id into a from public.analyses where id = p_analysis for update;
  if not found or a.transcript_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.transcripts set words = p_words, language = left(p_language, 8), asr_provider = 'groq', asr_model = left(p_model, 80) where id = a.transcript_id;
  update public.analyses set language = case when p_language ~ '^[a-z]{2}$' then p_language else language end where id = p_analysis;
  return a.transcript_id;
end $$;
revoke all on function public.save_transcript(uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.save_transcript(uuid,jsonb,text,text) to service_role;
