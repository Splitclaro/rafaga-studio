-- Opciones de publicación de TikTok por publicación (comentarios, dúo, stitch, contenido comercial), exigidas por las directrices de Direct Post.
-- Aditiva: columna nueva con valor por defecto; request_publication gana un parámetro opcional; publication_job lo devuelve al worker.
alter table public.publications add column if not exists post_options jsonb not null default '{}'::jsonb;

drop function if exists public.request_publication(uuid, text, text, text, text, timestamptz, text, uuid, text);
create or replace function public.request_publication(p_render uuid, p_platform text, p_title text, p_description text, p_privacy text,
  p_scheduled_at timestamptz, p_idem text, p_connection uuid default null, p_music text default null, p_options jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rd record; prev record; pid uuid := gen_random_uuid(); priv text; r jsonb; conn public.oauth_connections; cap int; day_n int; n_conn int;
begin
  if p_platform not in ('youtube','tiktok') or p_title is null or char_length(btrim(p_title)) not between 1 and 100 then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  if p_music is not null and p_music not in ('own','licensed','free','risk') then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
  if p_options is not null and (jsonb_typeof(p_options) <> 'object' or pg_column_size(p_options) > 600) then raise exception 'invalid_publication' using errcode = 'P0001'; end if;
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
  insert into public.publications(id, workspace_id, render_id, platform, title, description, privacy, state, scheduled_at, created_by, idempotency_key, connection_id, music_origin, post_options)
    values (pid, rd.workspace_id, p_render, p_platform, btrim(p_title), left(p_description, 5000), priv,
            case when p_scheduled_at is not null and p_scheduled_at > now() then 'scheduled' else 'queued' end, p_scheduled_at, auth.uid(), p_idem, conn.id, p_music, coalesce(p_options, '{}'::jsonb));
  if p_scheduled_at is not null and p_scheduled_at > now() then
    return jsonb_build_object('publication_id', pid, 'state', 'scheduled', 'job_id', null, 'replay', false, 'connection_id', conn.id);
  end if;
  r := public.enqueue_job(rd.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
         'params', jsonb_build_object('publication_id', pid))), 'publish:' || pid, '{}', null, null);
  update public.publications set job_id = (r->>'job_id')::uuid where id = pid;
  return jsonb_build_object('publication_id', pid, 'state', 'queued', 'job_id', r->>'job_id', 'replay', false, 'connection_id', conn.id);
end $$;
revoke all on function public.request_publication(uuid, text, text, text, text, timestamptz, text, uuid, text, jsonb) from public, anon;
grant execute on function public.request_publication(uuid, text, text, text, text, timestamptz, text, uuid, text, jsonb) to authenticated;

create or replace function public.publication_job(p_publication uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('publication_id', p.id, 'workspace_id', p.workspace_id, 'platform', p.platform, 'title', p.title, 'description', p.description,
    'privacy', p.privacy, 'state', p.state, 'object_key', r.storage_path, 'bytes', r.bytes, 'connection_id', p.connection_id, 'post_options', p.post_options)
  from public.publications p join public.renders r on r.id = p.render_id where p.id = p_publication $$;
revoke all on function public.publication_job(uuid) from public, anon, authenticated;
grant execute on function public.publication_job(uuid) to service_role;
