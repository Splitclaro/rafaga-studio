-- Vídeos grandes (aditiva).
--  · parts: el original se sube en trozos de ≤45 MB (`original.part000`…) para superar el límite de 50 MB por archivo del plan Free;
--    el worker los une byte a byte.
--  · clips.preview_path/preview_offset: vista previa del editor (tramo del clip ± 90 s, bucket privado `proxies`) que genera el worker,
--    porque el navegador no puede reproducir un original troceado.
alter table public.sources add column if not exists parts int not null default 0 check (parts between 0 and 400);
alter table public.clips add column if not exists preview_path text check (preview_path is null or preview_path like workspace_id::text || '/%');
alter table public.clips add column if not exists preview_offset real;
