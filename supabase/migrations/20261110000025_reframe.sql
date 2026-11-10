-- Reencuadre automático: análisis de caras de un tramo del clip (trabajo en segundo plano) y trayectoria de encuadre resultante.
-- La trayectoria es una SUGERENCIA guardada aparte: solo cambia el clip cuando la persona la aplica en el editor (nueva versión).

alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('ingest','transcribe','detect','render','live','automation','lyrics','package','reframe'));

create table if not exists public.reframe_tracks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  clip_id uuid not null,
  source_start numeric not null check (source_start >= 0),
  source_end numeric not null,
  ratio text not null check (ratio in ('9:16','4:5','1:1','16:9','4:3')),
  mode text not null default 'follow' check (mode in ('follow','group')),
  status text not null default 'queued' check (status in ('queued','analyzing','ready','failed','cancelled')),
  path jsonb,                 -- ReframePath: {v, kf:[{t,x}], mode, coverage, samples, note}
  error text,
  metrics jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (source_end - source_start between 3 and 90),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade
);
create index if not exists reframe_tracks_clip_idx on public.reframe_tracks(clip_id, created_at desc);
alter table public.reframe_tracks enable row level security;
drop policy if exists reframe_tracks_read on public.reframe_tracks;
create policy reframe_tracks_read on public.reframe_tracks for select to authenticated using (public.is_member(workspace_id));
revoke all on public.reframe_tracks from anon, authenticated;
grant select on public.reframe_tracks to authenticated;

create or replace function public.request_reframe(p_clip uuid, p_start numeric, p_end numeric, p_ratio text, p_mode text default 'follow') returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; tid uuid; k text;
begin
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not public.is_member(ws) or not public.can_edit(ws) then raise exception 'not_found'; end if;
  if p_ratio not in ('9:16','4:5','1:1','16:9','4:3') then raise exception 'invalid_ratio'; end if;
  if p_mode not in ('follow','group') then raise exception 'invalid_mode'; end if;
  if p_start is null or p_end is null or p_start < 0 or p_end - p_start < 3 or p_end - p_start > 90 then raise exception 'invalid_range'; end if;
  -- misma petición ya hecha o en curso: se reutiliza
  select id into tid from public.reframe_tracks
    where clip_id = p_clip and source_start = p_start and source_end = p_end and ratio = p_ratio and mode = p_mode and status in ('queued','analyzing','ready')
    order by created_at desc limit 1;
  if tid is not null then return tid; end if;
  insert into public.reframe_tracks(workspace_id, clip_id, source_start, source_end, ratio, mode, created_by)
    values (ws, p_clip, p_start, p_end, p_ratio, p_mode, auth.uid()) returning id into tid;
  k := 'reframe:' || tid;
  insert into public.jobs(workspace_id, kind, idempotency_key, clip_id, created_by, params) values (ws, 'reframe', k, p_clip, auth.uid(), jsonb_build_object('track_id', tid));
  return tid;
end $$;
revoke all on function public.request_reframe(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.request_reframe(uuid, numeric, numeric, text, text) to authenticated;

create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now(), started_at = coalesce(j.started_at, now())
  where j.id = (
    select q.id from public.jobs q
    where q.kind in ('detect','render','lyrics','automation','live','package','reframe') and q.attempts < 3
      and (q.status = 'queued' or (q.status not in ('done','failed','cancelled') and q.heartbeat_at < now() - interval '15 minutes'))
    order by (q.kind = 'live') desc, (q.kind = 'render') desc,
      (select count(*) from public.jobs r where r.workspace_id = q.workspace_id and r.status not in ('queued','done','failed','cancelled')), q.created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
