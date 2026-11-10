-- Brief estructurado por proyecto (campos) + versión usada en cada generación (el texto compuesto ya se guarda en brief_snapshot).
alter table public.projects add column if not exists brief_data jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_brief_data_size') then
    alter table public.projects add constraint projects_brief_data_size check (brief_data is null or (jsonb_typeof(brief_data) = 'object' and pg_column_size(brief_data) < 6000));
  end if;
end $$;
grant update (brief_data) on public.projects to authenticated;
