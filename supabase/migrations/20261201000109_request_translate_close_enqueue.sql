-- Seguridad (auditoría OWASP A01-003): `enqueue_job` aceptaba etapas, unidades y parámetros libres de cualquier usuario autenticado.
-- La única llamada desde la web era la traducción de subtítulos: pasa a `request_translate` (etapa fija, permisos comprobados, unidades calculadas
-- aquí y no por el cliente) y `enqueue_job` queda solo para otras funciones SECURITY DEFINER y para service_role.
create or replace function public.request_translate(p_clip uuid, p_lang text, p_groups jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; secs numeric; units numeric(10,2); g jsonb;
begin
  select id, workspace_id, project_id into c from public.clips where id = p_clip;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_lang is null or p_lang !~ '^[a-z]{2}(-[A-Z]{2})?$' then raise exception 'invalid_params' using errcode = 'P0001'; end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 400 or length(p_groups::text) > 7000 then raise exception 'invalid_params' using errcode = 'P0001'; end if;
  secs := 0;
  for g in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(g) <> 'object' or jsonb_typeof(g->'start') <> 'number' or jsonb_typeof(g->'end') <> 'number' or jsonb_typeof(g->'text') <> 'string' then raise exception 'invalid_params' using errcode = 'P0001'; end if;
    secs := secs + greatest(0, (g->>'end')::numeric - (g->>'start')::numeric);
  end loop;
  units := round(greatest(0.1, secs / 60.0) * 0.1, 2);
  return public.enqueue_job(c.workspace_id, 'translate',
    jsonb_build_array(jsonb_build_object('stage','translate','seq',1,'units',units,'params',jsonb_build_object('groups',p_groups,'target_language',p_lang,'clip_id',p_clip))),
    p_idem, jsonb_build_object('clip_id', p_clip, 'target_language', p_lang), c.project_id, null) || jsonb_build_object('units', units);
end $$;
revoke all on function public.request_translate(uuid,text,jsonb,text) from public, anon;
grant execute on function public.request_translate(uuid,text,jsonb,text) to authenticated, service_role;

revoke all on function public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text) to service_role;
