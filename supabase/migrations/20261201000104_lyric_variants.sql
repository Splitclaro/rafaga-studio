-- Variantes de letra (paso 15). Aditiva. request_exports se recrea copiando LITERALMENTE su cuerpo de
-- 20261113000041_exports.sql y cambiando solo la línea de validación de tipo y formato por:
--   if k not in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl','lrc','lrc_word','ass') or asp not in ('9:16','1:1','16:9','4:5') then
-- (mismo nombre, firma, revoke y grant). Las variantes no consumen unidades (render en Modal con el medidor compartido).
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
    if k not in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl','lrc','lrc_word','ass') or asp not in ('9:16','1:1','16:9','4:5') then raise exception 'invalid_items' using errcode = 'P0001'; end if;
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
revoke all on function public.request_exports(jsonb,boolean,text) from public, anon;
grant execute on function public.request_exports(jsonb,boolean,text) to authenticated;

create or replace function public.request_lyric_variants(p_project uuid, p_variants jsonb, p_zip boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lp record; gid uuid; tid uuid; prev uuid; v jsonb; i int := 0; a int; b int; cid uuid; items jsonb := '[]'::jsonb;
        ids uuid[] := '{}'; hashes text[] := '{}'; warn jsonb := '[]'::jsonb; r jsonb; resp jsonb;
begin
  select l.*, p.source_id, s.title as song_title into lp from public.lyric_projects l
    join public.projects p on p.id = l.project_id join public.songs s on s.id = l.song_id
   where l.project_id = p_project and p.deleted_at is null;
  if not found or not public.can_edit(lp.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 120 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  select id into prev from public.generations where workspace_id = lp.workspace_id and project_id = p_project and params->>'idempotency_key' = p_idem;
  if prev is not null then return (select params->'response' from public.generations where id = prev) || jsonb_build_object('replay', true); end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 10 then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"variants"}'; end if;
  for v in select * from jsonb_array_elements(p_variants) loop
    if coalesce(v->>'kind', '') <> 'lyric' or pg_column_size(v) > 200000 or coalesce(v->>'aspect', '') not in ('9:16','4:5','1:1','16:9') then
      raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"variants"}'; end if;
  end loop;
  insert into public.transcripts(workspace_id, source_id, words) values (lp.workspace_id, lp.source_id, coalesce(p_variants->0->'words', '[]'::jsonb)) returning id into tid;
  insert into public.generations(workspace_id, project_id, transcript_id, rubric_version, model, params, requested_count, component_versions)
    values (lp.workspace_id, p_project, tid, 'lyric-v2', 'n/a', jsonb_build_object('kind','lyric','idempotency_key', p_idem, 'n', jsonb_array_length(p_variants)),
            jsonb_array_length(p_variants), '{"lyric_engine":"1"}') returning id into gid;
  for v in select * from jsonb_array_elements(p_variants) loop
    i := i + 1;
    insert into public.clips(workspace_id, project_id, generation_id, title) values (lp.workspace_id, p_project, gid, left(lp.song_title || ' · #' || i, 160)) returning id into cid;
    insert into public.clip_versions(clip_id, workspace_id, version, composition, aspect, template, created_by)
      values (cid, lp.workspace_id, 1, v, v->>'aspect', 'lyric_' || coalesce(v->>'mode', 'letra'), auth.uid());
    ids := ids || cid; hashes := hashes || coalesce(v->>'variant_hash', md5(v::text));
    items := items || jsonb_build_array(jsonb_build_object('clip_id', cid, 'version', 1, 'aspect', v->>'aspect', 'burn_subtitles', true, 'kind', 'mp4'));
  end loop;
  for a in 1 .. i loop for b in a + 1 .. i loop
    if hashes[a] = hashes[b] then warn := warn || jsonb_build_array(jsonb_build_object('code', 'near_duplicate', 'variants', jsonb_build_array(a, b))); end if;
  end loop; end loop;
  r := public.request_exports(items, coalesce(p_zip, false), p_idem);
  resp := jsonb_build_object('generation_id', gid, 'clip_ids', to_jsonb(ids), 'export_ids', r->'export_ids', 'batch_id', r->'batch_id',
                             'job_id', r->'job_id', 'warnings', warn);
  update public.generations set warnings = warn, delivered_count = i, params = params || jsonb_build_object('response', resp) where id = gid;
  return resp || jsonb_build_object('replay', false);
end $$;
revoke all on function public.request_lyric_variants(uuid,jsonb,boolean,text) from public, anon;
grant execute on function public.request_lyric_variants(uuid,jsonb,boolean,text) to authenticated;
