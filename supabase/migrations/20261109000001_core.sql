-- Ráfaga Studio — esquema base (fase C). Idempotente donde es razonable.
-- Cada recurso privado pertenece a un workspace; las FK compuestas (workspace_id, id)
-- impiden relacionar recursos de workspaces distintos.

-- ───────── Perfiles y workspaces ─────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'es' check (locale in ('es','en')),
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

-- Un único workspace "personal" por usuario creado en signup (idempotente).
create unique index if not exists workspaces_one_per_creator on public.workspaces(created_by);

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.profiles(id, display_name) values (new.id, split_part(coalesce(new.email,''),'@',1))
    on conflict (id) do nothing;
  insert into public.workspaces(name, created_by) values ('Mi espacio', new.id)
    on conflict (created_by) do nothing returning id into ws;
  if ws is not null then
    insert into public.workspace_members(workspace_id, user_id, role) values (ws, new.id, 'owner')
      on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Fuentes, proyectos, generaciones ─────────
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('upload','url','live','feed')),
  storage_path text,
  status text not null default 'pending' check (status in ('pending','uploaded','validated','failed','expired','deleted')),
  mime text, bytes bigint check (bytes is null or bytes >= 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  width int, height int, has_audio boolean,
  sha256 text,
  range_start_ms bigint, range_end_ms bigint,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (range_start_ms is null or range_end_ms is null or range_end_ms > range_start_ms)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null,
  name text not null,
  project_brief text check (project_brief is null or char_length(project_brief) <= 2000),
  language text not null default 'auto' check (language in ('auto','es','en')),
  clip_count int not null default 5 check (clip_count between 3 and 10),
  target_seconds int not null default 45 check (target_seconds between 15 and 60),
  max_seconds int not null default 90 check (max_seconds between 15 and 90),
  deleted_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id)
);
create index if not exists projects_ws_idx on public.projects(workspace_id, created_at desc);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_id uuid not null,
  language text,
  words jsonb not null,                -- [{text,start,end,speaker?}] tiempos globales de la fuente (s)
  asr_provider text, asr_model text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id) on delete cascade
);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  transcript_id uuid not null,
  brief_snapshot text,                 -- inmutable
  brief_sha256 text,
  rubric_version text not null,
  model text not null,
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, transcript_id) references public.transcripts(workspace_id, id)
);

create table if not exists public.clip_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  generation_id uuid not null,
  start_ms bigint not null, end_ms bigint not null,
  title text not null, reason text, brief_fit text,
  scores jsonb not null,               -- {relevance,hook,standalone,closure,diversity} estimación editorial
  created_at timestamptz not null default now(),
  check (end_ms > start_ms),
  unique (workspace_id, id),
  foreign key (workspace_id, generation_id) references public.generations(workspace_id, id) on delete cascade
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  generation_id uuid not null,
  candidate_id uuid,
  title text not null,
  favorite boolean not null default false,
  discarded boolean not null default false,
  current_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, generation_id) references public.generations(workspace_id, id),
  foreign key (workspace_id, candidate_id) references public.clip_candidates(workspace_id, id)
);

create table if not exists public.clip_versions (
  clip_id uuid not null,
  workspace_id uuid not null,
  version int not null check (version >= 1),
  composition jsonb not null,          -- spec única para preview y export
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (clip_id, version),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('ingest','transcribe','detect','render','live','automation')),
  status text not null default 'queued' check (status in ('queued','validating','extracting','transcribing','selecting','tracking','rendering','done','failed','cancelled')),
  idempotency_key text not null,
  project_id uuid, generation_id uuid, clip_id uuid,
  attempts int not null default 0,
  error_code text, error_message text,
  metrics jsonb not null default '{}',  -- queue_ms, asr_ms, selection_ms, first_clip_ms, ...
  heartbeat_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id)
);

