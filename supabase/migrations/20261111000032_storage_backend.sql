-- Dónde vive el original de una fuente (aditiva): Supabase Storage (por defecto) o Cloudflare R2 (10 GB gratis, sin coste de salida).
-- La web pide URLs firmadas a /api/storage (la clave de R2 solo está en el servidor y en el worker).
alter table public.sources add column if not exists storage_backend text not null default 'supabase'
  check (storage_backend in ('supabase', 'r2'));
