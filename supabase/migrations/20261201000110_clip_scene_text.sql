-- Descripción visual de la escena de cada clip (estimación de un modelo de visión sobre la miniatura). Columna nueva y función solo del worker.
alter table public.clips add column if not exists scene_text text check (scene_text is null or char_length(scene_text) <= 600);

create or replace function public.set_clip_scene(p_clip uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clips set scene_text = left(p_text, 600) where id = p_clip;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.set_clip_scene(uuid, text) from public, anon, authenticated;
grant execute on function public.set_clip_scene(uuid, text) to service_role;
