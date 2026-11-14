-- Sincronización v2 (paso 5). Aditiva. Revisiones en song_alignments: clave 'v2:r<n>'; ASR en caché: clave 'asr:<modelo>'.
-- Unidades: 1 por minuto de canción solo si hay que llamar al ASR; con ASR en caché, 0.
create or replace function public.request_lyric_sync(p_song uuid, p_mode text, p_hints jsonb, p_model text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; cached boolean; units numeric(10,2); r jsonb;
begin
  select * into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.source_id is null then raise exception 'legacy_song' using errcode = 'P0001'; end if;
  if s.status <> 'ready' then raise exception 'song_not_ready' using errcode = 'P0001'; end if;
  if coalesce(p_mode, '') not in ('align','transcribe') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  if p_mode = 'align' and coalesce(btrim(s.lyrics_text), '') = '' then raise exception 'lyrics_required' using errcode = 'P0001'; end if;
  if p_hints is not null and (jsonb_typeof(p_hints) <> 'array' or pg_column_size(p_hints) > 6000) then raise exception 'hints_too_large' using errcode = 'P0001'; end if;
  cached := exists (select 1 from public.song_alignments where song_id = p_song and kind = 'asr' and lyrics_sha256 = 'asr:' || p_model);
  units := case when cached then 0 else greatest(0.01, round(s.duration_ms / 60000.0, 2)) end;
  r := public.enqueue_job(s.workspace_id, 'lyrics', jsonb_build_array(jsonb_build_object('stage','lyric_sync','seq',1,'units', units,
         'params', jsonb_build_object('song_id', p_song, 'mode', p_mode, 'model', p_model, 'hints', coalesce(p_hints, '[]'::jsonb)))),
       p_idem, jsonb_build_object('song_id', p_song, 'source_minutes', round(s.duration_ms / 60000.0, 2)), null, null,
       md5(p_song::text || '|' || p_mode || '|' || p_model || '|' || coalesce(p_hints::text, '')));
  return jsonb_build_object('job_id', r->>'job_id', 'units_reserved', (r->>'units_reserved')::numeric, 'cached', cached,
    'replay', coalesce((r->>'replay')::boolean, false));
end $$;

create or replace function public.lyric_sync_context(p_song uuid, p_model text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('song_id', s.id, 'workspace_id', s.workspace_id, 'source_id', s.source_id, 'key', s.storage_path,
    'audio_key', s.workspace_id || '/' || s.source_id || '/audio.opus', 'lyrics_text', s.lyrics_text, 'language', s.language,
    'duration_ms', s.duration_ms,
    'asr', (select a.words from public.song_alignments a where a.song_id = s.id and a.kind = 'asr' and a.lyrics_sha256 = 'asr:' || p_model),
    'latest', (select jsonb_build_object('revision', a.revision, 'kind', a.kind, 'words', a.words) from public.song_alignments a
               where a.song_id = s.id and a.revision is not null order by a.revision desc limit 1))
  from public.songs s where s.id = p_song $$;

create or replace function public.save_song_asr(p_song uuid, p_model text, p_words jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, kind)
  select s.workspace_id, s.id, 'asr:' || p_model, p_words, jsonb_array_length(p_words), 'asr' from public.songs s where s.id = p_song
  on conflict (song_id, lyrics_sha256) do nothing $$;

-- Nueva revisión. Usuario: solo kind 'manual' y base obligatoria. Worker (sin auth.uid): 'aligned' o 'proposal', sin base.
create or replace function public.save_song_alignment(p_song uuid, p_base_revision int, p_words jsonb, p_kind text, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; cur int; w jsonb; prev numeric := -1; st numeric; en numeric; n int;
begin
  select id, workspace_id, lyrics_text into s from public.songs where id = p_song;
  if not found or (auth.uid() is not null and not public.can_edit(s.workspace_id)) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_kind, '') not in ('aligned','proposal','manual') or (auth.uid() is not null and p_kind <> 'manual') then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"kind"}'; end if;
  if jsonb_typeof(p_words) is distinct from 'array' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  n := jsonb_array_length(p_words);
  if n = 0 or n > 4000 then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  for w in select value from jsonb_array_elements(p_words) loop
    if jsonb_typeof(w->'start') <> 'number' or jsonb_typeof(w->'end') <> 'number' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
    st := (w->>'start')::numeric; en := (w->>'end')::numeric;
    if st < 0 or en <= st or st < prev or coalesce(char_length(w->>'text'), 0) not between 1 and 80 then raise exception 'invalid_words' using errcode = 'P0001'; end if;
    prev := st;
  end loop;
  perform pg_advisory_xact_lock(hashtext('align:' || p_song));
  select coalesce(max(revision), 0) into cur from public.song_alignments where song_id = p_song and revision is not null;
  if auth.uid() is not null and p_base_revision is distinct from cur then return jsonb_build_object('conflict', true, 'current_revision', cur); end if;
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, revision, kind, lyrics_text, flags, created_by)
    values (s.workspace_id, p_song, 'v2:r' || (cur + 1), p_words, 0, cur + 1, p_kind,
            case when p_kind = 'proposal' then null else s.lyrics_text end, coalesce(p_flags, '[]'::jsonb), auth.uid());
  return jsonb_build_object('revision', cur + 1);
end $$;

create or replace function public.restore_original_alignment(p_song uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; o record; cur int;
begin
  select id, workspace_id, lyrics_text into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select words, flags into o from public.song_alignments where song_id = p_song and kind = 'aligned' and revision is not null order by revision asc limit 1;
  if not found then raise exception 'no_original' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('align:' || p_song));
  select coalesce(max(revision), 0) into cur from public.song_alignments where song_id = p_song and revision is not null;
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, revision, kind, lyrics_text, flags, created_by)
    values (s.workspace_id, p_song, 'v2:r' || (cur + 1), o.words, 0, cur + 1, 'aligned', s.lyrics_text, o.flags, auth.uid());
  return jsonb_build_object('revision', cur + 1);
end $$;

create or replace function public.song_alignment(p_song uuid, p_revision int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; a record;
begin
  select id, workspace_id into s from public.songs where id = p_song;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select revision, kind, words, flags, created_at into a from public.song_alignments
   where song_id = p_song and revision is not null and (p_revision is null or revision = p_revision) order by revision desc limit 1;
  if not found then return jsonb_build_object('revision', null, 'words', '[]'::jsonb); end if;
  return jsonb_build_object('revision', a.revision, 'kind', a.kind, 'words', a.words, 'flags', a.flags, 'created_at', a.created_at);
end $$;

create or replace function public.set_song_lyrics(p_song uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_text, '')) > 20000 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"lyrics_text"}'; end if;
  update public.songs set lyrics_text = nullif(p_text, '') where id = p_song and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.request_lyric_sync(uuid,text,jsonb,text,text), public.lyric_sync_context(uuid,text), public.save_song_asr(uuid,text,jsonb),
  public.save_song_alignment(uuid,int,jsonb,text,jsonb), public.restore_original_alignment(uuid), public.song_alignment(uuid,int),
  public.set_song_lyrics(uuid,text) from public, anon, authenticated;
grant execute on function public.request_lyric_sync(uuid,text,jsonb,text,text), public.save_song_alignment(uuid,int,jsonb,text,jsonb),
  public.restore_original_alignment(uuid), public.song_alignment(uuid,int), public.set_song_lyrics(uuid,text) to authenticated;
grant execute on function public.lyric_sync_context(uuid,text), public.save_song_asr(uuid,text,jsonb), public.save_song_alignment(uuid,int,jsonb,text,jsonb) to service_role;
