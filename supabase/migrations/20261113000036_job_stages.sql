alter table public.jobs add column if not exists engine text not null default 'v1';
do $$ begin if not exists (select 1 from pg_constraint where conname = 'jobs_engine_check') then
  alter table public.jobs add constraint jobs_engine_check check (engine in ('v1','v2')); end if; end $$;
alter table public.jobs add column if not exists units_reserved numeric(10,2) not null default 0;
alter table public.jobs add column if not exists cancel_requested_at timestamptz;
alter table public.jobs add column if not exists request_hash text;
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('ingest','transcribe','detect','render','live',
  'automation','lyrics','package','reframe','generation','export','import','publish','translate'));
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%validating%' loop
    execute format('alter table public.jobs drop constraint %I', c); end loop; end $$;
alter table public.jobs add constraint jobs_status_check check (status in ('queued','validating','extracting','transcribing',
  'selecting','tracking','rendering','running','done','failed','cancelled'));
-- Cómputo en ai_usage (027): kind 'compute' (ampliación aditiva de la CHECK).
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('stt','llm','vision','render','storage','transfer','compute'));

-- El worker heredado nunca reclama trabajos v2 (copia literal de 025 + filtro engine).
create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now(), started_at = coalesce(j.started_at, now())
  where j.id = (
    select q.id from public.jobs q
    where q.engine = 'v1' and q.kind in ('detect','render','lyrics','automation','live','package','reframe') and q.attempts < 3
      and (q.status = 'queued' or (q.status not in ('done','failed','cancelled') and q.heartbeat_at < now() - interval '15 minutes'))
    order by (q.kind = 'live') desc, (q.kind = 'render') desc,
      (select count(*) from public.jobs r where r.workspace_id = q.workspace_id and r.status not in ('queued','done','failed','cancelled')), q.created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
-- El planificador heredado solo vigila trabajos v1 (copia de 015 con el filtro engine).
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
  where engine = 'v1' and status not in ('queued','done','failed','cancelled') and attempts >= 3
    and coalesce(heartbeat_at, updated_at) < now() - interval '15 minutes';
  get diagnostics n_orph = row_count;
  -- 3) ¿Hay trabajo reclamable y ningún worker vivo?
  select count(*) into n_pend from public.jobs
  where engine = 'v1' and attempts < 3 and (status = 'queued' or (status not in ('done','failed','cancelled') and heartbeat_at < now() - interval '15 minutes'));
  select exists (select 1 from public.worker_heartbeats where seen_at > now() - interval '90 seconds') into alive;
  if n_pend > 0 and not alive then d := public.scheduler_dispatch(); end if;
  insert into public.scheduler_runs(enqueued, orphaned, pending, worker_alive, dispatch) values (n_enq, n_orph, n_pend, alive, d);
  delete from public.scheduler_runs where ran_at < now() - interval '3 days';
  delete from public.worker_heartbeats where seen_at < now() - interval '1 day';
  return jsonb_build_object('enqueued', n_enq, 'orphaned', n_orph, 'pending', n_pend, 'worker_alive', alive, 'dispatch', d);
end $$;
revoke all on function public.scheduler_tick() from public, anon, authenticated;

create table if not exists public.platform_settings (   -- excepción deliberada: global, sin workspace_id (§20.3 #9)
  key text primary key check (key in ('compute_budget_usd','modal_rate_card')), value jsonb,
  updated_at timestamptz not null default now());
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
insert into public.platform_settings(key, value) values ('compute_budget_usd', '30'), ('modal_rate_card', null)
  on conflict (key) do nothing;   -- modal_rate_card = {"usd_per_core_s": x, "usd_per_gib_s": y}, lo escribe el propietario (LC-5)

create table if not exists public.job_stages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, job_id uuid not null,
  stage text not null check (stage in ('validate','mezzanine','proxy','prepare','transcribe','scenes','speakers','candidates',
    'select','compose','previews','checks','render','zip','import','publish','translate')),
  seq int not null check (seq between 1 and 99),
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled','skipped')),
  attempts int not null default 0 check (attempts between 0 and 3), lease_until timestamptz, worker_id text,
  input_hash text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  output jsonb check (output is null or pg_column_size(output) <= 8192),
  params jsonb not null default '{}' check (pg_column_size(params) <= 8192),
  units numeric(10,2) not null default 0 check (units >= 0), started_at timestamptz, finished_at timestamptz,
  cost_core_s numeric(12,2) not null default 0, error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, job_id) references public.jobs(workspace_id, id) on delete cascade);
