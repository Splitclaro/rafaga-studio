-- Enlaces de revisión para externos (token acotado, caducidad, revocación, permisos) y paquetes ZIP por trabajo en segundo plano.
-- Sin clave de servidor en el front: el acceso anónimo es SOLO a través de RPC que reciben el token (se guarda su SHA-256).

-- Comentarios/decisiones de invitados
alter table public.clip_comments add column if not exists guest_name text check (guest_name is null or char_length(guest_name) between 1 and 60);
alter table public.clip_comments add column if not exists share_link_id uuid;
alter table public.clips add column if not exists reviewed_guest text;

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  delivery_id uuid not null,
  label text check (label is null or char_length(label) <= 80),
  token_sha256 text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  allow_download boolean not null default false,
  allow_comment boolean not null default true,
  allow_approve boolean not null default false,
  views int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, delivery_id) references public.deliveries(workspace_id, id) on delete cascade
);
alter table public.share_links enable row level security;
drop policy if exists share_links_read on public.share_links;
create policy share_links_read on public.share_links for select to authenticated using (public.can_edit(workspace_id));
revoke all on public.share_links from anon, authenticated;
grant select (id, workspace_id, delivery_id, label, expires_at, revoked_at, allow_download, allow_comment, allow_approve, views, last_viewed_at, created_at) on public.share_links to authenticated;

create or replace function public.create_share_link(p_delivery uuid, p_days int, p_download boolean, p_comment boolean, p_approve boolean, p_label text default null) returns text
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; tok text;
begin
  select * into d from public.deliveries where id = p_delivery;
  if d.id is null or not public.can_edit(d.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'La caducidad debe estar entre 1 y 90 días' using errcode = '22023'; end if;
  if (select count(*) from public.share_links where delivery_id = p_delivery and revoked_at is null and expires_at > now()) >= 20 then raise exception 'Demasiados enlaces activos en esta entrega' using errcode = '22023'; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.share_links(workspace_id, delivery_id, label, token_sha256, expires_at, allow_download, allow_comment, allow_approve, created_by)
  values (d.workspace_id, p_delivery, nullif(btrim(coalesce(p_label, '')), ''), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), now() + make_interval(days => p_days), coalesce(p_download, false), coalesce(p_comment, true), coalesce(p_approve, false) and coalesce(p_comment, true), auth.uid());
  insert into public.audit_events(workspace_id, actor, action, detail) values (d.workspace_id, auth.uid(), 'share.create', jsonb_build_object('delivery', p_delivery, 'days', p_days, 'download', p_download, 'approve', p_approve));
  return tok;
end $$;
create or replace function public.revoke_share_link(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.share_links;
begin
  select * into s from public.share_links where id = p_id;
  if s.id is null or not public.can_edit(s.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  insert into public.audit_events(workspace_id, actor, action, detail) values (s.workspace_id, auth.uid(), 'share.revoke', jsonb_build_object('link', p_id));
end $$;

-- Resolución interna del token → enlace válido
create or replace function public._share(p_token text) returns public.share_links
language sql stable security definer set search_path = public as $$
  select * from public.share_links where token_sha256 = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') limit 1;
$$;
revoke all on function public._share(text) from public, anon, authenticated;

create or replace function public.share_view(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.share_links; d public.deliveries; pr public.projects; bname text; items jsonb; cms jsonb;
begin
  s := public._share(p_token);
  if s.id is null then return jsonb_build_object('error', 'invalid'); end if;
  if s.revoked_at is not null then return jsonb_build_object('error', 'revoked'); end if;
  if s.expires_at < now() then return jsonb_build_object('error', 'expired'); end if;
  select * into d from public.deliveries where id = s.delivery_id;
  select * into pr from public.projects where id = d.project_id;
  select name into bname from public.brand_kits where id = pr.brand_kit_id;
  update public.share_links set views = views + 1, last_viewed_at = now() where id = s.id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'clip_id', c.id, 'version', di.version, 'title', c.title, 'review_status', c.review_status, 'approved_version', c.approved_version, 'current_version', c.current_version,
      'thumb_path', c.thumb_path, 'render_path', r.storage_path, 'ratio', r.ratio, 'duration', r.probe->>'duration', 'size', r.probe->>'size') order by di.position), '[]'::jsonb)
    into items
  from public.delivery_items di join public.clips c on c.id = di.clip_id
  left join lateral (select storage_path, ratio, probe from public.renders where clip_id = di.clip_id and clip_version = di.version and status = 'ready' order by created_at desc limit 1) r on true
  where di.delivery_id = d.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'clip_id', m.clip_id, 'version', m.version, 'at_sec', m.at_sec, 'body', m.body, 'kind', m.kind, 'who', coalesce(m.guest_name, 'Equipo'), 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
    into cms from public.clip_comments m where m.clip_id in (select clip_id from public.delivery_items where delivery_id = d.id);
  return jsonb_build_object('delivery', jsonb_build_object('name', d.name, 'description', d.description, 'created_at', d.created_at, 'project', pr.name, 'brand', bname),
    'perms', jsonb_build_object('download', s.allow_download, 'comment', s.allow_comment, 'approve', s.allow_approve), 'expires_at', s.expires_at, 'items', items, 'comments', cms);
