-- «Me gusta / No me gusta» por clip: señal guardada (sin tabla nueva) que la siguiente generación del proyecto usa para elegir mejor.
alter table public.clips add column if not exists feedback text check (feedback is null or feedback in ('like', 'dislike'));

create or replace function public.set_clip_feedback(p_clip uuid, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_feedback is not null and p_feedback not in ('like', 'dislike') then raise exception 'invalid_params' using errcode = 'P0001'; end if;
  update public.clips set feedback = p_feedback, discarded = case when p_feedback = 'dislike' then true when p_feedback is null then false else discarded end
   where id = p_clip and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_clip_feedback(uuid, text) from public, anon;
grant execute on function public.set_clip_feedback(uuid, text) to authenticated, service_role;

-- Lo que el usuario marcó en este proyecto, para la etapa de selección (solo el worker).
create or replace function public.project_feedback(p_project uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_build_object(
    'disliked', (select coalesce(jsonb_agg(jsonb_build_object('title', c.title, 'reason', left(coalesce(k.reason, ''), 160)) order by c.created_at desc), '[]') from (select * from public.clips where project_id = p_project and feedback = 'dislike' order by created_at desc limit 12) c left join public.clip_candidates k on k.id = c.candidate_id),
    'liked', (select coalesce(jsonb_agg(jsonb_build_object('title', c.title, 'reason', left(coalesce(k.reason, ''), 160)) order by c.created_at desc), '[]') from (select * from public.clips where project_id = p_project and feedback = 'like' order by created_at desc limit 12) c left join public.clip_candidates k on k.id = c.candidate_id)), '{}'::jsonb) $$;
revoke all on function public.project_feedback(uuid) from public, anon, authenticated;
grant execute on function public.project_feedback(uuid) to service_role;
