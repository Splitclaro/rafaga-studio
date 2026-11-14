-- Descarga del ZIP de un lote de exportaciones. Aditiva: una función nueva (cliente). Sin cambios de tablas.
create or replace function public.batch_zip_object(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  select id, workspace_id, status, zip_path, zip_expires_at into b from public.export_batches where id = p_batch;
  if not found or not public.is_member(b.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', b.zip_path, 'status', b.status, 'expired', coalesce(b.zip_expires_at < now(), false));
end $$;
revoke all on function public.batch_zip_object(uuid) from public, anon;
grant execute on function public.batch_zip_object(uuid) to authenticated;