end $$;

create or replace function public.share_comment(p_token text, p_clip uuid, p_at numeric, p_body text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.share_links; di public.delivery_items; c public.clips; cid uuid;
begin
  s := public._share(p_token);
  if s.id is null or s.revoked_at is not null or s.expires_at < now() then raise exception 'Enlace no válido o caducado' using errcode = '42501'; end if;
  if not s.allow_comment then raise exception 'Este enlace no permite comentar' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'Indica tu nombre (1–60 caracteres)' using errcode = '22023'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'El comentario debe tener entre 1 y 2000 caracteres' using errcode = '22023'; end if;
  select * into di from public.delivery_items where delivery_id = s.delivery_id and clip_id = p_clip;
  if di.clip_id is null then raise exception 'Pieza no incluida en esta entrega' using errcode = '22023'; end if;
  if (select count(*) from public.clip_comments where share_link_id = s.id) >= 300 then raise exception 'Límite de comentarios del enlace alcanzado' using errcode = '22023'; end if;
  select * into c from public.clips where id = p_clip;
  insert into public.clip_comments(workspace_id, clip_id, version, at_sec, body, guest_name, share_link_id) values (c.workspace_id, p_clip, di.version, p_at, btrim(p_body), btrim(p_name), s.id) returning clip_comments.id into cid;
  return cid;
end $$;

create or replace function public.share_decide(p_token text, p_clip uuid, p_status text, p_note text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.share_links; di public.delivery_items; c public.clips;
begin
  s := public._share(p_token);
  if s.id is null or s.revoked_at is not null or s.expires_at < now() then raise exception 'Enlace no válido o caducado' using errcode = '42501'; end if;
  if not s.allow_approve then raise exception 'Este enlace no permite aprobar' using errcode = '42501'; end if;
  if p_status not in ('approved', 'changes_requested') then raise exception 'Estado no válido' using errcode = '22023'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then raise exception 'Indica tu nombre (1–60 caracteres)' using errcode = '22023'; end if;
  select * into di from public.delivery_items where delivery_id = s.delivery_id and clip_id = p_clip;
  if di.clip_id is null then raise exception 'Pieza no incluida en esta entrega' using errcode = '22023'; end if;
  select * into c from public.clips where id = p_clip for update;
  if di.version <> c.current_version then raise exception 'La pieza cambió a la versión %: pide una entrega actualizada', c.current_version using errcode = '22023'; end if;
  update public.clips set review_status = p_status, approved_version = case when p_status = 'approved' then di.version else null end, reviewed_by = null, reviewed_guest = btrim(p_name), reviewed_at = now() where id = p_clip;
  insert into public.clip_comments(workspace_id, clip_id, version, body, kind, guest_name, share_link_id)
  values (c.workspace_id, p_clip, di.version, coalesce(nullif(btrim(p_note), ''), case p_status when 'approved' then 'Versión aprobada' else 'Cambios solicitados' end), case p_status when 'approved' then 'approval' else 'changes' end, btrim(p_name), s.id);
end $$;

-- Lectura anónima de archivos SOLO de entregas con enlace activo (y solo conociendo la ruta, que únicamente devuelve share_view)
create or replace function public.share_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.share_links s join public.delivery_items di on di.delivery_id = s.delivery_id
    where s.revoked_at is null and s.expires_at > now()
      and (p_name = (select c.thumb_path from public.clips c where c.id = di.clip_id)
        or exists (select 1 from public.renders r where r.clip_id = di.clip_id and r.clip_version = di.version and r.status = 'ready' and r.storage_path = p_name)));
$$;
revoke all on function public.share_path_ok(text) from public;
grant execute on function public.share_path_ok(text) to anon, authenticated;
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists share_read_anon on storage.objects';
    execute $p$create policy share_read_anon on storage.objects for select to anon using (bucket_id = 'renders' and public.share_path_ok(name))$p$;
  end if;
end $$;

revoke all on function public.create_share_link(uuid, int, boolean, boolean, boolean, text), public.revoke_share_link(uuid) from public, anon;
grant execute on function public.create_share_link(uuid, int, boolean, boolean, boolean, text), public.revoke_share_link(uuid) to authenticated;
revoke all on function public.share_view(text), public.share_comment(text, uuid, numeric, text, text), public.share_decide(text, uuid, text, text, text) from public;
grant execute on function public.share_view(text), public.share_comment(text, uuid, numeric, text, text), public.share_decide(text, uuid, text, text, text) to anon, authenticated;

-- Paquetes ZIP (trabajo en segundo plano; partes ≤ 40 MB por el límite de archivo del almacenamiento actual)
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('ingest','transcribe','detect','render','live','automation','lyrics','package'));
create table if not exists public.delivery_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  delivery_id uuid not null,
  options jsonb not null,
  status text not null default 'queued' check (status in ('queued','building','ready','failed','cancelled')),
  progress jsonb not null default '{}',
  parts jsonb not null default '[]',
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  foreign key (workspace_id, delivery_id) references public.deliveries(workspace_id, id) on delete cascade
);
alter table public.delivery_packages enable row level security;
drop policy if exists delivery_packages_read on public.delivery_packages;
create policy delivery_packages_read on public.delivery_packages for select to authenticated using (public.is_member(workspace_id));
revoke all on public.delivery_packages from anon, authenticated;
grant select on public.delivery_packages to authenticated;

