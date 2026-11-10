-- Selecciones de YouTube: identidad y metadatos de un vídeo o directo elegido en el buscador, con el encargo (brief) y la cantidad.
-- Conserva la selección aunque todavía no haya fuente: YouTube no entrega el original; hay que vincular un archivo o una señal autorizada.
create table if not exists public.youtube_picks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) <= 300),
  channel text check (char_length(channel) <= 200),
  thumb text check (thumb is null or thumb ~ '^https://[a-z0-9.-]*ytimg\.com/'),
  status text not null check (status in ('video','live','upcoming')),
  duration_sec int check (duration_sec is null or duration_sec >= 0),
  scheduled_at timestamptz,
  brief text check (brief is null or char_length(brief) <= 2000),
  clip_count int not null default 5 check (clip_count between 1 and 20),
  project_id uuid,                                        -- se rellena al vincular una fuente autorizada
  source_kind text check (source_kind in ('original','signal')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, video_id, created_by),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete set null (project_id)
);
alter table public.youtube_picks enable row level security;
drop policy if exists yt_picks_read on public.youtube_picks;
create policy yt_picks_read on public.youtube_picks for select to authenticated using (public.is_member(workspace_id));
drop policy if exists yt_picks_write on public.youtube_picks;
create policy yt_picks_write on public.youtube_picks for insert to authenticated with check (public.can_edit(workspace_id) and created_by = auth.uid());
drop policy if exists yt_picks_update on public.youtube_picks;
create policy yt_picks_update on public.youtube_picks for update to authenticated using (public.can_edit(workspace_id) and created_by = auth.uid()) with check (public.can_edit(workspace_id) and created_by = auth.uid());
drop policy if exists yt_picks_delete on public.youtube_picks;
create policy yt_picks_delete on public.youtube_picks for delete to authenticated using (public.can_edit(workspace_id) and created_by = auth.uid());
revoke all on public.youtube_picks from anon, authenticated;
grant select, insert, delete on public.youtube_picks to authenticated;
grant update (title, channel, thumb, status, duration_sec, scheduled_at, brief, clip_count, project_id, source_kind, updated_at) on public.youtube_picks to authenticated;

-- El proyecto recuerda de qué vídeo de YouTube viene (solo identidad; el contenido procesado es el original vinculado)
alter table public.projects add column if not exists youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$');
