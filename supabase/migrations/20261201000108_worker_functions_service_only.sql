-- Seguridad (auditoría OWASP 2026-11-14, A01-001/002): funciones SECURITY DEFINER pensadas solo para el worker o la contabilidad interna.
-- `revoke … from public, anon` no quita el privilegio por defecto que Supabase concede a `authenticated`; aquí se revoca de forma explícita
-- y solo se deja a `service_role`. La web no llama a ninguna de ellas (comprobado); el worker usa la clave de servicio. Aditiva y reversible con grant.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('import_job','finish_import','publication_job','finish_publication','oauth_token_for','oauth_touch_for',
              'export_job_item','finish_render','finish_batch','set_batch_zip','batch_renders','grant_units','reserve_units','compute_meter','handle_new_user')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
