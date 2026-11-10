-- Looks de videolyric: ajustes persistentes por canción y sincronización manual por pulsación.
alter table public.songs add column if not exists studio_settings jsonb not null default '{}'::jsonb;
grant update (studio_settings) on public.songs to authenticated;

-- Guarda una sincronización manual (tiempos absolutos de la canción) para la letra actual.
-- Clave = 'manual:' || sha256(letra normalizada), la misma que calcula el worker; reutilizable en todos los estilos y variantes.
create or replace function public.save_manual_alignment(p_song uuid, p_words jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare ws uuid; lyr text; k text; n int; prev numeric := -1; w jsonb; s numeric; e numeric;
begin
  select workspace_id, lyrics_text into ws, lyr from public.songs where id = p_song;
  if ws is null or not public.is_member(ws) then raise exception 'Canción no encontrada' using errcode = '42501'; end if;
  if lyr is null or btrim(lyr) = '' then raise exception 'Guarda primero la letra de la canción' using errcode = '22023'; end if;
  if jsonb_typeof(p_words) <> 'array' then raise exception 'Formato no válido' using errcode = '22023'; end if;
  n := jsonb_array_length(p_words);
  if n = 0 or n > 4000 then raise exception 'Número de palabras no válido' using errcode = '22023'; end if;
  for w in select value from jsonb_array_elements(p_words) loop
    s := (w->>'start')::numeric; e := (w->>'end')::numeric;
    if s is null or e is null or s < 0 or e <= s or s < prev or coalesce(length(w->>'text'), 0) = 0 or length(w->>'text') > 80 then
      raise exception 'Tiempos no válidos: cada palabra necesita inicio ≥ 0, fin > inicio y orden creciente' using errcode = '22023';
    end if;
    prev := s;
  end loop;
  k := 'manual:' || encode(sha256(convert_to(regexp_replace(btrim(lyr), '\s+', ' ', 'g'), 'UTF8')), 'hex');
  insert into public.song_alignments (workspace_id, song_id, lyrics_sha256, words, asr_words)
  values (ws, p_song, k, (select jsonb_agg(jsonb_build_object('text', x->>'text', 'start', round((x->>'start')::numeric, 3), 'end', round((x->>'end')::numeric, 3),
            'line', coalesce((x->>'line')::int, 0), 'confidence', 1, 'origin', 'manual')) from jsonb_array_elements(p_words) x), 0)
  on conflict (song_id, lyrics_sha256) do update set words = excluded.words, created_at = now();
  return k;
end $$;
revoke all on function public.save_manual_alignment(uuid, jsonb) from public, anon;
grant execute on function public.save_manual_alignment(uuid, jsonb) to authenticated;

-- Lotes de videolyrics: admite 4:3 (formato original del look «Archivo analógico»), resolución 720/1080 y overrides acotados.
create or replace function public.request_lyrics(p_song uuid, p_params jsonb, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; n int;
begin
  if p_key is null or char_length(p_key) < 8 then raise exception 'invalid_key'; end if;
  select workspace_id into ws from public.songs where id = p_song;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  n := (p_params->>'n')::int;
  if n is null or n < 1 or n > 200 then raise exception 'invalid_n'; end if;
  if (p_params->>'ratio') not in ('9:16','4:5','1:1','16:9','4:3') then raise exception 'invalid_ratio'; end if;
  if coalesce(p_params->>'res', '1080') not in ('1080','720') then raise exception 'invalid_res'; end if;
  if pg_column_size(p_params) > 32768 then raise exception 'params_too_large'; end if;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params)
    values (ws, 'lyrics', 'lyrics:' || p_song || ':' || p_key, auth.uid(), p_params || jsonb_build_object('song_id', p_song))
    on conflict (workspace_id, idempotency_key) do update set updated_at = now()
    returning id into jid;
  return jid;
end $$;
