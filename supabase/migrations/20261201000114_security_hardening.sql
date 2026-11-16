-- Auditoría 2026-11-16. Aditiva y reversible con grant.
--  1) La migración 113 recreó oauth_token_for / oauth_touch_for y Supabase volvió a concederlas a `authenticated`: cualquier usuario podía leer los tokens OAuth de
--     OTRO espacio. Se vuelve a revocar (misma lista que 108 + las funciones de worker posteriores). La prueba `worker_privileges.test.ts` lo vigila.
--  2) Las funciones auxiliares de acceso y los disparadores de marca dejan de ser ejecutables por `anon` (las de enlaces compartidos share_* siguen públicas a propósito: van con token).
--  3) delete_song: borrar una canción con piezas fallaba por la clave foránea; ahora marca la purga inmediata de sus proyectos (el worker borra R2) y borra las filas.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('import_job','finish_import','publication_job','finish_publication','oauth_token_for','oauth_touch_for',
              'export_job_item','finish_render','finish_batch','set_batch_zip','batch_renders','grant_units','reserve_units','compute_meter','handle_new_user',
              '_ledger_write','_share','add_generation_warning','add_split_item','claim_job','claim_stage','clip_version_spec','compose_clip','dispatch_plan','enqueue_due_publications',
              'enqueue_job','finalize_deleted_projects','find_cached_stage','finish_generation','finish_song_validate','finish_stage','generation_clips','generation_context','heartbeat_stage',
              'job_params','lyric_sync_context','mark_purged','media_split_context','project_feedback','purge_candidates','record_object','refund_units','save_analysis_part',
              'save_selection','save_song_asr','save_transcript','scheduler_dispatch','scheduler_tick','set_clip_scene','set_clip_thumb','set_source_ready','settle_units',
              'song_by_source','source_info','storage_used','sweep_stale')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('brand_kit_snapshot','brand_kit_version_bump','can_admin','can_edit','can_review','current_workspace','is_member','my_role')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

create or replace function public.delete_song(p_song uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.projects set deleted_at = coalesce(deleted_at, now()), purge_at = now() - interval '1 second'
   where id in (select project_id from public.lyric_projects where song_id = p_song);
  delete from public.lyric_projects where song_id = p_song;
  delete from public.songs where id = p_song;
end $$;
revoke all on function public.delete_song(uuid) from public, anon;
grant execute on function public.delete_song(uuid) to authenticated, service_role;
