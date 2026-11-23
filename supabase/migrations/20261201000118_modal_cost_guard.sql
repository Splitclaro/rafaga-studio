-- Control del coste de Modal (plan Starter: 1 USD de crédito al mes, sin tarjeta). Aditiva.
--  1) El medidor interno asumía 30 USD; el crédito real del plan es 1 USD, así que no frenaba antes de que Modal cortara. Se fija el presupuesto real
--     (solo si el valor guardado es mayor: no pisa un valor menor que el propietario ya haya puesto). compute_meter() bloquea al 90 %.
--  2) El barrido frecuente (sweep_stale + enqueue_due_publications) pasa de un contenedor de Modal cada 3 minutos a pg_cron de Supabase (SQL puro, sin coste de Modal).
--  3) modal_wake(): despierta a Modal solo cuando hay etapas listas (y como máximo cada 90 s), con la URL y el secreto guardados en Vault. Sin ellos no hace nada
--     (/api/wake sigue despertando a Modal tras cada acción del usuario).
-- Impacto: ninguno sobre datos de usuario.
update public.platform_settings set value = '1' where key = 'compute_budget_usd' and (value #>> '{}')::numeric > 1;

create or replace function public.modal_wake() returns text
language plpgsql security definer set search_path = public as $$
declare p jsonb; url text; sec text; last timestamptz;
begin
  p := public.dispatch_plan();
  if coalesce((p->>'ready')::int, 0) + coalesce((p->>'legacy')::int, 0) = 0 then return 'not_needed'; end if;
  select max(ran_at) into last from public.scheduler_runs where dispatch = 'modal_woken';
  if last is not null and last > now() - interval '90 seconds' then return 'recently_woken'; end if;
  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return 'not_configured'; end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'modal_dispatch_url' limit 1$q$ into url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'modal_wake_secret' limit 1$q$ into sec;
  if coalesce(url, '') = '' or coalesce(sec, '') = '' then return 'not_configured'; end if;
  execute $q$select net.http_post(url := $1, body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'X-Rafaga-Wake', $2))$q$ using url, sec;
  insert into public.scheduler_runs(dispatch) values ('modal_woken');
  return 'modal_woken';
exception when others then
  return 'error:' || left(sqlerrm, 120);
end $$;

create or replace function public.cron_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; b int; w text;
begin
  a := public.sweep_stale(); b := public.enqueue_due_publications(); w := public.modal_wake();
  return jsonb_build_object('sweep', a, 'due_publications', b, 'wake', w);
end $$;
revoke all on function public.modal_wake(), public.cron_sweep() from public, anon, authenticated;
grant execute on function public.modal_wake(), public.cron_sweep() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname = 'rafaga-sweep';
    perform cron.schedule('rafaga-sweep', '* * * * *', 'select public.cron_sweep()');
  end if;
end $$;
