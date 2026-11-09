-- Miniaturas, modos de proyecto y estilos de texto propios (Style Studio). No destructiva.
alter table public.sources add column if not exists thumb_path text check (thumb_path is null or thumb_path like workspace_id::text || '/%');
alter table public.projects add column if not exists mode text not null default 'clips' check (mode in ('clips','captions','reframe','social','broll'));

create table if not exists public.text_styles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  style jsonb not null check (pg_column_size(style) < 4096),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table public.text_styles enable row level security;
create policy text_styles_select on public.text_styles for select using (public.is_member(workspace_id));
create policy text_styles_insert on public.text_styles for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy text_styles_update on public.text_styles for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy text_styles_delete on public.text_styles for delete using (public.is_member(workspace_id));
revoke update on public.text_styles from anon, authenticated;
grant update (name, style) on public.text_styles to authenticated;
grant select, insert, delete on public.text_styles to authenticated;
