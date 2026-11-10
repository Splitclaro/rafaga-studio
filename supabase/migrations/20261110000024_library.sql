-- Biblioteca única: una sola lista de todo lo que hay en el espacio activo (vídeos, imágenes, audio, logos, fuentes, exportaciones)
-- con la huella del contenido para detectar duplicados exactos. Solo lectura; no mueve ni cambia ningún archivo.
--
-- Huella: sha256 propio si existe (fuentes de proyecto); si no, la eTag que Storage guarda al subir (hash del contenido en
-- subidas simples; en subidas por partes es una huella distinta, así que un mismo archivo subido de dos formas puede no coincidir).
-- Los duplicados «posibles» (mismo nombre y tamaño sin huella común) los calcula la aplicación y se rotulan como posibles.

create or replace function public.library_assets() returns table (
  asset_key text, kind text, name text, bucket text, storage_path text, bytes bigint,
  fingerprint text, fingerprint_kind text, container text, ref_table text, ref_id uuid, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with a as (
    select 'media_items:' || mi.id as asset_key, case when mi.kind = 'photo' then 'image' else 'video' end as kind, mi.name,
           'originals'::text as bucket, mi.storage_path, mi.bytes, null::text as sha, mc.name as container,
           'media_items'::text as ref_table, mi.id as ref_id, mi.created_at
      from public.media_items mi join public.media_collections mc on mc.workspace_id = mi.workspace_id and mc.id = mi.collection_id
     where public.is_member(mi.workspace_id)
    union all
    select 'songs:' || s.id, 'audio', s.title || coalesce(' · ' || s.artist, ''), 'originals', s.storage_path, s.bytes, null, null, 'songs', s.id, s.created_at
      from public.songs s where public.is_member(s.workspace_id)
    union all
    select 'workspace_fonts:' || f.id, 'font', f.family, 'brand-assets', f.storage_path, f.bytes, null, null, 'workspace_fonts', f.id, f.created_at
      from public.workspace_fonts f where public.is_member(f.workspace_id)
    union all
    select 'brand_kits:' || k.id, 'logo', 'Logo de ' || k.name, 'brand-assets', k.logo_path, null, null, k.name, 'brand_kits', k.id, coalesce(k.updated_at, k.created_at)
      from public.brand_kits k where k.logo_path is not null and k.archived_at is null and public.is_member(k.workspace_id)
    union all
    select 'sources:' || sr.id, 'video', p.name, 'originals', sr.storage_path, sr.bytes, sr.sha256, 'Proyecto', 'sources', sr.id, sr.created_at
      from public.sources sr join public.projects p on p.workspace_id = sr.workspace_id and p.source_id = sr.id
     where sr.storage_path is not null and sr.status in ('uploaded','validated') and p.deleted_at is null and public.is_member(sr.workspace_id)
    union all
    select 'lyric_videos:' || lv.id, 'export', coalesce(so.title, 'Canción') || ' · #' || lv.variant, 'renders', lv.storage_path,
           nullif(lv.probe->'format'->>'size', '')::bigint, null, 'Lyric Studio', 'lyric_videos', lv.id, lv.created_at
      from public.lyric_videos lv left join public.songs so on so.id = lv.song_id
     where lv.status = 'ready' and lv.storage_path is not null and public.is_member(lv.workspace_id)
    union all
    select 'renders:' || r.id, 'export', c.title || ' · ' || r.ratio, 'renders', r.storage_path,
           nullif(r.probe->'format'->>'size', '')::bigint, null, 'Clips', 'renders', r.id, r.created_at
      from public.renders r join public.clips c on c.workspace_id = r.workspace_id and c.id = r.clip_id
     where r.status = 'ready' and r.storage_path is not null and public.is_member(r.workspace_id)
  )
  select a.asset_key, a.kind, a.name, a.bucket, a.storage_path,
         coalesce(a.bytes, nullif(o.metadata->>'size', '')::bigint),
         coalesce(a.sha, nullif(o.metadata->>'eTag', '')),
         case when a.sha is not null then 'sha256' when o.metadata->>'eTag' is not null then 'etag' else null end,
         a.container, a.ref_table, a.ref_id, a.created_at
    from a left join storage.objects o on o.bucket_id = a.bucket and o.name = a.storage_path
   order by a.created_at desc
   limit 5000;
$$;
revoke all on function public.library_assets() from public, anon;
grant execute on function public.library_assets() to authenticated;
