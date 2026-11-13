create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null, version int not null check (version >= 1),
  range_start_ms bigint not null default 0 check (range_start_ms >= 0), range_end_ms bigint not null,
  transcript_id uuid, transcript_revision int not null default 1 check (transcript_revision >= 1),
  language text check (language is null or language ~ '^[a-z]{2}$'),
  speakers jsonb not null default '[]', scenes jsonb not null default '[]', audio_signals jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  component_versions jsonb not null default '{}', created_at timestamptz not null default now(),
  check (range_end_ms > range_start_ms), unique (workspace_id, id), unique (source_id, version),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id) on delete cascade,
  foreign key (workspace_id, transcript_id) references public.transcripts(workspace_id, id));
create index if not exists analyses_source_idx on public.analyses(workspace_id, source_id, status);

create table if not exists public.transcript_revisions (
  workspace_id uuid not null, transcript_id uuid not null, revision int not null check (revision >= 2),
  words jsonb not null check (jsonb_typeof(words) = 'array'), edited_by uuid references auth.users(id),
  created_at timestamptz not null default now(), primary key (transcript_id, revision),
  unique (workspace_id, transcript_id, revision),
  foreign key (workspace_id, transcript_id) references public.transcripts(workspace_id, id) on delete cascade);

alter table public.generations add column if not exists analysis_id uuid;
alter table public.generations add column if not exists mode text check (mode is null or mode in
  ('automatico','por_tema','pregunta_respuesta','educativo','historia','destacados','manual'));
alter table public.generations add column if not exists component_versions jsonb not null default '{}';
alter table public.generations add column if not exists units_reserved numeric(10,2) not null default 0;
alter table public.generations add column if not exists units_consumed numeric(10,2) not null default 0;
alter table public.generations add column if not exists warnings jsonb not null default '[]';
alter table public.generations add column if not exists errors jsonb not null default '[]';
alter table public.generations add column if not exists requested_count int check (requested_count is null or requested_count between 1 and 20);
alter table public.generations add column if not exists delivered_count int check (delivered_count is null or delivered_count >= 0);
alter table public.generations add column if not exists cancelled_at timestamptz;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'generations_analysis_fk') then
  alter table public.generations add constraint generations_analysis_fk foreign key (workspace_id, analysis_id)
    references public.analyses(workspace_id, id); end if; end $$;

create table if not exists public.generation_recipes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  params jsonb not null check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 8000),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));

create table if not exists public.clip_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));
alter table public.clips add column if not exists editorial_state text not null default 'pendiente'
  check (editorial_state in ('pendiente','en_revision','aprobado','descartado'));
alter table public.clips add column if not exists technical_state text not null default 'disponible'
  check (technical_state in ('preparando','disponible','exportando','fallido'));
alter table public.clips add column if not exists user_edited boolean not null default false;
alter table public.clips add column if not exists needs_review boolean not null default false;
alter table public.clips add column if not exists topic text check (topic is null or char_length(topic) <= 120);
alter table public.clips add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 20);
alter table public.clips add column if not exists collection_id uuid;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'clips_collection_fk') then
  alter table public.clips add constraint clips_collection_fk foreign key (workspace_id, collection_id)
    references public.clip_collections(workspace_id, id) on delete set null (collection_id); end if; end $$;
grant update (tags, collection_id, topic) on public.clips to authenticated;

alter table public.clip_versions add column if not exists aspect text check (aspect is null or aspect in ('9:16','16:9','1:1'));
alter table public.clip_versions add column if not exists layout text check (layout is null or layout in
  ('single_track','split_two','active_speaker','screen_presenter','fit_full','manual'));
alter table public.clip_versions add column if not exists template text check (template is null or template ~ '^[a-z0-9_]{1,40}$');
create or replace function public.clip_versions_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;  -- cascada desde clips
  raise exception 'clip_versions_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists clip_versions_immutable on public.clip_versions;
