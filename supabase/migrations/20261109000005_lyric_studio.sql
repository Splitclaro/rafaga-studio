-- Lyric Studio: canciones, alineaciones cacheadas y vídeos de letra por variante. No destructiva.
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('ingest','transcribe','detect','render','live','automation','lyrics'));

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  artist text check (artist is null or char_length(artist) <= 200),
  language text not null default 'auto' check (language in ('auto','es','en')),
  storage_path text not null,
  mime text not null check (mime in ('audio/mpeg','audio/wav','audio/x-wav','audio/wave')),
  bytes bigint not null check (bytes > 0),
  lyrics_text text check (lyrics_text is null or char_length(lyrics_text) <= 20000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (storage_path like workspace_id::text || '/songs/%')
);
create table if not exists public.song_alignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  song_id uuid not null,
  lyrics_sha256 text not null,
  words jsonb not null,           -- [{text,start,end,line,confidence,origin}] tiempos absolutos de la canción
  asr_words int not null default 0,
  created_at timestamptz not null default now(),
  unique (song_id, lyrics_sha256),
  foreign key (workspace_id, song_id) references public.songs(workspace_id, id) on delete cascade
);
create table if not exists public.lyric_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  song_id uuid not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  variant int not null check (variant >= 1),
  params jsonb not null,
  storage_path text,
  status text not null default 'rendering' check (status in ('rendering','ready','failed')),
  probe jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, variant),
  foreign key (workspace_id, song_id) references public.songs(workspace_id, id) on delete cascade
);
alter table public.songs enable row level security;
alter table public.song_alignments enable row level security;
alter table public.lyric_videos enable row level security;
create policy songs_select on public.songs for select using (public.is_member(workspace_id));
create policy songs_insert on public.songs for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy songs_update on public.songs for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy songs_delete on public.songs for delete using (public.is_member(workspace_id));
create policy song_alignments_select on public.song_alignments for select using (public.is_member(workspace_id));
create policy lyric_videos_select on public.lyric_videos for select using (public.is_member(workspace_id));
revoke update on public.songs from anon, authenticated;
grant update (title, artist, language, lyrics_text) on public.songs to authenticated;
revoke insert, update, delete on public.song_alignments, public.lyric_videos from anon, authenticated;

create or replace function public.request_lyrics(p_song uuid, p_params jsonb, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; n int;
begin
  if p_key is null or char_length(p_key) < 8 then raise exception 'invalid_key'; end if;
  select workspace_id into ws from public.songs where id = p_song;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  n := (p_params->>'n')::int;
  if n is null or n < 1 or n > 200 then raise exception 'invalid_n'; end if;   -- límite efectivo por petición (capacidad del worker gratuito)
  if (p_params->>'ratio') not in ('9:16','1:1','16:9') then raise exception 'invalid_ratio'; end if;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params)
    values (ws, 'lyrics', 'lyrics:' || p_song || ':' || p_key, auth.uid(), p_params || jsonb_build_object('song_id', p_song))
    on conflict (workspace_id, idempotency_key) do update set updated_at = now()
    returning id into jid;
  return jid;
end $$;
revoke all on function public.request_lyrics(uuid, jsonb, text) from public, anon;
grant execute on function public.request_lyrics(uuid, jsonb, text) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now()
  where j.id = (
    select id from public.jobs
    where kind in ('detect','render','lyrics') and attempts < 3
      and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'))
    order by (kind = 'render') desc, created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
