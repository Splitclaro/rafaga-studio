create or replace function public.request_lyrics(p_song uuid, p_params jsonb, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; n int;
begin
  if p_key is null or char_length(p_key) < 8 then raise exception 'invalid_key'; end if;
  select workspace_id into ws from public.songs where id = p_song;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  n := (p_params->>'n')::int;
  if n is null or n < 1 or n > 200 then raise exception 'invalid_n'; end if;
  if (p_params->>'ratio') not in ('9:16','4:5','1:1','16:9') then raise exception 'invalid_ratio'; end if;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params)
    values (ws, 'lyrics', 'lyrics:' || p_song || ':' || p_key, auth.uid(), p_params || jsonb_build_object('song_id', p_song))
    on conflict (workspace_id, idempotency_key) do update set updated_at = now()
    returning id into jid;
  return jid;
end $$;
