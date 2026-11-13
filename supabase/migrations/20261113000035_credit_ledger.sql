create table if not exists public.credit_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  balance numeric(10,2) not null default 0 check (balance >= 0), updated_at timestamptz not null default now());
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('grant','reserve','settle','release','refund')), units numeric(10,2) not null,
  job_id uuid, generation_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  note text check (note is null or char_length(note) <= 200), created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), unique (workspace_id, id), unique (workspace_id, idempotency_key),
  check ((kind = 'reserve' and units < 0) or (kind in ('grant','release','refund') and units > 0) or (kind = 'settle' and units = 0)));
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
drop policy if exists credit_accounts_select on public.credit_accounts;
drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_accounts_select on public.credit_accounts for select to authenticated using (public.is_member(workspace_id));
create policy credit_ledger_select on public.credit_ledger for select to authenticated using (public.is_member(workspace_id));
revoke all on public.credit_accounts, public.credit_ledger from anon, authenticated;
grant select on public.credit_accounts, public.credit_ledger to authenticated;

-- Escritura única (no expuesta): bloquea la cuenta, aplica idempotencia, mueve el saldo.
create or replace function public._ledger_write(p_ws uuid, p_kind text, p_units numeric, p_job uuid, p_gen uuid, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric(10,2); prev record; lid uuid;
begin
  insert into public.credit_accounts(workspace_id) values (p_ws) on conflict (workspace_id) do nothing;
  select balance into bal from public.credit_accounts where workspace_id = p_ws for update;
  select id into prev from public.credit_ledger where workspace_id = p_ws and idempotency_key = p_key;
  if found then return jsonb_build_object('ledger_id', prev.id, 'replay', true, 'balance', bal); end if;
  if p_kind = 'reserve' and bal < -p_units then
    raise exception 'insufficient_units' using errcode = 'P0001', detail = json_build_object('needed', -p_units, 'balance', bal)::text;
  end if;
  insert into public.credit_ledger(workspace_id, kind, units, job_id, generation_id, idempotency_key, note)
    values (p_ws, p_kind, p_units, p_job, p_gen, p_key, p_note) returning id into lid;
  update public.credit_accounts set balance = balance + p_units, updated_at = now() where workspace_id = p_ws;
  return jsonb_build_object('ledger_id', lid, 'replay', false, 'balance', bal + p_units);
end $$;
create or replace function public.grant_units(p_ws uuid, p_units numeric, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (select 1 from public.workspace_members where workspace_id = p_ws
       and user_id = auth.uid() and role = 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_units <= 0 then raise exception 'invalid_units' using errcode = 'P0001'; end if;
  return public._ledger_write(p_ws, 'grant', p_units, null, null, p_key, p_note);
end $$;
create or replace function public.reserve_units(p_ws uuid, p_units numeric, p_job uuid, p_gen uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_edit(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_units <= 0 then raise exception 'invalid_units' using errcode = 'P0001'; end if;
  return public._ledger_write(p_ws, 'reserve', -p_units, p_job, p_gen, p_key, null);
end $$;
create or replace function public.settle_units(p_ws uuid, p_job uuid, p_key text, p_reserved numeric, p_actual numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public._ledger_write(p_ws, 'settle', 0, p_job, null, p_key, null);
  if (r->>'replay')::boolean = false and p_actual < p_reserved then
    perform public._ledger_write(p_ws, 'release', p_reserved - p_actual, p_job, null, p_key || ':release', null);
  end if;
  return r;
end $$;
create or replace function public.refund_units(p_ws uuid, p_job uuid, p_key text, p_units numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_units <= 0 then return jsonb_build_object('replay', false, 'skipped', true); end if;
  return public._ledger_write(p_ws, 'refund', p_units, p_job, null, p_key, p_reason);
end $$;
create or replace function public.units_balance(p_ws uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return coalesce((select balance from public.credit_accounts where workspace_id = p_ws), 0);
end $$;
revoke all on function public._ledger_write(uuid,text,numeric,uuid,uuid,text,text), public.grant_units(uuid,numeric,text,text),
  public.reserve_units(uuid,numeric,uuid,uuid,text), public.settle_units(uuid,uuid,text,numeric,numeric),
  public.refund_units(uuid,uuid,text,numeric,text), public.units_balance(uuid) from public, anon, authenticated;
grant execute on function public.grant_units(uuid,numeric,text,text), public.reserve_units(uuid,numeric,uuid,uuid,text),
  public.units_balance(uuid) to authenticated;
grant execute on function public.grant_units(uuid,numeric,text,text), public.reserve_units(uuid,numeric,uuid,uuid,text),
  public.settle_units(uuid,uuid,text,numeric,numeric), public.refund_units(uuid,uuid,text,numeric,text),
  public.units_balance(uuid) to service_role;
