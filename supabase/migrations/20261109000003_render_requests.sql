-- Exportación bajo demanda desde el editor (no destructiva).
alter table public.jobs add column if not exists params jsonb not null default '{}';

create or replace function public.request_render(p_clip uuid, p_version int, p_ratio text, p_burn boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws uuid; jid uuid; rid uuid; st text; k text;
begin
  if p_ratio not in ('9:16','1:1','16:9') then raise exception 'invalid_ratio'; end if;
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not public.is_member(ws) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.clip_versions where clip_id = p_clip and version = p_version) then raise exception 'version_not_found'; end if;
  -- Export idéntico ya listo: se reutiliza
  select id into rid from public.renders where clip_id = p_clip and clip_version = p_version and ratio = p_ratio and burn_subtitles = p_burn and status = 'ready' limit 1;
  if rid is not null then return jsonb_build_object('render_id', rid, 'reused', true); end if;
  k := 'render:' || p_clip || ':' || p_version || ':' || p_ratio || ':' || p_burn;
  select id, status into jid, st from public.jobs where workspace_id = ws and idempotency_key = k;
  if jid is null then
    insert into public.jobs(workspace_id, kind, idempotency_key, clip_id, created_by, params)
      values (ws, 'render', k, p_clip, auth.uid(), jsonb_build_object('version', p_version, 'ratio', p_ratio, 'burn', p_burn))
      returning id into jid;
  elsif st in ('failed','cancelled') then
    update public.jobs set status = 'queued', attempts = 0, error_code = null, error_message = null, updated_at = now() where id = jid;
  end if;
  return jsonb_build_object('job_id', jid, 'reused', false);
end $$;
revoke all on function public.request_render(uuid, int, text, boolean) from public, anon;
grant execute on function public.request_render(uuid, int, text, boolean) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now()
  where j.id = (
    select id from public.jobs
    where kind in ('detect','render') and attempts < 3
      and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'))
    order by (kind = 'render') desc, created_at   -- exports (cortos) primero
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
