-- Editor de vídeo avanzado (Ráfaga v3): proyectos multipista creados desde cero o desde Autoclip.
-- Tabla nueva justificada: ninguna existente guarda una línea de tiempo con varias pistas. `projects` exige un vídeo fuente (source_id not null)
-- y `clip_versions` describe un solo clip de un proyecto; un proyecto del editor puede empezar vacío y mezclar varios orígenes.
-- El documento (`doc`) lo valida la aplicación (apps/web/lib/timeline.ts); la base limita tamaño y tipo. Concurrencia optimista por `version`.
-- Aditiva: tabla y funciones nuevas; no toca datos existentes.
create table if not exists public.editor_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  aspect text not null default '9:16' check (aspect in ('9:16','16:9','4:5','1:1')),
  doc jsonb not null default '{}' check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 262144),
  origin jsonb check (origin is null or (jsonb_typeof(origin) = 'object' and pg_column_size(origin) < 4096)),
  version int not null default 1 check (version >= 1),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (workspace_id, id));
create index if not exists editor_projects_ws_updated on public.editor_projects (workspace_id, updated_at desc) where deleted_at is null;
alter table public.editor_projects enable row level security;
drop policy if exists editor_projects_select on public.editor_projects;
create policy editor_projects_select on public.editor_projects for select to authenticated using (public.is_member(workspace_id) and deleted_at is null);
revoke all on public.editor_projects from anon, authenticated;
grant select on public.editor_projects to authenticated;

create or replace function public.create_editor_project(p_name text, p_aspect text, p_doc jsonb default '{}'::jsonb, p_origin jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); pid uuid;
begin
  if ws is null or not public.can_edit(ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_aspect is null or p_aspect not in ('9:16','16:9','4:5','1:1') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"aspect"}'; end if;
  if jsonb_typeof(coalesce(p_doc, '{}'::jsonb)) <> 'object' then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"doc"}'; end if;
  insert into public.editor_projects(workspace_id, name, aspect, doc, origin, created_by)
    values (ws, left(coalesce(nullif(btrim(p_name), ''), 'Proyecto sin título'), 120), p_aspect, coalesce(p_doc, '{}'::jsonb), p_origin, auth.uid()) returning id into pid;
  return pid;
end $$;

-- Guarda con la versión de partida: si otra pestaña guardó antes, devuelve conflicto sin pisar nada.
create or replace function public.save_editor_project(p_id uuid, p_base_version int, p_doc jsonb default null, p_name text default null, p_aspect text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ep record; nv int; ts timestamptz;
begin
  select * into ep from public.editor_projects where id = p_id and deleted_at is null;
  if not found or not public.can_edit(ep.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_aspect is not null and p_aspect not in ('9:16','16:9','4:5','1:1') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"aspect"}'; end if;
  if p_doc is not null and jsonb_typeof(p_doc) <> 'object' then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"doc"}'; end if;
  if p_base_version is distinct from ep.version then return jsonb_build_object('conflict', true, 'current_version', ep.version); end if;
  update public.editor_projects set doc = coalesce(p_doc, doc), name = coalesce(left(nullif(btrim(p_name), ''), 120), name), aspect = coalesce(p_aspect, aspect),
    version = version + 1, updated_at = now() where id = p_id returning version, updated_at into nv, ts;
  return jsonb_build_object('version', nv, 'updated_at', ts);
end $$;

create or replace function public.delete_editor_project(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ep record;
begin
  select * into ep from public.editor_projects where id = p_id and deleted_at is null;
  if not found or not public.can_edit(ep.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.editor_projects set deleted_at = now() where id = p_id;
end $$;

revoke all on function public.create_editor_project(text, text, jsonb, jsonb), public.save_editor_project(uuid, int, jsonb, text, text), public.delete_editor_project(uuid) from public, anon;
grant execute on function public.create_editor_project(text, text, jsonb, jsonb), public.save_editor_project(uuid, int, jsonb, text, text), public.delete_editor_project(uuid) to authenticated;
