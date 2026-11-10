-- H06: programador independiente del navegador y del worker.
-- pg_cron (Supabase) ejecuta scheduler_tick() cada minuto: encola revisiones de automatizaciones, cierra jobs huérfanos
-- y, si hay trabajo pendiente sin worker vivo, lanza el worker de GitHub Actions con un token guardado en Vault.

create table if not exists public.worker_heartbeats (
  id text primary key,                       -- id del run del worker
  seen_at timestamptz not null default now(),
  info jsonb not null default '{}'
);
create table if not exists public.scheduler_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  enqueued int not null default 0,
  orphaned int not null default 0,
  pending int not null default 0,
  worker_alive boolean not null default false,
  dispatch text not null default 'skipped'   -- skipped | not_needed | not_configured | dispatched | error:…
);
alter table public.worker_heartbeats enable row level security;
alter table public.scheduler_runs enable row level security;
-- Estado operativo global (sin datos de clientes): lectura para usuarios autenticados, escritura solo servidor.
create policy worker_heartbeats_read on public.worker_heartbeats for select to authenticated using (true);
create policy scheduler_runs_read on public.scheduler_runs for select to authenticated using (true);
revoke insert, update, delete on public.worker_heartbeats, public.scheduler_runs from anon, authenticated;
grant select on public.worker_heartbeats, public.scheduler_runs to authenticated;

-- Lanza el worker. Separada para poder probar el resto sin pg_net/Vault (PGlite).
create or replace function public.scheduler_dispatch() returns text
language plpgsql security definer set search_path = public as $$
declare tok text; last timestamptz;
begin
  select max(ran_at) into last from public.scheduler_runs where dispatch = 'dispatched';
  if last is not null and last > now() - interval '4 minutes' then return 'recently_dispatched'; end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return 'not_configured'; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'gh_dispatch_token' limit 1$q$ into tok;
  if tok is null or tok = '' then return 'not_configured'; end if;
  execute $q$select net.http_post(
      url := 'https://api.github.com/repos/Splitclaro/rafaga-studio/actions/workflows/worker.yml/dispatches',
      body := '{"ref":"main"}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || $1, 'Accept', 'application/vnd.github+json',
                                    'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'rafaga-scheduler', 'Content-Type', 'application/json'))$q$ using tok;
  return 'dispatched';
exception when others then
  return 'error:' || left(sqlerrm, 120);
end $$;

create or replace function public.scheduler_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_enq int := 0; n_orph int := 0; n_pend int; alive boolean; d text := 'not_needed'; r record; jid uuid;
begin
  -- 1) Automatizaciones activas con revisión vencida (15 min) y sin revisión ya pendiente
  for r in
    select a.* from public.automation_rules a
    where a.active and (a.last_checked_at is null or a.last_checked_at < now() - interval '15 minutes')
      and not exists (select 1 from public.jobs j where j.kind = 'automation' and j.params->>'rule_id' = a.id::text
                      and j.status not in ('done','failed','cancelled'))
    limit 50
  loop
    insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params)
    values (r.workspace_id, 'automation', 'automation:' || r.id || ':sched:' || floor(extract(epoch from now()) / 900)::bigint, r.created_by,
            jsonb_build_object('rule_id', r.id, 'manual', false, 'scheduled', true))
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into jid;
    if jid is not null then n_enq := n_enq + 1; end if;
  end loop;
  -- 2) Huérfanos: sin latido 15 min y sin intentos restantes → fallo explícito (no quedan «procesando» para siempre)
  update public.jobs set status = 'failed', error_code = 'orphaned', updated_at = now(),
         error_message = 'El proceso se interrumpió 3 veces sin terminar. Tus archivos se conservan: vuelve a lanzarlo.'
  where status not in ('queued','done','failed','cancelled') and attempts >= 3
    and coalesce(heartbeat_at, updated_at) < now() - interval '15 minutes';
  get diagnostics n_orph = row_count;
  -- 3) ¿Hay trabajo reclamable y ningún worker vivo?
  select count(*) into n_pend from public.jobs
  where attempts < 3 and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'));
  select exists (select 1 from public.worker_heartbeats where seen_at > now() - interval '90 seconds') into alive;
  if n_pend > 0 and not alive then d := public.scheduler_dispatch(); end if;
  insert into public.scheduler_runs(enqueued, orphaned, pending, worker_alive, dispatch) values (n_enq, n_orph, n_pend, alive, d);
  delete from public.scheduler_runs where ran_at < now() - interval '3 days';
  delete from public.worker_heartbeats where seen_at < now() - interval '1 day';
  return jsonb_build_object('enqueued', n_enq, 'orphaned', n_orph, 'pending', n_pend, 'worker_alive', alive, 'dispatch', d);
end $$;
revoke all on function public.scheduler_tick(), public.scheduler_dispatch() from public, anon, authenticated;

-- Programación (solo si pg_cron está disponible: Supabase sí, PGlite no)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname = 'rafaga-scheduler';
    perform cron.schedule('rafaga-scheduler', '* * * * *', 'select public.scheduler_tick()');
  end if;
end $$;
