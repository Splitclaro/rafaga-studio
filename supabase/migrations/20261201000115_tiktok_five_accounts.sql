-- Hasta 5 cuentas de TikTok por espacio de trabajo (petición del propietario, 2026-11-16). Aditiva: se recrea oauth_save copiando la
-- definición de 113 y añadiendo solo el tope; reconectar una cuenta ya existente nunca cuenta como nueva. Se reafirman los permisos.
create or replace function public.oauth_save(p_provider text, p_label text, p_scopes text[], p_access text, p_refresh text, p_expires_at timestamptz, p_account text default '', p_alias text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); cid uuid;
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if p_provider not in ('google','dropbox','tiktok') or p_access is null or char_length(p_access) < 10 then raise exception 'invalid_connection'; end if;
  if p_provider = 'tiktok' and coalesce(p_account, '') = '' then raise exception 'invalid_connection'; end if;
  if p_provider = 'tiktok' and not exists (select 1 from public.oauth_connections where workspace_id = ws and provider = 'tiktok' and account_key = p_account)
     and (select count(*) from public.oauth_connections where workspace_id = ws and provider = 'tiktok') >= 5 then
    raise exception 'account_limit' using errcode = 'P0001', detail = '{"limit":5}';
  end if;
  insert into public.oauth_connections(workspace_id, provider, account_key, alias, account_label, scopes, access_token, refresh_token, expires_at, status, last_error, last_checked_at, created_by)
  values (ws, p_provider, coalesce(p_account, ''), nullif(left(btrim(p_alias), 60), ''), left(p_label, 200), coalesce(p_scopes, '{}'), p_access, p_refresh, p_expires_at, 'connected', null, now(), auth.uid())
  on conflict (workspace_id, provider, account_key) do update set account_label = excluded.account_label, alias = coalesce(excluded.alias, public.oauth_connections.alias), scopes = excluded.scopes,
    access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, public.oauth_connections.refresh_token), expires_at = excluded.expires_at, status = 'connected',
    last_error = null, last_checked_at = now(), updated_at = now(), created_by = excluded.created_by
  returning id into cid;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'oauth.connect', jsonb_build_object('provider', p_provider, 'scopes', p_scopes, 'connection', cid));
  return jsonb_build_object('id', cid, 'provider', p_provider, 'account_label', left(p_label, 200), 'status', 'connected');
end $$;
revoke all on function public.oauth_save(text, text, text[], text, text, timestamptz, text, text) from public, anon;
grant execute on function public.oauth_save(text, text, text[], text, text, timestamptz, text, text) to authenticated;
