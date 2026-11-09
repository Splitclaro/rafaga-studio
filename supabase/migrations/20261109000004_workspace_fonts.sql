-- Fuentes propias por workspace (privadas en brand-assets/<ws>/fonts/...). No destructiva.
create table if not exists public.workspace_fonts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  family text not null check (char_length(family) between 1 and 80),
  storage_path text not null,
  bytes int not null check (bytes > 0 and bytes <= 5242880),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, family),
  check (storage_path like workspace_id::text || '/fonts/%')
);
alter table public.workspace_fonts enable row level security;
create policy workspace_fonts_select on public.workspace_fonts for select using (public.is_member(workspace_id));
create policy workspace_fonts_insert on public.workspace_fonts for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy workspace_fonts_delete on public.workspace_fonts for delete using (public.is_member(workspace_id));
revoke update on public.workspace_fonts from anon, authenticated;
