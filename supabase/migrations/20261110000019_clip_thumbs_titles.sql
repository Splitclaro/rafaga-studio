-- H13: miniatura real por clip y origen del título (para distinguir sugerido de editado por el usuario).
alter table public.clips add column if not exists thumb_path text;
alter table public.clips add column if not exists title_source text not null default 'lexical';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clips_title_source_chk') then
    alter table public.clips add constraint clips_title_source_chk check (title_source in ('ai','lexical','project','user'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clips_thumb_path_chk') then
    alter table public.clips add constraint clips_thumb_path_chk check (thumb_path is null or thumb_path like workspace_id::text || '/%');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clips_title_len_chk') then
    alter table public.clips add constraint clips_title_len_chk check (char_length(title) between 1 and 160);
  end if;
end $$;
-- El cliente puede renombrar y marcar el título como suyo; la miniatura solo la escribe el servidor.
grant update (title_source) on public.clips to authenticated;
-- Los clips de herramientas (reencuadre, captions…) llevan el nombre del proyecto
update public.clips c set title_source = 'project' where title_source = 'lexical' and exists (select 1 from public.projects p where p.id = c.project_id and p.name = c.title);
update public.clips c set title_source = 'ai' where title_source = 'lexical' and exists (select 1 from public.generations g where g.id = c.generation_id and g.model not like 'lexical%' and g.model not like 'herramienta%');

-- Cierre de privilegios: Supabase concede UPDATE de tabla por defecto, lo que anulaba los GRANT por columna.
-- Se revoca y se vuelve a conceder solo lo que el cliente edita de verdad (RLS sigue acotando por espacio y rol).
revoke update on public.clips from anon, authenticated;
grant update (title, favorite, discarded, current_version, title_source) on public.clips to authenticated;
revoke update on public.projects from anon, authenticated;
grant update (name, project_brief, language, clip_count, target_seconds, max_seconds, deleted_at, mode) on public.projects to authenticated;
