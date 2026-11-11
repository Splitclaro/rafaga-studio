-- Carpetas de proyectos (diseño maestro: «Nueva carpeta»). Un proyecto está en una carpeta o en la raíz.
create table if not exists public.project_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
alter table public.project_folders enable row level security;
drop policy if exists pf_select on public.project_folders;
drop policy if exists pf_insert on public.project_folders;
drop policy if exists pf_update on public.project_folders;
drop policy if exists pf_delete on public.project_folders;
create policy pf_select on public.project_folders for select to authenticated using (public.is_member(workspace_id));
create policy pf_insert on public.project_folders for insert to authenticated with check (public.can_edit(workspace_id) and created_by = auth.uid());
create policy pf_update on public.project_folders for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy pf_delete on public.project_folders for delete to authenticated using (public.can_edit(workspace_id));
grant select, insert, update, delete on public.project_folders to authenticated;
-- Al borrar una carpeta, sus proyectos vuelven a la raíz.
alter table public.projects add column if not exists folder_id uuid references public.project_folders(id) on delete set null;
grant update (folder_id) on public.projects to authenticated;
create index if not exists projects_folder_idx on public.projects(folder_id) where folder_id is not null;