create trigger clip_versions_immutable before update or delete on public.clip_versions
  for each row execute function public.clip_versions_immutable();

create table if not exists public.clip_drafts (
  clip_id uuid primary key, workspace_id uuid not null, base_version int not null check (base_version >= 1),
  spec jsonb not null check (pg_column_size(spec) < 200000), updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), unique (workspace_id, clip_id),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade);

alter table public.renders add column if not exists kind text not null default 'mp4'
  check (kind in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl'));
alter table public.renders add column if not exists settings_hash text;
alter table public.renders add column if not exists bytes bigint check (bytes is null or bytes >= 0);
alter table public.renders add column if not exists duration_ms bigint;
alter table public.renders add column if not exists width int;
alter table public.renders add column if not exists height int;
alter table public.renders add column if not exists expires_at timestamptz;
alter table public.renders add column if not exists error_code text;
alter table public.renders add column if not exists batch_id uuid;
alter table public.renders add column if not exists downloaded_at timestamptz;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'renders_ws_id_key') then
  alter table public.renders add constraint renders_ws_id_key unique (workspace_id, id); end if; end $$;
create table if not exists public.export_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  status text not null default 'queued' check (status in ('queued','running','partial','ready','failed','cancelled')),
  zip_requested boolean not null default false,
  zip_path text check (zip_path is null or zip_path like workspace_id::text || '/%'),
  zip_bytes bigint, zip_expires_at timestamptz, job_id uuid,
  created_at timestamptz not null default now(), unique (workspace_id, id));
do $$ begin if not exists (select 1 from pg_constraint where conname = 'renders_batch_fk') then
  alter table public.renders add constraint renders_batch_fk foreign key (workspace_id, batch_id)
    references public.export_batches(workspace_id, id) on delete set null (batch_id); end if; end $$;

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade, render_id uuid not null,
  platform text not null check (platform in ('youtube','tiktok')),
  title text not null check (char_length(title) between 1 and 100),
  description text check (description is null or char_length(description) <= 5000),
  privacy text not null default 'private' check (privacy in ('private','unlisted','public',
    'SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','PUBLIC_TO_EVERYONE')),
  external_id text,
  state text not null default 'queued' check (state in ('queued','uploading','processing','private_pending_review',
    'requiere_auditoria','published','scheduled','failed','cancelled')),
  scheduled_at timestamptz, error_code text, error_message text check (error_message is null or char_length(error_message) <= 500),
  job_id uuid, created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), foreign key (workspace_id, render_id) references public.renders(workspace_id, id));
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('drive','dropbox','link')), ref text not null check (char_length(ref) between 1 and 2048),
  state text not null default 'queued' check (state in ('queued','downloading','done','failed','cancelled')),
  source_id uuid, bytes bigint check (bytes is null or bytes >= 0), error_code text, job_id uuid,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), unique (workspace_id, id));
-- TikTok como proveedor OAuth (publicación): se amplía la CHECK y se recrea oauth_save con la misma lógica que en 029.
alter table public.oauth_connections drop constraint if exists oauth_connections_provider_check;
alter table public.oauth_connections add constraint oauth_connections_provider_check check (provider in ('google','dropbox','tiktok'));
create or replace function public.oauth_save(p_provider text, p_label text, p_scopes text[], p_access text, p_refresh text, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace();
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if p_provider not in ('google','dropbox','tiktok') or p_access is null or char_length(p_access) < 10 then raise exception 'invalid_connection'; end if;
  insert into public.oauth_connections(workspace_id, provider, account_label, scopes, access_token, refresh_token, expires_at, status, last_error, last_checked_at, created_by)
  values (ws, p_provider, left(p_label, 200), coalesce(p_scopes, '{}'), p_access, p_refresh, p_expires_at, 'connected', null, now(), auth.uid())
  on conflict (workspace_id, provider) do update set account_label = excluded.account_label, scopes = excluded.scopes, access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, public.oauth_connections.refresh_token), expires_at = excluded.expires_at, status = 'connected', last_error = null, last_checked_at = now(), updated_at = now(), created_by = excluded.created_by;
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'oauth.connect', jsonb_build_object('provider', p_provider, 'scopes', p_scopes));
  return jsonb_build_object('provider', p_provider, 'account_label', left(p_label, 200), 'status', 'connected');
