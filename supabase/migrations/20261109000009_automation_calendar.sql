-- 4:5, Automatizaciones (feeds RSS autorizados) y Calendario (planificación manual). No destructiva.
alter table public.renders drop constraint if exists renders_ratio_check;
alter table public.renders add constraint renders_ratio_check check (ratio in ('9:16','4:5','1:1','16:9'));

create or replace function public.request_render(p_clip uuid, p_version int, p_ratio text, p_burn boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; rid uuid; st text; k text;
begin
  if p_ratio not in ('9:16','4:5','1:1','16:9') then raise exception 'invalid_ratio'; end if;
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.clip_versions where clip_id = p_clip and version = p_version) then raise exception 'version_not_found'; end if;
  select id into rid from public.renders where clip_id = p_clip and clip_version = p_version and ratio = p_ratio and burn_subtitles = p_burn and status = 'ready' limit 1;
  if rid is not null then return jsonb_build_object('render_id', rid, 'reused', true); end if;
  k := 'render:' || p_clip || ':' || p_version || ':' || p_ratio || ':' || p_burn;
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

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  feed_url text not null check (feed_url ~ '^https://' and char_length(feed_url) <= 2000),
  review_first boolean not null default true,           -- por defecto genera candidatos y espera aprobación
  clip_count int not null default 5 check (clip_count between 3 and 10),
  brief text check (brief is null or char_length(brief) <= 2000),
  daily_limit int not null default 3 check (daily_limit between 1 and 20),
  active boolean not null default false,
  cursor_published timestamptz,                          -- primera activación: solo entradas posteriores
  last_checked_at timestamptz, last_error text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  rule_id uuid not null,
  entry_guid text not null,
  entry_title text, entry_url text,
  status text not null default 'queued' check (status in ('queued','imported','skipped','failed')),
  detail text, project_id uuid,
  created_at timestamptz not null default now(),
  unique (rule_id, entry_guid),                          -- una entrada nunca se procesa dos veces
  foreign key (workspace_id, rule_id) references public.automation_rules(workspace_id, id) on delete cascade
);
create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 150),
  caption text check (caption is null or char_length(caption) <= 2200),
  hashtags text check (hashtags is null or char_length(hashtags) <= 500),
  targets text[] not null default '{}',
  clip_id uuid, lyric_video_id uuid,
  scheduled_at timestamptz not null,
  timezone text not null default 'Europe/Madrid',
  status text not null default 'planned' check (status in ('draft','planned','done','cancelled')),
  publish_mode text not null default 'manual' check (publish_mode in ('manual')),   -- 'api' llegará con conexiones reales
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
alter table public.scheduled_posts enable row level security;
create policy automation_rules_select on public.automation_rules for select using (public.is_member(workspace_id));
create policy automation_rules_insert on public.automation_rules for insert with check (public.is_member(workspace_id) and created_by = auth.uid() and active = false);
create policy automation_rules_update on public.automation_rules for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy automation_rules_delete on public.automation_rules for delete using (public.is_member(workspace_id));
create policy automation_runs_select on public.automation_runs for select using (public.is_member(workspace_id));
create policy scheduled_posts_select on public.scheduled_posts for select using (public.is_member(workspace_id));
create policy scheduled_posts_insert on public.scheduled_posts for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy scheduled_posts_update on public.scheduled_posts for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy scheduled_posts_delete on public.scheduled_posts for delete using (public.is_member(workspace_id));
revoke update on public.automation_rules, public.scheduled_posts from anon, authenticated;
grant update (name, feed_url, review_first, clip_count, brief, daily_limit, active) on public.automation_rules to authenticated;
grant update (title, caption, hashtags, targets, scheduled_at, timezone, status) on public.scheduled_posts to authenticated;
revoke insert, update, delete on public.automation_runs from anon, authenticated;
grant select, insert, delete on public.automation_rules, public.scheduled_posts to authenticated;
grant select on public.automation_runs to authenticated;