create or replace function public.request_package(p_delivery uuid, p_options jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deliveries; opts jsonb; pid uuid; k text; inc jsonb;
begin
  select * into d from public.deliveries where id = p_delivery;
  if d.id is null or not public.can_edit(d.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  inc := coalesce(p_options->'include', '["mp4"]'::jsonb);
  if jsonb_typeof(inc) <> 'array' or exists (select 1 from jsonb_array_elements_text(inc) x where x not in ('mp4','thumbs','srt','vtt','transcript')) then raise exception 'Contenido no válido' using errcode = '22023'; end if;
  opts := jsonb_build_object('only_approved', coalesce((p_options->>'only_approved')::boolean, false), 'include', (select jsonb_agg(x order by x) from (select distinct jsonb_array_elements_text(inc) x) t), 'clips', case when jsonb_typeof(p_options->'clips') = 'array' then p_options->'clips' else null end);
  k := 'package:' || p_delivery || ':' || encode(sha256(convert_to(opts::text, 'UTF8')), 'hex');
  select id into pid from public.delivery_packages p where p.delivery_id = p_delivery and p.options = opts and p.status in ('queued','building','ready') and p.expires_at > now() order by created_at desc limit 1;
  if pid is not null then return pid; end if;
  insert into public.delivery_packages(workspace_id, delivery_id, options, created_by) values (d.workspace_id, p_delivery, opts, auth.uid()) returning id into pid;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params) values (d.workspace_id, 'package', k || ':' || pid, auth.uid(), jsonb_build_object('package_id', pid));
  return pid;
end $$;
create or replace function public.retry_package(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.delivery_packages;
begin
  select * into p from public.delivery_packages where id = p_id;
  if p.id is null or not public.can_edit(p.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p.status not in ('failed','cancelled') then raise exception 'Solo se reintenta un paquete fallido o cancelado' using errcode = '22023'; end if;
  update public.delivery_packages set status = 'queued', error = null, progress = '{}', parts = '[]', finished_at = null where id = p_id;
  update public.jobs set status = 'queued', attempts = 0, error_code = null, error_message = null, updated_at = now() where workspace_id = p.workspace_id and kind = 'package' and params->>'package_id' = p_id::text;
end $$;
create or replace function public.cancel_package(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.delivery_packages;
begin
  select * into p from public.delivery_packages where id = p_id;
  if p.id is null or not public.can_edit(p.workspace_id) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p.status not in ('queued','building') then raise exception 'Este paquete ya no se puede cancelar' using errcode = '22023'; end if;
  update public.delivery_packages set status = 'cancelled', finished_at = now() where id = p_id;
  update public.jobs set status = 'cancelled' where workspace_id = p.workspace_id and kind = 'package' and params->>'package_id' = p_id::text and status not in ('done','failed','cancelled');
end $$;
revoke all on function public.request_package(uuid, jsonb), public.retry_package(uuid), public.cancel_package(uuid) from public, anon;
grant execute on function public.request_package(uuid, jsonb), public.retry_package(uuid), public.cancel_package(uuid) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now(), started_at = coalesce(j.started_at, now())
  where j.id = (
    select q.id from public.jobs q
    where q.kind in ('detect','render','lyrics','automation','live','package') and q.attempts < 3
      and (q.status = 'queued' or (q.status not in ('done','failed','cancelled') and q.heartbeat_at < now() - interval '15 minutes'))
    order by (q.kind = 'live') desc, (q.kind = 'render') desc,
      (select count(*) from public.jobs r where r.workspace_id = q.workspace_id and r.status not in ('queued','done','failed','cancelled')), q.created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
