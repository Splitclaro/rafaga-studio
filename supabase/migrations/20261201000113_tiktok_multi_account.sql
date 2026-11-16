-- Varias cuentas de TikTok por espacio de trabajo (Punto de Perreo, Te Lo Dedico, …) con alias y perfil de contenido.
-- Aditiva. Impacto: `oauth_connections` deja de ser única por (espacio, proveedor) y pasa a serlo por (espacio, proveedor, cuenta);
-- Google y Dropbox siguen teniendo una sola fila (cuenta ''), así que su comportamiento no cambia. Las conexiones existentes
-- conservan account_key ''. Los tokens siguen sin ser legibles desde el navegador.
--   cliente:  oauth_status (con id, alias y perfil), oauth_save (con cuenta/alias), oauth_set_profile, oauth_disconnect_account, request_publication (con cuenta y origen de la música)
--   worker:   oauth_token_for / oauth_touch_for (con conexión opcional), publication_job (devuelve la conexión), enqueue_due_publications (salta cuentas en pausa)

alter table public.oauth_connections add column if not exists account_key text not null default '';
alter table public.oauth_connections add column if not exists alias text check (alias is null or char_length(alias) <= 60);
alter table public.oauth_connections add column if not exists profile jsonb not null default '{}' check (pg_column_size(profile) <= 6000);
alter table public.oauth_connections drop constraint if exists oauth_connections_workspace_id_provider_key;
create unique index if not exists oauth_connections_account_uq on public.oauth_connections(workspace_id, provider, account_key);

alter table public.publications add column if not exists connection_id uuid references public.oauth_connections(id) on delete set null;
alter table public.publications add column if not exists music_origin text check (music_origin is null or music_origin in ('own','licensed','free','risk'));
create index if not exists publications_connection_idx on public.publications(connection_id, scheduled_at) where connection_id is not null;

-- Estado (sin tokens): ahora con id, alias y perfil para distinguir las cuentas.
create or replace function public.oauth_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'provider', provider, 'account_label', account_label, 'alias', alias, 'profile', profile, 'scopes', scopes, 'expires_at', expires_at,
    'status', status, 'last_error', last_error, 'last_checked_at', last_checked_at, 'updated_at', updated_at) order by provider, created_at), '[]'::jsonb)
  from public.oauth_connections where workspace_id = public.current_workspace() and public.is_member(workspace_id);
$$;

-- Guardar (o reemplazar) una conexión. Misma lógica que 034 + cuenta (open_id de TikTok) y alias.
drop function if exists public.oauth_save(text, text, text[], text, text, timestamptz);
create or replace function public.oauth_save(p_provider text, p_label text, p_scopes text[], p_access text, p_refresh text, p_expires_at timestamptz, p_account text default '', p_alias text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); cid uuid;
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if p_provider not in ('google','dropbox','tiktok') or p_access is null or char_length(p_access) < 10 then raise exception 'invalid_connection'; end if;
  if p_provider = 'tiktok' and coalesce(p_account, '') = '' then raise exception 'invalid_connection'; end if;
  insert into public.oauth_connections(workspace_id, provider, account_key, alias, account_label, scopes, access_token, refresh_token, expires_at, status, last_error, last_checked_at, created_by)
  values (ws, p_provider, coalesce(p_account, ''), nullif(left(btrim(p_alias), 60), ''), left(p_label, 200), coalesce(p_scopes, '{}'), p_access, p_refresh, p_expires_at, 'connected', null, now(), auth.uid())
  on conflict (workspace_id, provider, account_key) do update set account_label = excluded.account_label, alias = coalesce(excluded.alias, public.oauth_connections.alias), scopes = excluded.scopes,
    access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, public.oauth_connections.refresh_token), expires_at = excluded.expires_at, status = 'connected',
    last_error = null, last_checked_at = now(), updated_at = now(), created_by = excluded.created_by
  returning id into cid;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'oauth.connect', jsonb_build_object('provider', p_provider, 'scopes', p_scopes, 'connection', cid));
  return jsonb_build_object('id', cid, 'provider', p_provider, 'account_label', left(p_label, 200), 'status', 'connected');
end $$;

