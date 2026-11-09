-- Custom Collections: colecciones de fondos (vídeo/foto) propias del workspace. No destructiva.
create table if not exists public.media_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, name),
  unique (workspace_id, id)
);
create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  collection_id uuid not null,
  kind text not null check (kind in ('video','photo')),
  name text not null,
  storage_path text not null check (storage_path like workspace_id::text || '/media/%'),
  mime text not null check (mime in ('video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp')),
  bytes bigint not null check (bytes > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, collection_id) references public.media_collections(workspace_id, id) on delete cascade
);
create index if not exists media_items_collection_idx on public.media_items(collection_id);
alter table public.media_collections enable row level security;
alter table public.media_items enable row level security;
create policy media_collections_select on public.media_collections for select using (public.is_member(workspace_id));
create policy media_collections_insert on public.media_collections for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy media_collections_update on public.media_collections for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy media_collections_delete on public.media_collections for delete using (public.is_member(workspace_id));
create policy media_items_select on public.media_items for select using (public.is_member(workspace_id));
create policy media_items_insert on public.media_items for insert with check (public.is_member(workspace_id) and created_by = auth.uid());
create policy media_items_delete on public.media_items for delete using (public.is_member(workspace_id));
revoke update on public.media_collections, public.media_items from anon, authenticated;
grant update (name) on public.media_collections to authenticated;
grant select, insert, delete on public.media_collections, public.media_items to authenticated;
grant update (name) on public.media_collections to authenticated;
