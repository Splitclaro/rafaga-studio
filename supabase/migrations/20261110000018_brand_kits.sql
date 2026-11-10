-- H03: brand kits operativos y versionados (logo, colores, estilo de subtítulos, intro/outro, perfil de export)
-- aplicables a proyectos con historial y reversión. Un cambio en el kit crea una versión nueva inmutable;
-- los proyectos guardan la versión aplicada, así nada cambia en silencio en exports ya hechos.

alter table public.brand_kits add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.brand_kits add column if not exists version int not null default 1;
alter table public.brand_kits add column if not exists updated_at timestamptz not null default now();
alter table public.brand_kits add column if not exists created_by uuid references auth.users(id);
alter table public.brand_kits add column if not exists archived_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_kits_ws_id_key') then
    alter table public.brand_kits add constraint brand_kits_ws_id_key unique (workspace_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_kits_name_len') then
    alter table public.brand_kits add constraint brand_kits_name_len check (char_length(name) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_kits_logo_path') then
    alter table public.brand_kits add constraint brand_kits_logo_path check (logo_path is null or logo_path like workspace_id::text || '/brand/%');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_kits_config_size') then
    alter table public.brand_kits add constraint brand_kits_config_size check (pg_column_size(config) < 16384 and pg_column_size(colors) < 4096);
  end if;
end $$;

create table if not exists public.brand_kit_versions (
  kit_id uuid not null,
  workspace_id uuid not null,
  version int not null,
  snapshot jsonb not null,           -- {name, logo_path, colors, subtitle_style, config}
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (kit_id, version),
  foreign key (workspace_id, kit_id) references public.brand_kits(workspace_id, id) on delete cascade
);
alter table public.brand_kit_versions enable row level security;
drop policy if exists bkv_read on public.brand_kit_versions;
create policy bkv_read on public.brand_kit_versions for select to authenticated using (public.is_member(workspace_id));
revoke insert, update, delete on public.brand_kit_versions from anon, authenticated;
grant select on public.brand_kit_versions to authenticated;

-- Versión automática: cualquier cambio de contenido incrementa la versión y guarda una instantánea inmutable
create or replace function public.brand_kit_version_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.name, new.logo_path, new.colors, new.subtitle_style, new.config) is not distinct from (old.name, old.logo_path, old.colors, old.subtitle_style, old.config) then
      return new;
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := 1;
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  return new;
end $$;
create or replace function public.brand_kit_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.brand_kit_versions(kit_id, workspace_id, version, snapshot, created_by)
  values (new.id, new.workspace_id, new.version,
          jsonb_build_object('name', new.name, 'logo_path', new.logo_path, 'colors', new.colors, 'subtitle_style', new.subtitle_style, 'config', new.config),
          auth.uid())
  on conflict (kit_id, version) do nothing;
  return null;
end $$;
drop trigger if exists brand_kit_version_bump on public.brand_kits;
create trigger brand_kit_version_bump before insert or update on public.brand_kits for each row execute function public.brand_kit_version_bump();
drop trigger if exists brand_kit_snapshot on public.brand_kits;
create trigger brand_kit_snapshot after insert or update on public.brand_kits for each row execute function public.brand_kit_snapshot();
-- instantánea de los kits ya existentes
insert into public.brand_kit_versions(kit_id, workspace_id, version, snapshot)
select id, workspace_id, version, jsonb_build_object('name', name, 'logo_path', logo_path, 'colors', colors, 'subtitle_style', subtitle_style, 'config', config)
from public.brand_kits on conflict do nothing;

revoke update on public.brand_kits from authenticated;
grant update (name, logo_path, colors, subtitle_style, config, archived_at) on public.brand_kits to authenticated;

-- Proyecto ← kit aplicado (versión fijada)
alter table public.projects add column if not exists brand_kit_id uuid;
alter table public.projects add column if not exists brand_kit_version int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_brand_kit_fk') then
    alter table public.projects add constraint projects_brand_kit_fk foreign key (workspace_id, brand_kit_id)
      references public.brand_kits(workspace_id, id) on delete set null (brand_kit_id);
  end if;
end $$;

create table if not exists public.brand_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  kit_id uuid, kit_version int,
  prev_kit_id uuid, prev_kit_version int,
  style_changes jsonb not null default '[]',   -- [{clip_id, from, to}] versiones de clip creadas al aplicar el estilo
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);
alter table public.brand_applications enable row level security;
drop policy if exists brand_app_read on public.brand_applications;
create policy brand_app_read on public.brand_applications for select to authenticated using (public.is_member(workspace_id));
revoke insert, update, delete on public.brand_applications from anon, authenticated;
grant select on public.brand_applications to authenticated;

