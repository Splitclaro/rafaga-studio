-- Corrige la purga de la papelera: los objetos derivados (mezzanine, proxy, miniaturas, vistas previas) llevan source_id pero no project_id,
-- así que quedaban sin borrar al purgar un proyecto. Ahora también se purgan por el vídeo de origen del proyecto purgable. Misma firma, solo amplía la rama «trash».
create or replace function public.purge_candidates(p_limit int default 500) returns table(key text, bytes bigint, reason text)
language sql stable security definer set search_path = public as $$
  select o.key, o.bytes, 'original_replaced' from public.storage_objects o
   where o.purged_at is null and o.kind in ('original','original_part')
     and exists (select 1 from public.storage_objects m where m.source_id = o.source_id and m.kind = 'mezzanine' and m.purged_at is null)
  union all
  select o.key, o.bytes, 'expired' from public.storage_objects o
   where o.purged_at is null and o.kind in ('export','zip','sidecar') and o.expires_at < now()
  union all
  select o.key, o.bytes, 'trash' from public.storage_objects o join public.projects p on (p.id = o.project_id or (o.project_id is null and p.source_id = o.source_id))
   where o.purged_at is null and p.purge_at is not null and p.purge_at < now()
     and (o.project_id is not null or not exists (select 1 from public.projects q where q.source_id = p.source_id and q.deleted_at is null))
  limit p_limit $$;
