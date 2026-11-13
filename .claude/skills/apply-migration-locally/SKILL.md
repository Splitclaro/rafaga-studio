---
name: apply-migration-locally
description: Crear o cambiar una migración de Supabase y comprobarla en PGlite con freshDb(). Úsala cuando digas «nueva migración», «añadir tabla/columna/función SQL», «aplicar migración», «probar RLS» o toques supabase/migrations/.
---

# Aplicar una migración en local (PGlite)

## Cuándo usarla
- Añadir esquema (tabla, columna, función, política) en `supabase/migrations/`.
- Comprobar RLS o una función `security definer` antes de que el propietario la aplique en producción.

## Pasos
1. Lee las migraciones que tocan las mismas tablas (`grep -l "<tabla>" supabase/migrations/*.sql`) y reutiliza lo que
   exista; justifica cualquier tabla nueva en `blueprint.md` §1 *Ampliaciones: reutilización*.
2. Crea el siguiente archivo `supabase/migrations/2026111300003N_<nombre>.sql` (o el que nombre el paso). Solo aditivo:
   `create … if not exists`, `add column if not exists`, CHECK nuevas como superconjunto de las vigentes.
3. Cada tabla nueva: `workspace_id`, `unique (workspace_id, id)`, FK compuestas, RLS `is_member`/`can_edit`, ningún
   grant a `anon`. Cada función `security definer`: `set search_path = public`, `revoke all … from public, anon` y
   `grant execute` a `authenticated` o `service_role`.
4. Escribe la prueba con `const { db, A, B, wsA, wsB, asUser } = await freshDb()` (de `supabase/tests/migrate.ts`), que
   aplica todas las migraciones por orden de nombre.
5. Si la migración falla en PGlite por algo de la plataforma Supabase, corrige `ENV_SHIMS` en `migrate.ts`, nunca la
   migración.

## Verificar
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/migrate.test.ts   # exit 0: todas aplicadas
export PATH="$HOME/.local/bin:$PATH" && pnpm test                                    # exit 0, 0 fallidas
```

## No hacer
- Editar una migración ya aplicada en producción (las aplica el propietario a mano; durante la construcción 034–037 aún no lo están).
- Usar `psql` o `supabase db push` contra un proyecto real.
- Insertar en `credit_ledger` fuera de la migración 035.