-- Aplica (o quita, con p_kit null) un kit a un proyecto. p_style_changes registra las versiones de clip creadas por el cliente.
create or replace function public.apply_brand_kit(p_project uuid, p_kit uuid, p_style_changes jsonb default '[]') returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.projects; kv int; app uuid; c jsonb;
begin
  select * into pr from public.projects where id = p_project;
  if pr.id is null or not public.can_edit(pr.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_kit is not null then
    select version into kv from public.brand_kits where id = p_kit and workspace_id = pr.workspace_id and archived_at is null;
    if kv is null then raise exception 'Kit no disponible' using errcode = '22023'; end if;
  end if;
  if jsonb_typeof(coalesce(p_style_changes, '[]')) <> 'array' or jsonb_array_length(coalesce(p_style_changes, '[]')) > 500 then raise exception 'Cambios no válidos' using errcode = '22023'; end if;
  for c in select value from jsonb_array_elements(coalesce(p_style_changes, '[]')) loop
    if not exists (select 1 from public.clips where id = (c->>'clip_id')::uuid and project_id = p_project and current_version = (c->>'to')::int)
       or not exists (select 1 from public.clip_versions where clip_id = (c->>'clip_id')::uuid and version = (c->>'from')::int) then
      raise exception 'Cambio de estilo inconsistente' using errcode = '22023';
    end if;
  end loop;
  insert into public.brand_applications(workspace_id, project_id, kit_id, kit_version, prev_kit_id, prev_kit_version, style_changes, created_by)
  values (pr.workspace_id, p_project, p_kit, kv, pr.brand_kit_id, pr.brand_kit_version, coalesce(p_style_changes, '[]'), auth.uid()) returning id into app;
  update public.projects set brand_kit_id = p_kit, brand_kit_version = kv where id = p_project;
  insert into public.audit_events(workspace_id, actor, action, detail) values (pr.workspace_id, auth.uid(), 'brand.apply', jsonb_build_object('project', p_project, 'kit', p_kit, 'version', kv));
  return app;
end $$;

-- Revierte una aplicación: vuelve al kit anterior y a la versión previa de cada clip que no se haya editado después.
create or replace function public.revert_brand_application(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a public.brand_applications; c jsonb; n int := 0;
begin
  select * into a from public.brand_applications where id = p_id for update;
  if a.id is null or not public.can_edit(a.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if a.reverted_at is not null then raise exception 'Ya se revirtió' using errcode = '22023'; end if;
  update public.projects set brand_kit_id = a.prev_kit_id, brand_kit_version = a.prev_kit_version where id = a.project_id;
  for c in select value from jsonb_array_elements(a.style_changes) loop
    update public.clips set current_version = (c->>'from')::int where id = (c->>'clip_id')::uuid and current_version = (c->>'to')::int;
    if found then n := n + 1; end if;
  end loop;
  update public.brand_applications set reverted_at = now() where id = p_id;
  insert into public.audit_events(workspace_id, actor, action, detail) values (a.workspace_id, auth.uid(), 'brand.revert', jsonb_build_object('project', a.project_id, 'clips', n));
  return n;
end $$;
revoke all on function public.apply_brand_kit(uuid, uuid, jsonb), public.revert_brand_application(uuid) from public, anon;
grant execute on function public.apply_brand_kit(uuid, uuid, jsonb), public.revert_brand_application(uuid) to authenticated;

-- Los exports dependen de la versión de marca aplicada: nunca se reutiliza un MP4 hecho con otra marca (o sin ella),
-- y la clave del trabajo incluye la versión del kit.
create or replace function public.request_render(p_clip uuid, p_version int, p_ratio text, p_burn boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; rid uuid; st text; k text; bref text;
begin
  if p_ratio not in ('9:16','4:5','1:1','16:9') then raise exception 'invalid_ratio'; end if;
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  if not public.can_edit(ws) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.clip_versions where clip_id = p_clip and version = p_version) then raise exception 'version_not_found'; end if;
  select case when p.brand_kit_id is null then null else p.brand_kit_id::text || '@' || p.brand_kit_version end into bref
    from public.clips c join public.projects p on p.id = c.project_id where c.id = p_clip;
  select id into rid from public.renders
    where clip_id = p_clip and clip_version = p_version and ratio = p_ratio and burn_subtitles = p_burn and status = 'ready'
      and (probe->>'brand') is not distinct from bref limit 1;
  if rid is not null then return jsonb_build_object('render_id', rid, 'reused', true); end if;
  k := 'render:' || p_clip || ':' || p_version || ':' || p_ratio || ':' || p_burn || coalesce(':' || bref, '');
  select id, status into jid, st from public.jobs where workspace_id = ws and idempotency_key = k;
  if jid is null then
    insert into public.jobs(workspace_id, kind, idempotency_key, clip_id, created_by, params)
      values (ws, 'render', k, p_clip, auth.uid(), jsonb_build_object('version', p_version, 'ratio', p_ratio, 'burn', p_burn))
      returning id into jid;
  elsif st in ('failed','cancelled') then
    update public.jobs set status = 'queued', attempts = 0, error_code = null, error_message = null, updated_at = now() where id = jid;
  end if;
  return jsonb_build_object('job_id', jid, 'reused', false);
end $$;
