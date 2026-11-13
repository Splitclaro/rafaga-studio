# Épica 01: Fundamentos

> Tras esta épica existen el arnés de migraciones completo, el esquema v2, el libro de unidades, el motor de etapas,
> la CLI del worker por etapas y la app de Modal con `/api/wake` despachando según `WORKER_BACKEND`.

| | |
|---|---|
| **Id** | `01-fundamentos` |
| **Tareas** | `E1-T1` … `E1-T6` (pasos 1–6 de `blueprint.md` §9) |
| **Depende de** | nada — se empieza aquí |
| **Desbloquea** | `02-ingesta-y-analisis`, `03-edicion-y-entrega` |
| **En paralelo con** | ninguna (todo lo posterior usa estas tablas) |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis
borrable: sin `enum`, `namespace`, propiedades de parámetro) · Tailwind existente · Supabase Postgres con RLS · RPC
`security definer` · Cloudflare R2 · worker `workers/media` · Modal (Python 1.6.4 como envoltorio fino) · pnpm 12.18.0.
Versiones en `pnpm-lock.yaml`: léelas, no las adivines. **No se añade ni actualiza ninguna dependencia npm.**

| Tarea | Comando |
|---|---|
| Entorno (cada comando) | `export PATH="$HOME/.local/bin:$PATH" && …` (pnpm 12.18 y ffmpeg 9.0.2) |
| Pruebas (todo) | `pnpm test` |
| Una prueba | `node --test <ruta>` |
| Typecheck web | `pnpm --filter @rafaga/web typecheck` |
| Build web | `pnpm --filter @rafaga/web build` |
| CLI del worker | `node workers/media/src/stage.ts --list` · `--list-flags` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` (nunca `git reset --hard`) |

**Puerta:** `pnpm test` (y typecheck en las tareas que tocan `apps/web`) verde antes de marcar una tarea como hecha.
Ninguna prueba toca la red: PGlite en proceso y `fetch` simulado. No hay servicios que levantar.

## Subárbol

```
supabase/
  migrations/20261113000034_clipping_v2_core.sql   # NUEVO T2
  migrations/20261113000035_credit_ledger.sql      # NUEVO T3
  migrations/20261113000036_job_stages.sql         # NUEVO T4
  tests/migrate.ts, migrate.test.ts                # NUEVO T1 — freshDb(), applyMigrations()
  tests/rls.test.ts                                # EDITA T1
  tests/v2_core.test.ts                            # NUEVO T2
  tests/ledger.test.ts, fake-supabase.ts           # NUEVO T3
  tests/job_stages.test.ts                         # NUEVO T4
apps/web/
  lib/api.ts, api.test.ts                          # NUEVO T3
  lib/jobs.test.ts, app/api/jobs/[[...slug]]/route.ts   # NUEVO T4
  components/ProjectList.tsx                       # EDITA T4
  app/api/wake/route.ts                            # EDITA T6
  lib/wake.test.ts                                 # NUEVO T6
  lib/oauthserver.ts, lib/ytserver.ts              # existen — solo lectura (rpcAs, bearer, userFrom)
workers/
  media/src/stage.ts, stages/{registry,runner,hash}.ts, stages.test.ts   # NUEVO T5
  media/src/run.ts                                 # existe — no se toca (bucle heredado con 2fbd1a5, 1d1024f, f74e330)
  modal/app.py, requirements.txt, README.md        # NUEVO T6
