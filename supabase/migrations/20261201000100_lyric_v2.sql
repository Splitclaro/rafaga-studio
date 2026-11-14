-- Lyric Studio v2: esquema (paso 1). Aditiva. Impacto declarado: CHECK reescritas como superconjuntos exactos de las
-- vigentes (projects.mode, songs.mime, songs.storage_path, clip_versions.aspect, renders.kind, job_stages.stage,
-- storage_objects.kind); únicas (workspace_id, id) nuevas en text_styles y media_items (id ya es PK). Nada se borra.
-- El flujo v1 (request_lyrics, save_manual_alignment, run.ts) no cambia.
do $$ declare c record; begin
  for c in select conrelid::regclass::text as t, conname from pg_constraint where contype = 'c' and (
       (conrelid = 'public.projects'::regclass and pg_get_constraintdef(oid) like '%''broll''%')
    or (conrelid = 'public.songs'::regclass and (pg_get_constraintdef(oid) like '%audio/mpeg%' or pg_get_constraintdef(oid) like '%/songs/%'))
    or (conrelid = 'public.clip_versions'::regclass and pg_get_constraintdef(oid) like '%aspect%')
    or (conrelid = 'public.renders'::regclass and pg_get_constraintdef(oid) like '%''xmeml''%')
    or (conrelid = 'public.job_stages'::regclass and pg_get_constraintdef(oid) like '%''translate''%')
    or (conrelid = 'public.storage_objects'::regclass and pg_get_constraintdef(oid) like '%''stage_output''%'))
  loop execute format('alter table public.%I drop constraint %I', c.t, c.conname); end loop;
end $$;
alter table public.projects add constraint projects_mode_check check (mode in ('clips','captions','reframe','social','broll','lyrics'));
alter table public.clip_versions add constraint clip_versions_aspect_check check (aspect is null or aspect in ('9:16','16:9','1:1','4:5'));
alter table public.renders add constraint renders_kind_check check (kind in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl','lrc','lrc_word','ass'));
alter table public.job_stages add constraint job_stages_stage_check check (stage in ('validate','mezzanine','proxy','prepare','transcribe','scenes',
  'speakers','candidates','select','compose','previews','checks','render','zip','import','publish','translate','song_validate','lyric_sync','media_split'));
alter table public.storage_objects add constraint storage_objects_kind_check check (kind in ('original','original_part','mezzanine','proxy','audio',
  'thumb','preview','export','zip','sidecar','stage_output','media'));

alter table public.songs add column if not exists source_id uuid;
alter table public.songs add column if not exists status text not null default 'ready' check (status in ('pending','ready','failed'));
alter table public.songs add column if not exists duration_ms bigint check (duration_ms is null or duration_ms between 0 and 600000);
alter table public.songs add column if not exists sample_rate int check (sample_rate is null or sample_rate between 8000 and 192000);
alter table public.songs add column if not exists channels int check (channels is null or channels between 1 and 8);
alter table public.songs add column if not exists loudness_lufs numeric(6,2);
alter table public.songs add column if not exists codec text check (codec is null or char_length(codec) <= 40);
alter table public.songs add column if not exists error_code text;
alter table public.songs add column if not exists demo boolean not null default false;
alter table public.songs add constraint songs_mime_check check (mime in ('audio/mpeg','audio/wav','audio/x-wav','audio/wave')
  or (source_id is not null and mime in ('audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/ogg')));
alter table public.songs add constraint songs_storage_path_check check (storage_path like workspace_id::text || '/songs/%'
  or (source_id is not null and storage_path like workspace_id::text || '/%'));
alter table public.songs add constraint songs_v2_bytes_check check (source_id is null or bytes <= 62914560);
do $$ begin if not exists (select 1 from pg_constraint where conname = 'songs_source_fk') then
  alter table public.songs add constraint songs_source_fk foreign key (workspace_id, source_id) references public.sources(workspace_id, id); end if; end $$;
create unique index if not exists songs_source_uidx on public.songs(source_id) where source_id is not null;

alter table public.song_alignments add column if not exists revision int check (revision is null or revision >= 1);
alter table public.song_alignments add column if not exists kind text not null default 'legacy' check (kind in ('legacy','asr','aligned','proposal','manual'));
alter table public.song_alignments add column if not exists lyrics_text text check (lyrics_text is null or char_length(lyrics_text) <= 20000);
alter table public.song_alignments add column if not exists flags jsonb not null default '[]' check (jsonb_typeof(flags) = 'array');
alter table public.song_alignments add column if not exists created_by uuid;
create unique index if not exists song_alignments_revision_idx on public.song_alignments(song_id, revision) where revision is not null;

alter table public.media_collections add column if not exists purpose text not null default 'backgrounds' check (purpose in ('backgrounds','artwork'));
alter table public.media_collections add column if not exists official boolean not null default false;
alter table public.media_collections add column if not exists mood text check (mood is null or char_length(mood) <= 40);
alter table public.media_items add column if not exists storage_backend text not null default 'supabase' check (storage_backend in ('supabase','r2'));
alter table public.media_items add column if not exists status text not null default 'ready' check (status in ('pending','ready','failed','excluded'));
alter table public.media_items add column if not exists duration_ms bigint check (duration_ms is null or duration_ms between 0 and 3600000);
alter table public.media_items add column if not exists width int check (width is null or width between 16 and 8192);
alter table public.media_items add column if not exists height int check (height is null or height between 16 and 8192);
alter table public.media_items add column if not exists category text check (category is null or category in
  ('ciudad','naturaleza','carretera','lluvia','nostalgia_analogica','abstracto'));
alter table public.media_items add column if not exists motion text check (motion is null or motion in ('estatico','lento','rapido'));
alter table public.media_items add column if not exists mood text check (mood is null or char_length(mood) <= 40);
alter table public.media_items add column if not exists source_id uuid;
alter table public.media_items add column if not exists segment_start_ms bigint;
alter table public.media_items add column if not exists segment_end_ms bigint;
alter table public.media_items add column if not exists cut_mode text check (cut_mode is null or cut_mode in ('rapido','exacto'));
alter table public.media_items add column if not exists audio_muted boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'media_items_ws_id_key') then
    alter table public.media_items add constraint media_items_ws_id_key unique (workspace_id, id); end if;
  if not exists (select 1 from pg_constraint where conname = 'text_styles_ws_id_key') then
    alter table public.text_styles add constraint text_styles_ws_id_key unique (workspace_id, id); end if;
