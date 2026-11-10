-- H02: varios espacios por usuario (clientes, marcas, sellos), invitaciones, roles y auditoría.
-- Diseño: cada usuario tiene un ESPACIO ACTIVO en el servidor. is_member(ws) significa «ws es mi espacio activo y soy miembro»,
-- de modo que todas las políticas RLS, Storage y RPC existentes quedan acotadas al espacio activo sin reescribirlas
-- y nunca se mezclan datos de dos clientes en una misma lista. Los roles limitan la escritura con políticas RESTRICTIVAS.

-- 1) Espacios adicionales (el personal sigue siendo único por usuario)
alter table public.workspaces add column if not exists personal boolean not null default false;
update public.workspaces set personal = true where not personal;
drop index if exists public.workspaces_one_per_creator;
create unique index if not exists workspaces_one_personal on public.workspaces(created_by) where personal;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.profiles(id, display_name) values (new.id, split_part(coalesce(new.email,''),'@',1))
    on conflict (id) do nothing;
  insert into public.workspaces(name, created_by, personal) values ('Mi espacio', new.id, true)
    on conflict (created_by) where personal do nothing returning id into ws;
  if ws is not null then
    insert into public.workspace_members(workspace_id, user_id, role) values (ws, new.id, 'owner') on conflict do nothing;
  end if;
  return new;
end $$;

-- 2) Roles
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner','admin','editor','reviewer','viewer','member'));

-- 3) Espacio activo
alter table public.profiles add column if not exists active_workspace_id uuid references public.workspaces(id) on delete set null;

create or replace function public.current_workspace() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.active_workspace_id from public.profiles p
       join public.workspace_members m on m.workspace_id = p.active_workspace_id and m.user_id = p.id
      where p.id = auth.uid()),
    (select m.workspace_id from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
      where m.user_id = auth.uid() order by (w.personal and w.created_by = auth.uid()) desc, m.created_at limit 1));
$$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select ws is not null and ws = public.current_workspace();
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.workspace_members m where m.workspace_id = public.current_workspace() and m.user_id = auth.uid();
$$;
create or replace function public.can_edit(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(ws) and coalesce(public.my_role() in ('owner','admin','editor','member'), false);
$$;
create or replace function public.can_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(ws) and coalesce(public.my_role() in ('owner','admin'), false);
$$;
grant execute on function public.current_workspace(), public.my_role(), public.can_edit(uuid), public.can_admin(uuid) to authenticated;

-- 4) Escritura solo para roles con edición: política restrictiva en todas las tablas con workspace_id
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relrowsecurity
    where c.table_schema = 'public' and c.column_name = 'workspace_id'
      and c.table_name not in ('workspace_members','workspace_invites','audit_events')
  loop
    execute format('drop policy if exists role_write_ins on public.%I', t.table_name);
    execute format('drop policy if exists role_write_upd on public.%I', t.table_name);
    execute format('drop policy if exists role_write_del on public.%I', t.table_name);
    execute format('create policy role_write_ins on public.%I as restrictive for insert to authenticated with check (public.can_edit(workspace_id))', t.table_name);
    execute format('create policy role_write_upd on public.%I as restrictive for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t.table_name);
    execute format('create policy role_write_del on public.%I as restrictive for delete to authenticated using (public.can_edit(workspace_id))', t.table_name);
  end loop;
end $$;
drop policy if exists ws_admin_update on public.workspaces;
create policy ws_admin_update on public.workspaces as restrictive for update to authenticated using (public.can_admin(id)) with check (public.can_admin(id));

-- 5) Auditoría de acciones de equipo
create table if not exists public.audit_events (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
drop policy if exists audit_read on public.audit_events;
create policy audit_read on public.audit_events for select to authenticated using (public.can_admin(workspace_id));
revoke insert, update, delete on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

-- 6) Invitaciones (enlace de un solo uso, ligado al email, caduca en 7 días). Solo se guarda el hash del token.
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  role text not null check (role in ('admin','editor','reviewer','viewer')),
  token_sha256 text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz, accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.workspace_invites enable row level security;
drop policy if exists invites_admin_read on public.workspace_invites;
create policy invites_admin_read on public.workspace_invites for select to authenticated using (public.can_admin(workspace_id));
revoke all on public.workspace_invites from anon, authenticated;
grant select (id, workspace_id, email, role, expires_at, accepted_at, revoked_at, created_at) on public.workspace_invites to authenticated;

-- 7) RPC de espacios y equipo
create or replace function public.my_workspaces() returns table(id uuid, name text, role text, personal boolean, active boolean, members int)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, m.role, w.personal, w.id = public.current_workspace(),
         (select count(*)::int from public.workspace_members x where x.workspace_id = w.id)
  from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid() order by w.personal desc, w.created_at;
$$;

create or replace function public.set_active_workspace(p_ws uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_ws and user_id = auth.uid()) then
    raise exception 'No perteneces a ese espacio' using errcode = '42501';
  end if;
  update public.profiles set active_workspace_id = p_ws where id = auth.uid();
end $$;

create or replace function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; n int;
begin
  if auth.uid() is null then raise exception 'Sesión no válida' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then raise exception 'Nombre no válido (1–80 caracteres)' using errcode = '22023'; end if;
  select count(*) into n from public.workspaces where created_by = auth.uid();
  if n >= 20 then raise exception 'Límite de 20 espacios por usuario' using errcode = '22023'; end if;
  insert into public.workspaces(name, created_by, personal) values (btrim(p_name), auth.uid(), false) returning id into ws;
  insert into public.workspace_members(workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  update public.profiles set active_workspace_id = ws where id = auth.uid();
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'workspace.create', jsonb_build_object('name', btrim(p_name)));
  return ws;
