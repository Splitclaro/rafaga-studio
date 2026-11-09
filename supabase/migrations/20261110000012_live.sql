-- En vivo: sesiones de captura HLS autorizada y sus ventanas (cada ventana pasa por el pipeline normal de clips). No destructiva.
create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  hls_url text not null check (hls_url ~ '^https://' and char_length(hls_url) <= 2000),
  brief text check (brief is null or char_length(brief) <= 2000),
  status text not null default 'queued' check (status in ('queued','capturing','paused','stopped','done','failed')),
  window_seconds int not null default 120 check (window_seconds between 40 and 300),
  max_seconds int not null default 3600 check (max_seconds between 60 and 3600),
  captured_seconds numeric not null default 0,
  windows_done int not null default 0,
  last_media_seq bigint,
  gaps int not null default 0, reconnects int not null default 0,
  last_error text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz, ended_at timestamptz,
  unique (workspace_id, id)
);
create unique index if not exists live_one_active_per_workspace on public.live_sessions(workspace_id) where status in ('queued','capturing');
create table if not exists public.live_windows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  session_id uuid not null,
  idx int not null,
  seconds numeric not null, reason text not null,
  project_id uuid,
  created_at timestamptz not null default now(),
  unique (session_id, idx),
  foreign key (workspace_id, session_id) references public.live_sessions(workspace_id, id) on delete cascade
);
alter table public.live_sessions enable row level security;
alter table public.live_windows enable row level security;
create policy live_sessions_select on public.live_sessions for select using (public.is_member(workspace_id));
create policy live_windows_select on public.live_windows for select using (public.is_member(workspace_id));
revoke insert, update, delete on public.live_sessions, public.live_windows from anon, authenticated;
grant select on public.live_sessions, public.live_windows to authenticated;

create or replace function public.start_live_session(p_url text, p_brief text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; sid uuid;
begin
  select workspace_id into ws from public.workspace_members where user_id = auth.uid() limit 1;
  if ws is null then raise exception 'not_found'; end if;
  if p_url is null or p_url !~ '^https://' or char_length(p_url) > 2000 then raise exception 'invalid_url'; end if;
  if p_brief is not null and char_length(p_brief) > 2000 then raise exception 'brief_too_long'; end if;
  if exists (select 1 from public.live_sessions where workspace_id = ws and status in ('queued','capturing')) then raise exception 'session_active'; end if;
  insert into public.live_sessions(workspace_id, hls_url, brief, created_by) values (ws, p_url, nullif(trim(p_brief), ''), auth.uid()) returning id into sid;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params) values (ws, 'live', 'live:' || sid || ':1', auth.uid(), jsonb_build_object('session_id', sid));
  return sid;
end $$;

create or replace function public.set_live_status(p_session uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare ws uuid; st text;
begin
  select workspace_id, status into ws, st from public.live_sessions where id = p_session;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  if p_action in ('stop','pause') then
    if st not in ('queued','capturing') then return st; end if;
    update public.live_sessions set status = case p_action when 'stop' then 'stopped' else 'paused' end, ended_at = now() where id = p_session;
    update public.jobs set status = 'cancelled', updated_at = now() where workspace_id = ws and kind = 'live' and params->>'session_id' = p_session::text and status = 'queued';
    return case p_action when 'stop' then 'stopped' else 'paused' end;
  elsif p_action = 'resume' then
    if st not in ('paused','stopped') then raise exception 'not_resumable'; end if;
    if exists (select 1 from public.live_sessions where workspace_id = ws and status in ('queued','capturing')) then raise exception 'session_active'; end if;
    update public.live_sessions set status = 'queued', ended_at = null, last_error = null where id = p_session;
    insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params) values (ws, 'live', 'live:' || p_session || ':' || extract(epoch from now())::bigint, auth.uid(), jsonb_build_object('session_id', p_session));
    return 'queued';
  end if;
  raise exception 'invalid_action';
end $$;
revoke all on function public.start_live_session(text, text), public.set_live_status(uuid, text) from public, anon;
grant execute on function public.start_live_session(text, text), public.set_live_status(uuid, text) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now()
  where j.id = (
    select id from public.jobs
    where kind in ('detect','render','lyrics','automation','live') and attempts < 3
      and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'))
    order by (kind = 'live') desc, (kind = 'render') desc, created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
