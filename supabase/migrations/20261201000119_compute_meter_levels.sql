-- E1 / B-01: el medidor de cómputo solo sumaba las etapas (ai_usage) y no el coste fijo de las funciones desplegadas, así que marcaba 4 % cuando Modal estaba al 100 %.
--  1) Nueva clave `compute_fixed_usd` (la escribe el propietario con la cifra real de «Deployed apps» del panel de Modal; por defecto 0). Se suma al gasto de etapas.
--  2) compute_meter() devuelve además stage_usd, fixed_usd y `level` ('ok' | 'warn' al 70 % | 'blocked' al 90 %). Los campos existentes no cambian (aditivo).
-- Impacto: ninguno sobre datos de usuario; con compute_fixed_usd = 0 el comportamiento de bloqueo es idéntico al anterior.
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.platform_settings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%compute_budget_usd%';
  if c is not null then execute format('alter table public.platform_settings drop constraint %I', c); end if;
  alter table public.platform_settings add constraint platform_settings_key_check check (key in ('compute_budget_usd','modal_rate_card','compute_fixed_usd'));
end $$;
insert into public.platform_settings(key, value) values ('compute_fixed_usd', '0') on conflict (key) do nothing;

create or replace function public.compute_meter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare stage_usd numeric; fixed numeric; spent numeric; budget numeric; rate jsonb; has_rate boolean; lvl text;
begin
  select coalesce(sum(cost_usd), 0) into stage_usd from public.ai_usage
   where provider = 'modal' and kind = 'compute' and created_at >= date_trunc('month', now());
  select coalesce((value #>> '{}')::numeric, 0) into fixed from public.platform_settings where key = 'compute_fixed_usd';
  fixed := coalesce(fixed, 0);
  spent := stage_usd + fixed;
  select (value #>> '{}')::numeric into budget from public.platform_settings where key = 'compute_budget_usd';
  select value into rate from public.platform_settings where key = 'modal_rate_card';
  has_rate := rate is not null and jsonb_typeof(rate) = 'object';
  lvl := case when (not has_rate) or spent >= 0.9 * budget then 'blocked' when spent >= 0.7 * budget then 'warn' else 'ok' end;
  return jsonb_build_object('month_usd', round(spent, 4), 'stage_usd', round(stage_usd, 4), 'fixed_usd', round(fixed, 4), 'budget_usd', budget,
    'pct', case when budget > 0 then round(100 * spent / budget, 1) end, 'rate_card_set', has_rate, 'level', lvl,
    'blocked', lvl = 'blocked');
end $$;
