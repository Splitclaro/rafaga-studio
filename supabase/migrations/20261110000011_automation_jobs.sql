-- Automatizaciones: cursor al activar, comprobación bajo demanda y reclamo de jobs 'automation'.
create or replace function public.automation_cursor() returns trigger language plpgsql as $$
begin
  -- Al (re)activar la regla solo se procesan entradas POSTERIORES a ese momento: nunca se consume el histórico.
  if new.active and coalesce(old.active, false) = false then new.cursor_published := now(); end if;
  return new;
end $$;
drop trigger if exists automation_cursor_trg on public.automation_rules;
create trigger automation_cursor_trg before insert or update on public.automation_rules for each row execute function public.automation_cursor();

create or replace function public.request_automation_check(p_rule uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid;
begin
  select workspace_id into ws from public.automation_rules where id = p_rule;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  insert into public.jobs(workspace_id, kind, idempotency_key, created_by, params)
    values (ws, 'automation', 'automation:' || p_rule || ':' || floor(extract(epoch from now()) / 120)::bigint, auth.uid(), jsonb_build_object('rule_id', p_rule, 'manual', true))
    on conflict (workspace_id, idempotency_key) do update set updated_at = now()
    returning id into jid;
  return jid;
end $$;
revoke all on function public.request_automation_check(uuid) from public, anon;
grant execute on function public.request_automation_check(uuid) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now()
  where j.id = (
    select id from public.jobs
    where kind in ('detect','render','lyrics','automation') and attempts < 3
      and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'))
    order by (kind = 'render') desc, created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
