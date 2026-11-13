-- Paso 12: acceso de las etapas de selección a los datos que necesitan (solo servicio). Aditiva: tres funciones nuevas.
--  · save_analysis_part: guarda escenas, señales de audio o hablantes de un análisis.
--  · generation_context: parámetros, transcripción, señales y rangos de clips anteriores de la generación.
--  · save_selection: crea los candidatos y los clips (técnico «preparando») de forma idempotente y registra avisos.

create or replace function public.save_analysis_part(p_analysis uuid, p_part text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_part not in ('scenes','audio_signals','speakers') then raise exception 'invalid_part' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_data) <> 'array' then raise exception 'invalid_data' using errcode = 'P0001'; end if;
  update public.analyses set
    scenes = case when p_part = 'scenes' then p_data else scenes end,
    audio_signals = case when p_part = 'audio_signals' then p_data else audio_signals end,
    speakers = case when p_part = 'speakers' then p_data else speakers end
   where id = p_analysis;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.generation_context(p_generation uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g record; a record; t record; prev jsonb;
begin
  select * into g from public.generations where id = p_generation;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into a from public.analyses where id = g.analysis_id;
  select words, language into t from public.transcripts where id = g.transcript_id;
  select coalesce(jsonb_agg(jsonb_build_object('start_ms', cc.start_ms, 'end_ms', cc.end_ms, 'user_edited', c.user_edited)), '[]'::jsonb) into prev
    from public.clips c join public.clip_candidates cc on cc.id = c.candidate_id
   where c.project_id = g.project_id and c.discarded = false and c.generation_id <> g.id;
  return jsonb_build_object('generation_id', g.id, 'workspace_id', g.workspace_id, 'project_id', g.project_id, 'analysis_id', g.analysis_id,
    'transcript_id', g.transcript_id, 'params', g.params, 'mode', g.mode, 'requested_count', g.requested_count,
    'words', coalesce(t.words, '[]'::jsonb), 'language', t.language, 'scenes', coalesce(a.scenes, '[]'::jsonb),
    'audio_signals', coalesce(a.audio_signals, '[]'::jsonb), 'speakers', coalesce(a.speakers, '[]'::jsonb), 'previous', prev);
end $$;

-- p_candidates = [{start_ms, end_ms, title, reason, brief_fit, scores:{…}}]. Si la generación ya tiene candidatos (reintento), devuelve los existentes.
create or replace function public.save_selection(p_generation uuid, p_candidates jsonb, p_warnings jsonb, p_requested int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g record; c jsonb; cid uuid; kid uuid; ids jsonb := '[]'::jsonb; n int := 0;
begin
  select id, workspace_id, project_id into g from public.generations where id = p_generation for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 20 then raise exception 'invalid_candidates' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clip_candidates where generation_id = p_generation) then
    select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb) into ids from public.clips where generation_id = p_generation;
    return jsonb_build_object('clip_ids', ids, 'replay', true);
  end if;
  for c in select * from jsonb_array_elements(p_candidates) loop
    insert into public.clip_candidates(workspace_id, generation_id, start_ms, end_ms, title, reason, brief_fit, scores)
      values (g.workspace_id, p_generation, (c->>'start_ms')::bigint, (c->>'end_ms')::bigint, left(c->>'title', 160), left(c->>'reason', 800), left(c->>'brief_fit', 300), coalesce(c->'scores', '{}'))
      returning id into cid;
    insert into public.clips(workspace_id, project_id, generation_id, candidate_id, title, technical_state)
      values (g.workspace_id, g.project_id, p_generation, cid, left(c->>'title', 160), 'preparando') returning id into kid;
    ids := ids || to_jsonb(kid); n := n + 1;
  end loop;
  update public.generations set delivered_count = n, warnings = coalesce(p_warnings, '[]'::jsonb), requested_count = coalesce(p_requested, requested_count) where id = p_generation;
  return jsonb_build_object('clip_ids', ids, 'replay', false, 'delivered', n);
end $$;

revoke all on function public.save_analysis_part(uuid,text,jsonb), public.generation_context(uuid), public.save_selection(uuid,jsonb,jsonb,int) from public, anon, authenticated;
grant execute on function public.save_analysis_part(uuid,text,jsonb), public.generation_context(uuid), public.save_selection(uuid,jsonb,jsonb,int) to service_role;
