-- Coste y límites de IA: registro de consumo por trabajo (incluido el nivel gratuito, a tarifa de pago equivalente) y límites por espacio.
-- Solo el worker (clave de servicio) escribe consumo. Los responsables (owner/admin) ven costes y editan límites dentro de topes duros.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid, job_id uuid,
  kind text not null check (kind in ('stt','llm','vision','render','storage','transfer')),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 120),
  units jsonb not null default '{}',                       -- {seconds}|{tokens_in,tokens_out}|{frames,…}|{ms}|{bytes}
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),     -- a tarifa de pago, aunque se haya usado el nivel gratuito
  billed_usd numeric(12,6) not null default 0 check (billed_usd >= 0), -- lo realmente cobrado (0 en nivel gratuito)
  measured boolean not null default true,                  -- false = estimado
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_ws_idx on public.ai_usage(workspace_id, created_at desc);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_admin_read on public.ai_usage;
create policy ai_usage_admin_read on public.ai_usage for select to authenticated using (public.can_admin(workspace_id));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

create table if not exists public.workspace_ai_limits (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  limits jsonb not null default '{}',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.workspace_ai_limits enable row level security;
drop policy if exists ai_limits_read on public.workspace_ai_limits;
create policy ai_limits_read on public.workspace_ai_limits for select to authenticated using (public.is_member(workspace_id));
revoke all on public.workspace_ai_limits from anon, authenticated;
grant select on public.workspace_ai_limits to authenticated;

-- Límites por defecto de la beta y topes duros (iguales a los del código: packages/providers/src/cost.ts)
create or replace function public.ai_limit_defaults() returns jsonb language sql immutable as $$
  select '{"weekly_source_minutes":120,"batch_clips":10,"active_jobs":1,"live_minutes":60,"monthly_budget_usd":20,"warn_at":0.8,"extra_variants_week":30,"extra_languages_week":6}'::jsonb $$;
create or replace function public.ai_limit_caps() returns jsonb language sql immutable as $$
  select '{"weekly_source_minutes":3000,"batch_clips":50,"active_jobs":5,"live_minutes":240,"monthly_budget_usd":5000,"warn_at":1,"extra_variants_week":500,"extra_languages_week":50}'::jsonb $$;

create or replace function public.set_ai_limits(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); k text; v numeric; cur jsonb; caps jsonb := public.ai_limit_caps(); defs jsonb := public.ai_limit_defaults();
begin
  if ws is null or not public.can_admin(ws) then raise exception 'not_found'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'invalid_limits'; end if;
  select coalesce(limits, '{}') into cur from public.workspace_ai_limits where workspace_id = ws;
  cur := coalesce(cur, '{}');
  for k in select jsonb_object_keys(p) loop
    if not (defs ? k) then raise exception 'unknown_limit: %', k; end if;
    begin v := (p->>k)::numeric; exception when others then raise exception 'invalid_limit: %', k; end;
    if v < 0 or v > (caps->>k)::numeric then raise exception 'limit_out_of_range: %', k; end if;
    cur := cur || jsonb_build_object(k, v);
  end loop;
  insert into public.workspace_ai_limits(workspace_id, limits, updated_by) values (ws, cur, auth.uid())
    on conflict (workspace_id) do update set limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_events(workspace_id, actor, action, detail) values (ws, auth.uid(), 'ai.limits', p);
  return defs || cur;
end $$;

create or replace function public.ai_usage_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ws uuid := public.current_workspace(); lim jsonb; wk numeric; adm boolean; res jsonb;
begin
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  adm := public.can_admin(ws);
  select public.ai_limit_defaults() || coalesce((select limits from public.workspace_ai_limits where workspace_id = ws), '{}') into lim;
  select coalesce(sum((units->>'seconds')::numeric), 0) / 60 into wk from public.ai_usage where workspace_id = ws and kind = 'stt' and created_at > now() - interval '7 days';
  res := jsonb_build_object('week_source_minutes', round(wk, 1), 'limits', lim, 'can_edit_limits', adm);
  if adm then
    res := res || jsonb_build_object(
      'month_cost_usd', (select coalesce(sum(cost_usd), 0) from public.ai_usage where workspace_id = ws and created_at >= date_trunc('month', now())),
      'month_billed_usd', (select coalesce(sum(billed_usd), 0) from public.ai_usage where workspace_id = ws and created_at >= date_trunc('month', now())),
      'month_measured_usd', (select coalesce(sum(cost_usd), 0) from public.ai_usage where workspace_id = ws and measured and created_at >= date_trunc('month', now())),
      'month_by_kind', (select coalesce(jsonb_object_agg(kind, c), '{}') from (select kind, round(sum(cost_usd), 4) c from public.ai_usage where workspace_id = ws and created_at >= date_trunc('month', now()) group by kind) t));
  end if;
  return res;
end $$;
revoke all on function public.set_ai_limits(jsonb), public.ai_usage_summary() from public, anon;
grant execute on function public.set_ai_limits(jsonb), public.ai_usage_summary() to authenticated;
