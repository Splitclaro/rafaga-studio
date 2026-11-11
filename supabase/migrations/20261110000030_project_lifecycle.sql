-- Biblioteca por proyectos: archivar/desarchivar y duplicar (misma fuente y encargo; sin clips: se detectan de nuevo).
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists description text check (description is null or char_length(description) <= 500);
create or replace function public.archive_project(p_project uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.projects where id = p_project and deleted_at is null;
  if ws is null or not public.can_edit(ws) then raise exception 'not_found'; end if;
  update public.projects set archived_at = case when p_archived then coalesce(archived_at, now()) else null end where id = p_project;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), case when p_archived then 'project.archive' else 'project.unarchive' end, jsonb_build_object('project', p_project));
end $$;
create or replace function public.duplicate_project(p_project uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.projects; nid uuid;
begin
  select * into src from public.projects where id = p_project and deleted_at is null;
  if src.id is null or not public.can_edit(src.workspace_id) then raise exception 'not_found'; end if;
  insert into public.projects(workspace_id, source_id, name, project_brief, brief_data, language, clip_count, target_seconds, max_seconds, mode, created_by, brand_kit_id, brand_kit_version, youtube_id, description)
  values (src.workspace_id, src.source_id, left(coalesce(nullif(trim(p_name), ''), src.name || ' (copia)'), 120), src.project_brief, src.brief_data, src.language, src.clip_count, src.target_seconds, src.max_seconds, src.mode, auth.uid(), src.brand_kit_id, src.brand_kit_version, src.youtube_id, src.description)
  returning id into nid;
  insert into public.audit_events(workspace_id, actor, action, detail) values (src.workspace_id, auth.uid(), 'project.duplicate', jsonb_build_object('from', p_project, 'to', nid));
  return nid;
end $$;
revoke all on function public.archive_project(uuid, boolean), public.duplicate_project(uuid, text) from public, anon;
grant execute on function public.archive_project(uuid, boolean), public.duplicate_project(uuid, text) to authenticated;
grant update (archived_at, description) on public.projects to authenticated;