-- Alias y perfil de contenido de una cuenta (tono, hashtags, idioma, cadencia, tope diario, privacidad, pausa). Solo responsables.
create or replace function public.oauth_set_profile(p_conn uuid, p_alias text, p_profile jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.oauth_connections;
begin
  select * into c from public.oauth_connections where id = p_conn;
  if c.id is null or not public.can_admin(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_profile is not null and (jsonb_typeof(p_profile) <> 'object' or pg_column_size(p_profile) > 6000) then raise exception 'invalid_profile' using errcode = 'P0001'; end if;
  update public.oauth_connections set alias = coalesce(nullif(left(btrim(p_alias), 60), ''), alias), profile = coalesce(p_profile, profile), updated_at = now() where id = p_conn;
  return jsonb_build_object('id', p_conn);
end $$;

-- Desconexión de una cuenta concreta (devuelve el token para revocarlo en el proveedor desde el servidor).
create or replace function public.oauth_disconnect_account(p_conn uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.oauth_connections;
begin
  select * into c from public.oauth_connections where id = p_conn;
  if c.id is null or not public.can_admin(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.oauth_connections where id = p_conn;
  update public.publications set state = 'cancelled' where connection_id = p_conn and state = 'scheduled';
  insert into public.audit_events(workspace_id, actor, action, detail) values (c.workspace_id, auth.uid(), 'oauth.disconnect', jsonb_build_object('provider', c.provider, 'connection', p_conn));
  return jsonb_build_object('token', coalesce(c.refresh_token, c.access_token), 'provider', c.provider);
end $$;

-- Publicación: ahora con cuenta destino y origen de la música. Mismas reglas que 042 + cuenta, pausa y, cuando se elige cuenta, tope diario, duplicados y origen de la música.
drop function if exists public.request_publication(uuid, text, text, text, text, timestamptz, text);
create or replace function public.request_publication(p_render uuid, p_platform text, p_title text, p_description text, p_privacy text,
  p_scheduled_at timestamptz, p_idem text, p_connection uuid default null, p_music text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd record; prev record; pid uuid := gen_random_uuid(); priv text; r jsonb; conn public.oauth_connections; cap int; day_n int; n_conn int;
begin
  if p_platform not in ('youtube','tiktok') or p_title is null or char_length(btrim(p_title)) not between 1 and 100 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  if p_music is not null and p_music not in ('own','licensed','free','risk') then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  select id, workspace_id, status, kind, storage_path into rd from public.renders where id = p_render;
  if not found or not public.can_edit(rd.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.publications where workspace_id = rd.workspace_id and idempotency_key = p_idem;
  if found then return jsonb_build_object('publication_id', prev.id, 'state', prev.state, 'job_id', prev.job_id, 'replay', true); end if;
  if rd.kind <> 'mp4' or rd.status <> 'ready' or rd.storage_path is null then raise exception 'render_not_ready' using errcode = 'P0001'; end if;
  priv := coalesce(p_privacy, case p_platform when 'youtube' then 'private' else 'SELF_ONLY' end);
  if (p_platform = 'youtube' and priv not in ('private','unlisted','public'))
     or (p_platform = 'tiktok' and priv not in ('SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','PUBLIC_TO_EVERYONE')) then raise exception 'invalid_privacy' using errcode = 'P0001'; end if;
  if p_platform = 'tiktok' then
    if p_connection is null then
      select count(*) into n_conn from public.oauth_connections where workspace_id = rd.workspace_id and provider = 'tiktok' and status = 'connected';
      if n_conn > 1 then raise exception 'account_required' using errcode = 'P0001'; end if;
      select * into conn from public.oauth_connections where workspace_id = rd.workspace_id and provider = 'tiktok' and status = 'connected';
    else
      select * into conn from public.oauth_connections where id = p_connection and workspace_id = rd.workspace_id and provider = 'tiktok';
    end if;
    if conn.id is null or conn.status <> 'connected' then raise exception 'not_connected' using errcode = 'P0001'; end if;
    if coalesce(conn.profile->>'paused', 'false') = 'true' then raise exception 'account_paused' using errcode = 'P0001'; end if;
    if p_connection is not null and p_music is null then raise exception 'music_origin_required' using errcode = 'P0001'; end if;
    if p_connection is not null and exists (select 1 from public.publications where connection_id = conn.id and render_id = p_render and state not in ('cancelled','failed')) then raise exception 'duplicate_publication' using errcode = 'P0001'; end if;
    cap := least(30, greatest(1, coalesce(nullif(conn.profile->>'daily_cap', '')::int, 8)));
    select count(*) into day_n from public.publications where connection_id = conn.id and state not in ('cancelled','failed')
       and (coalesce(scheduled_at, created_at) at time zone 'UTC')::date = (coalesce(p_scheduled_at, now()) at time zone 'UTC')::date;
    if p_connection is not null and day_n >= cap then raise exception 'daily_cap' using errcode = 'P0001', detail = json_build_object('cap', cap)::text; end if;
  elsif not exists (select 1 from public.oauth_connections where workspace_id = rd.workspace_id and status = 'connected' and provider = 'google') then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  insert into public.publications(id, workspace_id, render_id, platform, title, description, privacy, state, scheduled_at, created_by, idempotency_key, connection_id, music_origin)
    values (pid, rd.workspace_id, p_render, p_platform, btrim(p_title), left(p_description, 5000), priv,
            case when p_scheduled_at is not null and p_scheduled_at > now() then 'scheduled' else 'queued' end, p_scheduled_at, auth.uid(), p_idem, conn.id, p_music);
  if p_scheduled_at is not null and p_scheduled_at > now() then
    return jsonb_build_object('publication_id', pid, 'state', 'scheduled', 'job_id', null, 'replay', false, 'connection_id', conn.id);
  end if;
  r := public.enqueue_job(rd.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
         'params', jsonb_build_object('publication_id', pid))), 'publish:' || pid, '{}', null, null);
  update public.publications set job_id = (r->>'job_id')::uuid where id = pid;
  return jsonb_build_object('publication_id', pid, 'state', 'queued', 'job_id', r->>'job_id', 'replay', false, 'connection_id', conn.id);
end $$;

-- Cola programada: las cuentas en pausa no publican (sus publicaciones esperan en 'scheduled').
create or replace function public.enqueue_due_publications() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; r jsonb;
begin
  for p in select pb.* from public.publications pb left join public.oauth_connections c on c.id = pb.connection_id
            where pb.state = 'scheduled' and pb.scheduled_at <= now() and coalesce(c.profile->>'paused', 'false') <> 'true' for update of pb skip locked loop
    r := public.enqueue_job(p.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
           'params', jsonb_build_object('publication_id', p.id))), 'publish:' || p.id, '{}', null, null);
    update public.publications set state = 'queued', job_id = (r->>'job_id')::uuid where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Worker: la publicación conoce su cuenta.
create or replace function public.publication_job(p_publication uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('publication_id', p.id, 'workspace_id', p.workspace_id, 'platform', p.platform, 'title', p.title,
    'description', p.description, 'privacy', p.privacy, 'state', p.state, 'object_key', r.storage_path, 'bytes', r.bytes, 'connection_id', p.connection_id)
  from public.publications p join public.renders r on r.id = p.render_id where p.id = p_publication $$;

drop function if exists public.oauth_token_for(uuid, text);
create or replace function public.oauth_token_for(p_ws uuid, p_provider text, p_conn uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.oauth_connections;
begin
  if p_conn is not null then select * into c from public.oauth_connections where id = p_conn and workspace_id = p_ws and provider = p_provider;
  else select * into c from public.oauth_connections where workspace_id = p_ws and provider = p_provider order by created_at limit 1; end if;
  if c.id is null then raise exception 'not_connected' using errcode = 'P0001'; end if;
  return jsonb_build_object('access_token', c.access_token, 'refresh_token', c.refresh_token, 'expires_at', c.expires_at, 'scopes', c.scopes, 'status', c.status);
end $$;
drop function if exists public.oauth_touch_for(uuid, text, text, timestamptz, text, text);
create or replace function public.oauth_touch_for(p_ws uuid, p_provider text, p_access text, p_expires_at timestamptz, p_status text, p_error text, p_conn uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('connected','expired','revoked','error') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  update public.oauth_connections set access_token = coalesce(p_access, access_token), expires_at = coalesce(p_expires_at, expires_at), status = p_status,
    last_error = left(p_error, 300), last_checked_at = now(), updated_at = now()
   where workspace_id = p_ws and provider = p_provider and (p_conn is null or id = p_conn);
end $$;

revoke all on function public.oauth_save(text, text, text[], text, text, timestamptz, text, text), public.oauth_set_profile(uuid, text, jsonb), public.oauth_disconnect_account(uuid),
  public.request_publication(uuid, text, text, text, text, timestamptz, text, uuid, text), public.enqueue_due_publications(), public.publication_job(uuid),
  public.oauth_token_for(uuid, text, uuid), public.oauth_touch_for(uuid, text, text, timestamptz, text, text, uuid) from public, anon;
grant execute on function public.oauth_save(text, text, text[], text, text, timestamptz, text, text), public.oauth_set_profile(uuid, text, jsonb), public.oauth_disconnect_account(uuid),
  public.request_publication(uuid, text, text, text, text, timestamptz, text, uuid, text) to authenticated;
grant execute on function public.enqueue_due_publications(), public.publication_job(uuid), public.oauth_token_for(uuid, text, uuid), public.oauth_touch_for(uuid, text, text, timestamptz, text, text, uuid) to service_role;
revoke all on function public.oauth_status() from public, anon;
grant execute on function public.oauth_status() to authenticated;