end $$;

create table if not exists public.hook_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  hooks text[] not null check (cardinality(hooks) between 1 and 200),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));

create table if not exists public.lyric_projects (
  project_id uuid primary key, workspace_id uuid not null, song_id uuid not null,
  mode text not null default 'letra' check (mode in ('letra','texto','portada')),
  range_start_ms bigint not null default 0 check (range_start_ms >= 0),
  range_end_ms bigint check (range_end_ms is null or range_end_ms > range_start_ms),
  alignment_revision int check (alignment_revision is null or alignment_revision >= 1),
  aspect text not null default '9:16' check (aspect in ('9:16','4:5','1:1','16:9')),
  res int not null default 1080 check (res in (720, 1080)),
  style jsonb check (style is null or pg_column_size(style) < 4096), style_id uuid,
  preset text check (preset is null or preset ~ '^[a-z_]{1,40}$'),
  background jsonb not null default '{}' check (jsonb_typeof(background) = 'object' and pg_column_size(background) < 8192),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 4096),
  collection_ids uuid[] not null default '{}' check (cardinality(collection_ids) <= 10),
  hook_pack_id uuid, hook jsonb, message jsonb, cover jsonb, artwork_front_id uuid, artwork_back_id uuid,
  locks jsonb not null default '{}' check (jsonb_typeof(locks) = 'object'),
  updated_at timestamptz not null default now(), unique (workspace_id, project_id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, song_id) references public.songs(workspace_id, id),
  foreign key (workspace_id, style_id) references public.text_styles(workspace_id, id) on delete set null (style_id),
  foreign key (workspace_id, hook_pack_id) references public.hook_packs(workspace_id, id) on delete set null (hook_pack_id),
  foreign key (workspace_id, artwork_front_id) references public.media_items(workspace_id, id) on delete set null (artwork_front_id),
  foreign key (workspace_id, artwork_back_id) references public.media_items(workspace_id, id) on delete set null (artwork_back_id));