end $$;

do $$ declare t text; begin
  foreach t in array array['analyses','transcript_revisions','generation_recipes','clip_collections','clip_drafts',
                           'export_batches','publications','imports'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select on public.%1$s to authenticated', t);
  end loop;
  foreach t in array array['generation_recipes','clip_collections'] loop
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.can_edit(workspace_id) and created_by = auth.uid())', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.can_edit(workspace_id))', t);
    execute format('grant insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

create or replace function public.save_clip_version(p_clip uuid, p_base_version int, p_aspect text, p_layout text,
  p_template text, p_spec jsonb, p_user_edit boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v int;
begin
  select id, workspace_id, current_version into c from public.clips where id = p_clip for update;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.current_version <> p_base_version then return jsonb_build_object('conflict', true, 'current_version', c.current_version); end if;
  v := c.current_version + 1;
  insert into public.clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template, created_by)
    values (p_clip, c.workspace_id, v, p_spec, p_aspect, p_layout, p_template, auth.uid());
  update public.clips set current_version = v, user_edited = (user_edited or p_user_edit) where id = p_clip;
  delete from public.clip_drafts where clip_id = p_clip;
  return jsonb_build_object('version', v);
end $$;

create or replace function public.save_clip_draft(p_clip uuid, p_base_version int, p_spec jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare c record; ts timestamptz := now();
begin
  select id, workspace_id into c from public.clips where id = p_clip;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.clip_drafts(clip_id, workspace_id, base_version, spec, updated_by, updated_at)
    values (p_clip, c.workspace_id, p_base_version, p_spec, auth.uid(), ts)
  on conflict (clip_id) do update set base_version = excluded.base_version, spec = excluded.spec,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return ts;
end $$;

create or replace function public.apply_transcript_revision(p_transcript uuid, p_words jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; r int; ids uuid[];
begin
  select id, workspace_id into t from public.transcripts where id = p_transcript;
  if not found or not public.can_edit(t.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_words) <> 'array' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(p_transcript::text));
  select coalesce(max(revision), 1) + 1 into r from public.transcript_revisions where transcript_id = p_transcript;
  insert into public.transcript_revisions(workspace_id, transcript_id, revision, words, edited_by)
    values (t.workspace_id, p_transcript, r, p_words, auth.uid());
  update public.analyses set transcript_revision = r where transcript_id = p_transcript;
  select coalesce(array_agg(c.id), '{}') into ids from public.clips c join public.generations g on g.id = c.generation_id
   where g.transcript_id = p_transcript and c.user_edited = false;
  return jsonb_build_object('revision', r, 'follow_clips', to_jsonb(ids));
end $$;

create or replace function public.set_editorial_state(p_clip uuid, p_state text) returns text
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
       and m.role in ('owner','admin','editor','reviewer')) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_state not in ('pendiente','en_revision','aprobado','descartado') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  update public.clips set editorial_state = p_state where id = p_clip;
  return p_state;
end $$;
revoke all on function public.save_clip_version(uuid,int,text,text,text,jsonb,boolean), public.save_clip_draft(uuid,int,jsonb),
  public.apply_transcript_revision(uuid,jsonb), public.set_editorial_state(uuid,text) from public, anon;
grant execute on function public.save_clip_version(uuid,int,text,text,text,jsonb,boolean), public.save_clip_draft(uuid,int,jsonb),
  public.apply_transcript_revision(uuid,jsonb), public.set_editorial_state(uuid,text) to authenticated;