create table if not exists public.renders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  clip_id uuid not null,
  clip_version int not null,
  ratio text not null check (ratio in ('9:16','1:1','16:9')),
  burn_subtitles boolean not null default true,
  spec_sha256 text not null,
  storage_path text,
  status text not null default 'queued' check (status in ('queued','rendering','ready','failed','cancelled')),
  probe jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256),  -- solicitud idéntica reutiliza
  foreign key (clip_id, clip_version) references public.clip_versions(clip_id, version),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade
);

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid,
  kind text not null check (kind in ('reserve','consume','release')),
  input_seconds int not null check (input_seconds >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table if not exists public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  logo_path text,
  colors jsonb not null default '{}',
  subtitle_style jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null, body text not null, read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.outbox (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic text not null, payload jsonb not null,
  dispatched_at timestamptz,
  created_at timestamptz not null default now()
);

-- ───────── RLS ─────────
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.sources enable row level security;
alter table public.projects enable row level security;
alter table public.transcripts enable row level security;
alter table public.generations enable row level security;
alter table public.clip_candidates enable row level security;
alter table public.clips enable row level security;
alter table public.clip_versions enable row level security;
alter table public.jobs enable row level security;
alter table public.renders enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.brand_kits enable row level security;
alter table public.notifications enable row level security;
alter table public.outbox enable row level security;

-- Perfil: solo el propio; no puede cambiar id.
create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy ws_select on public.workspaces for select using (public.is_member(id));
create policy ws_update on public.workspaces for update using (public.is_member(id)) with check (public.is_member(id));
-- Membresías: lectura para miembros; sin escritura desde cliente (roles no autootorgables).
create policy wm_select on public.workspace_members for select using (public.is_member(workspace_id));

-- Lectura por miembros en tablas de recursos.
do $$
declare t text;
begin
  foreach t in array array['sources','projects','transcripts','generations','clip_candidates','clips','clip_versions','jobs','renders','usage_ledger','brand_kits','notifications'] loop
    execute format('create policy %I on public.%I for select using (public.is_member(workspace_id))', t||'_select', t);
  end loop;
end $$;

-- Escritura de cliente solo donde el usuario edita de verdad; jobs/ledger/renders/outbox: solo servidor (service_role).
create policy projects_insert on public.projects for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy projects_update on public.projects for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy sources_insert on public.sources for insert with check (public.is_member(workspace_id) and created_by = auth.uid() and status = 'pending');
create policy clips_update on public.clips for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy brand_kits_write on public.brand_kits for all using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy notifications_update on public.notifications for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
-- clip_versions: insertar versión nueva (inmutables; sin update/delete).
create policy clip_versions_insert on public.clip_versions for insert with check (public.is_member(workspace_id) and created_by = auth.uid());

-- Los privilegios de columna sensibles se cierran: el cliente no toca role/status privilegiados.
revoke update on public.sources from anon, authenticated;
revoke update on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.jobs, public.renders, public.usage_ledger, public.outbox, public.transcripts, public.generations, public.clip_candidates from anon, authenticated;
revoke select on public.outbox from anon, authenticated;
revoke update on public.workspaces from anon, authenticated;
grant update (name) on public.workspaces to authenticated;
grant update (name, project_brief, language, clip_count, target_seconds, max_seconds, deleted_at) on public.projects to authenticated;
grant update (title, favorite, discarded, current_version) on public.clips to authenticated;

-- ───────── Storage: buckets privados con ruta workspace_id/... ─────────
insert into storage.buckets (id, name, public, file_size_limit) values
  ('originals','originals',false,null), ('proxies','proxies',false,null),
  ('renders','renders',false,null), ('brand-assets','brand-assets',false,5242880)
on conflict (id) do nothing;

create policy storage_members_read on storage.objects for select to authenticated
  using (bucket_id in ('originals','proxies','renders','brand-assets')
         and public.is_member(((storage.foldername(name))[1])::uuid));
create policy storage_members_upload on storage.objects for insert to authenticated
  with check (bucket_id in ('originals','brand-assets')
         and public.is_member(((storage.foldername(name))[1])::uuid));
create policy storage_members_delete on storage.objects for delete to authenticated
  using (bucket_id in ('originals','brand-assets')
         and public.is_member(((storage.foldername(name))[1])::uuid));
