-- Defensa en profundidad (hallazgo de la auditoría de privilegios, 2026-11-10): RLS ya bloqueaba estos accesos,
-- pero los privilegios de tabla que Supabase concede por defecto seguían abiertos.
-- 1) La app no usa nunca el rol anon sobre tablas: sin acceso, ahora y para tablas futuras.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
-- 2) Las versiones de clip son inmutables: sin UPDATE ni DELETE desde el cliente.
revoke update, delete on public.clip_versions from anon, authenticated;