create index if not exists job_stages_queue_idx on public.job_stages(status, job_id, seq) where status = 'queued';
create index if not exists job_stages_cache_idx on public.job_stages(workspace_id, stage, input_hash) where status = 'done';
create index if not exists job_stages_lease_idx on public.job_stages(lease_until) where status = 'running';
alter table public.job_stages enable row level security;
drop policy if exists job_stages_select on public.job_stages;
create policy job_stages_select on public.job_stages for select to authenticated using (public.is_member(workspace_id));
revoke all on public.job_stages from anon, authenticated;
grant select on public.job_stages to authenticated;

create or replace view public.stage_timings with (security_invoker = true) as
  select s.stage, count(*)::int as samples,
    percentile_cont(0.5) within group (order by extract(epoch from s.finished_at - s.started_at) / greatest((j.params->>'source_minutes')::numeric, 0.1)) as p50_s_per_min,
    percentile_cont(0.9) within group (order by extract(epoch from s.finished_at - s.started_at) / greatest((j.params->>'source_minutes')::numeric, 0.1)) as p90_s_per_min
  from public.job_stages s join public.jobs j on j.id = s.job_id
  where s.status = 'done' and s.started_at is not null and s.finished_at is not null and j.params ? 'source_minutes'
    and s.finished_at > now() - interval '60 days'
  group by s.stage;