packages/providers/src/groq.ts, groq.test.ts       # existen — arreglos ya desplegados; solo lectura
```

Fuera de este subárbol no se edita nada. Si una tarea parece exigirlo, detente e informa.

## Modelo de datos de esta épica

| Entidad | Qué añade | Notas |
|---|---|---|
| `analyses`, `transcript_revisions`, `generation_recipes`, `clip_collections`, `clip_drafts`, `export_batches`, `publications`, `imports` | tablas nuevas (034) | RLS `is_member`; escritura solo por funciones o `can_edit` |
| `generations`, `clips`, `clip_versions`, `renders` | columnas nuevas (034) | `clip_versions` inmutable por trigger; `aspect`, `layout`, `template` |
| `credit_accounts`, `credit_ledger` | 035 | solo-añadir; `_ledger_write` es el único escritor |
| `jobs` | `engine`, `units_reserved`, `cancel_requested_at`, `request_hash` (036) | `claim_job` filtra `engine='v1'` |
| `job_stages`, `platform_settings`, vista `stage_timings` | 036 | arrendamiento 90 s; `output` ≤8192 bytes |
| `ai_usage` | CHECK de `kind` + `compute` (036) | el medidor de Modal escribe aquí (`provider='modal'`) |

El SQL completo de 034, 035 y 036 está en `blueprint.md` §4: pégalo y corrígelo solo si una prueba demuestra un error,
sin cambiar nombres, firmas ni códigos de error.

## Contratos

**Consumidos (existen):** `public.is_member(ws)`, `public.can_edit(ws)`, `public.my_role()`, `claim_job()`,
`scheduler_tick()`, `oauth_save(...)`, `rpcAs(token, fn, args)`, `bearer(req)`, `userFrom(req)`, `ai_usage`.

**Producidos (las épicas 02 y 03 dependen de estas firmas):**

| Export | Firma | Usado por |
|---|---|---|
| `supabase/tests/migrate.ts` → `freshDb` | `() => Promise<{ db, A, B, wsA, wsB, asUser, applied }>` | 02, 03 |
| `supabase/tests/fake-supabase.ts` → `fakeSupabaseFetch`, `tokenFor` | `(db, other?) => typeof fetch` · `(uid) => string` | 02, 03 |
| `apps/web/lib/api.ts` → `json`, `fail`, `idempotencyKey`, `mapDbError`, `errorFor`, `ERROR_CODES` | ver §5 de `blueprint.md` | 02, 03 |
| SQL `enqueue_job` | `(p_ws, p_kind, p_stages jsonb, p_idem, p_params, p_project, p_generation, p_request_hash default null) → {job_id, replay, units_reserved}` | 02, 03 |
| SQL `request_generation`, `claim_stage`, `heartbeat_stage`, `finish_stage`, `find_cached_stage`, `sweep_stale`, `cancel_job`, `dispatch_plan`, `compute_meter`, `stage_eta`, `save_clip_version`, `apply_transcript_revision` | §4 de `blueprint.md` | 02, 03 |
| `workers/media/src/stages/registry.ts` → `STAGES`, `loadStage`, `StageCtx`, `StageImpl` | `StageImpl = { inputs(ctx, row), run(ctx, row) → { output, units_actual? } }` | 02, 03 |
| `workers/media/src/stage.ts` → `main` | `(argv: string[], deps?: { rpc }) => Promise<number>` | pruebas |
| CLI `node workers/media/src/stage.ts` | `--list` · `--list-flags` · `<stage> <jobId>` · `--drain [--max-idle-s N]` · `--sweep` · `--keep-alive` · `--plan` · `--purge`; salidas 0/1/64/78 | Modal, 03 |

## Convenciones que muerden aquí

- Cada función `security definer` lleva `set search_path = public` y termina con `revoke all … from public, anon` y el
  `grant execute` explícito (`authenticated` o `service_role`): en Postgres, `PUBLIC` ejecuta funciones nuevas por defecto.
- Ninguna tabla nueva concede nada a `anon` (la prueba existente «anon sin acceso a ninguna tabla» lo comprueba).
- Una ruta `route.ts` solo exporta métodos HTTP y `dynamic` y responde con `Response.json`; la prueba importa el
  `route.ts` y llama a `POST(req, { params: Promise.resolve({ slug: [...] }) })`.
- Rutas con `[` van entre comillas simples en el shell.
- `app.py` solo pasa a `stage.ts` opciones que imprime `stage.ts --list-flags`.
- Reglas de la ampliación: lee la implementación y sus dependencias antes de tocar; reutiliza; nada de sistemas
  paralelos, refactorizaciones ajenas ni actualizaciones de dependencias; nunca reproceses proyectos históricos ni
  toques trabajos activos.

Reglas completas: `CLAUDE.md`. Reglas por zona: `.claude/rules/migrations.md`, `.claude/rules/worker-stages.md`,
`.claude/rules/api-routes.md` (copiadas a la raíz y confirmadas por el Bootstrap).

---

## Tareas

En el orden de `tasks.json`; no se reordenan por prioridad.

### `E1-T1` — Arnés de migraciones por glob ordenado

**Depende de:** nada · **Prioridad:** p0

**Precondición:** `test -z "$(git status --porcelain | grep -v '^.. blueprints/')"` debe salir con 0 (el árbol solo
tiene cambios bajo `blueprints/`; el Bootstrap ya confirmó en su propio commit lo que copió de `workspace/`). Si no,
detente e informa: hay trabajo ajeno sin confirmar. Los arreglos de Groq (`2fbd1a5`, `1d1024f`, `f74e330`) ya están
confirmados y desplegados; no hay nada que confirmar aparte. Después, saca de `rls.test.ts` la emulación de Supabase a
`migrate.ts` (`ENV_SHIMS` + rol `service_role` + `storage.buckets.allowed_mime_types` + `storage.objects.metadata`),
reproduce los grants intercalados en `HOOKS` y `FINAL_GRANTS`, y aplica todas las migraciones por orden de nombre. Si
una falla en PGlite, corrige el shim, nunca la migración.

**Archivos**
- `supabase/tests/migrate.ts` — nuevo: `listMigrations`, `ENV_SHIMS`, `HOOKS`, `applyMigrations`, `freshDb`
- `supabase/tests/migrate.test.ts` — nuevo
- `supabase/tests/rls.test.ts` — edita: `before` con `freshDb()`, sin nombres de migración

**Aceptación**
1. **WHEN** se ejecuta `node --test supabase/tests/migrate.test.ts` **THE SYSTEM SHALL** comprobar que la lista aplicada por `applyMigrations` es idéntica a la lista ordenada de `supabase/migrations/*.sql`, sin omitir ninguna (incluidas 006, 014, 028, 031, 032 y 033).
2. **WHEN** `freshDb()` termina **THE SYSTEM SHALL** exponer `sources.parts`, `sources.storage_backend`, `clips.preview_path`, la tabla `project_folders` y los roles `anon`, `authenticated` y `service_role`.
3. **WHEN** se busca `20261109000001_core.sql` en `supabase/tests/rls.test.ts` **THE SYSTEM SHALL** no encontrarlo (`grep` sale con 1).
4. **WHEN** se ejecuta `pnpm test` **THE SYSTEM SHALL** salir con 0 y 0 pruebas fallidas, incluidas las pruebas ya desplegadas de `packages/providers/src/groq.test.ts`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/migrate.test.ts
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/rls.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q '20261109000001_core.sql' supabase/tests/rls.test.ts; test $? -eq 1
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 01 — arnés de migraciones" && git tag rafaga-v2-step-01
git ls-files --error-unmatch supabase/tests/migrate.ts
```

### `E1-T2` — Esquema v2 (migración 034)

**Depende de:** `E1-T1` · **Prioridad:** p0

Pega el SQL de 034 de `blueprint.md` §4. Recrea `oauth_save` copiando su cuerpo de
`20261110000029_oauth_connections.sql` con `('google','dropbox','tiktok')`. No hay tabla `compositions`: la
composición vive en `clip_versions` (`composition` + `aspect`, `layout`, `template`). La prueba crea datos de A como
servicio y comprueba como B, como A y como superusuario.

**Archivos**
- `supabase/migrations/20261113000034_clipping_v2_core.sql` — nuevo
- `supabase/tests/v2_core.test.ts` — nuevo

**Aceptación**
1. **WHEN** el usuario B consulta `analyses`, `transcript_revisions`, `generation_recipes`, `clip_collections`, `clip_drafts`, `export_batches`, `publications` e `imports` **THE SYSTEM SHALL** devolver 0 filas del workspace de A, y SHALL rechazar cualquier inserción de B con el `workspace_id` de A (criterio 9, base de datos).
2. **WHEN** cualquier rol, incluido el propietario de la tabla, ejecuta UPDATE o DELETE directo sobre `clip_versions` **THE SYSTEM SHALL** lanzar `clip_versions_immutable` y dejar la fila intacta; WHEN se borra el clip padre THE SYSTEM SHALL borrar sus versiones en cascada (criterio 5, base de datos).
3. **WHEN** `save_clip_version` recibe un `p_base_version` distinto de `clips.current_version` **THE SYSTEM SHALL** devolver `{"conflict": true, "current_version": n}` sin crear versión; con la versión vigente SHALL crear la versión n+1 con `aspect`, `layout` y `template`, y poner `user_edited = true` salvo con `p_user_edit = false`.
4. **WHEN** se inserta en `analyses` una segunda fila con el mismo `(source_id, version)` **THE SYSTEM SHALL** rechazarla.
5. **WHEN** se escribe en `clips.editorial_state` un valor fuera de `pendiente|en_revision|aprobado|descartado`, o en `clip_versions.layout` uno fuera de los 6 diseños, **THE SYSTEM SHALL** rechazarlo.
6. **WHEN** se ejecuta `pnpm test` **THE SYSTEM SHALL** salir con 0 y 0 pruebas fallidas.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/v2_core.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 02 — esquema v2" && git tag rafaga-v2-step-02
```

### `E1-T3` — Libro de unidades (035) y núcleo de API

**Depende de:** `E1-T2` · **Prioridad:** p0

Pega 035. `fake-supabase.ts` emula `auth/v1/user` (token `test:<uuid>`) y `rest/v1/rpc/<fn>` ejecutando la función como
`authenticated` con `request.jwt.claim.sub` (o como servicio con `test:service`) y devuelve errores al estilo PostgREST
(400 `P0001`, 404 `P0002`, 403 `42501`, 409 `23505`); cualquier otra URL lanza. `api.ts` reutiliza `bearer`, `rpcAs`
y `userFrom` sin duplicarlos e incluye el catálogo de 14 códigos de `blueprint.md` §9 paso 3 (mensaje, qué se conserva,
acción, efecto en el consumo; en español). PGlite serializa las dos reservas «a la vez»: la prueba demuestra la
comprobación de saldo bajo el `for update`.

**Archivos**
- `supabase/migrations/20261113000035_credit_ledger.sql` — nuevo
- `supabase/tests/ledger.test.ts` — nuevo
- `supabase/tests/fake-supabase.ts` — nuevo
- `apps/web/lib/api.ts` — nuevo
- `apps/web/lib/api.test.ts` — nuevo

**Aceptación**
1. **WHEN** dos llamadas a `reserve_units` de 1 unidad con claves distintas se lanzan a la vez contra un saldo de 1.00 **THE SYSTEM SHALL** aceptar exactamente una, rechazar la otra con `insufficient_units` y dejar el saldo en 0.00.
2. **WHEN** `reserve_units` se llama 3 veces con la misma clave **THE SYSTEM SHALL** escribir exactamente 1 fila `reserve` y devolver el mismo `ledger_id` las 3 veces (criterio 6, base de datos).
3. **WHEN** `settle_units` o `refund_units` se llaman dos veces con la misma clave **THE SYSTEM SHALL** añadir una sola fila, y un `settle_units` con consumo real menor que lo reservado SHALL añadir una fila `release` por la diferencia.
4. **WHEN** un usuario `authenticated` escribe directamente en `credit_ledger`, llama a `grant_units` sin ser `owner`, o llama a `settle_units` o `refund_units` **THE SYSTEM SHALL** rechazarlo.
5. **WHEN** `ledger.test.ts` recorre `supabase/migrations`, `apps/web`, `workers` y `packages` (sin `node_modules` ni `.next`) **THE SYSTEM SHALL** encontrar `insert into public.credit_ledger` solo en `supabase/migrations/20261113000035_credit_ledger.sql`.
6. **WHEN** `mapDbError` recibe `insufficient_units` **THE SYSTEM SHALL** producir HTTP 402 con `{ "error": { "code": "insufficient_units", "message": … }, "needed": n, "balance": b }`, y `errorFor` SHALL devolver mensaje, trabajo conservado, acción y efecto en el consumo no vacíos para cada código de `ERROR_CODES`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/ledger.test.ts apps/web/lib/api.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 03 — libro de unidades y API" && git tag rafaga-v2-step-03
```

### `E1-T4` — Motor de etapas (036), cancelación y Biblioteca

**Depende de:** `E1-T3` · **Prioridad:** p0

Pega 036 y recrea también `scheduler_tick` copiando su cuerpo de `20261110000015_scheduler.sql` con
`and engine = 'v1'` en el UPDATE de huérfanos y en `n_pend`. El cómputo de Modal se registra en `ai_usage`
(`kind='compute'`, `provider='modal'`), no en una tabla nueva. En la prueba, fija la tarifa con valores de prueba
(`{"usd_per_core_s":0.0001,"usd_per_gib_s":0.00001}`), no precios reales. La ruta de cancelación llama a `cancel_job`.
`ProjectList.tsx` muestra el estado del último trabajo y un botón Cancelar desactivado en vuelo, solo para trabajos
`engine = 'v2'`, con los componentes existentes.

**Archivos**
- `supabase/migrations/20261113000036_job_stages.sql` — nuevo
- `supabase/tests/job_stages.test.ts` — nuevo
- `apps/web/app/api/jobs/[[...slug]]/route.ts` — nuevo
- `apps/web/lib/jobs.test.ts` — nuevo
- `apps/web/components/ProjectList.tsx` — edita

**Aceptación**
1. **WHEN** dos llamadas a `claim_stage` compiten por una única etapa reclamable **THE SYSTEM SHALL** entregarla a una sola, con `attempts = 1` y `lease_until` entre 85 s y 95 s por delante, y SHALL no entregar una etapa mientras otra de menor `seq` del mismo trabajo no esté `done` o `skipped`.
2. **WHEN** el arrendamiento de una etapa `running` ha caducado y se ejecuta `sweep_stale()` **THE SYSTEM SHALL** reencolarla mientras `attempts < 3`, y al tercer vencimiento SHALL marcar etapa y trabajo `failed` con `job_stalled` y añadir exactamente una devolución por sus unidades.
3. **WHEN** `enqueue_job` se llama 3 veces con la misma clave **THE SYSTEM SHALL** crear 1 trabajo, sus etapas y 1 fila `reserve` y devolver el mismo `job_id`, y una `output` de más de 8192 bytes SHALL rechazarse.
4. **WHEN** el gasto de Modal del mes en `ai_usage` (`provider = 'modal'`, `kind = 'compute'`) alcanza el 90 % de `compute_budget_usd`, o `modal_rate_card` es nula, **THE SYSTEM SHALL** rechazar `enqueue_job` con `compute_budget_exhausted` o `compute_rate_card_missing` sin escribir ningún trabajo.
5. **WHEN** la función heredada `claim_job()` se ejecuta con solo trabajos `engine = 'v2'` en cola **THE SYSTEM SHALL** devolver 0 filas.
6. **WHEN** `POST /api/jobs/:id/cancel` llega de un editor para un trabajo cuyas etapas con coste no han empezado **THE SYSTEM SHALL** responder 202 `{ kept, refunded_units }` y devolver sus unidades; para el usuario B SHALL responder 404.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/job_stages.test.ts apps/web/lib/jobs.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 04 — motor de etapas" && git tag rafaga-v2-step-04
```

### `E1-T5` — Worker por etapas (stage.ts)

**Depende de:** `E1-T4` · **Prioridad:** p0

`STAGES` = `validate, mezzanine, proxy, prepare, transcribe, scenes, speakers, candidates, select, compose, previews,
checks, render, zip, import, publish, translate`. `loadStage` importa perezosamente el módulo de la etapa; si aún no
existe, `not_implemented`. Las etapas nunca importan supabase-js: reciben `StageCtx`. `stage.ts` exporta
`main(argv, deps?)` (con `deps.rpc` simulable) y solo se ejecuta como programa si
`import.meta.url === pathToFileURL(process.argv[1]).href`; comprueba el uso (64) antes que la configuración (78) y es el
único que crea el cliente. `--list-flags` imprime una por línea `--list`, `--list-flags`, `--drain`, `--max-idle-s`,
`--sweep`, `--keep-alive`, `--plan`, `--purge`. `--purge` carga `./stages/purge.ts` con `import()` dinámico y convierte
un módulo ausente en `not_implemented` con salida 1, así la épica 03 no edita `stage.ts`. La prueba ejecuta la CLI con
`spawnSync(process.execPath, …)` para `--list`, `--list-flags`, 64 y 78, y llama a
`main(["--plan"|"--sweep"|"--keep-alive"], { rpc: stub })` en proceso. `run.ts` no se toca.

**Archivos**
- `workers/media/src/stage.ts` — nuevo
- `workers/media/src/stages/registry.ts` — nuevo
- `workers/media/src/stages/runner.ts` — nuevo
- `workers/media/src/stages/hash.ts` — nuevo
- `workers/media/src/stages.test.ts` — nuevo

**Aceptación**
1. **WHEN** se ejecuta `node workers/media/src/stage.ts --list` **THE SYSTEM SHALL** imprimir una por línea las etapas de `STAGES` en su orden (de `validate` a `translate`) y salir con 0 sin leer variables de entorno, y `--list-flags` SHALL imprimir `--list`, `--list-flags`, `--drain`, `--max-idle-s`, `--sweep`, `--keep-alive`, `--plan` y `--purge`.
2. **WHEN** `stage.ts` recibe una etapa conocida y un id sin `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` **THE SYSTEM SHALL** salir con 78 nombrando la variable que falta, y WHEN recibe una etapa desconocida SHALL salir con 64.
3. **WHEN** `main(["--plan"])` se ejecuta con un `rpc` simulado **THE SYSTEM SHALL** imprimir un JSON con `ready` y `legacy` numéricos, y `main(["--sweep"])` y `main(["--keep-alive"])` SHALL devolver 0 tras llamar a `sweep_stale`, `enqueue_due_publications` y `keep_alive`.
4. **WHEN** `inputHash` se calcula dos veces con las mismas entradas y versiones **THE SYSTEM SHALL** devolver el mismo sha256 de 64 caracteres hexadecimales, y otro distinto si cambia cualquier versión de componente.
5. **WHEN** el runner reclama una etapa cuyo `input_hash` coincide con una etapa `done` del mismo workspace **THE SYSTEM SHALL** cerrarla como `skipped` con la salida en caché sin invocar la implementación.
6. **WHEN** una etapa lanza un error **THE SYSTEM SHALL** llamar a `finish_stage` con `failed` y su `error_code`, y mientras corre SHALL renovar el arrendamiento cada 15 s y abortar con `cancelled` si `heartbeat_stage` devuelve `false`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/stages.test.ts
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list-flags
export PATH="$HOME/.local/bin:$PATH" && env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node workers/media/src/stage.ts validate 00000000-0000-0000-0000-000000000000; test $? -eq 78
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts no-such-stage 00000000-0000-0000-0000-000000000000; test $? -eq 64
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 05 — worker por etapas" && git tag rafaga-v2-step-05
```

### `E1-T6` — App de Modal y /api/wake

**Depende de:** `E1-T5` · **Prioridad:** p0

Crea el venv fuera del repo (`python3 -m venv ~/.cache/rafaga/modal-venv` y `~/.cache/rafaga/modal-venv/bin/pip
install -r workers/modal/requirements.txt`) y lee del paquete instalado las firmas de `App.function`,
`Image.add_local_dir` y `Image.debian_slim` antes de escribir `app.py` siguiendo la referencia de `blueprint.md` §12
(Node 24.22.3 con SHASUMS256, ffmpeg BtbN por SHA-256, opencv headless 4.10.0.84 con `numpy<2.1`, `fastapi[standard]`
solo importado dentro de `try`, secreto `rafaga-worker`, funciones `drain`, `run_legacy`, `dispatch`, `sweeper`,
`keep_alive`; `modal.Period` o `modal.Cron`). `app.py` solo pasa a `stage.ts` opciones que imprime `--list-flags`;
`wake.test.ts` lo comprueba ejecutando `stage.ts --list-flags` con `spawnSync` y comparando con las opciones `--…` que
aparecen en `app.py`. Comprueba la sintaxis con `ast.parse` (`py_compile` dejaría `__pycache__` en el repo). La ruta
wake usa `Response.json`; sin `WORKER_BACKEND`, comportamiento actual. No despliegues: `modal deploy` es acción del
propietario.

**Archivos**
- `workers/modal/app.py` — nuevo
- `workers/modal/requirements.txt` — nuevo (`modal==1.6.4`)
- `workers/modal/README.md` — nuevo
- `apps/web/app/api/wake/route.ts` — edita
- `apps/web/lib/wake.test.ts` — nuevo

**Aceptación**
1. **WHEN** `WORKER_BACKEND=modal` y una sesión válida llama a `POST /api/wake` con `{ "job_id": … }` **THE SYSTEM SHALL** hacer exactamente un POST a `MODAL_DISPATCH_URL` con la cabecera `X-Rafaga-Wake` igual a `WAKE_SECRET` y el cuerpo `{"job_id": …}`, y ninguna llamada a `api.github.com`.
2. **WHEN** `WORKER_BACKEND` es `actions` o no está definida **THE SYSTEM SHALL** despachar `worker.yml` solo si no hay ninguna ejecución `in_progress` ni `queued`, como hoy.
3. **WHEN** `WORKER_BACKEND=modal` y falta `MODAL_DISPATCH_URL` o `WAKE_SECRET` **THE SYSTEM SHALL** responder 200 `{ "woken": false, "reason": "not_configured" }`, y sin token Bearer SHALL responder 401.
4. **WHEN** `python3` analiza `workers/modal/app.py` con `ast.parse` **THE SYSTEM SHALL** salir con 0.
5. **WHEN** `wake.test.ts` lee `workers/modal/app.py` **THE SYSTEM SHALL** encontrar `X-Rafaga-Wake` y `hmac.compare_digest`, el SHA-256 `8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4`, `node-v24.22.3-linux-x64.tar.xz`, `opencv-python-headless==4.10.0.84`, una función cada minuto con `stage.ts --sweep` y otra diaria con `stage.ts --keep-alive`, y cada opción `--…` que `app.py` pasa a `stage.ts` SHALL figurar en la salida de `node workers/media/src/stage.ts --list-flags`.
6. **WHEN** el Python de `~/.cache/rafaga/modal-venv` importa `modal` **THE SYSTEM SHALL** informar la versión `1.6.4` y exponer `App`, `Image`, `Secret`, `fastapi_endpoint` y `Period` o `Cron`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/wake.test.ts
export PATH="$HOME/.local/bin:$PATH" && python3 -c "import ast; ast.parse(open('workers/modal/app.py').read(), 'workers/modal/app.py')"
export PATH="$HOME/.local/bin:$PATH" && ~/.cache/rafaga/modal-venv/bin/python -c "import importlib.metadata as m, modal; assert m.version('modal') == '1.6.4'; [getattr(modal, n) for n in ('App', 'Image', 'Secret', 'fastapi_endpoint')]; assert hasattr(modal, 'Period') or hasattr(modal, 'Cron')"
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 06 — Modal y wake" && git tag rafaga-v2-step-06
```

---

## Aceptación de la épica

1. **WHEN** se ejecuta `pnpm test` tras `E1-T6` **THE SYSTEM SHALL** salir con 0 con todas las migraciones aplicadas desde cero en PGlite.
2. **WHEN** se ejecuta `node workers/media/src/stage.ts --list-flags` **THE SYSTEM SHALL** salir con 0 sin variables de entorno.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list-flags
```

## Trampas

- **PUBLIC puede ejecutar funciones nuevas** — sin el `revoke` explícito, un usuario podría llamar a `settle_units`.
- **Cascada y trigger de inmutabilidad** — el trigger permite DELETE solo con `pg_trigger_depth() > 1` (cascada); no lo
  «simplifiques».
- **Árbol sucio al empezar** — la precondición de `E1-T1` lo detecta; no confirmes trabajo ajeno dentro de un paso.
- **Nombres de CHECK** — la de estado de `jobs` se localiza por su definición (`%validating%`), no por nombre.
- **Modal** — no inventes nombres de API: léelos del paquete instalado. Una opción nueva en `app.py` exige añadirla
  antes a `--list-flags`.
- **Vuelta atrás** — `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD`; `git reset --hard` está denegado.

## Antes de seguir

- [ ] Las 6 tareas `done` en `tasks.json`, ninguna `in_progress`.
- [ ] Todos los `verify` pasaron, ninguno se editó ni se saltó.
- [ ] Etiquetas `rafaga-v2-step-01` … `rafaga-v2-step-06` en git (`git tag -l 'rafaga-v2-step-*'`).
- [ ] Los contratos producidos existen con su firma.
- [ ] Nada editado fuera del subárbol; esta épica no añade variables de entorno a ningún `.env`.
