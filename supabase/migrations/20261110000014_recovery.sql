-- Recuperación guiada: el usuario puede convertir un proyecto sin habla en una herramienta que no la necesita (reencuadre),
-- reutilizando la fuente subida y la transcripción ya hecha (no se vuelve a subir ni a transcribir).
grant update (mode) on public.projects to authenticated;