create or replace function public.compute_meter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare spent numeric; budget numeric; rate jsonb; has_rate boolean;
begin
  select coalesce(sum(cost_usd), 0) into spent from public.ai_usage
   where provider = 'modal' and kind = 'compute' and created_at >= date_trunc('month', now());
  select (value #>> '{}')::numeric into budget from public.platform_settings where key = 'compute_budget_usd';
  select value into rate from public.platform_settings where key = 'modal_rate_card';
  has_rate := rate is not null and jsonb_typeof(rate) = 'object';
  return jsonb_build_object('month_usd', round(spent, 4), 'budget_usd', budget,
    'pct', case when budget > 0 then round(100 * spent / budget, 1) end, 'rate_card_set', has_rate,
    'blocked', (not has_rate) or spent >= 0.9 * budget);
end $$;

-- null si alguna etapa pedida tiene < 5 muestras; si no, suma de p50/p90 × minutos.
create or replace function public.stage_eta(p_minutes numeric, p_stages text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p50 numeric := 0; p90 numeric := 0; r record;
begin
  for r in select u.st, t.samples, t.p50_s_per_min, t.p90_s_per_min
             from unnest(p_stages) as u(st) left join public.stage_timings t on t.stage = u.st loop
    if r.samples is null or r.samples < 5 then return null; end if;
    p50 := p50 + r.p50_s_per_min * p_minutes; p90 := p90 + r.p90_s_per_min * p_minutes;
  end loop;
  return jsonb_build_object('p50_s', round(p50), 'p90_s', round(p90));
end $$;

-- p_stages = [{"stage":"transcribe","seq":2,"units":30.00,"params":{…}}, …]; p_request_hash por defecto md5(etapas||params).
create or replace function public.enqueue_job(p_ws uuid, p_kind text, p_stages jsonb, p_idem text, p_params jsonb,
  p_project uuid, p_generation uuid, p_request_hash text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; jid uuid := gen_random_uuid(); total numeric(10,2); m jsonb; s jsonb; h text;
begin
  if auth.uid() is not null and not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  h := coalesce(p_request_hash, md5(p_stages::text || coalesce(p_params::text, '')));
  select id, units_reserved, request_hash into prev from public.jobs where workspace_id = p_ws and idempotency_key = p_idem;
  if found then
    if prev.request_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('job_id', prev.id, 'replay', true, 'units_reserved', prev.units_reserved);
  end if;
  m := public.compute_meter();
  if not (m->>'rate_card_set')::boolean then raise exception 'compute_rate_card_missing' using errcode = 'P0001'; end if;
  if (m->>'blocked')::boolean then raise exception 'compute_budget_exhausted' using errcode = 'P0001', detail = m::text; end if;
  select coalesce(sum((x->>'units')::numeric), 0) into total from jsonb_array_elements(p_stages) x;
  if total > 0 then perform public.reserve_units(p_ws, total, jid, p_generation, 'reserve:' || p_idem); end if;
  insert into public.jobs(id, workspace_id, kind, status, idempotency_key, project_id, generation_id, params, engine,
                          units_reserved, request_hash, created_by)
    values (jid, p_ws, p_kind, 'queued', p_idem, p_project, p_generation, coalesce(p_params, '{}'), 'v2', total, h, auth.uid());
  for s in select * from jsonb_array_elements(p_stages) loop
    insert into public.job_stages(workspace_id, job_id, stage, seq, units, params)
      values (p_ws, jid, s->>'stage', (s->>'seq')::int, coalesce((s->>'units')::numeric, 0), coalesce(s->'params', '{}'));
  end loop;
  return jsonb_build_object('job_id', jid, 'replay', false, 'units_reserved', total);
end $$;

create or replace function public.claim_stage(p_worker text, p_lease_s int default 90) returns setof public.job_stages
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.job_stages s set status = 'running', attempts = s.attempts + 1, worker_id = p_worker,
         lease_until = now() + make_interval(secs => p_lease_s), started_at = coalesce(s.started_at, now()), updated_at = now()
   where s.id = (
     select q.id from public.job_stages q join public.jobs j on j.id = q.job_id
      where q.status = 'queued' and j.engine = 'v2' and j.cancel_requested_at is null and j.status not in ('done','failed','cancelled')
        and not exists (select 1 from public.job_stages p where p.job_id = q.job_id and p.seq < q.seq and p.status not in ('done','skipped'))
      order by j.created_at, q.seq limit 1 for update of q skip locked)
  returning s.*;
  update public.jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now(),
         metrics = metrics || jsonb_build_object('queue_ms', coalesce((metrics->>'queue_ms')::bigint, (extract(epoch from now() - created_at) * 1000)::bigint))
   where status = 'queued' and id in (select job_id from public.job_stages where worker_id = p_worker and status = 'running');
end $$;

create or replace function public.heartbeat_stage(p_stage uuid, p_worker text, p_lease_s int default 90) returns boolean
language plpgsql security definer set search_path = public as $$
declare cancelled boolean;
begin
  update public.job_stages set lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   where id = p_stage and worker_id = p_worker and status = 'running';
  select j.cancel_requested_at is not null into cancelled from public.jobs j join public.job_stages s on s.job_id = j.id where s.id = p_stage;
  return not coalesce(cancelled, true);   -- false = cancelado: el worker aborta
end $$;

create or replace function public.find_cached_stage(p_ws uuid, p_stage text, p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select output from public.job_stages where workspace_id = p_ws and stage = p_stage and input_hash = p_hash and status = 'done'
  order by finished_at desc limit 1 $$;

-- Cierra una etapa (done | skipped por caché | failed | cancelled): liquida o devuelve unidades y registra cómputo en ai_usage.
create or replace function public.finish_stage(p_stage uuid, p_worker text, p_status text, p_output jsonb, p_input_hash text,
  p_core_s numeric, p_mem_gib_s numeric, p_error_code text, p_error_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; x record; rate jsonb; retry boolean;
begin
  select * into s from public.job_stages where id = p_stage and worker_id = p_worker for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select value into rate from public.platform_settings where key = 'modal_rate_card';
  insert into public.ai_usage(workspace_id, job_id, kind, provider, model, units, cost_usd, billed_usd, measured)
    values (s.workspace_id, s.job_id, 'compute', 'modal', s.stage,
            jsonb_build_object('core_s', coalesce(p_core_s, 0), 'mem_gib_s', coalesce(p_mem_gib_s, 0), 'stage_id', s.id),
            coalesce(p_core_s, 0) * coalesce((rate->>'usd_per_core_s')::numeric, 0)
          + coalesce(p_mem_gib_s, 0) * coalesce((rate->>'usd_per_gib_s')::numeric, 0), 0, false);
  retry := p_status = 'failed' and s.attempts < 3 and coalesce(p_error_code, '') not in
           ('unsupported_file','corrupt_file','unsupported_container','too_long','too_large','no_moments','insufficient_units','cancelled');
  update public.job_stages set status = case when retry then 'queued' else p_status end, output = p_output,
         input_hash = coalesce(p_input_hash, input_hash), finished_at = case when retry then null else now() end,
         lease_until = null, worker_id = case when retry then null else worker_id end,
         cost_core_s = cost_core_s + coalesce(p_core_s, 0), error_code = p_error_code,
         error_message = left(p_error_message, 500), updated_at = now() where id = p_stage;
  if p_status = 'done' and s.units > 0 then
    perform public.settle_units(s.workspace_id, s.job_id, 'settle:' || s.id, s.units, coalesce((p_output->>'units_actual')::numeric, s.units));
  elsif p_status in ('skipped','cancelled') and s.units > 0 then
    perform public.refund_units(s.workspace_id, s.job_id, 'refund:' || s.id, s.units, p_status);
  elsif p_status = 'failed' and not retry then
    update public.jobs set status = 'failed', error_code = p_error_code, error_message = left(p_error_message, 500),
           finished_at = now(), updated_at = now() where id = s.job_id;
    for x in select * from public.job_stages where job_id = s.job_id and status in ('queued','failed') and units > 0 loop
      perform public.refund_units(x.workspace_id, x.job_id, 'refund:' || x.id, x.units, coalesce(p_error_code, 'failed'));
    end loop;
    update public.job_stages set status = 'cancelled', updated_at = now() where job_id = s.job_id and status = 'queued';
  end if;
  update public.jobs j set status = 'done', finished_at = now(), updated_at = now()
   where j.id = s.job_id and j.status = 'running'
     and not exists (select 1 from public.job_stages y where y.job_id = j.id and y.status not in ('done','skipped'));
  return jsonb_build_object('status', case when retry then 'queued' else p_status end);
end $$;

create or replace function public.sweep_stale() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; n_requeue int := 0; n_fail int := 0;
begin
  for s in select * from public.job_stages where status = 'running' and lease_until < now() for update skip locked loop
    if s.attempts < 3 then
      update public.job_stages set status = 'queued', lease_until = null, worker_id = null, updated_at = now() where id = s.id;
      n_requeue := n_requeue + 1;
    else
      update public.job_stages set status = 'failed', error_code = 'job_stalled', finished_at = now(), updated_at = now() where id = s.id;
      update public.jobs set status = 'failed', error_code = 'job_stalled', finished_at = now(), updated_at = now() where id = s.job_id;
      perform public.refund_units(s.workspace_id, s.job_id, 'refund:' || s.id, s.units, 'job_stalled');
      update public.job_stages set status = 'cancelled', updated_at = now() where job_id = s.job_id and status = 'queued';
      n_fail := n_fail + 1;
    end if;
  end loop;
  return jsonb_build_object('requeued', n_requeue, 'failed', n_fail);
end $$;

create or replace function public.cancel_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j record; s record; refunded numeric := 0; kept jsonb;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or not public.can_edit(j.workspace_id) or j.engine <> 'v2' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.jobs set cancel_requested_at = coalesce(cancel_requested_at, now()), status = 'cancelled', finished_at = now(), updated_at = now()
   where id = p_job and status not in ('done','failed','cancelled');
  for s in select * from public.job_stages where job_id = p_job and status = 'queued' loop
    update public.job_stages set status = 'cancelled', updated_at = now() where id = s.id;
    if s.units > 0 then perform public.refund_units(s.workspace_id, p_job, 'refund:' || s.id, s.units, 'cancelled'); refunded := refunded + s.units; end if;
  end loop;
  select coalesce(jsonb_agg(stage order by seq), '[]') into kept from public.job_stages where job_id = p_job and status in ('done','skipped');
  return jsonb_build_object('kept', kept, 'refunded_units', refunded);
end $$;

create or replace function public.dispatch_plan() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ready', (select count(*) from public.job_stages q join public.jobs j on j.id = q.job_id
               where q.status = 'queued' and j.engine = 'v2' and j.cancel_requested_at is null
                 and not exists (select 1 from public.job_stages p where p.job_id = q.job_id and p.seq < q.seq and p.status not in ('done','skipped'))),
    'legacy', (select count(*) from public.jobs where engine = 'v1' and status = 'queued' and attempts < 3)) $$;
create or replace function public.keep_alive() returns timestamptz language sql stable as $$ select now() $$;

create or replace function public.enqueue_due_publications() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; r jsonb;
begin
  for p in select * from public.publications where state = 'scheduled' and scheduled_at <= now() for update skip locked loop
    r := public.enqueue_job(p.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
           'params', jsonb_build_object('publication_id', p.id))), 'publish:' || p.id, '{}', null, null);
    update public.publications set state = 'queued', job_id = (r->>'job_id')::uuid where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Petición de generación (receta «Clips de vídeo largo»). Unidades: transcribe 1.0/min, select 0.2/min,
-- compose 0.1 × hook.top_n si el gancho está activo (cada clip cuenta como 1 minuto; lo no usado se libera).
create or replace function public.request_generation(p_project uuid, p_params jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr record; src record; prev record; aid uuid; tid uuid; gid uuid := gen_random_uuid();
        minutes numeric(10,2); hook numeric(10,2); stages jsonb; r jsonb; h text := md5(p_params::text);
begin
  select p.id, p.workspace_id, p.source_id into pr from public.projects p where p.id = p_project and p.deleted_at is null;
  if not found or not public.can_edit(pr.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, generation_id, request_hash into prev from public.jobs where workspace_id = pr.workspace_id and idempotency_key = p_idem;
  if found then
    if prev.request_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('generation_id', prev.generation_id, 'job_id', prev.id, 'replay', true);
  end if;
  select * into src from public.sources where id = pr.source_id;
  if src.status <> 'validated' then raise exception 'source_not_ready' using errcode = 'P0001'; end if;
  minutes := round(((p_params->>'range_end_ms')::numeric - (p_params->>'range_start_ms')::numeric) / 60000, 2);
  hook := case when coalesce((p_params#>>'{hook,enabled}')::boolean, false)
               then round(0.1 * coalesce((p_params#>>'{hook,top_n}')::numeric, 0), 2) else 0 end;
  select a.id, a.transcript_id into aid, tid from public.analyses a
   where a.source_id = src.id and a.status = 'done'
     and a.range_start_ms <= (p_params->>'range_start_ms')::bigint and a.range_end_ms >= (p_params->>'range_end_ms')::bigint
     and a.component_versions->>'asr_model' = p_params#>>'{component_versions,asr_model}'
   order by a.version desc limit 1;
  if aid is not null then
    stages := jsonb_build_array(jsonb_build_object('stage','candidates','seq',1,'units',0),
      jsonb_build_object('stage','select','seq',2,'units', round(minutes * 0.2, 2)), jsonb_build_object('stage','compose','seq',3,'units', hook),
      jsonb_build_object('stage','previews','seq',4,'units',0), jsonb_build_object('stage','checks','seq',5,'units',0));
  else
    insert into public.transcripts(workspace_id, source_id, words) values (pr.workspace_id, src.id, '[]') returning id into tid;
    insert into public.analyses(workspace_id, source_id, version, range_start_ms, range_end_ms, transcript_id, language, component_versions)
      values (pr.workspace_id, src.id, coalesce((select max(version) from public.analyses where source_id = src.id), 0) + 1,
              (p_params->>'range_start_ms')::bigint, (p_params->>'range_end_ms')::bigint, tid,
              nullif(p_params->>'language', 'auto'), coalesce(p_params->'component_versions', '{}')) returning id into aid;
    stages := jsonb_build_array(jsonb_build_object('stage','prepare','seq',1,'units',0),
      jsonb_build_object('stage','transcribe','seq',2,'units', round(minutes * 1.0, 2)), jsonb_build_object('stage','scenes','seq',2,'units',0),
      jsonb_build_object('stage','speakers','seq',3,'units',0), jsonb_build_object('stage','candidates','seq',4,'units',0),
      jsonb_build_object('stage','select','seq',5,'units', round(minutes * 0.2, 2)), jsonb_build_object('stage','compose','seq',6,'units', hook),
      jsonb_build_object('stage','previews','seq',7,'units',0), jsonb_build_object('stage','checks','seq',8,'units',0));
  end if;
  if tid is null then
    insert into public.transcripts(workspace_id, source_id, words) values (pr.workspace_id, src.id, '[]') returning id into tid;
    update public.analyses set transcript_id = tid where id = aid;
  end if;
  insert into public.generations(id, workspace_id, project_id, transcript_id, rubric_version, model, params, analysis_id, mode,
                                 component_versions, requested_count)
    values (gid, pr.workspace_id, p_project, tid, coalesce(p_params#>>'{component_versions,rubric_version}', 'rubric-v1'),
            coalesce(p_params#>>'{component_versions,llm_model}', 'n/a'), p_params, aid, nullif(p_params->>'mode', 'auto'),
            coalesce(p_params->'component_versions', '{}'), nullif(p_params->>'count', '')::int);
  r := public.enqueue_job(pr.workspace_id, 'generation', stages, p_idem,
         p_params || jsonb_build_object('source_minutes', minutes, 'analysis_id', aid, 'generation_id', gid), p_project, gid, h);
  update public.generations set units_reserved = (r->>'units_reserved')::numeric where id = gid;
  return jsonb_build_object('generation_id', gid, 'job_id', r->>'job_id', 'replay', false, 'units_reserved', r->'units_reserved');
end $$;

do $$ declare t text; begin   -- Realtime solo si existe la publicación de Supabase (PGlite no la tiene)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['job_stages','jobs','clips'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t); end if;
    end loop;
  end if;
end $$;

revoke all on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.claim_stage(text,int), public.heartbeat_stage(uuid,text,int), public.find_cached_stage(uuid,text,text),
  public.finish_stage(uuid,text,text,jsonb,text,numeric,numeric,text,text), public.sweep_stale(), public.cancel_job(uuid),
  public.dispatch_plan(), public.keep_alive(), public.enqueue_due_publications(), public.request_generation(uuid,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.cancel_job(uuid), public.request_generation(uuid,jsonb,text) to authenticated;
grant execute on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.claim_stage(text,int), public.heartbeat_stage(uuid,text,int), public.find_cached_stage(uuid,text,text),
  public.finish_stage(uuid,text,text,jsonb,text,numeric,numeric,text,text), public.sweep_stale(), public.cancel_job(uuid),
  public.dispatch_plan(), public.keep_alive(), public.enqueue_due_publications(), public.request_generation(uuid,jsonb,text) to service_role;
