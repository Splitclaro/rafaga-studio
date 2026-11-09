-- Petición de detección desde el cliente (sin escribir jobs directamente) + reclamo de jobs para el worker.

create or replace function public.request_detection(p_project uuid, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid;
begin
  if p_key is null or char_length(p_key) < 8 then raise exception 'invalid_key'; end if;
  select workspace_id into ws from public.projects where id = p_project and deleted_at is null;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  -- doble clic / reintento: si ya hay un job activo del proyecto, se devuelve ese
  select id into jid from public.jobs
    where workspace_id = ws and project_id = p_project and kind = 'detect' and status not in ('done','failed','cancelled')
    order by created_at desc limit 1;
  if jid is not null then return jid; end if;
  insert into public.jobs(workspace_id, kind, idempotency_key, project_id, created_by)
    values (ws, 'detect', 'detect:' || p_project || ':' || p_key, p_project, auth.uid())
    on conflict (workspace_id, idempotency_key) do update set updated_at = now()
    returning id into jid;
  return jid;
end $$;
revoke all on function public.request_detection(uuid, text) from public, anon;
grant execute on function public.request_detection(uuid, text) to authenticated;

-- Solo service_role: reclama el siguiente job en cola (skip locked) o uno atascado (heartbeat > 15 min).
create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now()
  where j.id = (
    select id from public.jobs
    where kind = 'detect' and attempts < 3
      and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'))
    order by created_at limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