do $$ declare t text; begin
  foreach t in array array['hook_packs','lyric_projects'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('revoke all on public.%1$s from anon, authenticated', t);
    execute format('grant select on public.%1$s to authenticated', t);
  end loop;
end $$;

-- Estilos v2 (rafagaStyle = 2): ≤ 20 por workspace, JSON ≤ 4000 bytes. Los estilos v1 no cuentan ni cambian.
create or replace function public.save_caption_style(p_ws uuid, p_id uuid, p_name text, p_style jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare n int; sid uuid;
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_style) is distinct from 'object' or coalesce(p_style->>'rafagaStyle', '') <> '2' then raise exception 'invalid_style' using errcode = 'P0001'; end if;
  if octet_length(p_style::text) > 4000 then raise exception 'style_too_large' using errcode = 'P0001', detail = '{"limit":4000}'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"name"}'; end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('styles:' || p_ws));
    select count(*) into n from public.text_styles where workspace_id = p_ws and style->>'rafagaStyle' = '2';
    if n >= 20 then raise exception 'style_limit' using errcode = 'P0001', detail = '{"limit":20}'; end if;
    insert into public.text_styles(workspace_id, name, style, created_by) values (p_ws, btrim(p_name), p_style, auth.uid()) returning id into sid;
  else
    update public.text_styles set name = btrim(p_name), style = p_style where id = p_id and workspace_id = p_ws returning id into sid;
    if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return sid;
end $$;
create or replace function public.delete_caption_style(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.text_styles where id = p_id and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.save_hook_pack(p_ws uuid, p_id uuid, p_name text, p_hooks text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; h text; clean text[] := '{}';
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  foreach h in array coalesce(p_hooks, '{}') loop
    if char_length(btrim(h)) not between 1 and 120 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"hooks"}'; end if;
    clean := clean || btrim(h);
  end loop;
  if cardinality(clean) not between 1 and 200 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"hooks"}'; end if;
  if p_id is null then
    insert into public.hook_packs(workspace_id, name, hooks) values (p_ws, btrim(p_name), clean) returning id into hid;
  else
    update public.hook_packs set name = btrim(p_name), hooks = clean, updated_at = now() where id = p_id and workspace_id = p_ws returning id into hid;
    if hid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return hid;
end $$;

