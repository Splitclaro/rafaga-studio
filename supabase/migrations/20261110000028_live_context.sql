-- Directo con contexto compartido: cada ventana arranca con la cola de la anterior; se guarda su posición absoluta en la sesión
-- para detectar momentos que cruzan ventanas y evitar duplicados tras reconexiones.
alter table public.live_windows add column if not exists abs_start numeric not null default 0;          -- segundos desde el inicio de la sesión hasta el primer fotograma de la fuente de la ventana
alter table public.live_windows add column if not exists context_seconds numeric not null default 0;    -- cola de la ventana anterior antepuesta (los momentos que acaban en ella no se repiten)
