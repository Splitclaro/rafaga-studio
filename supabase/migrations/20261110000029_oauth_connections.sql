-- Conexiones OAuth (Google: YouTube/Drive; Dropbox). Los tokens NUNCA se leen desde el navegador:
-- `authenticated` no tiene SELECT sobre la tabla; el estado se consulta por RPC sin tokens y el worker (clave de servicio) los usa.
create table if not exists public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google','dropbox')),
  account_label text check (account_label is null or char_length(account_label) <= 200),
  scopes text[] not null default '{}',
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected','expired','revoked','error')),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  last_checked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);
alter table public.oauth_connections enable row level security;
revoke all on public.oauth_connections from anon, authenticated;   -- sin políticas: nadie salvo el servicio lee la tabla

-- Estado de las conexiones del espacio activo (sin tokens)
create or replace function public.oauth_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'account_label', account_label, 'scopes', scopes, 'expires_at', expires_at, 'status', status, 'last_error', last_error, 'last_checked_at', last_checked_at, 'updated_at', updated_at) order by provider), '[]'::jsonb)
  from public.oauth_connections where workspace_id = public.current_workspace() and public.is_member(workspace_id);
$$;
-- Guardar (o reemplazar) una conexión: solo responsables. La llama el servidor tras canjear el código; el navegador no ve los tokens.
create or replace function public.oauth_save(p_provider text, p_label text, p_scopes text[], p_access text, p_refresh text, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace();
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if p_provider not in ('google','dropbox') or p_access is null or char_length(p_access) < 10 then raise exception 'invalid_connection'; end if;
  insert into public.oauth_connections(workspace_id, provider, account_label, scopes, access_token, refresh_token, expires_at, status, last_error, last_checked_at, created_by)
  values (ws, p_provider, left(p_label, 200), coalesce(p_scopes, '{}'), p_access, p_refresh, p_expires_at, 'connected', null, now(), auth.uid())
  on conflict (workspace_id, provider) do update set account_label = excluded.account_label, scopes = excluded.scopes, access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, public.oauth_connections.refresh_token), expires_at = excluded.expires_at, status = 'connected', last_error = null, last_checked_at = now(), updated_at = now(), created_by = excluded.created_by;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'oauth.connect', jsonb_build_object('provider', p_provider, 'scopes', p_scopes));
  return jsonb_build_object('provider', p_provider, 'account_label', left(p_label, 200), 'status', 'connected');
end $$;
-- Token de acceso para una acción puntual desde el servidor (listar vídeos, probar, revocar): solo responsables del espacio.
create or replace function public.oauth_token(p_provider text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); c public.oauth_connections;
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  select * into c from public.oauth_connections where workspace_id = ws and provider = p_provider;
  if c.id is null then raise exception 'not_connected'; end if;
  return jsonb_build_object('access_token', c.access_token, 'refresh_token', c.refresh_token, 'expires_at', c.expires_at, 'scopes', c.scopes, 'status', c.status);
end $$;
-- Resultado de una renovación o comprobación hecha en el servidor
create or replace function public.oauth_touch(p_provider text, p_access text, p_expires_at timestamptz, p_status text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace();
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if p_status not in ('connected','expired','revoked','error') then raise exception 'invalid_status'; end if;
  update public.oauth_connections set access_token = coalesce(p_access, access_token), expires_at = coalesce(p_expires_at, expires_at), status = p_status, last_error = left(p_error, 300), last_checked_at = now(), updated_at = now()
   where workspace_id = ws and provider = p_provider;
end $$;
create or replace function public.oauth_disconnect(p_provider text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); n int;
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  delete from public.oauth_connections where workspace_id = ws and provider = p_provider;
  get diagnostics n = row_count;
  if n > 0 then insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'oauth.disconnect', jsonb_build_object('provider', p_provider)); end if;
  return n > 0;
end $$;
revoke all on function public.oauth_status(), public.oauth_save(text, text, text[], text, text, timestamptz), public.oauth_token(text), public.oauth_touch(text, text, timestamptz, text, text), public.oauth_disconnect(text) from public, anon;
grant execute on function public.oauth_status(), public.oauth_save(text, text, text[], text, text, timestamptz), public.oauth_token(text), public.oauth_touch(text, text, timestamptz, text, text), public.oauth_disconnect(text) to authenticated;
