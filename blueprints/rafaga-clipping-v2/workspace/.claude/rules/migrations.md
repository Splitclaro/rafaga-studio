---
description: Migraciones y pruebas de base de datos (Supabase, PGlite)
paths:
  - "supabase/migrations/**"
  - "supabase/tests/**"
---

- Numeración `YYYYMMDDHHMMSS_nombre.sql`; las de esta construcción son `20261113000034` … `20261113000037`; las
  siguientes continúan en `…038`.
- Solo cambios aditivos. Una CHECK que se reescribe es un superconjunto de la vigente y su impacto se declara en el
  comentario de cabecera. Las funciones existentes que se recrean (`claim_job`, `scheduler_tick`, `oauth_save`) se copian
  literalmente de su última definición y solo se añade lo necesario.
- Cada tabla nueva: `workspace_id`, `unique (workspace_id, id)`, FK compuestas, RLS con `public.is_member` y
  `public.can_edit`, ningún grant a `anon`.
- Cada función `security definer`: `set search_path = public`; `revoke all … from public, anon`; `grant execute`
  explícito a `authenticated` (cliente) o `service_role` (worker).
- Errores con `raise exception '<código>' using errcode = …` (`P0001` regla, `P0002` no encontrado, `42501` permiso) y
  `detail` en JSON cuando la API necesita campos extra.
- Solo `_ledger_write` (035) inserta en `credit_ledger`.
- Pruebas: `freshDb()` de `supabase/tests/migrate.ts`; nunca una lista de migraciones escrita a mano; un fallo de
  plataforma se corrige en `ENV_SHIMS`, no en la migración.
- Nunca `psql` ni `supabase db push`: el propietario aplica las migraciones a mano (LC-4).