-- Pieza nueva sobre una canción v2: proyecto (mode = lyrics, misma fuente) + su fila de letra.
create or replace function public.create_lyric_project(p_song uuid, p_mode text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; pid uuid;
begin
  select id, workspace_id, source_id, title into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.source_id is null then raise exception 'legacy_song' using errcode = 'P0001'; end if;
  if p_mode is null or p_mode not in ('letra','texto','portada') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  insert into public.projects(workspace_id, source_id, name, mode, created_by)
    values (s.workspace_id, s.source_id, left(coalesce(nullif(btrim(p_name), ''), s.title), 120), 'lyrics', auth.uid()) returning id into pid;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (pid, s.workspace_id, p_song, p_mode);
  return pid;
end $$;

-- Parche de la pieza. Cambiar de modo nunca borra letra, alineación ni recursos.
create or replace function public.save_lyric_project(p_project uuid, p_patch jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare lp record; k text; ts timestamptz;
begin
  select * into lp from public.lyric_projects where project_id = p_project;
  if not found or not public.can_edit(lp.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"patch"}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('mode','range_start_ms','range_end_ms','alignment_revision','aspect','res','style','style_id','preset','background','settings',
                 'collection_ids','hook_pack_id','hook','message','cover','artwork_front_id','artwork_back_id','locks') then
      raise exception 'invalid_params' using errcode = 'P0001', detail = json_build_object('field', k)::text; end if;
  end loop;
  if p_patch ? 'mode' and coalesce(p_patch->>'mode', '') not in ('letra','texto','portada') then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  update public.lyric_projects set
    mode = case when p_patch ? 'mode' then p_patch->>'mode' else mode end,
    range_start_ms = case when p_patch ? 'range_start_ms' then (p_patch->>'range_start_ms')::bigint else range_start_ms end,
    range_end_ms = case when p_patch ? 'range_end_ms' then (p_patch->>'range_end_ms')::bigint else range_end_ms end,
    alignment_revision = case when p_patch ? 'alignment_revision' then (p_patch->>'alignment_revision')::int else alignment_revision end,
    aspect = case when p_patch ? 'aspect' then p_patch->>'aspect' else aspect end,
    res = case when p_patch ? 'res' then (p_patch->>'res')::int else res end,
    style = case when p_patch ? 'style' then p_patch->'style' else style end,
    style_id = case when p_patch ? 'style_id' then (p_patch->>'style_id')::uuid else style_id end,
    preset = case when p_patch ? 'preset' then p_patch->>'preset' else preset end,
    background = case when p_patch ? 'background' then p_patch->'background' else background end,
    settings = case when p_patch ? 'settings' then p_patch->'settings' else settings end,
    collection_ids = case when p_patch ? 'collection_ids' then array(select jsonb_array_elements_text(p_patch->'collection_ids'))::uuid[] else collection_ids end,
    hook_pack_id = case when p_patch ? 'hook_pack_id' then (p_patch->>'hook_pack_id')::uuid else hook_pack_id end,
    hook = case when p_patch ? 'hook' then p_patch->'hook' else hook end,
    message = case when p_patch ? 'message' then p_patch->'message' else message end,
    cover = case when p_patch ? 'cover' then p_patch->'cover' else cover end,
    artwork_front_id = case when p_patch ? 'artwork_front_id' then (p_patch->>'artwork_front_id')::uuid else artwork_front_id end,
    artwork_back_id = case when p_patch ? 'artwork_back_id' then (p_patch->>'artwork_back_id')::uuid else artwork_back_id end,
    locks = case when p_patch ? 'locks' then p_patch->'locks' else locks end,
    updated_at = now()
  where project_id = p_project returning updated_at into ts;
  return ts;
end $$;

create or replace function public.create_media_collection(p_ws uuid, p_name text, p_purpose text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_purpose, '') not in ('backgrounds','artwork') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"purpose"}'; end if;
  insert into public.media_collections(workspace_id, name, created_by, purpose) values (p_ws, btrim(p_name), auth.uid(), p_purpose) returning id into cid;
  return cid;
end $$;
-- «Colecciones Ráfaga» = paquetes que el propietario marca como oficiales (el catálogo sale vacío).
create or replace function public.set_collection_official(p_collection uuid, p_official boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.media_collections set official = coalesce(p_official, false) where id = p_collection and public.can_admin(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
create or replace function public.classify_media_item(p_item uuid, p_category text, p_motion text, p_mood text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status is not null and p_status not in ('ready','excluded') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"status"}'; end if;
  update public.media_items set category = p_category, motion = p_motion, mood = nullif(btrim(p_mood), ''), status = coalesce(p_status, status)
   where id = p_item and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.save_caption_style(uuid,uuid,text,jsonb), public.delete_caption_style(uuid), public.save_hook_pack(uuid,uuid,text,text[]),
  public.create_lyric_project(uuid,text,text), public.save_lyric_project(uuid,jsonb), public.create_media_collection(uuid,text,text),
  public.set_collection_official(uuid,boolean), public.classify_media_item(uuid,text,text,text,text) from public, anon;
grant execute on function public.save_caption_style(uuid,uuid,text,jsonb), public.delete_caption_style(uuid), public.save_hook_pack(uuid,uuid,text,text[]),
  public.create_lyric_project(uuid,text,text), public.save_lyric_project(uuid,jsonb), public.create_media_collection(uuid,text,text),
  public.set_collection_official(uuid,boolean), public.classify_media_item(uuid,text,text,text,text) to authenticated;
