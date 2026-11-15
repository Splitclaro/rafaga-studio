-- Eliminar proyecto del todo: marca la purga inmediata (el worker borra los archivos de R2 y luego las filas).
create or replace function public.delete_project_now(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.projects set deleted_at = coalesce(deleted_at, now()), purge_at = now() - interval '1 second'
   where id = p_project and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.delete_project_now(uuid) from public, anon;
grant execute on function public.delete_project_now(uuid) to authenticated, service_role;

-- Tras purgar los archivos, elimina las filas de proyectos en la papelera cuya purga ya venció (en cascada). Solo el worker.
create or replace function public.finalize_deleted_projects() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select p.id, p.source_id from public.projects p
     where p.purge_at is not null and p.purge_at < now()
       and not exists (select 1 from public.storage_objects o
                        where o.purged_at is null
                          and (o.project_id = p.id
                               or (o.project_id is null and o.source_id = p.source_id
                                   and not exists (select 1 from public.projects q where q.source_id = p.source_id and q.deleted_at is null))))
  loop
    begin
      delete from public.projects where id = r.id; n := n + 1;
    exception when others then null;   -- una referencia inesperada no debe frenar al resto
    end;
  end loop;
  return n;
end $$;
revoke all on function public.finalize_deleted_projects() from public, anon, authenticated;
grant execute on function public.finalize_deleted_projects() to service_role;
