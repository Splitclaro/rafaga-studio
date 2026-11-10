-- H14/H06: tiempos reales de cola y de proceso por trabajo, y cola justa entre workspaces.
alter table public.jobs add column if not exists started_at timestamptz;   -- primera vez que un worker lo reclama
alter table public.jobs add column if not exists finished_at timestamptz;  -- llegó a done/failed/cancelled

create or replace function public.jobs_finished_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('done','failed','cancelled') and (old.status is distinct from new.status) then new.finished_at := now();
  elsif new.status not in ('done','failed','cancelled') then new.finished_at := null; end if;
  return new;
end $$;
drop trigger if exists jobs_finished_at on public.jobs;
create trigger jobs_finished_at before update of status on public.jobs for each row execute function public.jobs_finished_at();

-- Reclamación: prioridad live > render; después el workspace con menos trabajos en marcha (un cliente con un lote grande
-- no bloquea a los demás); después antigüedad.
create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now(),
         started_at = coalesce(j.started_at, now())
  where j.id = (
    select q.id from public.jobs q
    where q.kind in ('detect','render','lyrics','automation','live') and q.attempts < 3
      and (q.status = 'queued' or (q.status not in ('done','failed','cancelled') and q.heartbeat_at < now() - interval '15 minutes'))
    order by (q.kind = 'live') desc, (q.kind = 'render') desc,
      (select count(*) from public.jobs r where r.workspace_id = q.workspace_id and r.status not in ('queued','done','failed','cancelled')),
      q.created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
