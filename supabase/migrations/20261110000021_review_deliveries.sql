-- Revisión, comentarios y entregas. Estados separados: generado (render listo) ≠ aprobado (revisión de una VERSIÓN concreta) ≠ entregado.
-- La aprobación queda ligada a la versión del clip: si el clip cambia de versión, deja de contar como aprobada (se muestra «necesita nueva revisión»).

alter table public.clips add column if not exists review_status text not null default 'pending';
alter table public.clips add column if not exists approved_version int;
alter table public.clips add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.clips add column if not exists reviewed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clips_review_status_chk') then
    alter table public.clips add constraint clips_review_status_chk check (review_status in ('pending','changes_requested','approved'));
  end if;
end $$;
-- Solo se escribe mediante set_review (el UPDATE de tabla ya está revocado y no se concede en estas columnas).

create or replace function public.can_review(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(ws) and coalesce(public.my_role() in ('owner','admin','editor','reviewer','member'), false);
$$;
grant execute on function public.can_review(uuid) to authenticated;

create table if not exists public.clip_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  clip_id uuid not null,
  version int not null,
  at_sec numeric check (at_sec is null or (at_sec >= 0 and at_sec < 86400)),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  kind text not null default 'comment' check (kind in ('comment','approval','changes')),
  author uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade
);
create index if not exists clip_comments_clip_idx on public.clip_comments(clip_id, created_at);
alter table public.clip_comments enable row level security;
drop policy if exists clip_comments_read on public.clip_comments;
create policy clip_comments_read on public.clip_comments for select to authenticated using (public.is_member(workspace_id));
revoke all on public.clip_comments from anon, authenticated;
grant select on public.clip_comments to authenticated;

create or replace function public.add_clip_comment(p_clip uuid, p_version int, p_at numeric, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.clips; cid uuid;
begin
  select * into c from public.clips where id = p_clip;
  if c.id is null or not public.can_review(c.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not exists (select 1 from public.clip_versions where clip_id = p_clip and version = p_version) then raise exception 'Versión inexistente' using errcode = '22023'; end if;
  insert into public.clip_comments(workspace_id, clip_id, version, at_sec, body, author) values (c.workspace_id, p_clip, p_version, p_at, btrim(p_body), auth.uid()) returning clip_comments.id into cid;
  return cid;
end $$;

create or replace function public.resolve_clip_comment(p_id uuid, p_resolved boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.clip_comments where id = p_id;
  if ws is null or not public.can_review(ws) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.clip_comments set resolved_at = case when p_resolved then now() else null end where id = p_id;
end $$;

-- Revisión de una versión concreta. Si el clip ya va por otra versión, se rechaza: nunca se aprueba un vídeo que el revisor no vio.
create or replace function public.set_review(p_clip uuid, p_status text, p_version int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.clips;
begin
  select * into c from public.clips where id = p_clip for update;
  if c.id is null or not public.can_review(c.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_status not in ('pending','changes_requested','approved') then raise exception 'Estado no válido' using errcode = '22023'; end if;
  if p_version is distinct from c.current_version then raise exception 'El clip cambió a la versión %: revisa la versión actual antes de decidir', c.current_version using errcode = '22023'; end if;
  update public.clips set review_status = p_status, approved_version = case when p_status = 'approved' then p_version else null end,
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_clip;
  if p_note is not null and btrim(p_note) <> '' or p_status <> 'pending' then
    insert into public.clip_comments(workspace_id, clip_id, version, body, kind, author)
    values (c.workspace_id, p_clip, p_version, coalesce(nullif(btrim(p_note), ''), case p_status when 'approved' then 'Versión aprobada' when 'changes_requested' then 'Cambios solicitados' else 'Revisión reabierta' end),
            case p_status when 'approved' then 'approval' when 'changes_requested' then 'changes' else 'comment' end, auth.uid());
  end if;
  insert into public.audit_events(workspace_id, actor, action, detail) values (c.workspace_id, auth.uid(), 'review.' || p_status, jsonb_build_object('clip', p_clip, 'version', p_version));
end $$;

-- Entregas: selección explícita de piezas con su versión fijada.
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  cover_clip_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade
);
create table if not exists public.delivery_items (
  delivery_id uuid not null,
  workspace_id uuid not null,
  clip_id uuid not null,
  version int not null,
  position int not null default 0,
  primary key (delivery_id, clip_id),
  foreign key (workspace_id, delivery_id) references public.deliveries(workspace_id, id) on delete cascade,
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade,
  foreign key (clip_id, version) references public.clip_versions(clip_id, version)
);
alter table public.deliveries enable row level security;
alter table public.delivery_items enable row level security;
drop policy if exists deliveries_read on public.deliveries; drop policy if exists delivery_items_read on public.delivery_items;
create policy deliveries_read on public.deliveries for select to authenticated using (public.is_member(workspace_id));
create policy delivery_items_read on public.delivery_items for select to authenticated using (public.is_member(workspace_id));
revoke all on public.deliveries, public.delivery_items from anon, authenticated;
grant select on public.deliveries, public.delivery_items to authenticated;

create or replace function public.create_delivery(p_project uuid, p_name text, p_description text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.projects; d uuid; it jsonb; pos int := 0;
begin
  select * into pr from public.projects where id = p_project;
  if pr.id is null or not public.can_edit(pr.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'Elige entre 1 y 500 piezas' using errcode = '22023'; end if;
  insert into public.deliveries(workspace_id, project_id, name, description, created_by) values (pr.workspace_id, p_project, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), auth.uid()) returning id into d;
  for it in select value from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.clips where id = (it->>'clip_id')::uuid and project_id = p_project and workspace_id = pr.workspace_id) then raise exception 'Una pieza no pertenece al proyecto' using errcode = '22023'; end if;
    insert into public.delivery_items(delivery_id, workspace_id, clip_id, version, position) values (d, pr.workspace_id, (it->>'clip_id')::uuid, (it->>'version')::int, pos);
    pos := pos + 1;
  end loop;
  update public.deliveries set cover_clip_id = (p_items->0->>'clip_id')::uuid where id = d;
  insert into public.audit_events(workspace_id, actor, action, detail) values (pr.workspace_id, auth.uid(), 'delivery.create', jsonb_build_object('delivery', d, 'items', pos));
  return d;
end $$;
create or replace function public.delete_delivery(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.deliveries where id = p_id;
  if ws is null or not public.can_edit(ws) then raise exception 'No autorizado' using errcode = '42501'; end if;
  delete from public.deliveries where id = p_id;   -- no borra clips ni renders: solo la entrega
end $$;
revoke all on function public.add_clip_comment(uuid, int, numeric, text), public.resolve_clip_comment(uuid, boolean), public.set_review(uuid, text, int, text), public.create_delivery(uuid, text, text, jsonb), public.delete_delivery(uuid) from public, anon;
grant execute on function public.add_clip_comment(uuid, int, numeric, text), public.resolve_clip_comment(uuid, boolean), public.set_review(uuid, text, int, text), public.create_delivery(uuid, text, text, jsonb), public.delete_delivery(uuid) to authenticated;
