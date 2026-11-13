-- Paso 13: lo que necesitan las etapas compose / previews / checks (solo servicio). Aditiva: cinco funciones nuevas.
create or replace function public.generation_clips(p_generation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('clip_id', c.id, 'title', c.title, 'start_ms', cc.start_ms, 'end_ms', cc.end_ms,
           'overall', coalesce((cc.scores->>'overall')::numeric, 0), 'reason', cc.reason, 'user_edited', c.user_edited,
           'has_version', exists (select 1 from public.clip_versions v where v.clip_id = c.id)) order by cc.start_ms), '[]'::jsonb)
  from public.clips c join public.clip_candidates cc on cc.id = c.candidate_id where c.generation_id = p_generation and c.discarded = false $$;

-- Versión 1 de un clip con su composición v2; el clip pasa a «disponible» (ningún MP4: eso es la exportación). Repetible.
create or replace function public.compose_clip(p_clip uuid, p_aspect text, p_layout text, p_template text, p_spec jsonb, p_needs_review boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, workspace_id, user_edited into c from public.clips where id = p_clip for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template)
    values (p_clip, c.workspace_id, 1, p_spec, p_aspect, p_layout, p_template) on conflict (clip_id, version) do nothing;
  update public.clips set technical_state = 'disponible', needs_review = coalesce(p_needs_review, false) where id = p_clip and not user_edited;
end $$;

create or replace function public.set_clip_thumb(p_clip uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, workspace_id from public.clips where id = p_clip into c;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_path not like c.workspace_id::text || '/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  update public.clips set thumb_path = p_path where id = p_clip;
end $$;

create or replace function public.add_generation_warning(p_generation uuid, p_warning jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.generations set warnings = coalesce(warnings, '[]'::jsonb) || jsonb_build_array(p_warning) where id = p_generation;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.finish_generation(p_generation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.generations set status = 'done' where id = p_generation and status <> 'cancelled';
end $$;

revoke all on function public.generation_clips(uuid), public.compose_clip(uuid,text,text,text,jsonb,boolean), public.set_clip_thumb(uuid,text),
  public.add_generation_warning(uuid,jsonb), public.finish_generation(uuid) from public, anon, authenticated;
grant execute on function public.generation_clips(uuid), public.compose_clip(uuid,text,text,text,jsonb,boolean), public.set_clip_thumb(uuid,text),
  public.add_generation_warning(uuid,jsonb), public.finish_generation(uuid) to service_role;

-- Parámetros del trabajo de una etapa (generation_id, analysis_id, rango…) más la fuente del proyecto. El ejecutor los mezcla con los de la etapa.
create or replace function public.job_params(p_job uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(j.params, '{}'::jsonb)
         || case when j.project_id is not null then jsonb_build_object('source_id', (select p.source_id from public.projects p where p.id = j.project_id)) else '{}'::jsonb end
  from public.jobs j where j.id = p_job $$;
revoke all on function public.job_params(uuid) from public, anon, authenticated;
grant execute on function public.job_params(uuid) to service_role;

create or replace function public.clip_version_spec(p_clip uuid, p_version int) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('composition', composition, 'aspect', aspect, 'layout', layout, 'template', template)
  from public.clip_versions where clip_id = p_clip and version = p_version $$;
revoke all on function public.clip_version_spec(uuid,int) from public, anon, authenticated;
grant execute on function public.clip_version_spec(uuid,int) to service_role;

-- Clave de la miniatura de un clip para el usuario que pertenece al espacio (la ruta firma después de esta comprobación).
create or replace function public.clip_thumb_key(p_clip uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select id, workspace_id, thumb_path into c from public.clips where id = p_clip;
  if not found or not public.is_member(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return c.thumb_path;
end $$;
revoke all on function public.clip_thumb_key(uuid) from public, anon;
grant execute on function public.clip_thumb_key(uuid) to authenticated, service_role;