end $$;

create or replace function public.create_invite(p_email text, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); tok text;
begin
  if not public.can_admin(ws) then raise exception 'Solo propietarios y administradores pueden invitar' using errcode = '42501'; end if;
  if p_role not in ('admin','editor','reviewer','viewer') then raise exception 'Rol no válido' using errcode = '22023'; end if;
  if (select role from public.workspace_members where workspace_id = ws and user_id = auth.uid()) <> 'owner' and p_role = 'admin' then
    raise exception 'Solo el propietario puede invitar administradores' using errcode = '42501';
  end if;
  if (select count(*) from public.workspace_invites where workspace_id = ws and accepted_at is null and revoked_at is null and expires_at > now()) >= 50 then
    raise exception 'Demasiadas invitaciones pendientes' using errcode = '22023';
  end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites(workspace_id, email, role, token_sha256, created_by)
  values (ws, lower(btrim(p_email)), p_role, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), auth.uid());
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'invite.create', jsonb_build_object('email', lower(btrim(p_email)), 'role', p_role));
  return tok;
end $$;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.workspace_invites; mail text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para aceptar la invitación' using errcode = '42501'; end if;
  select * into inv from public.workspace_invites where token_sha256 = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') for update;
  if inv.id is null or inv.revoked_at is not null then raise exception 'Invitación no válida' using errcode = '22023'; end if;
  if inv.accepted_at is not null then raise exception 'Esta invitación ya se usó' using errcode = '22023'; end if;
  if inv.expires_at < now() then raise exception 'La invitación caducó: pide otra' using errcode = '22023'; end if;
  select lower(email) into mail from auth.users where id = auth.uid();
  if mail is distinct from inv.email then raise exception 'La invitación es para otra dirección de email' using errcode = '42501'; end if;
  insert into public.workspace_members(workspace_id, user_id, role) values (inv.workspace_id, auth.uid(), inv.role)
    on conflict (workspace_id, user_id) do nothing;
  update public.workspace_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  update public.profiles set active_workspace_id = inv.workspace_id where id = auth.uid();
  insert into public.audit_events(workspace_id, actor, action, detail) values (inv.workspace_id, auth.uid(), 'invite.accept', jsonb_build_object('role', inv.role));
  return inv.workspace_id;
end $$;

create or replace function public.revoke_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.workspace_invites where id = p_id;
  if ws is null or not public.can_admin(ws) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.workspace_invites set revoked_at = now() where id = p_id and accepted_at is null;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'invite.revoke', jsonb_build_object('invite', p_id));
end $$;

create or replace function public.workspace_people() returns table(user_id uuid, email text, display_name text, role text, joined_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, p.display_name, m.role, m.created_at, m.user_id = auth.uid()
  from public.workspace_members m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
  where m.workspace_id = public.current_workspace() and public.is_member(m.workspace_id)
  order by (m.role = 'owner') desc, m.created_at;
$$;

create or replace function public.set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); cur text; mine text;
begin
  if not public.can_admin(ws) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_role not in ('admin','editor','reviewer','viewer') then raise exception 'Rol no válido' using errcode = '22023'; end if;
  select role into cur from public.workspace_members where workspace_id = ws and user_id = p_user;
  select role into mine from public.workspace_members where workspace_id = ws and user_id = auth.uid();
  if cur is null then raise exception 'No es miembro' using errcode = '22023'; end if;
  if cur = 'owner' then raise exception 'No se puede cambiar el rol del propietario' using errcode = '42501'; end if;
  if mine <> 'owner' and (cur = 'admin' or p_role = 'admin') then raise exception 'Solo el propietario gestiona administradores' using errcode = '42501'; end if;
  update public.workspace_members set role = p_role where workspace_id = ws and user_id = p_user;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'member.role', jsonb_build_object('user', p_user, 'from', cur, 'to', p_role));
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); cur text; mine text;
begin
  select role into cur from public.workspace_members where workspace_id = ws and user_id = p_user;
  select role into mine from public.workspace_members where workspace_id = ws and user_id = auth.uid();
  if cur is null then raise exception 'No es miembro' using errcode = '22023'; end if;
  if cur = 'owner' then raise exception 'El propietario no se puede eliminar' using errcode = '42501'; end if;
  if p_user <> auth.uid() and not public.can_admin(ws) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_user <> auth.uid() and mine <> 'owner' and cur = 'admin' then raise exception 'Solo el propietario elimina administradores' using errcode = '42501'; end if;
  delete from public.workspace_members where workspace_id = ws and user_id = p_user;
  update public.profiles set active_workspace_id = null where id = p_user and active_workspace_id = ws;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), case when p_user = auth.uid() then 'member.leave' else 'member.remove' end, jsonb_build_object('user', p_user, 'role', cur));
end $$;

revoke all on function public.my_workspaces(), public.set_active_workspace(uuid), public.create_workspace(text), public.create_invite(text, text),
  public.accept_invite(text), public.revoke_invite(uuid), public.workspace_people(), public.set_member_role(uuid, text), public.remove_member(uuid) from public, anon;
grant execute on function public.my_workspaces(), public.set_active_workspace(uuid), public.create_workspace(text), public.create_invite(text, text),
  public.accept_invite(text), public.revoke_invite(uuid), public.workspace_people(), public.set_member_role(uuid, text), public.remove_member(uuid) to authenticated;
