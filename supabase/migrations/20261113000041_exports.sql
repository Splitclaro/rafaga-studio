-- Paso 16: exportaciones. Aditiva: funciones nuevas (cliente: request_exports, retry_export, rerender_export, export_object, mark_export_downloaded;
-- worker: export_job_item, finish_render, finish_batch, set_batch_zip, batch_renders). Ningún cambio de tablas.
-- Una exportación queda FIJADA a una versión inmutable de clip_versions: seguir editando no cambia el archivo ya pedido.

create or replace function public._render_hash(p_kind text, p_aspect text, p_burn boolean, p_comp jsonb) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_kind || '|' || p_aspect || '|' || p_burn::text || '|' || p_comp::text, 'UTF8')), 'hex') $$;

-- p_items = [{clip_id, version, aspect, burn_subtitles, kind}]. Reutiliza lo ya pedido (misma versión y ajustes); solo encola lo nuevo.
create or replace function public.request_exports(p_items jsonb, p_zip boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; c record; v record; rid uuid; h text; ids uuid[] := '{}'; fresh uuid[] := '{}'; bid uuid; ws uuid; jid uuid; reused int := 0;
        k text; asp text; burn boolean; stages jsonb := '[]'::jsonb; prev uuid; r jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'invalid_items' using errcode = 'P0001'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select id, workspace_id into c from public.clips where id = (it->>'clip_id')::uuid;
    if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
    ws := coalesce(ws, c.workspace_id); if ws <> c.workspace_id then raise exception 'invalid_items' using errcode = 'P0001'; end if;
    select * into v from public.clip_versions where clip_id = c.id and version = (it->>'version')::int;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    k := coalesce(it->>'kind', 'mp4'); asp := coalesce(it->>'aspect', v.aspect, '9:16'); burn := coalesce((it->>'burn_subtitles')::boolean, true);
    if k not in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl') or asp not in ('9:16','1:1','16:9') then raise exception 'invalid_items' using errcode = 'P0001'; end if;
    h := public._render_hash(k, asp, burn, v.composition);
    select id into rid from public.renders where workspace_id = ws and clip_id = c.id and clip_version = v.version and ratio = asp and burn_subtitles = burn and spec_sha256 = h;
    if found then reused := reused + 1; ids := ids || rid;
    else
      insert into public.renders(workspace_id, clip_id, clip_version, ratio, burn_subtitles, spec_sha256, status, kind, settings_hash)
        values (ws, c.id, v.version, asp, burn, h, 'queued', k, h) returning id into rid;
      ids := ids || rid; fresh := fresh || rid;
    end if;
  end loop;
  select id into prev from public.jobs where workspace_id = ws and idempotency_key = p_idem and kind = 'export' limit 1;
  if prev is not null then return jsonb_build_object('export_ids', to_jsonb(ids), 'job_id', prev, 'reused', reused, 'replay', true); end if;
  if coalesce(p_zip, false) or jsonb_array_length(p_items) > 1 then
    insert into public.export_batches(workspace_id, zip_requested, status) values (ws, coalesce(p_zip, false), 'queued') returning id into bid;
    update public.renders set batch_id = bid where id = any(fresh);
  end if;
  if array_length(fresh, 1) > 0 or coalesce(p_zip, false) then
    select coalesce(jsonb_agg(jsonb_build_object('stage', 'render', 'seq', 1, 'units', 0, 'params', jsonb_build_object('render_id', x))), '[]'::jsonb) into stages from unnest(fresh) x;
    if coalesce(p_zip, false) then stages := stages || jsonb_build_array(jsonb_build_object('stage', 'zip', 'seq', 2, 'units', 0, 'params', jsonb_build_object('batch_id', bid))); end if;
    r := public.enqueue_job(ws, 'export', stages, p_idem, jsonb_build_object('batch_id', bid), null, null);
    jid := (r->>'job_id')::uuid;
    if bid is not null then update public.export_batches set job_id = jid where id = bid; end if;
  end if;
  return jsonb_build_object('export_ids', to_jsonb(ids), 'batch_id', bid, 'job_id', jid, 'reused', reused);
end $$;

-- Reintenta solo una exportación fallida (el resto del lote sigue disponible).
create or replace function public.retry_export(p_render uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; j jsonb;
begin
  select id, workspace_id, status, batch_id into r from public.renders where id = p_render;
  if not found or not public.can_edit(r.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status not in ('failed','cancelled') then return jsonb_build_object('job_id', null, 'status', r.status); end if;
  update public.renders set status = 'queued', error_code = null where id = p_render;
  j := public.enqueue_job(r.workspace_id, 'export', jsonb_build_array(jsonb_build_object('stage','render','seq',1,'units',0,'params',jsonb_build_object('render_id', p_render))), p_idem, '{}', null, null);
  return jsonb_build_object('job_id', j->>'job_id', 'status', 'queued');
end $$;

-- Si el objeto ya se purgó, se vuelve a renderizar desde su versión inmutable (sin ningún movimiento en el libro).
create or replace function public.rerender_export(p_render uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; j jsonb;
begin
  select id, workspace_id, status, storage_path into r from public.renders where id = p_render;
  if not found or not public.can_edit(r.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.storage_path is not null then return jsonb_build_object('job_id', null, 'status', r.status); end if;
  update public.renders set status = 'queued', error_code = null, expires_at = null where id = p_render;
  j := public.enqueue_job(r.workspace_id, 'export', jsonb_build_array(jsonb_build_object('stage','render','seq',1,'units',0,'params',jsonb_build_object('render_id', p_render))), p_idem, '{}', null, null);
  return jsonb_build_object('job_id', j->>'job_id', 'status', 'queued');
end $$;

create or replace function public.export_object(p_render uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select id, workspace_id, status, storage_path, expires_at, downloaded_at, kind into r from public.renders where id = p_render;
  if not found or not public.is_member(r.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', r.storage_path, 'status', r.status, 'kind', r.kind, 'expires_at', r.expires_at, 'downloaded_at', r.downloaded_at,
    'purged', r.storage_path is null and r.status = 'ready', 'expired', r.expires_at is not null and r.expires_at < now());
end $$;
create or replace function public.mark_export_downloaded(p_render uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, workspace_id into r from public.renders where id = p_render;
  if not found or not public.is_member(r.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.renders set downloaded_at = coalesce(downloaded_at, now()) where id = p_render;
end $$;

-- ── Worker (solo servicio) ──
create or replace function public.export_job_item(p_render uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; v record; c record; g record; src record; w jsonb;
begin
  select * into r from public.renders where id = p_render; if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into v from public.clip_versions where clip_id = r.clip_id and version = r.clip_version;      -- SIEMPRE la versión pedida, nunca la actual
  select * into c from public.clips where id = r.clip_id;
  select * into g from public.generations where id = c.generation_id;
  select p.source_id into src from public.projects p where p.id = c.project_id;
  select coalesce((select tr.words from public.transcript_revisions tr where tr.transcript_id = g.transcript_id order by tr.revision desc limit 1), t.words) into w from public.transcripts t where t.id = g.transcript_id;
  return jsonb_build_object('render_id', r.id, 'workspace_id', r.workspace_id, 'clip_id', r.clip_id, 'version', r.clip_version, 'kind', r.kind, 'aspect', r.ratio,
    'burn', r.burn_subtitles, 'composition', v.composition, 'source_id', src.source_id, 'title', c.title, 'words', coalesce(w, '[]'::jsonb), 'hash', r.spec_sha256, 'batch_id', r.batch_id);
end $$;
create or replace function public.finish_render(p_render uuid, p_status text, p_path text, p_probe jsonb, p_bytes bigint, p_duration_ms bigint, p_width int, p_height int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, workspace_id into r from public.renders where id = p_render; if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_path is not null and p_path not like r.workspace_id::text || '/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  update public.renders set status = p_status, storage_path = coalesce(p_path, storage_path), probe = coalesce(p_probe, probe), bytes = p_bytes, duration_ms = p_duration_ms,
         width = p_width, height = p_height, error_code = p_error, expires_at = case when p_status = 'ready' then now() + interval '30 days' else expires_at end where id = p_render;
  if p_status = 'ready' and p_path is not null then
    insert into public.storage_objects(workspace_id, key, bytes, kind, render_id, expires_at)
      values (r.workspace_id, p_path, coalesce(p_bytes, 0), 'export', p_render, now() + interval '30 days') on conflict (key) do update set bytes = excluded.bytes, expires_at = excluded.expires_at, purged_at = null;
  end if;
end $$;
create or replace function public.batch_renders(p_batch uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('render_id', id, 'status', status, 'path', storage_path, 'kind', kind, 'clip_id', clip_id, 'version', clip_version, 'ratio', ratio) order by created_at), '[]'::jsonb)
  from public.renders where batch_id = p_batch $$;
create or replace function public.finish_batch(p_batch uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ok int; bad int; st text;
begin
  select count(*) filter (where status = 'ready'), count(*) filter (where status in ('failed','cancelled')) into ok, bad from public.renders where batch_id = p_batch;
  st := case when bad = 0 and ok > 0 then 'ready' when ok > 0 then 'partial' else 'failed' end;
  update public.export_batches set status = st where id = p_batch; return st;
end $$;
create or replace function public.set_batch_zip(p_batch uuid, p_path text, p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  select id, workspace_id into b from public.export_batches where id = p_batch; if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_path not like b.workspace_id::text || '/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  update public.export_batches set zip_path = p_path, zip_bytes = p_bytes, zip_expires_at = now() + interval '30 days' where id = p_batch;
  insert into public.storage_objects(workspace_id, key, bytes, kind, expires_at) values (b.workspace_id, p_path, p_bytes, 'zip', now() + interval '30 days') on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
end $$;

revoke all on function public._render_hash(text,text,boolean,jsonb), public.request_exports(jsonb,boolean,text), public.retry_export(uuid,text), public.rerender_export(uuid,text), public.export_object(uuid),
  public.mark_export_downloaded(uuid), public.export_job_item(uuid), public.finish_render(uuid,text,text,jsonb,bigint,bigint,int,int,text), public.batch_renders(uuid), public.finish_batch(uuid), public.set_batch_zip(uuid,text,bigint) from public, anon;
grant execute on function public.request_exports(jsonb,boolean,text), public.retry_export(uuid,text), public.rerender_export(uuid,text), public.export_object(uuid), public.mark_export_downloaded(uuid) to authenticated;
grant execute on function public._render_hash(text,text,boolean,jsonb), public.export_job_item(uuid), public.finish_render(uuid,text,text,jsonb,bigint,bigint,int,int,text), public.batch_renders(uuid), public.finish_batch(uuid), public.set_batch_zip(uuid,text,bigint) to service_role, authenticated;
