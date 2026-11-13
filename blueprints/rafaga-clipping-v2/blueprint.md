# Ráfaga Studio v2 · Clipping — Blueprint de cambio (brownfield)

> Generado por The Architect el 2026-11-13 · incluye la AMPLIACIÓN 2026-11-13 (feedback del propietario), que prevalece
> Forma: generative-media-app (sin pasarela de pago: uso privado) · Pista: ts-node con las convenciones del repo
> Modo: bundle `blueprints/rafaga-clipping-v2/` · Versión 2 (correcciones del validador) · Versiones verificadas: 2026-11-13 (§11)

El bundle vive **dentro** del repo, en `blueprints/rafaga-clipping-v2/`, para que cada `Verify` corra desde la raíz
contra el código real. Un bundle posterior, `rafaga-lyric-studio-v2`, depende de los pasos 3–8 y 14 de este (libro de
unidades, motor de etapas, worker en Modal, subida, motor de escena). Lyric Studio no se diseña aquí.

---

## 1. Visión general y no-objetivos

### Visión
Ráfaga Studio convierte un vídeo largo (charla, podcast, directo grabado) en clips cortos que su único usuario —el
propietario, uso privado— configura al estilo OpusClip (receta, duración, subtítulos, gancho, plantilla viral), revisa
en una rejilla con reproductor a pantalla completa, edita, exporta y publica. Hoy el repo lo hace en un bucle
monolítico en GitHub Actions que renderiza todos los MP4 al generar. Este cambio lo convierte en una tubería por etapas
cacheada y reanudable en Modal, con vista previa en el navegador dibujada por el mismo motor que la exportación, render
solo al exportar y **coste de funcionamiento 0 €** (Modal Starter, Groq free, Supabase Free, R2 Free, Vercel Hobby).

### Usuarios
| Persona | Qué viene a hacer | Frecuencia |
|---|---|---|
| Propietario (`owner`) | subir, configurar, revisar, editar, exportar, publicar | varias veces por semana |
| Revisor invitado (`reviewer`/`viewer`, existente) | ver entregas, comentar, aprobar | ocasional |

### Estado actual
| Área | Hecho leído del código |
|---|---|
| Pista | Node ≥24 ejecuta TS directamente (imports `.ts`, `allowImportingTsExtensions`), pnpm 12.18.0, ESM |
| Workspace | `apps/web` (Next.js 16.4.5, React 19.3.1, Tailwind 4.3.5), `packages/{composition,selection,providers,lyrics}`, `workers/media` |
| Datos | Supabase `rafaga-studio-beta`; 33 migraciones (última `20261112000033_project_folders.sql`); RLS con `is_member`, `can_edit`, `can_admin`, `my_role`; FK compuestas `(workspace_id, id)`; migraciones aplicadas **a mano** por el propietario |
| Pruebas | `pnpm test` = `node --test` sobre `packages/*/src`, `apps/web/lib`, `workers/media/src`, `supabase/tests`. `rls.test.ts` carga migraciones con una lista a mano que para en la 030 y omite 006, 014 y 028 |
| Worker | `workers/media/src/run.ts` (bucle monolítico, `claim_job()`) en `.github/workflows/worker.yml`; lo despiertan `/api/wake` (`GH_DISPATCH_TOKEN`) y `scheduler_tick()` (pg_cron) |
| Composición | `packages/composition` (`exports` → `src/index.ts`): `Composition`, `ffmpegArgs`, `buildAss`, `groupWords`, `layoutLines`, `mapTime`, `retimeWords`, `xAt`, `toSRT`, `toVTT`, presets de subtítulos; `MAX_CLIP_SEC = 90` en `trim.ts` |
| Selección | `packages/selection`: `exports` = `.` (`src/index.ts`), `./brief`, `./intent`, `./title`; `validateCandidates`, `WEIGHTS`, `RUBRIC_VERSION`; `src/fixture.ts` (`INTERVIEW`, uso interno de pruebas) |
| Reutilizables | `ZipBuilder` (`workers/media/src/zip.ts`), `presignV4`/`r2Url` (ya admite `GET`/`PUT`/`HEAD`/`DELETE`)/`originalKey` (`packages/providers/src/r2.ts`), `checkUrl`/`isPublicIp` (`net.ts`), OAuth google/dropbox (`oauth.ts`, `apps/web/lib/oauthserver.ts` con `rpcAs`, `bearer`), `ai_usage` + `workspace_ai_limits` (027), `text_styles`, `brand_kits`, `apply_brand_kit`, `duplicate_project`, `deliveries`/`share_links`/`delivery_packages` |
| Formato | sin linter ni formateador; el typecheck es el formato obligatorio |
| **Arreglos de selección ya desplegados** (confirmados, empujados y en producción) | Origen: el proyecto `670539ac…` (fuente «DIA 1_Camp 2026 Panda Sur», 18.3 min, 1080p25, 1.92 GB .mov, PCM s24le + timecode; 10 × 30 s) dio 0 clips porque Groq devolvía `400 json_validate_failed` y un único `try` descartaba todas las ventanas. **`2fbd1a5`**: `reasoning_effort: "low"`, `max_completion_tokens` 8000, reintento sin `response_format` ante `json_validate_failed`, `try/catch` por ventana (`m.ai_windows`), pasada léxica relajada de último recurso (`m.relaxed`), 3 pruebas en `groq.test.ts`; verificado: 10/10 clips con IA en 2/2 ventanas en ~3 min 25 s. **`1d1024f`**: `minSec` = 70 % de `target_seconds` (por debajo del máximo) y rango explícito en el prompt; verificado: duraciones 21–28 s para objetivo 30 s, pero solo 6/10 clips. **`f74e330`**: segunda pasada de IA: si faltan clips tras validar, se pide a la IA por ventana momentos NUEVOS excluyendo los rangos de palabras ya elegidos (`m.second_pass`); verificación en curso. Todo vive hoy en `run.ts`/`groq.ts`; el paso 12 lo **generaliza** a los módulos de etapa con pruebas, no lo reaplica |
| Árbol de trabajo | limpio salvo `blueprints/` |

### Estado objetivo
Etapas en `job_stages` (validar → mezzanine 1080p → proxy 720p → audio → transcribir → escenas → hablantes →
candidatos → selección → composición → vistas previas → comprobaciones) con caché por `input_hash` y arrendamiento de
90 s; worker en Modal que envuelve `node workers/media/src/stage.ts`; subida reanudable multipart a R2 hasta **4 GB y
60 min**, con el original borrado en cuanto la mezzanine pasa ffprobe; libro de unidades con reserva/liquidación/
devolución e idempotencia; medidor de cómputo que rechaza al 90 % de 30 USD; panel de creación tipo Opus; plantillas
virales y zonas seguras; rejilla de resultados con reproductor a pantalla completa (solo en proyectos v2; la vista v1
queda intacta); editor v2; exportaciones por lotes; importación y publicación.

### Objetivos v1
1. Un vídeo de hasta 4 GB y 60 min se sube, valida y procesa en el servidor aunque se cierre la pestaña.
2. Nunca 0 clips en silencio si hay habla: toda diferencia con lo pedido se explica en `generations.warnings`.
3. Cambiar composición, plantilla o formato nunca re-analiza ni cobra unidades.
4. Cada exportación corresponde a una versión inmutable; un fallo en un lote no bloquea el resto.
5. Coste 0 €: guardas de cómputo, límites de Groq configurables, cuota de 10 GB.
6. Nadie sin acceso al proyecto lee ni descarga sus archivos.

### No-objetivos
| No se construye | Por qué | Revisar cuando |
|---|---|---|
| URLs de YouTube/TikTok como fuente | anti-bot y términos de servicio | nunca |
| Doblaje | sin TTS gratuito de calidad | aparezca uno |
| B-roll generado por IA | sin generador gratuito | aparezca uno |
| Pasarela de pago | uso privado; `grant_units` | deje de ser privado |
| Rediseño visual | excluido por el propietario | lo pida |
| Instagram (publicar) | revisión de Meta y cuenta business | haya cuenta business |
| Lyric Studio | bundle `rafaga-lyric-studio-v2` | al terminar este |
| Linter, CI o E2E nuevos | el repo no los usa; sin dependencias nuevas | el propietario los pida |
| Reprocesar proyectos históricos, reiniciar workers, purgar colas o tocar trabajos activos | regla del propietario | nunca sin orden expresa |
| Despliegues, cambios en producción o ejecuciones de pago | no autorizados por este encargo | orden expresa del propietario |
| Calendario, Automatizaciones, Analítica, Brand kit, Style Studio, Entregas, Conexiones (salvo importar/publicar) | congelados | bundle posterior |
| **Congelada:** respuesta de `POST /api/wake` `{ woken, reason? }`; `GET/POST /api/storage` | los usan clientes actuales | D1 / desmantelar v1 |
| **Congelada:** `claim_job()`, `request_detection`, `request_render`, `request_reframe`, `request_lyrics`, `request_package`, `apply_brand_kit`, `duplicate_project` | worker heredado y pantallas actuales | D1 |
| **Congelada:** vista v1 de `/app/p/[id]` (`BriefFields`, «Volver a detectar», «Ajustar enfoque») para proyectos v1 | proyectos existentes | desmantelar v1 |
| **Congelada:** columnas existentes de todas las tablas; `usage_ledger` (solo lectura) | datos v1 | nunca se borran |
| **Congelada:** variables de entorno existentes; `.github/workflows/worker.yml` | Vercel y worker heredado | D1 |

El constructor no implementa nada de esta tabla. Si un paso parece requerirlo, se detiene e informa.

### Reglas de la ampliación (propietario, 2026-11-13)
Antes de tocar una parte se identifican su implementación y dependencias; se reutilizan componentes, servicios, colas,
almacenamiento y motores; **no hay sistemas paralelos**; se conservan las modificaciones pendientes; nada de
refactorizaciones, reorganizaciones ni actualizaciones de dependencias ajenas al cambio; ninguna migración destructiva
ni cambio incompatible sin declarar su impacto; ninguna entidad conceptual se convierte en tabla si ya existe una
equivalente (tabla siguiente).

### Ampliaciones: reutilización
| Ampliación | Implementación reutilizada | Hueco | Cambio mínimo | Efecto en procesos actuales | Prueba de aceptación | Prueba de regresión |
|---|---|---|---|---|---|---|
| Cola por etapas | `jobs` (+ `engine`), `claim_job` | sin etapas, sin caché | tabla `job_stages` (no existe equivalente por etapa) | ninguno: `claim_job` filtra `engine='v1'` | `job_stages.test.ts` | `rls.test.ts` (claim_job, cola justa) |
| Libro de unidades | `usage_ledger` (solo segundos enteros, sin devolución por etapa) | unidades decimales, release/refund | tabla `credit_ledger` (`usage_ledger` queda de solo lectura) | ninguno | `ledger.test.ts` | `rls.test.ts` (usage_ledger cerrado al cliente) |
| Medidor de cómputo | `ai_usage` (027) | tipo `compute` | ampliar la CHECK de `kind` con `compute`; filas `provider='modal'` | `ai_usage_summary` suma también cómputo | `job_stages.test.ts` | prueba existente «coste y límites de IA» |
| Análisis reutilizable | `transcripts`, `generations.transcript_id` | rango, hablantes, escenas | tabla `analyses` + `transcript_revisions` | ninguno | `v2_core.test.ts` | `rls.test.ts` |
| Composición y plantilla | `clip_versions.composition` | formato/diseño/plantilla consultables | columnas `aspect`, `layout`, `template` en `clip_versions` (sin tabla `compositions`) | ninguno | `v2_core.test.ts`, `compose.test.ts` | pruebas de revisión y brand kit |
| Candidatos y puntuación | `clip_candidates.scores`, `clips.candidate_id` | 5 motivos editoriales | nuevas claves en `scores` (jsonb existente) | ninguno | `select.test.ts` | `packages/selection` existentes |
| Selección robusta | `2fbd1a5`, `1d1024f`, `f74e330` en `run.ts`/`groq.ts` | lógica fuera de módulos probados por etapa | `stages/select.ts` + `@rafaga/selection/modes` | `run.ts` sigue igual para v1 | `select.test.ts` | `groq.test.ts` |
| Estilos de subtítulos | `text_styles`, presets de `subtitles.ts` | estilo por generación | `generations.params.caption_style` | ninguno | `generations.test.ts` | `style.test.ts` |
| Recetas | — (ninguna tabla guarda parámetros con nombre) | «Mis recetas» | tabla `generation_recipes` | ninguno | `v2_core.test.ts` | — |
| Brand kit en el panel | `brand_kits`, `apply_brand_kit` | elección antes de generar | `params.brand_kit_id` | ninguno | `generations.test.ts` | prueba de brand kits |
| Colecciones de clips | `media_collections` (agrupa `media_items`, no clips) | colecciones de clips | tabla `clip_collections` + `clips.collection_id`, `clips.tags` | ninguno | `v2_core.test.ts` | prueba de colecciones |
| Lotes de exportación | `renders`, `delivery_packages` (ligado a una entrega) | lote efímero con ZIP | tabla `export_batches` + `renders.batch_id` | ninguno | `export.test.ts` | prueba de paquetes |
| Publicación | `scheduled_posts` (Calendario, congelado) | estados por plataforma | tabla `publications` | ninguno | `integrations.test.ts` | prueba de calendario |
| Importación | `oauth_connections`, `listDriveVideos`, `checkUrl` | trabajo de importación | tabla `imports` | ninguno | `integrations.test.ts` | prueba OAuth |
| Subida reanudable y cuota | `sources.parts` (031), `storage.objects` (solo Supabase) | sesiones R2, cuota sin listar R2 | tablas `upload_sessions`, `storage_objects` | ninguno | `uploads.test.ts` | `r2.test.ts` |
| Mezzanine y borrado temprano | `sources.storage_path`, `originalKey` | 1080p de trabajo | etapa `mezzanine`; `storage_path` apunta a ella | fuentes v1 intactas | `validate.test.ts` | `source.test.ts` |
| Resultados tipo Opus | `p/[id]/page.tsx` | rejilla, pantalla completa | `ResultsGrid` solo en proyectos v2 | vista v1 intacta | paso 14 | grep de `BriefFields` en la vista v1 |
| Demos (NexusClips) | `/app/demos`, `duplicate_project` | abrir copia editable | botón «Abrir copia editable» | el ejemplo compartido nunca cambia | paso 15 | prueba «proyectos: duplicar» |
| Grupos y mapa temporal (WayinVideo) | `generations` (una por petición) | vista por grupo | cada «Momentos a incluir» = una generación; mapa sobre la línea de tiempo | ninguno | paso 14 | — |
| Métricas de producto | tablas existentes (sin eventos nuevos) | consultas | función `product_metrics` | ninguno | `lifecycle.test.ts` | — |
| Configuración global | `workspace_ai_limits` (por workspace) | presupuesto de toda la cuenta de Modal | tabla `platform_settings` (excepción: sin `workspace_id`) | ninguno | `job_stages.test.ts` | — |

### Métricas de éxito
| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Primer clip visible (fixture del propietario, 18 min) | ≤ 3 min | LC-16, `jobs.metrics->>'first_clip_ms'` |
| Clips entregados o diferencia explicada (10 × 30–60 s) | ≥ 8 o `shortfall` explicado | LC-16 |
| Coste | 0 € | `select public.compute_meter()` + panel de Modal |
| Cobros duplicados | 0 | `select workspace_id, idempotency_key, count(*) from credit_ledger group by 1,2 having count(*) > 1` → 0 filas |
| Deriva vista previa/exportación | ≤ 1 fotograma | `parity.test.ts` |
| Hipótesis de producto (primera pieza aprobada, aceptación, tiempo de corrección, tiempo a segunda variante, piezas aprobadas y descargadas por creador) | se miden, sin objetivo previo | `select public.product_metrics('<ws>', now() - interval '30 days', now())` |

---

## 2. Stack tecnológico

| Capa | Decisión | Por qué (y qué se rechaza) |
|---|---|---|
| Runtime | TypeScript ejecutado por Node ≥24 | convención del repo; rechazado tsx/ts-node |
| Framework / estilos / componentes | Next.js App Router, Tailwind y `apps/web/components/ui/` existentes | diseño fuera de alcance |
| Base de datos y acceso | Supabase Postgres; RPC `security definer` con el JWT del usuario; worker con service role | RLS decide en la BD; el repo no usa ORM |
| Autenticación | Supabase Auth existente | sin cambios |
| Segundo plano | Modal (Starter) + cola `job_stages` en Postgres | Actions no puede procesar medios (términos de GitHub); rechazado servidor propio y el Mac |
| Pagos | NOT APPLICABLE — uso privado | — |
| Archivos | R2 (10 GB) con `presignV4` | ya en uso, sin coste de salida |
| Tiempo real | Supabase Realtime sobre `jobs`, `job_stages`, `clips` | incluido; filas pequeñas |
| Alojamiento | Vercel Hobby | ya desplegado |
| IA | Groq `whisper-large-v3-turbo` y `openai/gpt-oss-120b`; Deepgram mientras dure el crédito | gratuitos |

**Compatibilidad:** comprobado contra `knowledge/stack-compatibility.md` — sin combinaciones conocidas como malas.

---

## 3. Estructura de directorios

```
rafaga-studio/
  CLAUDE.md                          # el Bootstrap lo sustituye por la fusión de workspace/CLAUDE.md (raíz literal + v2)
  AGENTS.md, .claude/{settings.json, skills/*, rules/*}   # Bootstrap (copia de workspace/, confirmada en su propio commit)
  blueprints/rafaga-clipping-v2/     # este bundle; ninguna herramienta lo recorre (§19.6)
  apps/web/app/api/
    wake/route.ts                    # EDITA 6
    jobs/[[...slug]]/route.ts        # NUEVO 4  — cancelar
    uploads/[[...slug]]/route.ts     # NUEVO 7  — subida reanudable, cuota, URL del proxy
    generations/[[...slug]]/route.ts # NUEVO 11 — estimar y crear
    clips/[[...slug]]/route.ts       # NUEVO 15 — versiones, borrador, revisión de transcript, traducción
    exports/[[...slug]]/route.ts     # NUEVO 16 — exportar, reintentar, URL
    [integration]/[[...rest]]/route.ts  # NUEVO 17 — /api/import/{link,drive,dropbox}, /api/publish
  apps/web/app/app/
    nuevo/page.tsx (EDITA 11) · p/[id]/page.tsx (EDITA 10, 14; vista v2 detrás de engine v2) · c/[id]/page.tsx (EDITA 15)
    demos/page.tsx (EDITA 15) · exports/page.tsx (EDITA 16) · uso/page.tsx (NUEVO 18)
  apps/web/components/
    ProjectList.tsx (EDITA 4) · UploadPanel.tsx (NUEVO 8) · ProcessingPanel.tsx (NUEVO 10)
    CreationPanel.tsx (NUEVO 11) · PreviewPlayer.tsx (NUEVO 14, incluye pantalla completa) · ResultsGrid.tsx (NUEVO 14, vista v2)
  apps/web/lib/
    api.ts, api.test.ts (3) · jobs.test.ts (4) · wake.test.ts (6) · uploads.test.ts (7)
    uploader.ts, uploader.test.ts, hash.worker.ts (8) · progress.ts, progress.test.ts (9)
    generations.ts, generations.test.ts (11) · editor.ts, editor.test.ts (15) · exports.test.ts (16)
    integrations.test.ts, oauthserver.ts [EDITA] (17)
  packages/providers/src/r2.ts, r2.test.ts (EDITA 7) · oauth.ts (EDITA 17)
  packages/selection/
    package.json                     # EDITA 12 — exports "./modes": "./src/modes.ts"
    src/modes.ts, src/modes.test.ts  # NUEVO 12 (el transcript de prueba vive dentro de modes.test.ts)
  packages/composition/src/
    layouts.ts                       # NUEVO 13 (diseños, plantillas virales); EDITA 14 (sceneAt) — motor compartido
    safezones.ts                     # NUEVO 13 — zonas seguras con su fuente
    index.ts                         # EDITA 13 — export * de layouts.ts y safezones.ts
    parity.test.ts                   # NUEVO 14 (transcript de prueba propio; composition no depende de selection)
  workers/media/src/
    stage.ts, stages/{registry,runner,hash}.ts, stages.test.ts      # NUEVO 5
    stages/validate.ts (validate + mezzanine), fixtures.ts, validate.test.ts      # NUEVO 9
    stages/analysis.ts, groqlimits.ts, analysis.test.ts             # NUEVO 10
    stages/select.ts, select.test.ts                                # NUEVO 12
    stages/compose.ts, compose.test.ts                              # NUEVO 13
    stages/export.ts, export.test.ts                                # NUEVO 16
    stages/integrations.ts                                          # NUEVO 17
    stages/purge.ts, lifecycle.test.ts                              # NUEVO 18 (stage.ts ya lo carga con import())
    run.ts                                                          # SIN CAMBIOS — bucle heredado (con los arreglos desplegados)
  workers/modal/app.py, requirements.txt, README.md                 # NUEVO 6
  supabase/migrations/20261113000034_clipping_v2_core.sql (2) · …035_credit_ledger.sql (3)
                      …036_job_stages.sql (4) · …037_upload_storage.sql (7)
  supabase/tests/migrate.ts, migrate.test.ts (1) · rls.test.ts (EDITA 1) · v2_core.test.ts (2)
                 ledger.test.ts, fake-supabase.ts (3) · job_stages.test.ts (4)
  scripts/r2-multipart-probe.ts (8) · perf-run.ts (18)
  docs/PERF.md (18, lo escribe perf-run.ts)
  .fixtures/                         # ignorado — fixtures ffmpeg -f lavfi
```

### Delta
Añadidos: lo marcado NUEVO. Modificados: lo marcado EDITA. Borrados: ninguno (D1 lo hace tras la construcción).
`BriefFields.tsx` y `BriefUnderstanding.tsx` siguen usándose en la vista v1 de `p/[id]` y no se borran.

### Reglas de frontera
- `workers/media/src/stages/*.ts` nunca importa `@supabase/supabase-js`; recibe `StageCtx` (`rpc`, `db`, `r2`, `fetch`,
  `ffmpeg`, `ffprobe`, `tmpDir`, `env`, `log`). Solo `stage.ts` crea el cliente.
- Una ruta de `apps/web/app/api/**` solo exporta métodos HTTP y `dynamic`, responde con `Response.json` y lee la BD solo
  por RPC como el usuario (`rpcAs`). Sus pruebas en `apps/web/lib/*.test.ts` importan el `route.ts`.
- Solo la migración 035 inserta en `credit_ledger`.
- Vista previa y exportación toman cajas y tiempos de `planLayout`/`sceneAt` (`@rafaga/composition`); las zonas seguras
  solo se dibujan en la vista previa.
- `packages/composition` no depende de `packages/selection`; cada prueba define su propio transcript de prueba.
- Convención de imports reconciliada en §19.6.

---

## 4. Modelo de datos

### Entidades y correspondencia
Proyecto = `projects`; Archivo fuente = `sources` (tras la mezzanine, `storage_path` apunta a ella); Análisis =
`analyses` (+ `transcripts`, `transcript_revisions`); Generación = `generations` (una por petición, también cada
«Momentos a incluir» distinto); Clip = `clips` (+ `clip_candidates.scores`); Composición = `clip_versions.aspect/
layout/template` + `composition` jsonb; Versión = `clip_versions` (inmutable); Exportación = `renders`
(+ `export_batches`). Una fuente → muchas generaciones; un clip → muchas versiones y exportaciones.

`clip_candidates.scores` (jsonb existente) guarda los 5 motivos editoriales: `{gancho, desarrollo, valor, afinidad,
calidad_tecnica}` en 0–1, `overall` 0–100 y `notes` (texto por motivo).

### Delta
| Tipo | Detalle | Migración |
|---|---|---|
| Tablas nuevas | `analyses`, `transcript_revisions`, `generation_recipes`, `clip_collections`, `clip_drafts`, `export_batches`, `publications`, `imports` | 034 |
| | `credit_accounts`, `credit_ledger` | 035 |
| | `platform_settings`, `job_stages`; vista `stage_timings` | 036 |
| | `upload_sessions`, `storage_objects` | 037 |
| Columnas añadidas | `generations`: `analysis_id`, `mode`, `component_versions`, `units_reserved`, `units_consumed`, `warnings`, `errors`, `requested_count`, `delivered_count`, `cancelled_at` | 034 |
| | `clips`: `editorial_state`, `technical_state`, `user_edited`, `needs_review`, `topic`, `tags`, `collection_id` | 034 |
| | `clip_versions`: `aspect`, `layout`, `template` (+ trigger de inmutabilidad) | 034 |
| | `renders`: `kind`, `settings_hash`, `bytes`, `duration_ms`, `width`, `height`, `expires_at`, `error_code`, `batch_id`, `downloaded_at` (+ `unique (workspace_id, id)`) | 034 |
| | `jobs`: `engine`, `units_reserved`, `cancel_requested_at`, `request_hash` | 036 |
| | `sources`: `sha256_prefix` · `projects`: `purge_at` | 037 |
| CHECK reescritas (superconjuntos de las vigentes) | `jobs.kind` (+ `generation`, `export`, `import`, `publish`, `translate`), `jobs.status` (+ `running`), `ai_usage.kind` (+ `compute`), `oauth_connections.provider` si existe (+ `tiktok`) | 036, 034 |
| Funciones recreadas con el mismo contrato | `claim_job` (+ `engine = 'v1'`), `scheduler_tick` (+ `engine = 'v1'`), `oauth_save` (+ `tiktok`) | 036, 036, 034 |
| Funciones nuevas | 034: `save_clip_version`, `save_clip_draft`, `apply_transcript_revision`, `set_editorial_state` · 035: `_ledger_write`, `grant_units`, `reserve_units`, `settle_units`, `refund_units`, `units_balance` · 036: `compute_meter`, `stage_eta`, `enqueue_job`, `claim_stage`, `heartbeat_stage`, `find_cached_stage`, `finish_stage`, `sweep_stale`, `cancel_job`, `dispatch_plan`, `keep_alive`, `enqueue_due_publications`, `request_generation` · 037: `storage_used`, `create_upload_session`, `upload_session`, `set_upload_r2_id`, `complete_upload`, `abort_upload`, `source_object`, `record_object`, `purge_candidates`, `mark_purged`, `trash_project`, `restore_project`, `storage_summary`, `product_metrics` | |
| Borrado | ninguno (ni tablas, ni columnas, ni funciones) | — |

### Claves de objetos en R2
| Objeto | Clave |
|---|---|
| Original (se borra tras la mezzanine) | `<ws>/<source>/original` (+ `.partNNN`) |
| Mezzanine 1080p | `<ws>/<source>/mezzanine.mp4` |
| Proxy 720p · audio · miniatura | `<ws>/<source>/proxy.mp4` · `audio.opus` · `thumb.jpg` |
| Miniatura de clip | `<ws>/<clip>/preview.jpg` |
| Exportación | `<ws>/<clip>/v<version>-<12 hex de spec_sha256>.<ext>` |
| ZIP de lote · salida grande de etapa | `<ws>/batches/<batch>.zip` · `<ws>/stages/<stage_id>.json` |

### Relaciones y cascadas
`sources→analyses` cascada · `transcripts→transcript_revisions` cascada · `analyses→generations` sin cascada ·
`clips→clip_versions`, `clips→clip_drafts` cascada · `clip_collections→clips` `set null (collection_id)` ·
`export_batches→renders` `set null (batch_id)` · `jobs→job_stages` cascada · `renders→publications` sin cascada ·
`sources→upload_sessions` cascada.

### Índices
`analyses(workspace_id, source_id, status)` · `job_stages(status, job_id, seq) where queued` ·
`job_stages(workspace_id, stage, input_hash) where done` · `job_stages(lease_until) where running` ·
`credit_ledger unique(workspace_id, idempotency_key)` · `storage_objects(workspace_id) where purged_at is null` ·
`sources(workspace_id, bytes, sha256_prefix)`.

### Esquema
SQL de referencia: cada paso lo pega en su migración y solo lo corrige si una prueba demuestra un error, sin cambiar
nombres, firmas ni códigos de error. Toda función `security definer` lleva `set search_path = public` y termina con
`revoke all … from public, anon` + `grant execute` explícito (`authenticated` para cliente, `service_role` para worker),
porque `PUBLIC` ejecuta funciones nuevas por defecto. Ninguna tabla nueva concede nada a `anon`.

#### 034 — `supabase/migrations/20261113000034_clipping_v2_core.sql` (paso 2)
```sql
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid not null, version int not null check (version >= 1),
  range_start_ms bigint not null default 0 check (range_start_ms >= 0), range_end_ms bigint not null,
  transcript_id uuid, transcript_revision int not null default 1 check (transcript_revision >= 1),
  language text check (language is null or language ~ '^[a-z]{2}$'),
  speakers jsonb not null default '[]', scenes jsonb not null default '[]', audio_signals jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  component_versions jsonb not null default '{}', created_at timestamptz not null default now(),
  check (range_end_ms > range_start_ms), unique (workspace_id, id), unique (source_id, version),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id) on delete cascade,
  foreign key (workspace_id, transcript_id) references public.transcripts(workspace_id, id));
create index if not exists analyses_source_idx on public.analyses(workspace_id, source_id, status);

create table if not exists public.transcript_revisions (
  workspace_id uuid not null, transcript_id uuid not null, revision int not null check (revision >= 2),
  words jsonb not null check (jsonb_typeof(words) = 'array'), edited_by uuid references auth.users(id),
  created_at timestamptz not null default now(), primary key (transcript_id, revision),
  unique (workspace_id, transcript_id, revision),
  foreign key (workspace_id, transcript_id) references public.transcripts(workspace_id, id) on delete cascade);

alter table public.generations add column if not exists analysis_id uuid;
alter table public.generations add column if not exists mode text check (mode is null or mode in
  ('automatico','por_tema','pregunta_respuesta','educativo','historia','destacados','manual'));
alter table public.generations add column if not exists component_versions jsonb not null default '{}';
alter table public.generations add column if not exists units_reserved numeric(10,2) not null default 0;
alter table public.generations add column if not exists units_consumed numeric(10,2) not null default 0;
alter table public.generations add column if not exists warnings jsonb not null default '[]';
alter table public.generations add column if not exists errors jsonb not null default '[]';
alter table public.generations add column if not exists requested_count int check (requested_count is null or requested_count between 1 and 20);
alter table public.generations add column if not exists delivered_count int check (delivered_count is null or delivered_count >= 0);
alter table public.generations add column if not exists cancelled_at timestamptz;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'generations_analysis_fk') then
  alter table public.generations add constraint generations_analysis_fk foreign key (workspace_id, analysis_id)
    references public.analyses(workspace_id, id); end if; end $$;

create table if not exists public.generation_recipes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  params jsonb not null check (jsonb_typeof(params) = 'object' and pg_column_size(params) < 8000),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));

create table if not exists public.clip_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));
alter table public.clips add column if not exists editorial_state text not null default 'pendiente'
  check (editorial_state in ('pendiente','en_revision','aprobado','descartado'));
alter table public.clips add column if not exists technical_state text not null default 'disponible'
  check (technical_state in ('preparando','disponible','exportando','fallido'));
alter table public.clips add column if not exists user_edited boolean not null default false;
alter table public.clips add column if not exists needs_review boolean not null default false;
alter table public.clips add column if not exists topic text check (topic is null or char_length(topic) <= 120);
alter table public.clips add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 20);
alter table public.clips add column if not exists collection_id uuid;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'clips_collection_fk') then
  alter table public.clips add constraint clips_collection_fk foreign key (workspace_id, collection_id)
    references public.clip_collections(workspace_id, id) on delete set null (collection_id); end if; end $$;
grant update (tags, collection_id, topic) on public.clips to authenticated;

alter table public.clip_versions add column if not exists aspect text check (aspect is null or aspect in ('9:16','16:9','1:1'));
alter table public.clip_versions add column if not exists layout text check (layout is null or layout in
  ('single_track','split_two','active_speaker','screen_presenter','fit_full','manual'));
alter table public.clip_versions add column if not exists template text check (template is null or template ~ '^[a-z0-9_]{1,40}$');
create or replace function public.clip_versions_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;  -- cascada desde clips
  raise exception 'clip_versions_immutable' using errcode = 'P0001';
end $$;
drop trigger if exists clip_versions_immutable on public.clip_versions;
create trigger clip_versions_immutable before update or delete on public.clip_versions
  for each row execute function public.clip_versions_immutable();

create table if not exists public.clip_drafts (
  clip_id uuid primary key, workspace_id uuid not null, base_version int not null check (base_version >= 1),
  spec jsonb not null check (pg_column_size(spec) < 200000), updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(), unique (workspace_id, clip_id),
  foreign key (workspace_id, clip_id) references public.clips(workspace_id, id) on delete cascade);

alter table public.renders add column if not exists kind text not null default 'mp4'
  check (kind in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl'));
alter table public.renders add column if not exists settings_hash text;
alter table public.renders add column if not exists bytes bigint check (bytes is null or bytes >= 0);
alter table public.renders add column if not exists duration_ms bigint;
alter table public.renders add column if not exists width int;
alter table public.renders add column if not exists height int;
alter table public.renders add column if not exists expires_at timestamptz;
alter table public.renders add column if not exists error_code text;
alter table public.renders add column if not exists batch_id uuid;
alter table public.renders add column if not exists downloaded_at timestamptz;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'renders_ws_id_key') then
  alter table public.renders add constraint renders_ws_id_key unique (workspace_id, id); end if; end $$;
create table if not exists public.export_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  status text not null default 'queued' check (status in ('queued','running','partial','ready','failed','cancelled')),
  zip_requested boolean not null default false,
  zip_path text check (zip_path is null or zip_path like workspace_id::text || '/%'),
  zip_bytes bigint, zip_expires_at timestamptz, job_id uuid,
  created_at timestamptz not null default now(), unique (workspace_id, id));
do $$ begin if not exists (select 1 from pg_constraint where conname = 'renders_batch_fk') then
  alter table public.renders add constraint renders_batch_fk foreign key (workspace_id, batch_id)
    references public.export_batches(workspace_id, id) on delete set null (batch_id); end if; end $$;

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade, render_id uuid not null,
  platform text not null check (platform in ('youtube','tiktok')),
  title text not null check (char_length(title) between 1 and 100),
  description text check (description is null or char_length(description) <= 5000),
  privacy text not null default 'private' check (privacy in ('private','unlisted','public',
    'SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','PUBLIC_TO_EVERYONE')),
  external_id text,
  state text not null default 'queued' check (state in ('queued','uploading','processing','private_pending_review',
    'requiere_auditoria','published','scheduled','failed','cancelled')),
  scheduled_at timestamptz, error_code text, error_message text check (error_message is null or char_length(error_message) <= 500),
  job_id uuid, created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  unique (workspace_id, id), foreign key (workspace_id, render_id) references public.renders(workspace_id, id));
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('drive','dropbox','link')), ref text not null check (char_length(ref) between 1 and 2048),
  state text not null default 'queued' check (state in ('queued','downloading','done','failed','cancelled')),
  source_id uuid, bytes bigint check (bytes is null or bytes >= 0), error_code text, job_id uuid,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), unique (workspace_id, id));
-- TikTok: recrear public.oauth_save copiando su cuerpo de 20261110000029_oauth_connections.sql con la lista de
-- proveedores ('google','dropbox','tiktok'); ampliar igual la CHECK de oauth_connections.provider si existe.

do $$ declare t text; begin
  foreach t in array array['analyses','transcript_revisions','generation_recipes','clip_collections','clip_drafts',
                           'export_batches','publications','imports'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select on public.%1$s to authenticated', t);
  end loop;
  foreach t in array array['generation_recipes','clip_collections'] loop
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.can_edit(workspace_id) and created_by = auth.uid())', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.can_edit(workspace_id))', t);
    execute format('grant insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

create or replace function public.save_clip_version(p_clip uuid, p_base_version int, p_aspect text, p_layout text,
  p_template text, p_spec jsonb, p_user_edit boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v int;
begin
  select id, workspace_id, current_version into c from public.clips where id = p_clip for update;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.current_version <> p_base_version then return jsonb_build_object('conflict', true, 'current_version', c.current_version); end if;
  v := c.current_version + 1;
  insert into public.clip_versions(clip_id, workspace_id, version, composition, aspect, layout, template, created_by)
    values (p_clip, c.workspace_id, v, p_spec, p_aspect, p_layout, p_template, auth.uid());
  update public.clips set current_version = v, user_edited = (user_edited or p_user_edit) where id = p_clip;
  delete from public.clip_drafts where clip_id = p_clip;
  return jsonb_build_object('version', v);
end $$;

create or replace function public.save_clip_draft(p_clip uuid, p_base_version int, p_spec jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare c record; ts timestamptz := now();
begin
  select id, workspace_id into c from public.clips where id = p_clip;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.clip_drafts(clip_id, workspace_id, base_version, spec, updated_by, updated_at)
    values (p_clip, c.workspace_id, p_base_version, p_spec, auth.uid(), ts)
  on conflict (clip_id) do update set base_version = excluded.base_version, spec = excluded.spec,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return ts;
end $$;

create or replace function public.apply_transcript_revision(p_transcript uuid, p_words jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; r int; ids uuid[];
begin
  select id, workspace_id into t from public.transcripts where id = p_transcript;
  if not found or not public.can_edit(t.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_words) <> 'array' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(p_transcript::text));
  select coalesce(max(revision), 1) + 1 into r from public.transcript_revisions where transcript_id = p_transcript;
  insert into public.transcript_revisions(workspace_id, transcript_id, revision, words, edited_by)
    values (t.workspace_id, p_transcript, r, p_words, auth.uid());
  update public.analyses set transcript_revision = r where transcript_id = p_transcript;
  select coalesce(array_agg(c.id), '{}') into ids from public.clips c join public.generations g on g.id = c.generation_id
   where g.transcript_id = p_transcript and c.user_edited = false;
  return jsonb_build_object('revision', r, 'follow_clips', to_jsonb(ids));
end $$;

create or replace function public.set_editorial_state(p_clip uuid, p_state text) returns text
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select workspace_id into ws from public.clips where id = p_clip;
  if ws is null or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
       and m.role in ('owner','admin','editor','reviewer')) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_state not in ('pendiente','en_revision','aprobado','descartado') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  update public.clips set editorial_state = p_state where id = p_clip;
  return p_state;
end $$;
revoke all on function public.save_clip_version(uuid,int,text,text,text,jsonb,boolean), public.save_clip_draft(uuid,int,jsonb),
  public.apply_transcript_revision(uuid,jsonb), public.set_editorial_state(uuid,text) from public, anon;
grant execute on function public.save_clip_version(uuid,int,text,text,text,jsonb,boolean), public.save_clip_draft(uuid,int,jsonb),
  public.apply_transcript_revision(uuid,jsonb), public.set_editorial_state(uuid,text) to authenticated;
```

#### 035 — `supabase/migrations/20261113000035_credit_ledger.sql` (paso 3)
```sql
create table if not exists public.credit_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  balance numeric(10,2) not null default 0 check (balance >= 0), updated_at timestamptz not null default now());
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('grant','reserve','settle','release','refund')), units numeric(10,2) not null,
  job_id uuid, generation_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  note text check (note is null or char_length(note) <= 200), created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), unique (workspace_id, id), unique (workspace_id, idempotency_key),
  check ((kind = 'reserve' and units < 0) or (kind in ('grant','release','refund') and units > 0) or (kind = 'settle' and units = 0)));
alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;
drop policy if exists credit_accounts_select on public.credit_accounts;
drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_accounts_select on public.credit_accounts for select to authenticated using (public.is_member(workspace_id));
create policy credit_ledger_select on public.credit_ledger for select to authenticated using (public.is_member(workspace_id));
revoke all on public.credit_accounts, public.credit_ledger from anon, authenticated;
grant select on public.credit_accounts, public.credit_ledger to authenticated;

-- Escritura única (no expuesta): bloquea la cuenta, aplica idempotencia, mueve el saldo.
create or replace function public._ledger_write(p_ws uuid, p_kind text, p_units numeric, p_job uuid, p_gen uuid, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric(10,2); prev record; lid uuid;
begin
  insert into public.credit_accounts(workspace_id) values (p_ws) on conflict (workspace_id) do nothing;
  select balance into bal from public.credit_accounts where workspace_id = p_ws for update;
  select id into prev from public.credit_ledger where workspace_id = p_ws and idempotency_key = p_key;
  if found then return jsonb_build_object('ledger_id', prev.id, 'replay', true, 'balance', bal); end if;
  if p_kind = 'reserve' and bal < -p_units then
    raise exception 'insufficient_units' using errcode = 'P0001', detail = json_build_object('needed', -p_units, 'balance', bal)::text;
  end if;
  insert into public.credit_ledger(workspace_id, kind, units, job_id, generation_id, idempotency_key, note)
    values (p_ws, p_kind, p_units, p_job, p_gen, p_key, p_note) returning id into lid;
  update public.credit_accounts set balance = balance + p_units, updated_at = now() where workspace_id = p_ws;
  return jsonb_build_object('ledger_id', lid, 'replay', false, 'balance', bal + p_units);
end $$;
create or replace function public.grant_units(p_ws uuid, p_units numeric, p_note text, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (select 1 from public.workspace_members where workspace_id = p_ws
       and user_id = auth.uid() and role = 'owner') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_units <= 0 then raise exception 'invalid_units' using errcode = 'P0001'; end if;
  return public._ledger_write(p_ws, 'grant', p_units, null, null, p_key, p_note);
end $$;
create or replace function public.reserve_units(p_ws uuid, p_units numeric, p_job uuid, p_gen uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_edit(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_units <= 0 then raise exception 'invalid_units' using errcode = 'P0001'; end if;
  return public._ledger_write(p_ws, 'reserve', -p_units, p_job, p_gen, p_key, null);
end $$;
create or replace function public.settle_units(p_ws uuid, p_job uuid, p_key text, p_reserved numeric, p_actual numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public._ledger_write(p_ws, 'settle', 0, p_job, null, p_key, null);
  if (r->>'replay')::boolean = false and p_actual < p_reserved then
    perform public._ledger_write(p_ws, 'release', p_reserved - p_actual, p_job, null, p_key || ':release', null);
  end if;
  return r;
end $$;
create or replace function public.refund_units(p_ws uuid, p_job uuid, p_key text, p_units numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_units <= 0 then return jsonb_build_object('replay', false, 'skipped', true); end if;
  return public._ledger_write(p_ws, 'refund', p_units, p_job, null, p_key, p_reason);
end $$;
create or replace function public.units_balance(p_ws uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return coalesce((select balance from public.credit_accounts where workspace_id = p_ws), 0);
end $$;
revoke all on function public._ledger_write(uuid,text,numeric,uuid,uuid,text,text), public.grant_units(uuid,numeric,text,text),
  public.reserve_units(uuid,numeric,uuid,uuid,text), public.settle_units(uuid,uuid,text,numeric,numeric),
  public.refund_units(uuid,uuid,text,numeric,text), public.units_balance(uuid) from public, anon, authenticated;
grant execute on function public.grant_units(uuid,numeric,text,text), public.reserve_units(uuid,numeric,uuid,uuid,text),
  public.units_balance(uuid) to authenticated;
grant execute on function public.grant_units(uuid,numeric,text,text), public.reserve_units(uuid,numeric,uuid,uuid,text),
  public.settle_units(uuid,uuid,text,numeric,numeric), public.refund_units(uuid,uuid,text,numeric,text),
  public.units_balance(uuid) to service_role;
```

#### 036 — `supabase/migrations/20261113000036_job_stages.sql` (paso 4)
```sql
alter table public.jobs add column if not exists engine text not null default 'v1';
do $$ begin if not exists (select 1 from pg_constraint where conname = 'jobs_engine_check') then
  alter table public.jobs add constraint jobs_engine_check check (engine in ('v1','v2')); end if; end $$;
alter table public.jobs add column if not exists units_reserved numeric(10,2) not null default 0;
alter table public.jobs add column if not exists cancel_requested_at timestamptz;
alter table public.jobs add column if not exists request_hash text;
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('ingest','transcribe','detect','render','live',
  'automation','lyrics','package','reframe','generation','export','import','publish','translate'));
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%validating%' loop
    execute format('alter table public.jobs drop constraint %I', c); end loop; end $$;
alter table public.jobs add constraint jobs_status_check check (status in ('queued','validating','extracting','transcribing',
  'selecting','tracking','rendering','running','done','failed','cancelled'));
-- Cómputo en ai_usage (027): kind 'compute' (ampliación aditiva de la CHECK).
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('stt','llm','vision','render','storage','transfer','compute'));

-- El worker heredado nunca reclama trabajos v2 (copia literal de 025 + filtro engine).
create or replace function public.claim_job() returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j set status = 'validating', attempts = j.attempts + 1, heartbeat_at = now(), updated_at = now(), started_at = coalesce(j.started_at, now())
  where j.id = (
    select q.id from public.jobs q
    where q.engine = 'v1' and q.kind in ('detect','render','lyrics','automation','live','package','reframe') and q.attempts < 3
      and (q.status = 'queued' or (q.status not in ('done','failed','cancelled') and q.heartbeat_at < now() - interval '15 minutes'))
    order by (q.kind = 'live') desc, (q.kind = 'render') desc,
      (select count(*) from public.jobs r where r.workspace_id = q.workspace_id and r.status not in ('queued','done','failed','cancelled')), q.created_at
    limit 1 for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_job() from public, anon, authenticated;
-- public.scheduler_tick(): recrear copiando su cuerpo de 20261110000015_scheduler.sql con `and engine = 'v1'` en el
-- UPDATE de huérfanos y en el recuento n_pend; mantener su revoke.

create table if not exists public.platform_settings (   -- excepción deliberada: global, sin workspace_id (§20.3 #9)
  key text primary key check (key in ('compute_budget_usd','modal_rate_card')), value jsonb,
  updated_at timestamptz not null default now());
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
insert into public.platform_settings(key, value) values ('compute_budget_usd', '30'), ('modal_rate_card', null)
  on conflict (key) do nothing;   -- modal_rate_card = {"usd_per_core_s": x, "usd_per_gib_s": y}, lo escribe el propietario (LC-5)

create table if not exists public.job_stages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, job_id uuid not null,
  stage text not null check (stage in ('validate','mezzanine','proxy','prepare','transcribe','scenes','speakers','candidates',
    'select','compose','previews','checks','render','zip','import','publish','translate')),
  seq int not null check (seq between 1 and 99),
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled','skipped')),
  attempts int not null default 0 check (attempts between 0 and 3), lease_until timestamptz, worker_id text,
  input_hash text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  output jsonb check (output is null or pg_column_size(output) <= 8192),
  params jsonb not null default '{}' check (pg_column_size(params) <= 8192),
  units numeric(10,2) not null default 0 check (units >= 0), started_at timestamptz, finished_at timestamptz,
  cost_core_s numeric(12,2) not null default 0, error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  updated_at timestamptz not null default now(), unique (workspace_id, id),
  foreign key (workspace_id, job_id) references public.jobs(workspace_id, id) on delete cascade);
create index if not exists job_stages_queue_idx on public.job_stages(status, job_id, seq) where status = 'queued';
create index if not exists job_stages_cache_idx on public.job_stages(workspace_id, stage, input_hash) where status = 'done';
create index if not exists job_stages_lease_idx on public.job_stages(lease_until) where status = 'running';
alter table public.job_stages enable row level security;
drop policy if exists job_stages_select on public.job_stages;
create policy job_stages_select on public.job_stages for select to authenticated using (public.is_member(workspace_id));
revoke all on public.job_stages from anon, authenticated;
grant select on public.job_stages to authenticated;

create or replace view public.stage_timings with (security_invoker = true) as
  select s.stage, count(*)::int as samples,
    percentile_cont(0.5) within group (order by extract(epoch from s.finished_at - s.started_at) / greatest((j.params->>'source_minutes')::numeric, 0.1)) as p50_s_per_min,
    percentile_cont(0.9) within group (order by extract(epoch from s.finished_at - s.started_at) / greatest((j.params->>'source_minutes')::numeric, 0.1)) as p90_s_per_min
  from public.job_stages s join public.jobs j on j.id = s.job_id
  where s.status = 'done' and s.started_at is not null and s.finished_at is not null and j.params ? 'source_minutes'
    and s.finished_at > now() - interval '60 days'
  group by s.stage;

create or replace function public.compute_meter() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare spent numeric; budget numeric; rate jsonb; has_rate boolean;
begin
  select coalesce(sum(cost_usd), 0) into spent from public.ai_usage
   where provider = 'modal' and kind = 'compute' and created_at >= date_trunc('month', now());
  select (value #>> '{}')::numeric into budget from public.platform_settings where key = 'compute_budget_usd';
  select value into rate from public.platform_settings where key = 'modal_rate_card';
  has_rate := rate is not null and jsonb_typeof(rate) = 'object';
  return jsonb_build_object('month_usd', round(spent, 4), 'budget_usd', budget,
    'pct', case when budget > 0 then round(100 * spent / budget, 1) end, 'rate_card_set', has_rate,
    'blocked', (not has_rate) or spent >= 0.9 * budget);
end $$;

-- null si alguna etapa pedida tiene < 5 muestras; si no, suma de p50/p90 × minutos.
create or replace function public.stage_eta(p_minutes numeric, p_stages text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p50 numeric := 0; p90 numeric := 0; r record;
begin
  for r in select u.st, t.samples, t.p50_s_per_min, t.p90_s_per_min
             from unnest(p_stages) as u(st) left join public.stage_timings t on t.stage = u.st loop
    if r.samples is null or r.samples < 5 then return null; end if;
    p50 := p50 + r.p50_s_per_min * p_minutes; p90 := p90 + r.p90_s_per_min * p_minutes;
  end loop;
  return jsonb_build_object('p50_s', round(p50), 'p90_s', round(p90));
end $$;

-- p_stages = [{"stage":"transcribe","seq":2,"units":30.00,"params":{…}}, …]; p_request_hash por defecto md5(etapas||params).
create or replace function public.enqueue_job(p_ws uuid, p_kind text, p_stages jsonb, p_idem text, p_params jsonb,
  p_project uuid, p_generation uuid, p_request_hash text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; jid uuid := gen_random_uuid(); total numeric(10,2); m jsonb; s jsonb; h text;
begin
  if auth.uid() is not null and not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 128 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  h := coalesce(p_request_hash, md5(p_stages::text || coalesce(p_params::text, '')));
  select id, units_reserved, request_hash into prev from public.jobs where workspace_id = p_ws and idempotency_key = p_idem;
  if found then
    if prev.request_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('job_id', prev.id, 'replay', true, 'units_reserved', prev.units_reserved);
  end if;
  m := public.compute_meter();
  if not (m->>'rate_card_set')::boolean then raise exception 'compute_rate_card_missing' using errcode = 'P0001'; end if;
  if (m->>'blocked')::boolean then raise exception 'compute_budget_exhausted' using errcode = 'P0001', detail = m::text; end if;
  select coalesce(sum((x->>'units')::numeric), 0) into total from jsonb_array_elements(p_stages) x;
  if total > 0 then perform public.reserve_units(p_ws, total, jid, p_generation, 'reserve:' || p_idem); end if;
  insert into public.jobs(id, workspace_id, kind, status, idempotency_key, project_id, generation_id, params, engine,
                          units_reserved, request_hash, created_by)
    values (jid, p_ws, p_kind, 'queued', p_idem, p_project, p_generation, coalesce(p_params, '{}'), 'v2', total, h, auth.uid());
  for s in select * from jsonb_array_elements(p_stages) loop
    insert into public.job_stages(workspace_id, job_id, stage, seq, units, params)
      values (p_ws, jid, s->>'stage', (s->>'seq')::int, coalesce((s->>'units')::numeric, 0), coalesce(s->'params', '{}'));
  end loop;
  return jsonb_build_object('job_id', jid, 'replay', false, 'units_reserved', total);
end $$;

create or replace function public.claim_stage(p_worker text, p_lease_s int default 90) returns setof public.job_stages
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.job_stages s set status = 'running', attempts = s.attempts + 1, worker_id = p_worker,
         lease_until = now() + make_interval(secs => p_lease_s), started_at = coalesce(s.started_at, now()), updated_at = now()
   where s.id = (
     select q.id from public.job_stages q join public.jobs j on j.id = q.job_id
      where q.status = 'queued' and j.engine = 'v2' and j.cancel_requested_at is null and j.status not in ('done','failed','cancelled')
        and not exists (select 1 from public.job_stages p where p.job_id = q.job_id and p.seq < q.seq and p.status not in ('done','skipped'))
      order by j.created_at, q.seq limit 1 for update of q skip locked)
  returning s.*;
  update public.jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now(),
         metrics = metrics || jsonb_build_object('queue_ms', coalesce((metrics->>'queue_ms')::bigint, (extract(epoch from now() - created_at) * 1000)::bigint))
   where status = 'queued' and id in (select job_id from public.job_stages where worker_id = p_worker and status = 'running');
end $$;

create or replace function public.heartbeat_stage(p_stage uuid, p_worker text, p_lease_s int default 90) returns boolean
language plpgsql security definer set search_path = public as $$
declare cancelled boolean;
begin
  update public.job_stages set lease_until = now() + make_interval(secs => p_lease_s), updated_at = now()
   where id = p_stage and worker_id = p_worker and status = 'running';
  select j.cancel_requested_at is not null into cancelled from public.jobs j join public.job_stages s on s.job_id = j.id where s.id = p_stage;
  return not coalesce(cancelled, true);   -- false = cancelado: el worker aborta
end $$;

create or replace function public.find_cached_stage(p_ws uuid, p_stage text, p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select output from public.job_stages where workspace_id = p_ws and stage = p_stage and input_hash = p_hash and status = 'done'
  order by finished_at desc limit 1 $$;

-- Cierra una etapa (done | skipped por caché | failed | cancelled): liquida o devuelve unidades y registra cómputo en ai_usage.
create or replace function public.finish_stage(p_stage uuid, p_worker text, p_status text, p_output jsonb, p_input_hash text,
  p_core_s numeric, p_mem_gib_s numeric, p_error_code text, p_error_message text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; x record; rate jsonb; retry boolean;
begin
  select * into s from public.job_stages where id = p_stage and worker_id = p_worker for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select value into rate from public.platform_settings where key = 'modal_rate_card';
  insert into public.ai_usage(workspace_id, job_id, kind, provider, model, units, cost_usd, billed_usd, measured)
    values (s.workspace_id, s.job_id, 'compute', 'modal', s.stage,
            jsonb_build_object('core_s', coalesce(p_core_s, 0), 'mem_gib_s', coalesce(p_mem_gib_s, 0), 'stage_id', s.id),
            coalesce(p_core_s, 0) * coalesce((rate->>'usd_per_core_s')::numeric, 0)
          + coalesce(p_mem_gib_s, 0) * coalesce((rate->>'usd_per_gib_s')::numeric, 0), 0, false);
  retry := p_status = 'failed' and s.attempts < 3 and coalesce(p_error_code, '') not in
           ('unsupported_file','corrupt_file','unsupported_container','too_long','too_large','no_moments','insufficient_units','cancelled');
  update public.job_stages set status = case when retry then 'queued' else p_status end, output = p_output,
         input_hash = coalesce(p_input_hash, input_hash), finished_at = case when retry then null else now() end,
         lease_until = null, worker_id = case when retry then null else worker_id end,
         cost_core_s = cost_core_s + coalesce(p_core_s, 0), error_code = p_error_code,
         error_message = left(p_error_message, 500), updated_at = now() where id = p_stage;
  if p_status = 'done' and s.units > 0 then
    perform public.settle_units(s.workspace_id, s.job_id, 'settle:' || s.id, s.units, coalesce((p_output->>'units_actual')::numeric, s.units));
  elsif p_status in ('skipped','cancelled') and s.units > 0 then
    perform public.refund_units(s.workspace_id, s.job_id, 'refund:' || s.id, s.units, p_status);
  elsif p_status = 'failed' and not retry then
    update public.jobs set status = 'failed', error_code = p_error_code, error_message = left(p_error_message, 500),
           finished_at = now(), updated_at = now() where id = s.job_id;
    for x in select * from public.job_stages where job_id = s.job_id and status in ('queued','failed') and units > 0 loop
      perform public.refund_units(x.workspace_id, x.job_id, 'refund:' || x.id, x.units, coalesce(p_error_code, 'failed'));
    end loop;
    update public.job_stages set status = 'cancelled', updated_at = now() where job_id = s.job_id and status = 'queued';
  end if;
  update public.jobs j set status = 'done', finished_at = now(), updated_at = now()
   where j.id = s.job_id and j.status = 'running'
     and not exists (select 1 from public.job_stages y where y.job_id = j.id and y.status not in ('done','skipped'));
  return jsonb_build_object('status', case when retry then 'queued' else p_status end);
end $$;

create or replace function public.sweep_stale() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; n_requeue int := 0; n_fail int := 0;
begin
  for s in select * from public.job_stages where status = 'running' and lease_until < now() for update skip locked loop
    if s.attempts < 3 then
      update public.job_stages set status = 'queued', lease_until = null, worker_id = null, updated_at = now() where id = s.id;
      n_requeue := n_requeue + 1;
    else
      update public.job_stages set status = 'failed', error_code = 'job_stalled', finished_at = now(), updated_at = now() where id = s.id;
      update public.jobs set status = 'failed', error_code = 'job_stalled', finished_at = now(), updated_at = now() where id = s.job_id;
      perform public.refund_units(s.workspace_id, s.job_id, 'refund:' || s.id, s.units, 'job_stalled');
      update public.job_stages set status = 'cancelled', updated_at = now() where job_id = s.job_id and status = 'queued';
      n_fail := n_fail + 1;
    end if;
  end loop;
  return jsonb_build_object('requeued', n_requeue, 'failed', n_fail);
end $$;

create or replace function public.cancel_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j record; s record; refunded numeric := 0; kept jsonb;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or not public.can_edit(j.workspace_id) or j.engine <> 'v2' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.jobs set cancel_requested_at = coalesce(cancel_requested_at, now()), status = 'cancelled', finished_at = now(), updated_at = now()
   where id = p_job and status not in ('done','failed','cancelled');
  for s in select * from public.job_stages where job_id = p_job and status = 'queued' loop
    update public.job_stages set status = 'cancelled', updated_at = now() where id = s.id;
    if s.units > 0 then perform public.refund_units(s.workspace_id, p_job, 'refund:' || s.id, s.units, 'cancelled'); refunded := refunded + s.units; end if;
  end loop;
  select coalesce(jsonb_agg(stage order by seq), '[]') into kept from public.job_stages where job_id = p_job and status in ('done','skipped');
  return jsonb_build_object('kept', kept, 'refunded_units', refunded);
end $$;

create or replace function public.dispatch_plan() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ready', (select count(*) from public.job_stages q join public.jobs j on j.id = q.job_id
               where q.status = 'queued' and j.engine = 'v2' and j.cancel_requested_at is null
                 and not exists (select 1 from public.job_stages p where p.job_id = q.job_id and p.seq < q.seq and p.status not in ('done','skipped'))),
    'legacy', (select count(*) from public.jobs where engine = 'v1' and status = 'queued' and attempts < 3)) $$;
create or replace function public.keep_alive() returns timestamptz language sql stable as $$ select now() $$;

create or replace function public.enqueue_due_publications() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; r jsonb;
begin
  for p in select * from public.publications where state = 'scheduled' and scheduled_at <= now() for update skip locked loop
    r := public.enqueue_job(p.workspace_id, 'publish', jsonb_build_array(jsonb_build_object('stage','publish','seq',1,'units',0,
           'params', jsonb_build_object('publication_id', p.id))), 'publish:' || p.id, '{}', null, null);
    update public.publications set state = 'queued', job_id = (r->>'job_id')::uuid where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Petición de generación (receta «Clips de vídeo largo»). Unidades: transcribe 1.0/min, select 0.2/min,
-- compose 0.1 × hook.top_n si el gancho está activo (cada clip cuenta como 1 minuto; lo no usado se libera).
create or replace function public.request_generation(p_project uuid, p_params jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr record; src record; prev record; aid uuid; tid uuid; gid uuid := gen_random_uuid();
        minutes numeric(10,2); hook numeric(10,2); stages jsonb; r jsonb; h text := md5(p_params::text);
begin
  select p.id, p.workspace_id, p.source_id into pr from public.projects p where p.id = p_project and p.deleted_at is null;
  if not found or not public.can_edit(pr.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, generation_id, request_hash into prev from public.jobs where workspace_id = pr.workspace_id and idempotency_key = p_idem;
  if found then
    if prev.request_hash is distinct from h then raise exception 'idempotency_conflict' using errcode = 'P0001'; end if;
    return jsonb_build_object('generation_id', prev.generation_id, 'job_id', prev.id, 'replay', true);
  end if;
  select * into src from public.sources where id = pr.source_id;
  if src.status <> 'validated' then raise exception 'source_not_ready' using errcode = 'P0001'; end if;
  minutes := round(((p_params->>'range_end_ms')::numeric - (p_params->>'range_start_ms')::numeric) / 60000, 2);
  hook := case when coalesce((p_params#>>'{hook,enabled}')::boolean, false)
               then round(0.1 * coalesce((p_params#>>'{hook,top_n}')::numeric, 0), 2) else 0 end;
  select a.id, a.transcript_id into aid, tid from public.analyses a
   where a.source_id = src.id and a.status = 'done'
     and a.range_start_ms <= (p_params->>'range_start_ms')::bigint and a.range_end_ms >= (p_params->>'range_end_ms')::bigint
     and a.component_versions->>'asr_model' = p_params#>>'{component_versions,asr_model}'
   order by a.version desc limit 1;
  if aid is not null then
    stages := jsonb_build_array(jsonb_build_object('stage','candidates','seq',1,'units',0),
      jsonb_build_object('stage','select','seq',2,'units', round(minutes * 0.2, 2)), jsonb_build_object('stage','compose','seq',3,'units', hook),
      jsonb_build_object('stage','previews','seq',4,'units',0), jsonb_build_object('stage','checks','seq',5,'units',0));
  else
    insert into public.transcripts(workspace_id, source_id, words) values (pr.workspace_id, src.id, '[]') returning id into tid;
    insert into public.analyses(workspace_id, source_id, version, range_start_ms, range_end_ms, transcript_id, language, component_versions)
      values (pr.workspace_id, src.id, coalesce((select max(version) from public.analyses where source_id = src.id), 0) + 1,
              (p_params->>'range_start_ms')::bigint, (p_params->>'range_end_ms')::bigint, tid,
              nullif(p_params->>'language', 'auto'), coalesce(p_params->'component_versions', '{}')) returning id into aid;
    stages := jsonb_build_array(jsonb_build_object('stage','prepare','seq',1,'units',0),
      jsonb_build_object('stage','transcribe','seq',2,'units', round(minutes * 1.0, 2)), jsonb_build_object('stage','scenes','seq',2,'units',0),
      jsonb_build_object('stage','speakers','seq',3,'units',0), jsonb_build_object('stage','candidates','seq',4,'units',0),
      jsonb_build_object('stage','select','seq',5,'units', round(minutes * 0.2, 2)), jsonb_build_object('stage','compose','seq',6,'units', hook),
      jsonb_build_object('stage','previews','seq',7,'units',0), jsonb_build_object('stage','checks','seq',8,'units',0));
  end if;
  if tid is null then
    insert into public.transcripts(workspace_id, source_id, words) values (pr.workspace_id, src.id, '[]') returning id into tid;
    update public.analyses set transcript_id = tid where id = aid;
  end if;
  insert into public.generations(id, workspace_id, project_id, transcript_id, rubric_version, model, params, analysis_id, mode,
                                 component_versions, requested_count)
    values (gid, pr.workspace_id, p_project, tid, coalesce(p_params#>>'{component_versions,rubric_version}', 'rubric-v1'),
            coalesce(p_params#>>'{component_versions,llm_model}', 'n/a'), p_params, aid, nullif(p_params->>'mode', 'auto'),
            coalesce(p_params->'component_versions', '{}'), nullif(p_params->>'count', '')::int);
  r := public.enqueue_job(pr.workspace_id, 'generation', stages, p_idem,
         p_params || jsonb_build_object('source_minutes', minutes, 'analysis_id', aid, 'generation_id', gid), p_project, gid, h);
  update public.generations set units_reserved = (r->>'units_reserved')::numeric where id = gid;
  return jsonb_build_object('generation_id', gid, 'job_id', r->>'job_id', 'replay', false, 'units_reserved', r->'units_reserved');
end $$;

do $$ declare t text; begin   -- Realtime solo si existe la publicación de Supabase (PGlite no la tiene)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['job_stages','jobs','clips'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t); end if;
    end loop;
  end if;
end $$;

revoke all on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.claim_stage(text,int), public.heartbeat_stage(uuid,text,int), public.find_cached_stage(uuid,text,text),
  public.finish_stage(uuid,text,text,jsonb,text,numeric,numeric,text,text), public.sweep_stale(), public.cancel_job(uuid),
  public.dispatch_plan(), public.keep_alive(), public.enqueue_due_publications(), public.request_generation(uuid,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.cancel_job(uuid), public.request_generation(uuid,jsonb,text) to authenticated;
grant execute on function public.compute_meter(), public.stage_eta(numeric,text[]), public.enqueue_job(uuid,text,jsonb,text,jsonb,uuid,uuid,text),
  public.claim_stage(text,int), public.heartbeat_stage(uuid,text,int), public.find_cached_stage(uuid,text,text),
  public.finish_stage(uuid,text,text,jsonb,text,numeric,numeric,text,text), public.sweep_stale(), public.cancel_job(uuid),
  public.dispatch_plan(), public.keep_alive(), public.enqueue_due_publications(), public.request_generation(uuid,jsonb,text) to service_role;
```

#### 037 — `supabase/migrations/20261113000037_upload_storage.sql` (paso 7)
```sql
alter table public.sources add column if not exists sha256_prefix text check (sha256_prefix is null or sha256_prefix ~ '^[0-9a-f]{64}$');
create index if not exists sources_dup_idx on public.sources(workspace_id, bytes, sha256_prefix) where sha256_prefix is not null;
alter table public.projects add column if not exists purge_at timestamptz;

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade, source_id uuid not null, project_id uuid,
  strategy text not null check (strategy in ('multipart','parts')), r2_upload_id text,
  object_key text not null check (object_key like workspace_id::text || '/%'),
  part_size int not null check (part_size between 5242880 and 47185920), total_parts int not null check (total_parts between 1 and 400),
  bytes bigint not null check (bytes between 1 and 4294967296),
  sha256_prefix text, sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'active' check (state in ('active','completed','aborted','expired')),
  idempotency_key text not null, job_id uuid, created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '7 days',
  unique (workspace_id, id), unique (workspace_id, idempotency_key),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id) on delete cascade);
create table if not exists public.storage_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null unique check (key like workspace_id::text || '/%'), bytes bigint not null check (bytes >= 0),
  kind text not null check (kind in ('original','original_part','mezzanine','proxy','audio','thumb','preview','export','zip','sidecar','stage_output')),
  project_id uuid, source_id uuid, render_id uuid, expires_at timestamptz, purged_at timestamptz,
  created_at timestamptz not null default now(), unique (workspace_id, id));
create index if not exists storage_objects_live_idx on public.storage_objects(workspace_id) where purged_at is null;
alter table public.upload_sessions enable row level security;
alter table public.storage_objects enable row level security;
drop policy if exists upload_sessions_select on public.upload_sessions;
drop policy if exists storage_objects_select on public.storage_objects;
create policy upload_sessions_select on public.upload_sessions for select to authenticated using (public.is_member(workspace_id));
create policy storage_objects_select on public.storage_objects for select to authenticated using (public.is_member(workspace_id));
revoke all on public.upload_sessions, public.storage_objects from anon, authenticated;
grant select on public.upload_sessions, public.storage_objects to authenticated;

create or replace function public.storage_used(p_ws uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(bytes), 0)::bigint from public.storage_objects where workspace_id = p_ws and purged_at is null $$;

-- Fuente + proyecto + sesión. Errores: file_too_large (>4 GiB), quota_exceeded (uso + tamaño entrante > 10 GiB).
-- p_ws null → espacio activo del usuario o, si no hay, el suyo propio.
create or replace function public.create_upload_session(p_ws uuid, p_name text, p_bytes bigint, p_mime text, p_sha256_prefix text,
  p_project uuid, p_force boolean, p_strategy text, p_part_size int, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; dup uuid; sid uuid := gen_random_uuid(); pid uuid; uid uuid := gen_random_uuid(); k text; parts int; used bigint;
begin
  p_ws := coalesce(p_ws, (select active_workspace_id from public.profiles where id = auth.uid()),
                   (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'owner' limit 1));
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into prev from public.upload_sessions where workspace_id = p_ws and idempotency_key = p_idem;
  if found then return jsonb_build_object('upload_id', prev.id, 'source_id', prev.source_id, 'project_id', prev.project_id,
    'part_size', prev.part_size, 'parts', prev.total_parts, 'strategy', prev.strategy, 'replay', true); end if;
  if p_bytes > 4294967296 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":4294967296}'; end if;
  used := public.storage_used(p_ws);
  if used + p_bytes > 10737418240 then
    raise exception 'quota_exceeded' using errcode = 'P0001', detail = json_build_object('quota', 10737418240, 'used', used)::text;
  end if;
  if not coalesce(p_force, false) then
    select p.id into dup from public.sources s join public.projects p on p.source_id = s.id and p.deleted_at is null
     where s.workspace_id = p_ws and s.bytes = p_bytes and s.sha256_prefix = p_sha256_prefix and s.status not in ('deleted','failed') limit 1;
    if dup is not null then return jsonb_build_object('duplicate_of_project', dup); end if;
  end if;
  k := p_ws || '/' || sid || '/original';
  parts := ceil(p_bytes::numeric / p_part_size);
  insert into public.sources(id, workspace_id, kind, storage_path, status, mime, bytes, sha256_prefix, storage_backend, parts, created_by)
    values (sid, p_ws, 'upload', k, 'pending', p_mime, p_bytes, p_sha256_prefix, 'r2', case when p_strategy = 'parts' then parts else 0 end, auth.uid());
  if p_project is null then
    insert into public.projects(workspace_id, source_id, name, created_by)
      values (p_ws, sid, left(coalesce(nullif(btrim(p_name), ''), 'Proyecto'), 120), auth.uid()) returning id into pid;
  else
    update public.projects set source_id = sid where id = p_project and workspace_id = p_ws returning id into pid;
  end if;
  insert into public.upload_sessions(id, workspace_id, source_id, project_id, strategy, object_key, part_size, total_parts, bytes, sha256_prefix, idempotency_key)
    values (uid, p_ws, sid, pid, p_strategy, k, p_part_size, parts, p_bytes, p_sha256_prefix, p_idem);
  return jsonb_build_object('upload_id', uid, 'source_id', sid, 'project_id', pid, 'part_size', p_part_size, 'parts', parts,
    'strategy', p_strategy, 'replay', false);
end $$;

create or replace function public.upload_session(p_upload uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u record;
begin
  select * into u from public.upload_sessions where id = p_upload;
  if not found or (auth.uid() is not null and not public.is_member(u.workspace_id)) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return to_jsonb(u) - 'idempotency_key';
end $$;
create or replace function public.set_upload_r2_id(p_upload uuid, p_r2_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.upload_sessions set r2_upload_id = p_r2_id where id = p_upload and created_by = auth.uid() and state = 'active' and r2_upload_id is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Completa: fuente uploaded, objeto registrado, trabajo ingest (validate → mezzanine → proxy). Repetible.
create or replace function public.complete_upload(p_upload uuid, p_sha256 text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u record; r jsonb; dup uuid;
begin
  select * into u from public.upload_sessions where id = p_upload for update;
  if not found or u.created_by <> auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  if u.state = 'aborted' then raise exception 'upload_aborted' using errcode = 'P0001'; end if;
  if u.state = 'active' then
    update public.upload_sessions set state = 'completed', sha256 = p_sha256 where id = p_upload;
    update public.sources set status = 'uploaded', sha256 = p_sha256 where id = u.source_id;
    insert into public.storage_objects(workspace_id, key, bytes, kind, project_id, source_id)
      values (u.workspace_id, u.object_key, u.bytes, 'original', u.project_id, u.source_id) on conflict (key) do nothing;
  end if;
  r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
         jsonb_build_object('stage','validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
         jsonb_build_object('stage','mezzanine','seq',2,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
         jsonb_build_object('stage','proxy','seq',3,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
       'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  update public.upload_sessions set job_id = (r->>'job_id')::uuid where id = p_upload;
  select p.id into dup from public.sources s join public.projects p on p.source_id = s.id
   where s.workspace_id = u.workspace_id and s.sha256 = p_sha256 and s.id <> u.source_id and p.deleted_at is null limit 1;
  return jsonb_build_object('job_id', r->>'job_id', 'duplicate_of_project', dup);
end $$;
create or replace function public.abort_upload(p_upload uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.upload_sessions set state = 'aborted' where id = p_upload and created_by = auth.uid() and state = 'active';
  update public.sources set status = 'deleted' where id = (select source_id from public.upload_sessions where id = p_upload) and status = 'pending';
end $$;
create or replace function public.source_object(p_source uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id into s from public.sources where id = p_source;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_kind not in ('proxy','thumb') then raise exception 'bad_request' using errcode = 'P0001'; end if;
  return jsonb_build_object('key', s.workspace_id || '/' || s.id || case p_kind when 'proxy' then '/proxy.mp4' else '/thumb.jpg' end);
end $$;
create or replace function public.record_object(p_ws uuid, p_key text, p_bytes bigint, p_kind text, p_project uuid, p_source uuid,
  p_render uuid, p_expires_at timestamptz) returns void language sql security definer set search_path = public as $$
  insert into public.storage_objects(workspace_id, key, bytes, kind, project_id, source_id, render_id, expires_at)
  values (p_ws, p_key, p_bytes, p_kind, p_project, p_source, p_render, p_expires_at)
  on conflict (key) do update set bytes = excluded.bytes, expires_at = excluded.expires_at, purged_at = null $$;

-- Retención: originales con mezzanine registrada (respaldo si el borrado inmediato falló), exportaciones caducadas, papelera vencida.
create or replace function public.purge_candidates(p_limit int default 500) returns table(key text, bytes bigint, reason text)
language sql stable security definer set search_path = public as $$
  select o.key, o.bytes, 'original_replaced' from public.storage_objects o
   where o.purged_at is null and o.kind in ('original','original_part')
     and exists (select 1 from public.storage_objects m where m.source_id = o.source_id and m.kind = 'mezzanine' and m.purged_at is null)
  union all
  select o.key, o.bytes, 'expired' from public.storage_objects o
   where o.purged_at is null and o.kind in ('export','zip','sidecar') and o.expires_at < now()
  union all
  select o.key, o.bytes, 'trash' from public.storage_objects o join public.projects p on p.id = o.project_id
   where o.purged_at is null and p.purge_at is not null and p.purge_at < now()
  limit p_limit $$;
create or replace function public.mark_purged(p_keys text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.storage_objects set purged_at = now() where key = any(p_keys) and purged_at is null;
  get diagnostics n = row_count;
  update public.renders set storage_path = null where storage_path = any(p_keys);
  return n;
end $$;
create or replace function public.trash_project(p_project uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  update public.projects set deleted_at = now(), purge_at = now() + interval '30 days'
   where id = p_project and public.can_edit(workspace_id) and deleted_at is null returning purge_at into ts;
  if ts is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return ts;
end $$;
create or replace function public.restore_project(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.projects set deleted_at = null, purge_at = null
   where id = p_project and public.can_edit(workspace_id) and deleted_at is not null and purge_at > now();
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
create or replace function public.storage_summary(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('used_bytes', public.storage_used(p_ws), 'quota_bytes', 10737418240,
    'units_balance', coalesce((select balance from public.credit_accounts where workspace_id = p_ws), 0),
    'compute', public.compute_meter(),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('key', e.key, 'kind', e.kind, 'bytes', e.bytes, 'expires_at', e.expires_at) order by e.expires_at)
       from (select * from public.storage_objects where workspace_id = p_ws and purged_at is null and expires_at is not null
             order by expires_at limit 20) e), '[]'));
end $$;
-- Hipótesis de producto sobre tablas existentes; solo proyectos con generaciones v2 (excluye demos e históricos);
-- reintentos y descargas repetidas cuentan una vez (renders.downloaded_at = primera descarga).
create or replace function public.product_metrics(p_ws uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return (with g as (select g.*, j.created_by as creator from public.generations g join public.jobs j on j.generation_id = g.id and j.engine = 'v2'
                      where g.workspace_id = p_ws and g.created_at between p_from and p_to),
               c as (select c.* from public.clips c where c.generation_id in (select id from g))
    select jsonb_build_object(
      'first_approved_s', (select extract(epoch from min(cv.created_at) - (select min(created_at) from g))
                            from public.clip_versions cv join c on c.id = cv.clip_id where c.editorial_state = 'aprobado'),
      'acceptance_rate', (select round(avg((editorial_state = 'aprobado')::int)::numeric, 3) from c),
      'active_correction_s', (select round(avg(extract(epoch from cv2.created_at - cv1.created_at))) from c
                               join public.clip_versions cv1 on cv1.clip_id = c.id and cv1.version = 1
                               join public.clip_versions cv2 on cv2.clip_id = c.id and cv2.version = c.current_version and c.current_version > 1),
      'second_variant_s', (select extract(epoch from (array_agg(created_at order by created_at))[2] - min(created_at)) from g),
      'approved_downloaded_per_creator', (select count(distinct r.clip_id)::numeric / greatest((select count(distinct creator) from g), 1)
         from public.renders r join c on c.id = r.clip_id and c.editorial_state = 'aprobado' where r.downloaded_at is not null)));
end $$;

revoke all on function public.storage_used(uuid), public.create_upload_session(uuid,text,bigint,text,text,uuid,boolean,text,int,text),
  public.upload_session(uuid), public.set_upload_r2_id(uuid,text), public.complete_upload(uuid,text), public.abort_upload(uuid),
  public.source_object(uuid,text), public.record_object(uuid,text,bigint,text,uuid,uuid,uuid,timestamptz), public.purge_candidates(int),
  public.mark_purged(text[]), public.trash_project(uuid), public.restore_project(uuid), public.storage_summary(uuid),
  public.product_metrics(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.create_upload_session(uuid,text,bigint,text,text,uuid,boolean,text,int,text), public.upload_session(uuid),
  public.set_upload_r2_id(uuid,text), public.complete_upload(uuid,text), public.abort_upload(uuid), public.source_object(uuid,text),
  public.trash_project(uuid), public.restore_project(uuid), public.storage_summary(uuid), public.product_metrics(uuid,timestamptz,timestamptz)
  to authenticated;
grant execute on function public.storage_used(uuid), public.record_object(uuid,text,bigint,text,uuid,uuid,uuid,timestamptz),
  public.purge_candidates(int), public.mark_purged(text[]), public.upload_session(uuid) to service_role;
```
`product_metrics` es la forma de referencia; el paso 18 fija su comportamiento con `lifecycle.test.ts` (los cinco
campos, filtrado v2, descargas contadas una vez) y puede simplificar la consulta sin cambiar los nombres de los campos.

### Migraciones
Archivos aditivos, uno por paso con esquema. Durante la construcción ninguna de 034–037 está aplicada en producción,
así que solo el paso que crea una migración la edita; esquema posterior → migración 038+. Verificación local con PGlite
(`supabase/tests/migrate.ts`). Producción: el propietario aplica 034→037 en el editor SQL (LC-4) antes de activar v2;
todas son compatibles con el código v1. Impacto declarado: ver *Delta* (CHECK reescritas como superconjuntos y tres
funciones recreadas con el mismo contrato).

### Datos semilla
Sin semilla de producción. En pruebas, `freshDb()` crea A, B y sus workspaces. En producción, LC-6:
`select public.grant_units('<workspace>', 600, 'saldo inicial', 'grant-inicial-2026-11');`.

---

## 5. Diseño de la API

### Convenciones
- `/api/*`, JSON, `Authorization: Bearer <JWT>`; el despachador de Modal usa `X-Rafaga-Wake`.
- Error: `{ "error": { "code", "message" } }` + campos extra al mismo nivel (`needed`, `balance`, `limit`, `quota`,
  `duplicate_of_project`, `conflict`, `field`, `reason`). Éxito: el cuerpo documentado.
- Códigos: `no_session` 401 · `not_found` 404 (también «no es tuyo») · `bad_request`/`invalid_params`/
  `bad_idempotency_key` 400 · `idempotency_conflict`/`source_not_ready`/`conflict`/`upload_aborted` 409 ·
  `insufficient_units` 402 · `file_too_large` 413 · `quota_exceeded` 507 · `compute_budget_exhausted`/
  `compute_rate_card_missing`/`not_configured` 503 · `rate` 429. `mapDbError` (paso 3) traduce los mensajes de Postgres
  y lee `details` como JSON.
- Validación a mano en `apps/web/lib/*.ts`. Sin paginación nueva (las pantallas leen con supabase-js bajo RLS).
- `Idempotency-Key` (8–128, `[A-Za-z0-9:._-]`) obligatoria en todo POST que crea trabajo o sesión; misma clave + mismo
  cuerpo → misma respuesta; otro cuerpo → 409 `idempotency_conflict`.
- Límite `allow(user, 600)` por hora (`apps/web/lib/ytserver.ts`) en rutas que firman URLs.

### Rutas
| Método | Ruta | Contrato | Auth |
|---|---|---|---|
| POST | `/api/uploads` | `{workspace_id?, project_id?, name, bytes, mime, sha256_prefix, force?}` → 201 `{upload_id, source_id, project_id, part_size, parts, strategy}` · 409 `{duplicate_of_project}` · 413 `{limit}` · 507 `{quota}` | editor |
| GET | `/api/uploads?workspace_id=` | `{used_bytes, quota_bytes}` | miembro |
| POST | `/api/uploads/:id/parts` | `{part_numbers[]}` → `{urls}` (UploadPart, 900 s) | creador |
| GET | `/api/uploads/:id` | `{uploaded_parts[{n, etag, size}], state}` | miembro |
| POST | `/api/uploads/:id/complete` | `{parts[{n, etag}], sha256}` → 202 `{job_id, duplicate_of_project}` | creador |
| DELETE | `/api/uploads/:id` | 204 | creador |
| GET | `/api/uploads/sources/:sourceId/proxy` | `{url, expires_at}` (3600 s) | miembro |
| POST | `/api/generations/estimate` | `{project_id, params}` → `{minutes, units, breakdown, balance, viable_count, eta \| null, summary}` | editor |
| POST | `/api/generations` | `{project_id, params}` → 202 `{generation_id, job_id}` · 402 · 409 | editor |
| POST | `/api/clips/:id/versions` | `{base_version, aspect, layout, template, spec}` → 201 `{version}` · 409 `{conflict}` | editor |
| PUT | `/api/clips/:id/draft` | `{base_version, spec}` → `{saved_at}` | editor |
| POST | `/api/clips/transcripts/:transcriptId/revisions` | `{words}` → 201 `{revision, updated_clips}` | editor |
| POST | `/api/clips/:id/translate` | `{target_language}` → 202 `{job_id}` (0.1 u/min) | editor |
| POST | `/api/exports` | `{items[{clip_id, version, aspect, burn_subtitles, kind}], zip?}` → 202 `{export_ids, batch_id, zip}` | editor |
| POST | `/api/exports/:id/retry` | 202 | editor |
| GET | `/api/exports/:id/url` | `{url, expires_at}` · 202 `{state:"rerendering"}` si se purgó | miembro |
| POST | `/api/jobs/:id/cancel` | 202 `{kept, refunded_units}` | editor |
| POST | `/api/import/{link,drive,dropbox}` | `{url}`/`{file_id}`/`{path}` → 202 `{job_id}` · 400 `{reason}` | editor |
| POST | `/api/publish` | `{export_id, platform, title, description, privacy, scheduled_at?}` → 202 `{publication_id}` | editor |
| POST | `/api/wake` | (existe) `{job_id?}` → `{woken, reason?}` | sesión |
| POST | `<MODAL_DISPATCH_URL>` | `X-Rafaga-Wake`, `{job_id?}` → 2xx | secreto |

### Endpoints críticos
- **`/api/uploads/:id/complete`** — `upload_session` como el usuario; multipart: CompleteMultipartUpload con las ETag
  ordenadas (si R2 dice `NoSuchUpload` y la sesión ya está `completed`, sigue); `parts`: HEAD de cada parte; después
  `complete_upload` → trabajo `ingest` (validate, mezzanine, proxy), 0 unidades; llama a `/api/wake` sin esperar.
- **`/api/generations`** — `validateParams` (paso 11) → `request_generation` con `componentVersions()`; 402/409/503 por
  `mapDbError`; llama a `/api/wake` sin esperar.
- **`/api/exports`** — reutiliza la fila `renders` con la misma clave si está `ready` y no purgada; si no, `export_batches`
  + trabajo `export` (una etapa `render` por ítem, mismo `seq`, y `zip` en seq 2). Renderiza desde la mezzanine. 0 unidades.
- **`/api/exports/:id/url`** — búsqueda RLS; 404 sin firmar si no es suyo; purgado → re-render gratis; si no, GET de
  3600 s y `downloaded_at` en la primera descarga.

### Delta
Nuevas todas salvo `/api/wake` (modificada para despachar a Modal).

### Interfaces que se mantienen constantes
| Interfaz | Contrato | Prueba |
|---|---|---|
| `POST /api/wake` | `{woken, reason?}`; 401 sin sesión; sin `WORKER_BACKEND` = hoy | `wake.test.ts` |
| `GET/POST /api/storage` | sin cambios | archivo no editado |
| `claim_job()` | mismo tipo y orden; solo `engine='v1'` | `rls.test.ts` + `job_stages.test.ts` |
| `request_*`, `apply_brand_kit`, `duplicate_project` | sin cambios | `rls.test.ts` |
| Vista v1 de `/app/p/[id]` | `BriefFields`, «Volver a detectar», «Ajustar enfoque» para proyectos v1 | grep de los pasos 10 y 14 |
| Columnas existentes; `usage_ledger` | ni se borran ni cambian de tipo | `pnpm test` |
| Variables de entorno existentes; `worker.yml` | sin cambios hasta D1 | §10 |

---

## 6. Arquitectura de frontend

| Ruta | Pantalla | Paso |
|---|---|---|
| `/app/proyectos` | Biblioteca: estado del trabajo y Cancelar | 4 |
| `/app/nuevo` | Fuente (soltar archivo, Subir, Google Drive, Dropbox, Enlace directo) + **panel de creación** (solo con `NEXT_PUBLIC_PIPELINE_VERSION === "v2"`) | 8, 11 |
| `/app/p/[id]` | **Proyecto v2** (algún trabajo con `engine = 'v2'`): Procesamiento; **Resultados** (rejilla, cabecera con el prompt, búsqueda, filtro/orden, rejilla/lista, mapa temporal por grupo, «Nueva generación» con el mismo panel) y **reproductor a pantalla completa**. **Proyecto v1:** la vista actual intacta (`BriefFields`, «Volver a detectar», «Ajustar enfoque») | 10, 14 |
| `/app/c/[id]` | Editor v2 (con pantalla completa y zonas seguras) | 15 |
| `/app/demos` | Demos: «Abrir copia editable» (`duplicate_project`); un ejemplo nunca simula una generación en vivo | 15 |
| `/app/exports` | Exportaciones (lotes, reintento, aviso de zonas seguras, Publicar) | 16 |
| `/app/uso` | Uso y almacenamiento | 18 |

**Panel de creación (`CreationPanel`, estilo Opus):** Receta (Clips de vídeo largo · Solo subtítulos · Solo
reencuadre · Limpiar grabación · Mis recetas — guardar/usar con `generation_recipes`), Brand kit (Ninguno · plantillas
· `brand_kits` · Nuevo), Ajustes (Clipping sí/no; «La IA elige»: Auto o uno de los 7 modos; Duración: Auto (10 s–3 min),
<30 s, 30–60 s, 60–90 s, 90 s–3 min — los mismos valores que `DURATION_BUCKETS`; Momentos a incluir con ayuda «Cómo
escribirlo»; Intervalo), Subtítulos sí/no + galería de estilos dibujada con el motor de subtítulos
(`groupWords`/`layoutLines` + presets) y edición de fuente, colores (texto, palabra activa, contorno/caja), tamaño y
posición antes de generar, Gancho automático (Editorial, Declaración, Clásico; posición), Formato/plantilla viral +
formato, y columna **Resumen** (Procesado de vídeo, Clipping, Subtítulos, Gancho, total frente a saldo; «Aplicar extras
a los N mejores clips»; botón **Crear** idempotente). Las recetas distintas de «Clips de vídeo largo» reutilizan rutas
existentes (Solo subtítulos → `projects.mode = 'captions'`, Solo reencuadre → `request_reframe`, Limpiar grabación →
cortes de `cuts.ts`) sin pipeline nuevo.

**Estado:** solo de filas (`deriveProjectState({ job, stages, clips })`, pura); Realtime dispara relecturas.
**Estados:** cada pantalla nueva o editada tiene vacío, cargando, disponible, parcial, sin permiso y error
(`errorFor(code)`); botones desactivados en vuelo; esperas con etapa actual y rango (`stage_eta`) o «aún no se puede
calcular». Rutas de API con `dynamic = "force-dynamic"`.

---

## 7. Sistema de diseño

NOT APPLICABLE — el propietario dejó fuera de alcance el diseño visual; se conserva el sistema existente
(`apps/web/components/ui/`, tema oscuro del editor). Ningún paso cambia colores, fuentes ni estilo de la interfaz ni toma
un contrato de esta sección. (Los estilos de **subtítulos** son contenido del vídeo, no interfaz: viven en
`packages/composition`.)

---

## 8. Autenticación y autorización

Supabase Auth existente, sin cambios en flujos. Rutas nuevas: `userFrom(req)` + RPC con el mismo JWT.

| Superficie | Regla | Dónde |
|---|---|---|
| `/api/{uploads,generations,clips,exports,jobs,import,publish}` | sesión; permisos en RPC `security definer` (`can_edit`/`is_member`) | cada `route.ts` + 034–037 |
| `/api/wake` | sesión | `wake/route.ts` |
| Despachador Modal | `X-Rafaga-Wake` con `hmac.compare_digest` | `workers/modal/app.py` |
| Funciones del worker | `service_role` | grants de 035–037 |

| Rol | Puede | No puede |
|---|---|---|
| owner | todo; `grant_units` | — |
| admin / editor | subir, generar, editar, exportar, publicar, cancelar, papelera | conceder unidades |
| reviewer | ver, comentar, estado editorial | crear trabajos, editar versiones |
| viewer / member | ver | escribir |

Sesiones de Supabase sin cambios; la API nueva solo acepta `Bearer` (sin CSRF por cookies). Aislamiento: RLS
`is_member` en cada tabla nueva, escrituras solo por funciones con `can_edit`, FK compuestas; URLs firmadas solo tras
una búsqueda con el JWT del usuario.

---

## 9. ORDEN DE CONSTRUCCIÓN

### Reglas
1. Una sesión por paso: ≤5 archivos, ≤6 criterios.
2. Cada paso: **Hacer → Hecho cuando → Verify → Checkpoint**.
3. Criterios EARS decididos por un comando aquí y hoy, sin secretos ni red de pago (`fetch` simulado, PGlite, ffmpeg
   `-f lavfi`).
4. Cada línea de `Verify` empieza por `export PATH="$HOME/.local/bin:$PATH" &&` y sale con 0 si el paso es correcto;
   los códigos esperados se afirman (`; test $? -eq N`), nunca con `!` ni `test $? -ne 0`.
5. Un paso termina cuando pasan sus `Verify` y los anteriores (`pnpm test` en casi todos).
6. Checkpoint: `git add -A && git commit -m "rafaga-v2: paso NN — <slug>" && git tag rafaga-v2-step-NN`. Ningún `Verify`
   comprueba estado que solo crea el Checkpoint. **Vuelta atrás no destructiva:** `git revert --no-edit
   rafaga-v2-step-<NN-1>..HEAD` (crea commits de reversión; nunca `reset --hard`).
7. No adelantar pasos; si uno se bloquea, detenerse e informar.
8. Ningún paso rompe una puerta anterior: no hay validación global de entorno; cada ruta/etapa responde
   `not_configured` si le falta algo; las pruebas fijan valores falsos en proceso.
9. Acciones del propietario → lista de lanzamiento (§20.1), nunca un «Hecho cuando».
10. Rutas con `[` (`[id]`, `[[...slug]]`) van entre comillas simples en el shell.
11. Antes de tocar una parte, leer su implementación y dependencias (regla de la ampliación); no sistemas paralelos.

**18 pasos = 18 tareas = 18 bloques en 3 épicas de 6** (`01-fundamentos`, `02-ingesta-y-analisis`,
`03-edicion-y-entrega`).

### Mapa de pasos
| # | Paso | Depende | Archivos | Puerta |
|---|---|---|---|---|
| 1 | Arnés de migraciones | — | `supabase/tests/{migrate.ts,migrate.test.ts,rls.test.ts}` | `node --test supabase/tests/migrate.test.ts` |
| 2 | Esquema v2 (034) | 1 | 034, `v2_core.test.ts` | `node --test supabase/tests/v2_core.test.ts` |
| 3 | Libro de unidades (035) + API | 2 | 035, `ledger.test.ts`, `fake-supabase.ts`, `api.ts`, `api.test.ts` | `node --test supabase/tests/ledger.test.ts apps/web/lib/api.test.ts` |
| 4 | Motor de etapas (036) + cancelar | 3 | 036, `job_stages.test.ts`, ruta jobs, `jobs.test.ts`, `ProjectList.tsx` | `node --test supabase/tests/job_stages.test.ts apps/web/lib/jobs.test.ts` |
| 5 | Worker por etapas | 4 | `stage.ts`, `stages/{registry,runner,hash}.ts`, `stages.test.ts` | `node workers/media/src/stage.ts --list-flags` |
| 6 | Modal + `/api/wake` | 5 | `workers/modal/{app.py,requirements.txt,README.md}`, ruta wake, `wake.test.ts` | `node --test apps/web/lib/wake.test.ts` |
| 7 | API de subida (037) | 4 | `r2.ts`, `r2.test.ts`, 037, ruta uploads, `uploads.test.ts` | `node --test packages/providers/src/r2.test.ts apps/web/lib/uploads.test.ts` |
| 8 | Cliente de subida | 7 | `uploader.ts`, `uploader.test.ts`, `hash.worker.ts`, `UploadPanel.tsx`, sonda R2 | `node --test apps/web/lib/uploader.test.ts` |
| 9 | Validación + mezzanine + estado derivado | 5, 7 | `stages/validate.ts`, `fixtures.ts`, `validate.test.ts`, `progress.ts`, `progress.test.ts` | `node --test workers/media/src/validate.test.ts apps/web/lib/progress.test.ts` |
| 10 | Análisis + Procesamiento (vista v2) | 9 | `stages/analysis.ts`, `groqlimits.ts`, `analysis.test.ts`, `ProcessingPanel.tsx`, `p/[id]/page.tsx` | `node --test workers/media/src/analysis.test.ts` |
| 11 | Panel de creación, estimación y reserva | 8, 9 | ruta generations, `generations.ts`, `generations.test.ts`, `CreationPanel.tsx`, `nuevo/page.tsx` | `node --test apps/web/lib/generations.test.ts` |
| 12 | Modos, puntuación y selección robusta | 10, 11 | `selection/package.json`, `modes.ts`, `modes.test.ts`, `stages/select.ts`, `select.test.ts` | `node --test packages/selection/src/modes.test.ts workers/media/src/select.test.ts` |
| 13 | Composiciones, plantillas virales, zonas seguras | 12 | `layouts.ts`, `safezones.ts`, `composition/src/index.ts`, `stages/compose.ts`, `compose.test.ts` | `node --test workers/media/src/compose.test.ts` |
| 14 | Motor de escena + resultados + pantalla completa (vista v2) | 13, 10 | `layouts.ts`, `parity.test.ts`, `PreviewPlayer.tsx`, `ResultsGrid.tsx`, `p/[id]/page.tsx` | `node --test packages/composition/src/parity.test.ts` |
| 15 | Editor v2 + demos editables | 14 | `editor.ts`, `editor.test.ts`, ruta clips, `c/[id]/page.tsx`, `demos/page.tsx` | `node --test apps/web/lib/editor.test.ts` |
| 16 | Exportaciones | 15 | `stages/export.ts`, `export.test.ts`, ruta exports, `exports.test.ts`, `exports/page.tsx` | `node --test workers/media/src/export.test.ts apps/web/lib/exports.test.ts` |
| 17 | Importación y publicación | 16 | `stages/integrations.ts`, ruta `[integration]`, `integrations.test.ts`, `oauth.ts`, `oauthserver.ts` | `node --test apps/web/lib/integrations.test.ts` |
| 18 | Ciclo de vida, métricas, Uso, rendimiento | 16 | `stages/purge.ts`, `lifecycle.test.ts`, `uso/page.tsx`, `perf-run.ts`, `docs/PERF.md` | `node scripts/perf-run.ts --quick` |

### Criterios obligatorios → pasos
| # | Criterio | Paso · prueba |
|---|---|---|
| 1 | Cerrar la pestaña tras subir → sigue | 7 (`complete` crea el trabajo) · 9 (runner con solo filas de BD) |
| 2 | Volver → estado real | 9 (`progress.test.ts`) |
| 3 | Cambiar composición → sin re-análisis | 15 (0 trabajos, 0 cargos) · 10 (caché `input_hash`) |
| 4 | Regenerar → editados conservados | 15 (`editor.test.ts`) |
| 5 | Exportar y editar → versión pedida | 2 (trigger) · 16 (`export.test.ts`) |
| 6 | Petición repetida → sin duplicados | 3, 4, 11 (3×) |
| 7 | Falla una del lote → resto disponible | 16 |
| 8 | Más clips de los posibles → explicado | 12 (`warnings`) · 11 (`viable_count`) |
| 9 | Sin acceso → no lee ni descarga | 2 (RLS B) · 7 (404) · 16 (404) |

---

#### Paso 1 — Arnés de migraciones por glob ordenado
**Hacer**
- **Precondición:** `test -z "$(git status --porcelain | grep -v '^.. blueprints/')"` debe salir con 0: el árbol solo
  tiene cambios bajo `blueprints/` (el Bootstrap ya confirmó en su propio commit los archivos que copia de
  `workspace/`). Si no, detente e informa: hay trabajo ajeno sin confirmar y no se mezcla con este paso.
- Crear `supabase/tests/migrate.ts`: `listMigrations()` (readdir de `supabase/migrations`, `.sql`, ordenado);
  `ENV_SHIMS` (la emulación de Supabase que hoy abre `rls.test.ts`, más `create role service_role nologin`, la columna
  `storage.buckets.allowed_mime_types text[]` que pide la 006 y `storage.objects.metadata jsonb`); `HOOKS` que reproduce
  las sentencias intercaladas actuales (tras la core: grants amplios y re-ejecución de su bloque de privilegios; tras
  004, 008, 011 y 012 sus grants) y `FINAL_GRANTS` (los grants que hoy van tras la 030) al final; `applyMigrations(db)` →
  nombres aplicados; `freshDb()` → `{ db, A, B, wsA, wsB, asUser, applied }`.
- Editar `supabase/tests/rls.test.ts`: su `before` usa `freshDb()` y no nombra ningún archivo de migración.
- Crear `supabase/tests/migrate.test.ts`. Si una migración falla en PGlite, se corrige el shim, nunca la migración.

**Hecho cuando**
- [ ] WHEN se ejecuta `node --test supabase/tests/migrate.test.ts` THE SYSTEM SHALL comprobar que la lista aplicada por `applyMigrations` es idéntica a la lista ordenada de `supabase/migrations/*.sql`, sin omitir ninguna (incluidas 006, 014, 028, 031, 032 y 033).
- [ ] WHEN `freshDb()` termina THE SYSTEM SHALL exponer `sources.parts`, `sources.storage_backend`, `clips.preview_path`, la tabla `project_folders` y los roles `anon`, `authenticated` y `service_role`.
- [ ] WHEN se busca `20261109000001_core.sql` en `supabase/tests/rls.test.ts` THE SYSTEM SHALL no encontrarlo (`grep` sale con 1).
- [ ] WHEN se ejecuta `pnpm test` THE SYSTEM SHALL salir con 0 y 0 pruebas fallidas, incluidas las pruebas ya desplegadas de `packages/providers/src/groq.test.ts`.

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
git ls-files --error-unmatch supabase/tests/migrate.ts   # exit 0 — confirmado arriba
```

---

#### Paso 2 — Esquema v2 (migración 034)
**Hacer:** crear `supabase/migrations/20261113000034_clipping_v2_core.sql` con el SQL de §4 (incluida la recreación de
`oauth_save` con `tiktok`) y `supabase/tests/v2_core.test.ts` con `freshDb()`. La prueba existente «anon sin acceso a
ninguna tabla» debe seguir verde.

**Hecho cuando**
- [ ] WHEN el usuario B consulta `analyses`, `transcript_revisions`, `generation_recipes`, `clip_collections`, `clip_drafts`, `export_batches`, `publications` e `imports` THE SYSTEM SHALL devolver 0 filas del workspace de A, y SHALL rechazar cualquier inserción de B con el `workspace_id` de A (criterio 9, base de datos).
- [ ] WHEN cualquier rol, incluido el propietario de la tabla, ejecuta UPDATE o DELETE directo sobre `clip_versions` THE SYSTEM SHALL lanzar `clip_versions_immutable` y dejar la fila intacta; WHEN se borra el clip padre THE SYSTEM SHALL borrar sus versiones en cascada (criterio 5, base de datos).
- [ ] WHEN `save_clip_version` recibe un `p_base_version` distinto de `clips.current_version` THE SYSTEM SHALL devolver `{"conflict": true, "current_version": n}` sin crear versión; con la versión vigente SHALL crear la versión n+1 con `aspect`, `layout` y `template`, y poner `user_edited = true` salvo con `p_user_edit = false`.
- [ ] WHEN se inserta en `analyses` una segunda fila con el mismo `(source_id, version)` THE SYSTEM SHALL rechazarla.
- [ ] WHEN se escribe en `clips.editorial_state` un valor fuera de `pendiente|en_revision|aprobado|descartado`, o en `clip_versions.layout` uno fuera de los 6 diseños, THE SYSTEM SHALL rechazarlo.
- [ ] WHEN se ejecuta `pnpm test` THE SYSTEM SHALL salir con 0 y 0 pruebas fallidas.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/v2_core.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 02 — esquema v2" && git tag rafaga-v2-step-02`

---

#### Paso 3 — Libro de unidades (035) y núcleo de API
**Hacer**
- Crear la migración 035 (§4).
- Crear `supabase/tests/fake-supabase.ts`: `fakeSupabaseFetch(db, other?)` atiende `GET …/auth/v1/user` (token
  `test:<uuid>` → `{id}`; otro → 401) y `POST …/rest/v1/rpc/<fn>` (ejecuta `select to_jsonb(public.<fn>(arg => $n, …))`
  como `authenticated` con `request.jwt.claim.sub`, o como servicio con `test:service`; errores al estilo PostgREST
  `{code, message, details, hint}`: 400 `P0001`, 404 `P0002`, 403 `42501`, 409 `23505`); cualquier otra URL → `other` o
  lanza `unexpected fetch <url>`. Exporta `tokenFor(uid)`.
- Crear `apps/web/lib/api.ts` (reutiliza `bearer`, `rpcAs` de `oauthserver.ts` y `userFrom` de `ytserver.ts`): `json`,
  `fail`, `idempotencyKey(req)`, `mapDbError(error)`, `ERROR_CODES` y `errorFor(code)` con el catálogo de abajo.
- Crear `supabase/tests/ledger.test.ts` (dos reservas con `Promise.all`; PGlite las serializa y la prueba demuestra la
  comprobación de saldo bajo el `for update`) y `apps/web/lib/api.test.ts`.

**Catálogo de errores** (mensaje · se conserva · acción · consumo; todo en español): `upload_interrupted` (partes subidas
· reanudar · ninguno) · `unsupported_file` con alias `corrupt_file`, `unsupported_container`, `too_long`, `too_large`
(nada · convertir o recortar · ninguno) · `no_audio` (vídeo · modos Manual/Destacados · sin cargo de transcripción) ·
`wrong_language` (análisis visual · corregir idioma · el nuevo análisis cobra) · `no_moments` (análisis · cambiar tema o
modo · se devuelve la selección) · `transcription_failed` (audio y proxy · reintentar · devolución) · `tracking_failed`
(encuadre de respaldo · revisar · ninguno) · `render_failed` (versión y resto del lote · reintentar · ninguno) ·
`job_stalled` (etapas hechas · reanudar · devolución de lo no hecho) · `insufficient_units` (configuración · pedir saldo ·
nada reservado) · `quota_exceeded` (archivos · borrar o archivar · ninguno) · `download_expired` (versión · renovar,
re-render gratis · ninguno) · `connection_lost` (todo; el servidor sigue · reconectar · ninguno) ·
`compute_budget_exhausted` (todo · esperar al mes siguiente · nada reservado).

**Hecho cuando**
- [ ] WHEN dos llamadas a `reserve_units` de 1 unidad con claves distintas se lanzan a la vez contra un saldo de 1.00 THE SYSTEM SHALL aceptar exactamente una, rechazar la otra con `insufficient_units` y dejar el saldo en 0.00.
- [ ] WHEN `reserve_units` se llama 3 veces con la misma clave THE SYSTEM SHALL escribir exactamente 1 fila `reserve` y devolver el mismo `ledger_id` las 3 veces (criterio 6, base de datos).
- [ ] WHEN `settle_units` o `refund_units` se llaman dos veces con la misma clave THE SYSTEM SHALL añadir una sola fila, y un `settle_units` con consumo real menor que lo reservado SHALL añadir una fila `release` por la diferencia.
- [ ] WHEN un usuario `authenticated` escribe directamente en `credit_ledger`, llama a `grant_units` sin ser `owner`, o llama a `settle_units` o `refund_units` THE SYSTEM SHALL rechazarlo.
- [ ] WHEN `ledger.test.ts` recorre `supabase/migrations`, `apps/web`, `workers` y `packages` (sin `node_modules` ni `.next`) THE SYSTEM SHALL encontrar `insert into public.credit_ledger` solo en `supabase/migrations/20261113000035_credit_ledger.sql`.
- [ ] WHEN `mapDbError` recibe `insufficient_units` THE SYSTEM SHALL producir HTTP 402 con `{ "error": { "code": "insufficient_units", "message": … }, "needed": n, "balance": b }`, y `errorFor` SHALL devolver mensaje, trabajo conservado, acción y efecto en el consumo no vacíos para cada código de `ERROR_CODES`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/ledger.test.ts apps/web/lib/api.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 03 — libro de unidades y API" && git tag rafaga-v2-step-03`

---

#### Paso 4 — Motor de etapas (036), cancelación y Biblioteca
**Hacer:** migración 036 (§4) recreando además `scheduler_tick` con el filtro v1; `supabase/tests/job_stages.test.ts`
(la tarifa se fija en la prueba con valores de prueba, no precios reales); `apps/web/app/api/jobs/[[...slug]]/route.ts`
(`POST /api/jobs/:id/cancel` → `cancel_job`); `apps/web/lib/jobs.test.ts` (importa la ruta con `fakeSupabaseFetch` y
`params: Promise.resolve({ slug: [id, "cancel"] })`); `apps/web/components/ProjectList.tsx` (estado del último trabajo y
botón Cancelar desactivado en vuelo, solo para trabajos `engine = 'v2'`).

**Hecho cuando**
- [ ] WHEN dos llamadas a `claim_stage` compiten por una única etapa reclamable THE SYSTEM SHALL entregarla a una sola, con `attempts = 1` y `lease_until` entre 85 s y 95 s por delante, y SHALL no entregar una etapa mientras otra de menor `seq` del mismo trabajo no esté `done` o `skipped`.
- [ ] WHEN el arrendamiento de una etapa `running` ha caducado y se ejecuta `sweep_stale()` THE SYSTEM SHALL reencolarla mientras `attempts < 3`, y al tercer vencimiento SHALL marcar etapa y trabajo `failed` con `job_stalled` y añadir exactamente una devolución por sus unidades.
- [ ] WHEN `enqueue_job` se llama 3 veces con la misma clave THE SYSTEM SHALL crear 1 trabajo, sus etapas y 1 fila `reserve` y devolver el mismo `job_id`, y una `output` de más de 8192 bytes SHALL rechazarse.
- [ ] WHEN el gasto de Modal del mes en `ai_usage` (`provider = 'modal'`, `kind = 'compute'`) alcanza el 90 % de `compute_budget_usd`, o `modal_rate_card` es nula, THE SYSTEM SHALL rechazar `enqueue_job` con `compute_budget_exhausted` o `compute_rate_card_missing` sin escribir ningún trabajo.
- [ ] WHEN la función heredada `claim_job()` se ejecuta con solo trabajos `engine = 'v2'` en cola THE SYSTEM SHALL devolver 0 filas.
- [ ] WHEN `POST /api/jobs/:id/cancel` llega de un editor para un trabajo cuyas etapas con coste no han empezado THE SYSTEM SHALL responder 202 `{ kept, refunded_units }` y devolver sus unidades; para el usuario B SHALL responder 404.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/job_stages.test.ts apps/web/lib/jobs.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 04 — motor de etapas" && git tag rafaga-v2-step-04`

---

#### Paso 5 — Worker por etapas (`stage.ts`)
**Hacer**
- `workers/media/src/stages/registry.ts`: `STAGES` = `validate, mezzanine, proxy, prepare, transcribe, scenes, speakers,
  candidates, select, compose, previews, checks, render, zip, import, publish, translate`; `loadStage(name)` con
  `import()` perezoso (`./validate.ts`, `./analysis.ts`, `./select.ts`, `./compose.ts`, `./export.ts`,
  `./integrations.ts`); si el módulo no existe aún → `not_implemented`. Tipos `StageCtx` y `StageImpl = { inputs(ctx,
  row), run(ctx, row) → { output, units_actual? } }`.
- `stages/hash.ts`: `inputHash(inputs, componentVersions)` = sha256 de JSON canónico.
- `stages/runner.ts`: `runOnce` = `claim_stage` → `inputs` → `inputHash` → `find_cached_stage` (acierto → `skipped` sin
  `run`) → `run` con `heartbeat_stage` cada 15 s (si devuelve `false`, aborta con `cancelled`) → `finish_stage` con
  `core_s = s × RAFAGA_CPU_CORES` y `mem_gib_s = s × RAFAGA_MEM_GIB`; `drain(ctx, maxIdleS)`.
- `stage.ts` (CLI) exporta `main(argv, deps?)` (`deps.rpc` permite un `rpc` simulado) y solo se ejecuta como programa si
  `import.meta.url === pathToFileURL(process.argv[1]).href`. Modos: `--list`, `--list-flags` (imprime una por línea los
  modos y opciones admitidos: `--list`, `--list-flags`, `--drain`, `--max-idle-s`, `--sweep`, `--keep-alive`, `--plan`,
  `--purge`), `<stage> <jobId>`, `--drain [--max-idle-s N]`, `--sweep` (`sweep_stale` + `enqueue_due_publications`),
  `--keep-alive`, `--plan` (JSON `{ ready, legacy }` de `dispatch_plan`), `--purge` (carga `./stages/purge.ts` con
  `import()` dinámico y convierte un módulo ausente en `not_implemented` con salida 1, así el paso 18 no edita
  `stage.ts`). Salidas: 0 bien, 1 etapa fallida, 64 uso (comprobado antes), 78 configuración
  (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Solo aquí se crea el cliente de supabase-js.
- `stages.test.ts`: `rpc` en memoria, `mock.timers`; la CLI vía `spawnSync(process.execPath, …)` para `--list`,
  `--list-flags`, 64 y 78; y `main(["--plan"|"--sweep"|"--keep-alive"], { rpc: stub })` en proceso. `run.ts` no se toca.

**Hecho cuando**
- [ ] WHEN se ejecuta `node workers/media/src/stage.ts --list` THE SYSTEM SHALL imprimir una por línea las etapas de `STAGES` en su orden (de `validate` a `translate`) y salir con 0 sin leer variables de entorno, y `--list-flags` SHALL imprimir `--list`, `--list-flags`, `--drain`, `--max-idle-s`, `--sweep`, `--keep-alive`, `--plan` y `--purge`.
- [ ] WHEN `stage.ts` recibe una etapa conocida y un id sin `SUPABASE_URL` o `SUPABASE_SERVICE_ROLE_KEY` THE SYSTEM SHALL salir con 78 nombrando la variable que falta, y WHEN recibe una etapa desconocida SHALL salir con 64.
- [ ] WHEN `main(["--plan"])` se ejecuta con un `rpc` simulado THE SYSTEM SHALL imprimir un JSON con `ready` y `legacy` numéricos, y `main(["--sweep"])` y `main(["--keep-alive"])` SHALL devolver 0 tras llamar a `sweep_stale`, `enqueue_due_publications` y `keep_alive`.
- [ ] WHEN `inputHash` se calcula dos veces con las mismas entradas y versiones THE SYSTEM SHALL devolver el mismo sha256 de 64 caracteres hexadecimales, y otro distinto si cambia cualquier versión de componente.
- [ ] WHEN el runner reclama una etapa cuyo `input_hash` coincide con una etapa `done` del mismo workspace THE SYSTEM SHALL cerrarla como `skipped` con la salida en caché sin invocar la implementación.
- [ ] WHEN una etapa lanza un error THE SYSTEM SHALL llamar a `finish_stage` con `failed` y su `error_code`, y mientras corre SHALL renovar el arrendamiento cada 15 s y abortar con `cancelled` si `heartbeat_stage` devuelve `false`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/stages.test.ts
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list-flags
export PATH="$HOME/.local/bin:$PATH" && env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY node workers/media/src/stage.ts validate 00000000-0000-0000-0000-000000000000; test $? -eq 78
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts no-such-stage 00000000-0000-0000-0000-000000000000; test $? -eq 64
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 05 — worker por etapas" && git tag rafaga-v2-step-05`

---

#### Paso 6 — App de Modal y `/api/wake`
**Hacer**
- `workers/modal/requirements.txt` = `modal==1.6.4`. Entorno fuera del repo: `python3 -m venv ~/.cache/rafaga/modal-venv`
  y `~/.cache/rafaga/modal-venv/bin/pip install -r workers/modal/requirements.txt`. Antes de escribir `app.py`, leer las
  firmas no verificadas: `~/.cache/rafaga/modal-venv/bin/python -c "import inspect, modal; print(inspect.signature(modal.App.function)); print(inspect.signature(modal.Image.add_local_dir)); print(inspect.signature(modal.Image.debian_slim))"`.
- `workers/modal/app.py` según la referencia de §12 (Python 3.12, o 3.13 + `numpy==2.1.3` si 3.12 se rechaza; Node
  24.22.3 con SHASUMS256; `pnpm@12.18.0`; ffmpeg BtbN por SHA-256; opencv headless; `fastapi[standard]`;
  `add_local_dir(copy=True)` excluyendo `node_modules`, `.next`, `.git`, `.fixtures`, `blueprints`; secreto
  `rafaga-worker`; funciones `drain`, `run_legacy`, `dispatch`, `sweeper` cada minuto, `keep_alive` diaria con
  `--keep-alive` y `--purge`; `modal.Period` o, si no existe, `modal.Cron`; `fastapi` solo dentro de `try/except
  ImportError`). `app.py` solo pasa a `stage.ts` opciones que imprime `--list-flags`.
- `workers/modal/README.md`: funciones, claves del secreto, comandos del propietario; sin valores.
- `apps/web/app/api/wake/route.ts`: `Response.json`; `{ job_id? }`; `WORKER_BACKEND === "modal"` → sin
  `MODAL_DISPATCH_URL`/`WAKE_SECRET` 200 `{woken:false, reason:"not_configured"}`, si no POST con `X-Rafaga-Wake`;
  cualquier otro valor → lógica GitHub actual.
- `apps/web/lib/wake.test.ts` (fetch simulado; lee `app.py` como texto y ejecuta `stage.ts --list-flags` con
  `spawnSync` para comparar las opciones).

**Hecho cuando**
- [ ] WHEN `WORKER_BACKEND=modal` y una sesión válida llama a `POST /api/wake` con `{ "job_id": … }` THE SYSTEM SHALL hacer exactamente un POST a `MODAL_DISPATCH_URL` con la cabecera `X-Rafaga-Wake` igual a `WAKE_SECRET` y el cuerpo `{"job_id": …}`, y ninguna llamada a `api.github.com`.
- [ ] WHEN `WORKER_BACKEND` es `actions` o no está definida THE SYSTEM SHALL despachar `worker.yml` solo si no hay ninguna ejecución `in_progress` ni `queued`, como hoy.
- [ ] WHEN `WORKER_BACKEND=modal` y falta `MODAL_DISPATCH_URL` o `WAKE_SECRET` THE SYSTEM SHALL responder 200 `{ "woken": false, "reason": "not_configured" }`, y sin token Bearer SHALL responder 401.
- [ ] WHEN `python3` analiza `workers/modal/app.py` con `ast.parse` THE SYSTEM SHALL salir con 0.
- [ ] WHEN `wake.test.ts` lee `workers/modal/app.py` THE SYSTEM SHALL encontrar `X-Rafaga-Wake` y `hmac.compare_digest`, el SHA-256 `8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4`, `node-v24.22.3-linux-x64.tar.xz`, `opencv-python-headless==4.10.0.84`, una función cada minuto con `stage.ts --sweep` y otra diaria con `stage.ts --keep-alive`, y cada opción `--…` que `app.py` pasa a `stage.ts` SHALL figurar en la salida de `node workers/media/src/stage.ts --list-flags`.
- [ ] WHEN el Python de `~/.cache/rafaga/modal-venv` importa `modal` THE SYSTEM SHALL informar la versión `1.6.4` y exponer `App`, `Image`, `Secret`, `fastapi_endpoint` y `Period` o `Cron`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/wake.test.ts
export PATH="$HOME/.local/bin:$PATH" && python3 -c "import ast; ast.parse(open('workers/modal/app.py').read(), 'workers/modal/app.py')"
export PATH="$HOME/.local/bin:$PATH" && ~/.cache/rafaga/modal-venv/bin/python -c "import importlib.metadata as m, modal; assert m.version('modal') == '1.6.4'; [getattr(modal, n) for n in ('App', 'Image', 'Secret', 'fastapi_endpoint')]; assert hasattr(modal, 'Period') or hasattr(modal, 'Cron')"
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 06 — Modal y wake" && git tag rafaga-v2-step-06`

---

#### Paso 7 — API de subida reanudable (037)
**Hacer:** migración 037 (§4); `packages/providers/src/r2.ts`: `r2Multipart(cfg)` con `create`, `partUrl(key, uploadId,
n, 900)`, `list`, `complete`, `abort` firmados con `presignV4` (parámetros en `query`) y analizador XML mínimo por
regex; `partsKey(key, n)` = `${key}.part${String(n).padStart(3, "0")}` (`r2Url` ya admite `HEAD`; no se cambia); ampliar
`r2.test.ts`. `apps/web/app/api/uploads/[[...slug]]/route.ts` con los contratos de §5: `UPLOAD_STRATEGY` `multipart`
(partes de 16777216 bytes) o `parts` (47185920); toda firma después de una RPC con el JWT del usuario.
`apps/web/lib/uploads.test.ts` con `freshDb`, `fakeSupabaseFetch` y un R2 simulado como `other`.

**Hecho cuando**
- [ ] WHEN `r2Multipart` firma CreateMultipartUpload, UploadPart, ListParts, CompleteMultipartUpload y AbortMultipartUpload THE SYSTEM SHALL producir URLs con `uploads`, `partNumber` y `uploadId`, `uploadId`, `uploadId` y `uploadId` respectivamente, región `auto`, y la de UploadPart SHALL llevar `X-Amz-Expires=900`; la prueba del ejemplo de AWS SHALL seguir pasando.
- [ ] WHEN `POST /api/uploads` recibe `bytes` mayor que 4294967296 THE SYSTEM SHALL responder 413 `{ error: { code: "file_too_large" }, limit: 4294967296 }`, y WHEN el uso del workspace más `bytes` supera 10737418240 SHALL responder 507 `{ error: { code: "quota_exceeded" }, quota: 10737418240 }`; en ambos casos sin crear sesión.
- [ ] WHEN existe en el workspace una fuente no borrada con los mismos `bytes` y `sha256_prefix` THE SYSTEM SHALL responder 409 `{ duplicate_of_project }` salvo que el cuerpo lleve `force: true`.
- [ ] WHEN `POST /api/uploads/:id/complete` recibe las ETag de todas las partes THE SYSTEM SHALL completar la subida en el R2 simulado, marcar la fuente `uploaded` y crear un único trabajo `engine = 'v2'` con las etapas `validate`, `mezzanine` y `proxy`, respondiendo 202 `{ job_id }`; repetida SHALL devolver el mismo `job_id` (criterio 1, servidor).
- [ ] WHEN el usuario B pide `GET /api/uploads/:id`, `POST /api/uploads/:id/parts` o `GET /api/uploads/sources/:sourceId/proxy` sobre recursos de A THE SYSTEM SHALL responder 404 sin firmar ninguna URL.
- [ ] WHEN `UPLOAD_STRATEGY=parts` THE SYSTEM SHALL devolver URLs PUT para objetos `original.partNNN` de 47185920 bytes como máximo, y `GET /api/uploads/:id` SHALL reconstruir las partes subidas con HEAD por objeto.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/providers/src/r2.test.ts apps/web/lib/uploads.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 07 — API de subida" && git tag rafaga-v2-step-07`

---

#### Paso 8 — Cliente de subida
**Hacer:** `apps/web/lib/uploader.ts` (`planParts(bytes, 16777216)`, `Sha256` incremental en TS puro, `mergeResume`,
`etaSeconds` con media móvil, `runUpload({ file, api, fetch, store, signal, concurrency: 3, retries: 5, backoffMs:
[1000, 2000, 4000, 8000, 16000] })` con eventos `{ bytesSent, totalBytes, speedBps, etaS, state }`, `cancel()`);
`apps/web/lib/hash.worker.ts` (Web Worker: `sha256_prefix` de la primera parte y `sha256` completo);
`apps/web/components/UploadPanel.tsx` (soltar archivo, Subir, Google Drive, Dropbox, Enlace directo — estos tres llaman
a `/api/import/*` del paso 17 y muestran `not_configured` hasta entonces; cuota antes de subir; progreso real; Cancelar;
Reanudar tras recargar; aviso de duplicado; tarjeta final con nombre, miniatura, duración, resolución, idioma y estado de
validación); `scripts/r2-multipart-probe.ts` (`--dry-run` imprime las cinco operaciones sin red; real exige las 4
variables R2, si no sale 78; dos partes de 5 MiB en `rafaga-probe/` borradas al final); `apps/web/lib/uploader.test.ts`.

**Hecho cuando**
- [ ] WHEN `planParts` recibe 4294967296 bytes THE SYSTEM SHALL devolver 256 partes de 16777216 bytes, y para 20000000 bytes SHALL devolver 2 partes de 16777216 y 3222784 bytes.
- [ ] WHEN `Sha256` incremental procesa un búfer de 5 MB en trozos irregulares THE SYSTEM SHALL producir el mismo resumen que `createHash('sha256')` de `node:crypto` sobre el búfer completo.
- [ ] WHEN el servidor informa de las partes 1–3 subidas y el registro local tiene las partes 1–2 THE SYSTEM SHALL programar exactamente las partes que el servidor no informa como subidas.
- [ ] WHEN el PUT de una parte falla dos veces por error de red y luego responde 200 THE SYSTEM SHALL completar con 3 intentos para esa parte y nunca más de 3 partes en vuelo, informando bytes enviados, velocidad y ETA en cada evento.
- [ ] WHEN se llama a `cancel()` THE SYSTEM SHALL abortar los PUT en vuelo, enviar `DELETE /api/uploads/:id` y dejar el estado `cancelled`.
- [ ] WHEN se ejecuta `node scripts/r2-multipart-probe.ts --dry-run` THE SYSTEM SHALL imprimir las cinco operaciones S3 previstas y salir con 0 sin red, y sin las variables R2 y sin `--dry-run` SHALL salir con 78.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/uploader.test.ts
export PATH="$HOME/.local/bin:$PATH" && node scripts/r2-multipart-probe.ts --dry-run
export PATH="$HOME/.local/bin:$PATH" && env -u R2_ACCOUNT_ID -u R2_BUCKET -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY node scripts/r2-multipart-probe.ts; test $? -eq 78
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 08 — cliente de subida" && git tag rafaga-v2-step-08`

---

#### Paso 9 — Validación, mezzanine y estado derivado
**Hacer**
- `workers/media/src/fixtures.ts` (no es prueba): `makeFixture(kind, dir)` en `.fixtures/` con `ffmpeg -f lavfi`:
  `ok` (6 s, 1920×1080, 25 fps, H.264, audio `pcm_s24le` estéreo, MOV con pista de timecode `-timecode 01:00:00:00`,
  tono intermitente como «habla escasa»), `noaudio`, `corrupt` (primeros 4096 bytes de `ok`), `rotated`
  (`-display_rotation 90`), `vfr` (tramos a 25 y 12 fps con `-fps_mode passthrough`), `short3` (3 s). Exporta
  `pgliteCtx(db)` y `fakeR2()`. Si falta ffmpeg, las pruebas fallan, no se omiten.
- `workers/media/src/stages/validate.ts`: etapa `validate` (bytes mágicos `ftyp`/EBML; ffprobe: códec, duración,
  resolución, fps, pistas de audio, rotación, VFR, pistas de datos ignoradas; límites 3600 s y 4294967296 bytes; muestra
  de 30 s → `groqTranscribe` con `ctx.fetch` para el idioma; miniatura `thumb.jpg`; metadatos en `sources`) y etapa
  `mezzanine` (1080p H.264 High ~6 Mbps VBV, AAC 192k, clave cada 1 s, `+faststart`, `-map 0:v:0 -map 0:a:0?`, PCM →
  AAC; comprobación ffprobe: duración a ≤1 fotograma de la fuente y pistas presentes; si pasa: `record_object`
  `mezzanine`, borrar el original (y partes) de R2, `mark_purged`, `sources.storage_path` = clave de la mezzanine,
  `sources.status = 'validated'`; si no pasa: falla sin borrar nada).
- `apps/web/lib/progress.ts`: `deriveProjectState({ job, stages, clips })` pura e independiente del orden →
  `{ phase, currentStage, done, failed, partial, queued: { reason } | null, firstClipAt }`; `subscribe(supabase,
  projectId, onChange)`.
- `workers/media/src/validate.test.ts` (el trabajo del runner se crea con `enqueue_job` y solo las etapas `validate` y
  `mezzanine`), `apps/web/lib/progress.test.ts`.

**Hecho cuando**
- [ ] WHEN `validate` analiza el fixture `ok` (1080p25 H.264, `pcm_s24le`, pista de timecode) THE SYSTEM SHALL devolver `status: "ok"` con duración 6 s ±0.1, 1920×1080, 25 fps, 1 pista de audio, la pista de datos ignorada y el idioma de la respuesta simulada de Groq.
- [ ] WHEN el fixture no tiene audio THE SYSTEM SHALL devolver `status: "ok"` con el aviso `no_audio`, `modes_available` igual a `["manual", "destacados"]` y `subtitles: false`.
- [ ] WHEN el archivo está truncado o no es un contenedor admitido THE SYSTEM SHALL devolver `unsupported` con `corrupt_file` o `unsupported_container` y un mensaje de solución en español; con más de 3600 s o más de 4294967296 bytes SHALL devolver `too_long` o `too_large`; con rotación de 90° o VFR SHALL devolver `needs_conversion` con `rotation` o `vfr`.
- [ ] WHEN la etapa `mezzanine` procesa el fixture `ok` THE SYSTEM SHALL escribir un MP4 h264 de 1080 px de alto con audio AAC, sin pista de datos, `moov` antes de `mdat`, claves a ≤1 s y duración a ≤1 fotograma de la fuente, y solo entonces SHALL borrar el original del R2 simulado, marcarlo purgado y apuntar `sources.storage_path` a la mezzanine.
- [ ] WHEN el runner ejecuta `validate` y `mezzanine` de un trabajo en cola usando solo filas de base de datos (PGlite, sin cliente HTTP) THE SYSTEM SHALL cerrar ambas etapas `done`, poner `sources.status = 'validated'` y el trabajo en `done` (criterio 1).
- [ ] WHEN `deriveProjectState` recibe las mismas filas de `jobs`, `job_stages` y `clips` en cualquier orden THE SYSTEM SHALL devolver el mismo estado, con `partial: true` cuando hay al menos un clip `disponible` y etapas en curso, y `queued` con motivo cuando ninguna etapa corre (criterio 2).

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/validate.test.ts apps/web/lib/progress.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 09 — validación y mezzanine" && git tag rafaga-v2-step-09`

---

#### Paso 10 — Análisis y Procesamiento (vista v2)
**Hacer:** `workers/media/src/groqlimits.ts` (`GroqLimiter`: cubetas por minuto/hora/día; por defecto
`{"stt":{"rpm":20,"rpd":2000,"audio_s_per_h":7200,"audio_s_per_day":28800},"llm":{"rpm":30,"rpd":1000,"tpm":8000,"tpd":200000}}`,
sobrescribible con `GROQ_LIMITS`; `wait(kind, cost)` → `wait_ms`; `on429(retryAfterS)`; reloj inyectable; la espera
se publica en `job_stages.output.wait_ms`). `workers/media/src/stages/analysis.ts`: `proxy` (720p H.264 desde la
mezzanine, `+faststart`, `-force_key_frames expr:gte(t,n_forced*1)`), `prepare` (audio opus 16 kHz mono desde la
mezzanine), `transcribe` (`planChunks` ≤600 s con 2 s de solape, trozos en paralelo bajo `GroqLimiter`, `mergeChunks`;
`inputs` = `{audio_sha256, asr_model, language, range}`), `scenes` (`scdet` + energía con `astats` →
`audio_signals`), `speakers` (Deepgram con `DEEPGRAM_API_KEY`; 402 o sin clave → hablante activo visual con `faces.py`
y `needs_review: true`; el detector de caras es inyectable). `apps/web/components/ProcessingPanel.tsx` (etapas, ETA o
«aún no se puede calcular», «En cola» con motivo, `aria-live="polite"`) y su uso en `apps/web/app/app/p/[id]/page.tsx`
**solo cuando el proyecto tiene algún trabajo `engine = 'v2'`**; la vista v1 de esa página no cambia.
`workers/media/src/analysis.test.ts`: la prueba del respaldo visual usa un detector de caras simulado (no necesita
opencv); la llamada real a `faces.py` solo se prueba si `python3 -c "import cv2"` funciona, y si no se omite con
`t.skip`, igual que `workers/media/src/reframe.test.ts`.

**Hecho cuando**
- [ ] WHEN `planChunks(3600)` se ejecuta THE SYSTEM SHALL devolver trozos de 600 s como máximo que se solapan 2 s y cubren [0, 3600] sin huecos.
- [ ] WHEN `mergeChunks` une dos trozos cuyo solape de 2 s contiene las mismas palabras THE SYSTEM SHALL emitir cada palabra una sola vez, en orden y con marcas de tiempo globales.
- [ ] WHEN el limitador usa los valores por defecto (20 peticiones/min, 7200 s de audio/h, 28800 s de audio/día) o los de `GROQ_LIMITS`, y recibe una 21.ª petición en el mismo minuto o un 429 con `retry-after: 7` THE SYSTEM SHALL retrasarla, con `wait_ms` ≥ 7000 en el caso del 429 (reloj simulado).
- [ ] WHEN la etapa `proxy` procesa la mezzanine del fixture THE SYSTEM SHALL escribir un MP4 h264 de 720 px de alto con `moov` antes de `mdat` y fotogramas clave a ≤1 s.
- [ ] WHEN `speakers` recibe 402 de Deepgram (simulado) o falta `DEEPGRAM_API_KEY` THE SYSTEM SHALL usar el hablante activo visual (detector de caras simulado) y marcar `needs_review: true`.
- [ ] WHEN `transcribe` se ejecuta dos veces sobre el mismo audio y el mismo `asr_model` THE SYSTEM SHALL calcular el mismo `input_hash`, servir la segunda desde la caché y hacer 0 llamadas a la ASR la segunda vez (criterio 3, análisis).

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/analysis.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'BriefFields' 'apps/web/app/app/p/[id]/page.tsx'
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 10 — análisis" && git tag rafaga-v2-step-10`

---

#### Paso 11 — Panel de creación, estimación y reserva
**Hacer**
- `apps/web/lib/generations.ts` (pura): `validateParams(params, sourceDurationS)`; `DURATION_BUCKETS` = `auto` [10,180],
  `lt30` [10,30], `30_60` [30,60], `60_90` [60,90], `90_180` [90,180] segundos (la etiqueta «Auto» del panel dice
  «10 s–3 min»); `estimateUnits({ minutes, hasAnalysis, hook })` → `{ processing, clipping, subtitles: 0, hook, total }`
  con processing 1.0/min (0 si hay análisis), clipping 0.2/min, hook 0.1 × `hook.top_n` si está activo (cada clip cuenta
  como 1 minuto), redondeo a 2 decimales; `viableCount(rangeS, minS)` = `floor(rangeS / minS)`; `summary(params)`;
  `componentVersions()`.
- `apps/web/app/api/generations/[[...slug]]/route.ts`: `estimate` (`units_balance`, `stage_eta`, análisis reutilizable)
  y crear (`request_generation`; luego `/api/wake` sin esperar).
- `apps/web/components/CreationPanel.tsx`: el panel de §6 (receta, Mis recetas con `generation_recipes`, brand kit,
  ajustes, rangos de duración, Momentos a incluir, intervalo, galería de subtítulos con edición de fuente/colores/tamaño/
  posición guardada en `params.caption_style`, gancho y su plantilla, plantilla viral y formato, Resumen con desglose y
  «Aplicar extras a los N mejores clips», Crear idempotente). Las recetas Solo subtítulos / Solo reencuadre / Limpiar
  grabación llaman a las funciones existentes (§6). Sin estilos de interfaz nuevos.
- `apps/web/app/app/nuevo/page.tsx`: `UploadPanel` (paso 8) → tarjeta de validación → `CreationPanel` (activo con la
  fuente `validated`) → `/app/p/[id]`; solo si `NEXT_PUBLIC_PIPELINE_VERSION === "v2"`, si no el flujo actual intacto.
- `apps/web/lib/generations.test.ts` (PGlite + `fakeSupabaseFetch`).

**Hecho cuando**
- [ ] WHEN `POST /api/generations` se dispara 3 veces con la misma `Idempotency-Key` y el mismo cuerpo THE SYSTEM SHALL crear exactamente 1 generación, 1 trabajo y 1 fila `reserve` y responder 202 con el mismo `{ generation_id, job_id }` las 3 veces (criterio 6); con la misma clave y otro cuerpo SHALL responder 409 `idempotency_conflict`.
- [ ] WHEN el saldo es menor que las unidades necesarias THE SYSTEM SHALL responder 402 `{ needed, balance }` sin escribir generación, trabajo ni movimiento en el libro.
- [ ] WHEN se estima un tramo de 30 min sin análisis THE SYSTEM SHALL devolver `total: 36` (30 × 1.2), con análisis reutilizable `total: 6` (30 × 0.2), y con gancho en los 10 mejores clips SHALL sumar `hook: 1` (10 × 0.1).
- [ ] WHEN alguna etapa del plan tiene menos de 5 muestras en `stage_timings` THE SYSTEM SHALL devolver `eta: null`, y con 5 o más SHALL devolver `{ p50_s, p90_s }` calculados a partir de ellas.
- [ ] WHEN los parámetros violan los límites (rango de duración desconocido, número pedido mayor que 20, tramo fuera de la fuente, modo desconocido) o la fuente no está `validated` THE SYSTEM SHALL responder 400 `invalid_params` con el campo, o 409 `source_not_ready`.
- [ ] WHEN el número pedido supera el viable (`floor(duración del tramo / mínimo del rango de duración)`) THE SYSTEM SHALL guardar el número pedido en `generations.requested_count` y la estimación SHALL incluir `viable_count`, y los rangos `auto`, `lt30`, `30_60`, `60_90` y `90_180` SHALL traducirse a [10,180], [10,30], [30,60], [60,90] y [90,180] segundos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/generations.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 11 — panel de creación" && git tag rafaga-v2-step-11`

---

#### Paso 12 — Modos, puntuación editorial y selección robusta
**Hacer**
- `packages/selection/package.json`: añadir a `exports` la subruta `"./modes": "./src/modes.ts"` (sin tocar las
  existentes). El worker importa `@rafaga/selection/modes` (`workers/media` ya depende de `@rafaga/selection`).
- `packages/selection/src/modes.ts`: `MODES` (`automatico`, `por_tema`, `pregunta_respuesta`, `educativo`, `historia`,
  `destacados`, `manual`; `{ id, label, promptId, filters, model: "editorial" | null }`, `null` en destacados y manual);
  `qualityFilters` (frase cortada al inicio; pronombre/deíctico inicial sin antecedente —`esto`, `eso`, `aquello`,
  `él`, `ella`, `ellos`, `ahí`, `allí`, `this`, `that`, `it`, `they`, `there`—; sin cierre; solape >50 %);
  `editorialScore` con los motivos `gancho`, `desarrollo`, `valor`, `afinidad`, `calidad_tecnica` (0–1, cada uno con
  texto) y `overall` 0–100 con `EDITORIAL_WEIGHTS` = gancho 0.30, desarrollo 0.20, valor 0.25, afinidad 0.15,
  calidad_tecnica 0.10; sin dispersión artificial: los empates conservan su puntuación y añaden `notes.difference`;
  `minSecFor(bucket, targetS)` = 70 % del objetivo por debajo del máximo (generaliza `1d1024f`); `shortfall(requested,
  delivered, reasons)`.
- `packages/selection/src/modes.test.ts`: contiene su propio transcript de prueba en español (≈4 min, habla escasa)
  como constante del archivo; no se exporta a otros paquetes.
- `workers/media/src/stages/select.ts` — **generaliza** los arreglos ya desplegados (`2fbd1a5`, `1d1024f`, `f74e330`)
  dentro del módulo de etapa, sin tocar `run.ts`: `candidates` (ventanas en paralelo con `groqProposeClips` bajo
  `GroqLimiter`, cada ventana con su propio `try/catch`, `output.ai_windows` = `"<ok>/<total>"`; destacados por picos
  de `audio_signals` y escenas; manual sin LLM), `select` (filtros, deduplicado, `exclude_previous`,
  `alternatives_for`; si faltan clips tras validar, **segunda pasada** de IA por ventana pidiendo momentos nuevos con los
  rangos de palabras ya elegidos excluidos, `output.second_pass`; si aún no queda ninguno y hay habla, pasada léxica
  relajada mín ×0.5 / máx ×1.5 anotada en `reason` y `output.relaxed`; si sigue en 0, aviso `no_moments` con motivos;
  **nunca 0 sin aviso**; clips en `preparando`; `warnings` y `delivered_count`; 0 útiles → `units_actual: 0` libera la
  selección y el análisis se mantiene) y `translate` (texto por grupo con `groqChat`, tiempos intactos).
- `workers/media/src/select.test.ts`: su propio transcript de prueba y respuestas de Groq simuladas.

**Hecho cuando**
- [ ] WHEN se lee `MODES` THE SYSTEM SHALL contener exactamente `automatico`, `por_tema`, `pregunta_respuesta`, `educativo`, `historia`, `destacados` y `manual`, cada uno con id de prompt, filtros y modelo, con `model: null` en `destacados` y `manual`.
- [ ] WHEN los filtros de calidad se aplican a los candidatos del transcript de prueba de `modes.test.ts` THE SYSTEM SHALL descartar los que empiezan a mitad de frase, empiezan con un pronombre o deíctico sin antecedente, terminan sin cierre o se solapan más de un 50 % con uno ya aceptado.
- [ ] WHEN se puntúan los candidatos del transcript de prueba THE SYSTEM SHALL exponer `gancho`, `desarrollo`, `valor`, `afinidad` y `calidad_tecnica` entre 0 y 1 con texto y `overall` entre 0 y 100, ordenar los candidatos de calidad distinta en el orden esperado, añadir `notes.difference` a los empatados sin alterar sus puntuaciones, y ningún `reason` SHALL contener «viral».
- [ ] WHEN se piden 10 clips y solo 3 pasan los filtros THE SYSTEM SHALL entregar 3, poner `delivered_count = 3` y añadir a `generations.warnings` `{ "code": "shortfall", "requested": 10, "delivered": 3, "reasons": [...] }`; con 0 útiles SHALL devolver las unidades de `select` y mantener el cargo del análisis (criterio 8).
- [ ] WHEN Groq (simulado) responde `400 json_validate_failed` en una de 3 ventanas y faltan clips tras validar aunque el transcript tiene habla THE SYSTEM SHALL procesar las otras 2 (`ai_windows = "2/3"`), pedir una segunda pasada con los rangos ya elegidos excluidos (`second_pass`), después la pasada relajada (mín ×0.5, máx ×1.5) anotada en `reason` y `relaxed`, y si sigue sin clips SHALL escribir el aviso `no_moments` con sus motivos en lugar de terminar con 0 en silencio.
- [ ] WHEN `destacados` recibe picos de energía y cambios de escena THE SYSTEM SHALL proponer candidatos centrados en ellos con 0 llamadas al LLM (también `manual`), `exclude_previous` SHALL evitar todo solape con clips anteriores del proyecto, y `translate` SHALL conservar el inicio y el fin de cada grupo de subtítulos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/selection/src/modes.test.ts workers/media/src/select.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 12 — selección robusta" && git tag rafaga-v2-step-12`

---

#### Paso 13 — Composiciones, plantillas virales y zonas seguras
**Hacer**
- `packages/composition/src/layouts.ts`: `CompositionV2` (`aspect`, `layout`, `template`, `fragments`, `cuts`, `kf`,
  `audio`, `subtitles`, `headline`, `extras`, `duration`); `planLayout(comp, srcW, srcH)` (cajas pares); respaldo de
  encuadre (última caja buena ponderada al centro → `fit_full` + `needs_review`); `switchLayout`; `toLegacyComposition`
  hacia la `Composition` existente para `ffmpegArgs` (single_track → fill + `reframe.kf`; split_two → split con hablante
  por mitad; active_speaker → speaker; screen_presenter → fit + cam; fit_full → blur/fit/fill; manual → fill + kf);
  `TEMPLATES` (funciones puras → `CompositionV2`, rectángulos normalizados por formato): `titular_video_subtitulos`
  (fondo desenfocado y ampliado del mismo vídeo, banda 16:9 o 4:5 centrada, titular de 1–2 líneas arriba —primera blanca,
  segunda en color de acento, píldora roja opcional— y subtítulos debajo), `pantalla_dividida`, `hablante_seguimiento`,
  `cambio_hablante`, `presentacion_ponente`, `presentacion_sola`, `titular_en_caja`, `titular_sobre_desenfoque`,
  `video_completo`. Sin nombres que choquen con los ya exportados.
- `packages/composition/src/safezones.ts`: `SAFE_ZONES_VERSION`; `SAFE_ZONES` para `tiktok`, `instagram_reels` y
  `youtube_shorts` en 9:16: rectángulos inseguros normalizados (barra derecha de acciones, zona inferior de
  texto/descripción, parte superior de pestañas). **Los valores se miden** consultando las páginas oficiales de
  especificaciones creativas de cada plataforma; cada entrada lleva `source` (URL https) o, si no se puede medir de una
  fuente pública, `note: "medido por nosotros, revisar"` (el propietario los revisa en LC-15). Nunca se inventan.
  `safeArea(platforms)` (intersección), `validateSafeZones(comp, platforms)` → cajas de texto que invaden.
- `packages/composition/src/index.ts`: `export * from "./layouts.ts"; export * from "./safezones.ts";`.
- `workers/media/src/stages/compose.ts`: `compose` (por clip: versión 1 con `aspect`, `layout`, `template` y el
  `caption_style` de la generación; titular con `groqChat` si el gancho está activo para los N mejores, `units_actual` =
  0.1 × ganchos hechos; `technical_state = 'disponible'` clip a clip; ningún MP4), `previews` (`preview.jpg`),
  `checks` (composición presente, duración dentro del rango, `validateSafeZones` → aviso `safe_zone` en el clip).
- `workers/media/src/compose.test.ts`: pruebas de `layouts.ts`, `safezones.ts`, plantillas y etapa (PGlite) y renders
  reales con ffmpeg sobre `short3`; palabras de subtítulos definidas en la propia prueba.

**Hecho cuando**
- [ ] WHEN `planLayout` se ejecuta para cada uno de los 6 diseños en cada uno de los 3 formatos (18 combinaciones) THE SYSTEM SHALL devolver cajas dentro del fotograma con dimensiones pares.
- [ ] WHEN la cobertura del seguimiento cae por debajo de `minCoverage` THE SYSTEM SHALL usar la última caja buena ponderada al centro y después `fit_full` y marcar `needs_review: true`, y `switchLayout` SHALL conservar fragmentos, cortes, subtítulos, audio y extras.
- [ ] WHEN cada plantilla de `TEMPLATES` se genera para 9:16, 1:1 y 16:9 THE SYSTEM SHALL devolver rectángulos normalizados en [0,1], y `titular_video_subtitulos` en 9:16 SHALL colocar el titular por encima de la banda de vídeo y los subtítulos por debajo, con fondo desenfocado.
- [ ] WHEN se leen `SAFE_ZONES` THE SYSTEM SHALL tener entradas para `tiktok`, `instagram_reels` y `youtube_shorts` con rectángulos en [0,1] y una `source` https o la `note` "medido por nosotros, revisar", las plantillas con plataformas seleccionadas SHALL quedar dentro de `safeArea`, y `validateSafeZones` SHALL marcar una caja de texto que invade un rectángulo inseguro.
- [ ] WHEN ffmpeg renderiza el fixture de 3 s con los 6 diseños en 9:16, `fit_full` en 16:9 y 1:1, y `titular_video_subtitulos` en 9:16 THE SYSTEM SHALL salir con 0 y ffprobe SHALL informar h264 con el ancho y el alto de `RATIO_SIZE` de cada formato.
- [ ] WHEN la etapa `compose` se ejecuta para una generación THE SYSTEM SHALL crear por clip la versión 1 con `aspect`, `layout` y `template`, poner `technical_state = 'disponible'` y crear 0 filas en `renders`, y `checks` SHALL añadir el aviso `safe_zone` a un clip cuyo texto invade la zona insegura.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/compose.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 13 — composiciones y plantillas" && git tag rafaga-v2-step-13`

---

#### Paso 14 — Motor de escena, resultados y pantalla completa (vista v2)
**Hacer**
- `packages/composition/src/layouts.ts`: añadir `sceneAt(comp, t, srcW, srcH, opts?)` → `{ video, headline, subtitles,
  overlays }` con las mismas funciones que la exportación (`planLayout`, `xAt`, `mapTime`/`retimeWords`, `groupWords`/
  `layoutLines`); `opts.safeZones` añade `overlays` solo para la vista previa.
- `packages/composition/src/parity.test.ts`: propiedades; su transcript de prueba es una constante del archivo
  (`packages/composition` no importa `@rafaga/selection`).
- `apps/web/components/PreviewPlayer.tsx`: `<video>` del proxy (`GET /api/uploads/sources/:sourceId/proxy`) + `<canvas>`
  con `sceneAt` en cada `requestAnimationFrame`; selector «Zonas seguras: TikTok | Instagram | Shorts»; modo pantalla
  completa (`Escape` cierra, `ArrowLeft`/`ArrowRight` anterior/siguiente, espacio reproduce/pausa; título, puntuación,
  motivos, Editar, Exportar).
- `apps/web/components/ResultsGrid.tsx` (la **vista v2** completa de resultados): rejilla de vistas verticales con
  puntuación 0–100, título, duración y acciones (descargar, programar, editar); cabecera con el prompt; búsqueda
  «palabras clave o momentos»; filtro y orden (relevancia, duración, posición); rejilla/lista; selección múltiple con
  acciones según la selección; grupos por generación y **mapa temporal** de los clips sobre la línea de tiempo de la
  fuente; botón «Nueva generación» (abre `CreationPanel`, conserva resultados); clic → pantalla completa. No importa
  `BriefFields` ni `BriefUnderstanding`.
- `apps/web/app/app/p/[id]/page.tsx`: si el proyecto tiene algún trabajo `engine = 'v2'`, muestra `ResultsGrid` con el
  resumen (clips, minutos analizados, consumo final, avisos incluido `shortfall`, transcript) y Realtime
  (`postgres_changes` en `jobs`, `job_stages` y `clips`; clips visibles en cuanto `deriveProjectState` informa
  `partial`); si no, la vista v1 actual sin cambios (`BriefFields`, «Volver a detectar», «Ajustar enfoque»).

**Hecho cuando**
- [ ] WHEN `parity.test.ts` compara, para cada grupo de subtítulos de su transcript de prueba, el inicio y el fin del evento `Dialogue` de `buildAss` con el intervalo de `sceneAt` THE SYSTEM SHALL encontrar diferencias de 1 fotograma (1/30 s) como máximo.
- [ ] WHEN se comparan las cajas de `ffmpegArgs` (vía `toLegacyComposition`) con las de `sceneAt` THE SYSTEM SHALL encontrarlas iguales en los diseños sin fotogramas clave y el mismo arreglo `kf` en los demás, y los `overlays` de zonas seguras SHALL aparecer en `sceneAt` con `safeZones` y nunca en los argumentos de ffmpeg.
- [ ] WHEN se ejecutan `grep -q 'sceneAt' apps/web/components/PreviewPlayer.tsx` y `grep -q 'Escape' apps/web/components/PreviewPlayer.tsx` THE SYSTEM SHALL salir con 0 en ambos: la vista previa usa el motor de exportación y la pantalla completa se cierra con Esc.
- [ ] WHEN se ejecutan `grep -q 'postgres_changes' 'apps/web/app/app/p/[id]/page.tsx'`, `grep -q 'ResultsGrid' 'apps/web/app/app/p/[id]/page.tsx'` y `grep -q 'BriefFields' 'apps/web/app/app/p/[id]/page.tsx'` THE SYSTEM SHALL salir con 0 en los tres (la vista v1 conserva `BriefFields`), `grep -q 'BriefFields' apps/web/components/ResultsGrid.tsx` SHALL salir con 1 (la vista v2 no lo usa), y `pnpm --filter @rafaga/web build` SHALL salir con 0.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/parity.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'sceneAt' apps/web/components/PreviewPlayer.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Escape' apps/web/components/PreviewPlayer.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'postgres_changes' 'apps/web/app/app/p/[id]/page.tsx'
export PATH="$HOME/.local/bin:$PATH" && grep -q 'ResultsGrid' 'apps/web/app/app/p/[id]/page.tsx'
export PATH="$HOME/.local/bin:$PATH" && grep -q 'BriefFields' 'apps/web/app/app/p/[id]/page.tsx'
export PATH="$HOME/.local/bin:$PATH" && grep -q 'BriefFields' apps/web/components/ResultsGrid.tsx; test $? -eq 1
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 14 — resultados y pantalla completa" && git tag rafaga-v2-step-14`

---

#### Paso 15 — Editor v2 y demos editables
**Hacer:** `apps/web/lib/editor.ts` (historial `apply/undo/redo/duplicate`; entrada/salida con paso de fotograma,
extender con la mezzanine, editar por transcript, borrar/restaurar fragmentos vía `cuts`, corregir texto y tiempos con
`editText`/`setTiming`, composición y plantilla con `switchLayout`/`TEMPLATES`, volumen; los cortes actualizan vídeo,
audio y subtítulos con `mapTime`/`retimeWords`; clips v2 hasta 180 s con su propio límite, `trim.ts` no se toca;
autoguardado de 800 ms → `PUT /api/clips/:id/draft` con estados `guardando`, `guardado`, `error al guardar`;
`saveVersion`). `apps/web/app/api/clips/[[...slug]]/route.ts` (versions, draft, revisión de transcript con
`apply_transcript_revision` + `save_clip_version(…, p_user_edit => false)` para `follow_clips`, translate con
`enqueue_job` de 0.1 × minutos). `apps/web/app/app/c/[id]/page.tsx` (editor con `PreviewPlayer`, pantalla completa,
zonas seguras, transcript editable, corrección de subtítulos, deshacer/rehacer, estado de autoguardado, Guardar,
Duplicar; para clips de proyectos v1 conserva el editor actual). `apps/web/app/app/demos/page.tsx` («Abrir copia
editable» con `duplicate_project`; el ejemplo compartido nunca cambia; las demos se presentan como ejemplos preparados,
distinguen vista previa de pieza completa e indican su fuente, sin simular una generación en vivo).
`apps/web/lib/editor.test.ts`.

**Hecho cuando**
- [ ] WHEN se borra un fragmento y después se restaura THE SYSTEM SHALL quitar y devolver sus palabras de los subtítulos y acortar y restaurar la línea de tiempo, `mapTime` SHALL llevar cada instante superviviente a tiempo de edición y de vuelta con error de 1 ms como máximo, y N deshacer tras N ediciones SHALL devolver la especificación inicial que N rehacer vuelve a aplicar.
- [ ] WHEN hay ediciones en t = 0, 300 y 600 ms THE SYSTEM SHALL escribir un único borrador en t = 1400 ms pasando por `guardando` y `guardado`, y si la escritura falla SHALL mostrar `error al guardar` sin perder la edición en memoria.
- [ ] WHEN `POST /api/clips/:id/versions` llega con un `base_version` obsoleto THE SYSTEM SHALL responder 409 `{ conflict: { current_version } }` sin crear versión; con la vigente SHALL responder 201 `{ version }`, y aplicar otra composición o plantilla así SHALL crear 0 trabajos, 0 etapas y 0 movimientos en el libro (criterio 3).
- [ ] WHEN se guarda una nueva revisión del transcript THE SYSTEM SHALL crear una versión nueva con los subtítulos corregidos solo para los clips con `user_edited = false` y dejar idénticas las versiones de los editados por el usuario (criterio 4).
- [ ] WHEN se lanza una nueva generación sobre el mismo proyecto THE SYSTEM SHALL dejar sin cambios todas las filas anteriores de `clips` y `clip_versions` (criterio 4).
- [ ] WHEN se ejecuta `grep -q 'duplicate_project' apps/web/app/app/demos/page.tsx` THE SYSTEM SHALL salir con 0: abrir una demo crea una copia editable y nunca modifica el ejemplo compartido.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/editor.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'duplicate_project' apps/web/app/app/demos/page.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 15 — editor v2" && git tag rafaga-v2-step-15`

---

#### Paso 16 — Exportaciones
**Hacer:** `workers/media/src/stages/export.ts`: `render` (lee `clip_versions` por `(clip_id, clip_version)` de la fila
`renders`, nunca la versión actual; parte de la **mezzanine**; `toLegacyComposition` → `ffmpegArgs`; H.264 High, AAC
LC, yuv420p, `+faststart`; ffprobe; sube a `<ws>/<clip>/v<version>-<hash12>.<ext>` con `expires_at` +30 días; quemado o
limpio; srt/vtt/txt con `toSRT`/`toVTT`/`toTranscript`; FCPXML 1.10, xmeml v4 y EDL CMX3600 + SRT con constructores en
este módulo; fallo de un ítem → solo su etapa `render_failed`) y `zip` (`ZipBuilder` con una entrada por exportación
`ready`; lote `partial` si alguna falló). `apps/web/app/api/exports/[[...slug]]/route.ts` (§5; `downloaded_at` en la
primera descarga). `apps/web/app/app/exports/page.tsx` (versión, formato, resolución, duración, tamaño, estado,
caducidad; descargar, ZIP, reintentar, renovar; aviso `safe_zone` en el diálogo; Publicar).
`workers/media/src/export.test.ts`, `apps/web/lib/exports.test.ts`.

**Hecho cuando**
- [ ] WHEN `render` exporta la versión 1 de un clip y después se guarda la versión 2 THE SYSTEM SHALL producir el MP4 a partir de la composición de `(clip_id, 1)` y la mezzanine —H.264 High, AAC LC, yuv420p y `moov` antes de `mdat`— y la fila de `renders` SHALL seguir con `clip_version = 1` (criterio 5).
- [ ] WHEN un lote de 3 exportaciones tiene una que falla THE SYSTEM SHALL dejar las otras 2 en `ready` y descargables y el lote en `partial`, y `POST /api/exports/:id/retry` SHALL reencolar solo la fallida (criterio 7).
- [ ] WHEN se pide dos veces la misma exportación (versión, formato, subtítulos y tipo) THE SYSTEM SHALL reutilizar la fila de `renders` sin crear un trabajo nuevo.
- [ ] WHEN el usuario B pide `GET /api/exports/:id/url` de una exportación de A THE SYSTEM SHALL responder 404 sin firmar ninguna URL, y para A SHALL devolver `{ url, expires_at }` y fijar `downloaded_at` solo en la primera descarga (criterio 9, ruta).
- [ ] WHEN `zip` empaqueta un lote THE SYSTEM SHALL producir con `ZipBuilder` una entrada por exportación `ready`, y las salidas SRT, VTT, TXT, FCPXML, xmeml y EDL SHALL cumplir su formato: `<fcpxml version="1.10">`, `<xmeml version="4">`, una línea `TITLE:` y un evento por fragmento en la EDL.
- [ ] WHEN se pide la URL de una exportación cuyo objeto se purgó THE SYSTEM SHALL volver a renderizarla desde su versión inmutable sin ningún movimiento en el libro.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/export.test.ts apps/web/lib/exports.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 16 — exportaciones" && git tag rafaga-v2-step-16`

---

#### Paso 17 — Importación y publicación
**Hacer:** `packages/providers/src/oauth.ts` (proveedor `tiktok` con endpoints OAuth marcados no verificados —LC-10—,
capacidades `publish_youtube` con alcance `https://www.googleapis.com/auth/youtube.upload` y `publish_tiktok` con
`video.publish`; `authUrl` con `client_key` para TikTok); `apps/web/lib/oauthserver.ts` (`providerConfig("tiktok")`
con `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`; `CAPS` ampliado); `workers/media/src/stages/integrations.ts`
(`import`: `checkUrl` + DNS con `isPublicIp` en cada salto, sin redirecciones a rangos privados, `content-length`
≤4294967296 y `content-type` de vídeo, descarga en flujo a R2 por partes, Drive/Dropbox con `oauth_token`, luego encola
`validate`/`mezzanine`/`proxy`; `publish`: YouTube `videos.insert` reanudable con la privacidad elegida, y si la
respuesta trae `status.privacyStatus = "private"` cuando se pidió otra → `private_pending_review`; TikTok
`creator_info/query` → `privacy_level` de `privacy_level_options` → `video/init` con `FILE_UPLOAD` → PUT a
`upload_url` → `status/fetch`; `unaudited_client_can_only_post_to_private_accounts` → `requiere_auditoria`);
`apps/web/app/api/[integration]/[[...rest]]/route.ts` (`import` con `link|drive|dropbox`, `publish`; otro → 404);
`apps/web/lib/integrations.test.ts` (fetch y DNS simulados).

**Hecho cuando**
- [ ] WHEN `POST /api/import/link` recibe una URL `http:`, una que resuelve a una IP privada o de loopback, o una cuya redirección apunta a un rango privado THE SYSTEM SHALL responder 400 `{ reason }` con `not_https`, `private_address` o `redirect_private` sin crear ningún trabajo.
- [ ] WHEN `import` descarga un enlace con `content-length` mayor que 4294967296 o `content-type` que no es de vídeo THE SYSTEM SHALL fallar con `too_large` o `unsupported_file` sin escribir en R2, y con un enlace válido SHALL subirlo a R2 por partes y encolar `validate`.
- [ ] WHEN `POST /api/publish` llega para YouTube THE SYSTEM SHALL enviar `videos.insert` (simulado) con la privacidad elegida, `private` por defecto, y si la respuesta trae `status.privacyStatus` `private` cuando se pidió otra SHALL poner la publicación en `private_pending_review`.
- [ ] WHEN TikTok responde `unaudited_client_can_only_post_to_private_accounts` THE SYSTEM SHALL poner la publicación en `requiere_auditoria` con su explicación, y el `privacy_level` enviado SHALL ser uno de `privacy_level_options`.
- [ ] WHEN una publicación tiene `scheduled_at` futuro THE SYSTEM SHALL dejarla en `scheduled` sin llamar a la plataforma hasta que `enqueue_due_publications()` la encuentre vencida.
- [ ] WHEN se inicia una conexión con `publish_tiktok` o `publish_youtube` THE SYSTEM SHALL usar `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` o `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y el alcance `video.publish` o `https://www.googleapis.com/auth/youtube.upload`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/integrations.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-v2: paso 17 — importación y publicación" && git tag rafaga-v2-step-17`

---

#### Paso 18 — Ciclo de vida, métricas, Uso y rendimiento
**Hacer:** `workers/media/src/stages/purge.ts` (lo carga `stage.ts --purge` con `import()` desde el paso 5, sin editar
`stage.ts`: `purge_candidates` → DELETE firmado en R2 → `mark_purged`; un 404 de R2 cuenta como borrado).
`workers/media/src/lifecycle.test.ts` (PGlite + R2 simulado: original con mezzanine registrada, exportación caducada,
proyecto con `purge_at` vencido, proxy y mezzanine de un proyecto vivo; `trash_project`/`restore_project`;
`storage_summary`; `product_metrics`). `apps/web/app/app/uso/page.tsx` (almacenamiento frente a 10 GB, saldo, cómputo
del mes frente a 30 USD con el aviso al 90 %, caducidades y consecuencias de borrar, archivar/papelera/definitivo).
`scripts/perf-run.ts` (`--quick`: fixtures de 5 min con `ffmpeg -f lavfi` en 360p con `pcm_s24le` y timecode, 2
proyectos a la vez por las etapas locales sobre PGlite con ASR/LLM simulados de retardo fijo, p50/p95 de `upload_ms`,
`queue_ms`, `analysis_ms`, `first_clip_ms`, `all_clips_ms`, `render_ms`, `zip_ms`, escribe `docs/PERF.md` con entorno,
fecha y objetivos «a confirmar en Modal»; `--full` es LC-12).

**Hecho cuando**
- [ ] WHEN `purge_candidates()` se ejecuta THE SYSTEM SHALL devolver el original de una fuente con mezzanine registrada, las exportaciones con `expires_at` vencido y todos los objetos de proyectos con `purge_at` vencido, y SHALL no devolver el proxy ni la mezzanine de un proyecto fuera de la papelera.
- [ ] WHEN `purge` borra esos objetos en el R2 simulado THE SYSTEM SHALL llamar a `mark_purged` y `storage_used` SHALL bajar exactamente en la suma de sus bytes.
- [ ] WHEN un proyecto se envía a la papelera THE SYSTEM SHALL fijar `purge_at` 30 días después de `deleted_at`, y `restore_project` antes de esa fecha SHALL devolverlo con sus clips y versiones intactos.
- [ ] WHEN `storage_summary()` se llama THE SYSTEM SHALL devolver `used_bytes`, `quota_bytes = 10737418240`, el saldo, el cómputo del mes frente a `budget_usd` y las próximas caducidades del workspace, y para el usuario B sobre el workspace de A SHALL lanzar `not_found`.
- [ ] WHEN `product_metrics` se calcula sobre datos de prueba THE SYSTEM SHALL devolver `first_approved_s`, `acceptance_rate`, `active_correction_s`, `second_variant_s` y `approved_downloaded_per_creator`, contando solo proyectos con generaciones v2 y cada descarga repetida una sola vez.
- [ ] WHEN se ejecuta `node scripts/perf-run.ts --quick` THE SYSTEM SHALL generar fixtures de 5 min, ejecutar 2 proyectos a la vez con ASR y LLM simulados y escribir `docs/PERF.md` con p50 y p95 de `upload_ms`, `queue_ms`, `analysis_ms`, `first_clip_ms`, `all_clips_ms`, `render_ms` y `zip_ms`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lifecycle.test.ts
export PATH="$HOME/.local/bin:$PATH" && node scripts/perf-run.ts --quick
export PATH="$HOME/.local/bin:$PATH" && grep -q 'first_clip_ms' docs/PERF.md
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 18 — ciclo de vida y rendimiento" && git tag rafaga-v2-step-18
test "$(git tag -l 'rafaga-v2-step-*' | wc -l | tr -d ' ')" = 18
```

---

### 9.1 Paridad y transición
Dos migraciones: **(A)** worker de GitHub Actions → Modal; **(B)** render de todos los MP4 al generar → vista previa en
el navegador + render al exportar.

#### 1 · Checklist de paridad
| # | Comportamiento | Prueba | Tolerancia |
|---|---|---|---|
| A1 | Tipos heredados (`detect`, `render`, `lyrics`, `automation`, `live`, `package`, `reframe`) se siguen procesando | `run_legacy` ejecuta el mismo `run.ts` (con los arreglos desplegados); autopruebas `selftest`, `lyrics-selftest`, `looks-selftest`, `reframe-selftest`, `perf-selftest` en Modal (LC-11) | exit 0 igual que en Actions |
| A2 | Misma ffmpeg | SHA-256 en `app.py` = `worker.yml` (`wake.test.ts`) | exacta |
| A3 | Misma Node mayor y opencv | `wake.test.ts` | exacta |
| A4 | `claim_job`/`scheduler_tick` ignoran v2 | `job_stages.test.ts` + `rls.test.ts` | exacta |
| A5 | `/api/wake` sin `WORKER_BACKEND` = hoy | `wake.test.ts` | exacta |
| A6 | Contrato `app.py` ↔ `stage.ts` | `wake.test.ts` (opciones ⊆ `--list-flags`) + `stages.test.ts` (`--plan` numérico) | exacta |
| B1 | Vista previa = exportación | `parity.test.ts` | ≤ 1 fotograma; cajas iguales |
| B2 | Reutilización de exportaciones | `export.test.ts` + prueba de `request_render` | exacta |
| B3 | Clips v1 con MP4 siguen descargables | filas `renders` intactas + `pnpm test` | exacta |
| B4 | Entregas y enlaces fijan versiones | pruebas existentes de `rls.test.ts` | exacta |
| B5 | MP4 H.264 + AAC validado | `export.test.ts` | exacta |
| B6 | Vista v1 de `p/[id]` intacta | grep de `BriefFields` en la página (pasos 10 y 14) | exacta |

#### 2 · Arnés de paridad
```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/parity.test.ts apps/web/lib/wake.test.ts supabase/tests/job_stages.test.ts
```
En la nube: autopruebas de A1 en Modal frente a la última ejecución verde en Actions. **Sombra:** 7 días con
`WORKER_BACKEND=modal` y `NEXT_PUBLIC_PIPELINE_VERSION=v2`, Actions aún desplegado; paridad = 0 fallos de autoprueba y
<10 % de etapas fallidas en cada 24 h.

#### 3 · Coexistencia
`WORKER_BACKEND=actions|modal` decide el despacho de `/api/wake`; `NEXT_PUBLIC_PIPELINE_VERSION=v1|v2` decide el flujo
de Nuevo proyecto (por defecto `v1`: v2 se despliega a oscuras); `jobs.engine` separa colas (Actions ve `v1`; Modal ve
`v2` y, con `run_legacy`, también `v1` cuando `WORKER_BACKEND=modal`) y decide qué vista muestra `p/[id]`. Misma base de
datos, sin doble escritura. El render al generar solo existe en `run.ts`. Ningún proyecto histórico se reprocesa.

#### 4 · Secuencia de transición
| Fase | Cambio | Afecta a | Se revierte con | Hecho cuando (script) |
|---|---|---|---|---|
| 1 Oscuro | 034–037 aplicadas, Modal desplegado, `WORKER_BACKEND=actions`, `v1` | nadie | el propietario detiene la app `rafaga-worker` en el panel de Modal; las migraciones aditivas se quedan (el código v1 las ignora) | `test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MODAL_DISPATCH_URL" -H 'X-Rafaga-Wake: x')" = 401` |
| 2 Canario | `WORKER_BACKEND=modal` | trabajos v1 | `WORKER_BACKEND=actions` + redeploy | autopruebas A1 en Modal con exit 0 |
| 3 Completa | `NEXT_PUBLIC_PIPELINE_VERSION=v2` | proyectos nuevos | `v1` + redeploy | `select count(*) from jobs where engine = 'v2' and status = 'done'` > 0 |
| 4 Desmantelar | D1 | todos | `git revert` del commit de D1 + redeploy | `test "$(grep -c 'run.ts' .github/workflows/worker.yml \|\| true)" = 0` |

Todas son acciones del propietario (§20.1). La construcción termina con la fase 1 preparada y el camino antiguo intacto.
**Interruptor:** `WORKER_BACKEND=actions` + `NEXT_PUBLIC_PIPELINE_VERSION=v1` en Vercel y redeploy (~2–3 min, no
instantáneo); los trabajos v2 quedan en cola sin perderse.

#### 5 · Criterios de abandono (vigila el propietario)
- [ ] WHEN `select count(*) filter (where status = 'failed')::float / nullif(count(*), 0) from job_stages where finished_at > now() - interval '24 hours'` supera 0.10 THE SYSTEM SHALL revertirse con el interruptor.
- [ ] WHEN el p95 de `(jobs.metrics->>'queue_ms')::bigint` de los trabajos v2 de 24 h supera 600000 THE SYSTEM SHALL revertirse.
- [ ] WHEN `(public.compute_meter()->>'pct')::numeric` supera 90 antes del día 20 THE SYSTEM SHALL volver a `WORKER_BACKEND=actions` para los tipos heredados hasta el mes siguiente.
- [ ] WHEN `parity.test.ts` falla en `main` THE SYSTEM SHALL volver a `NEXT_PUBLIC_PIPELINE_VERSION=v1`.

#### Migración de datos
NOT APPLICABLE — no se mueven datos; v1 y v2 comparten tablas con columnas nuevas por defecto; no hay punto de no retorno
hasta D1.

#### 6 · Desmantelamiento — tarea D1
Tras 7 días seguidos sin criterios de abandono: (1) borrar de `.github/workflows/worker.yml` los pasos de proceso de
medios (o el archivo si no queda CI); (2) retirar `GH_DISPATCH_TOKEN` de Vercel y `gh_dispatch_token` de Vault;
(3) quitar la rama `actions` de `/api/wake` con su prueba; (4) registrar en `docs/provisioning-manifest.json` y
`docs/STATUS.md`. Respaldo: la etiqueta `rafaga-v2-step-18`; vuelta atrás con `git revert` del commit de D1.

---

## 10. Configuración del entorno

### Requisitos previos
| Herramienta | Versión | Comprobación |
|---|---|---|
| Node.js | ≥24 | `node --version` |
| pnpm | 12.18.0 en `~/.local/bin` | `pnpm --version` |
| ffmpeg/ffprobe | 9.0.2 en `~/.local/bin` | `ffmpeg -hide_banner -version` |
| Python | 3.10–3.15 | `python3 -c "import sys; print(sys.version)"` |
| Red | npm, PyPI y Google Fonts (`next build` con `next/font/google`), gratuitos; páginas oficiales de especificaciones creativas para medir zonas seguras (paso 13) | — |

Cuentas existentes: Supabase, R2, Vercel, Groq, Deepgram, Google Cloud, Dropbox. Nuevas: Modal (LC-1) y TikTok for
Developers (LC-10). Ninguna hace falta para construir.

### Variables de entorno
Sin validador global; cada ruta o etapa lee las suyas y responde `not_configured` si faltan. Las pruebas no leen `.env`.

| Variable | Para qué | Dónde se obtiene | Requerida desde | Secreto |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | Supabase → API | existente | no |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | worker | Supabase → API | 5 | clave sí |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | firma R2 | Cloudflare → R2 | existente; 7 | claves sí |
| `UPLOAD_STRATEGY` | `multipart` (defecto) o `parts` | tras LC-8 | 7 | no |
| `WORKER_BACKEND` | `actions` (defecto) o `modal` | transición | 6 | no |
| `WAKE_SECRET` | secreto Vercel ↔ Modal | `openssl rand -hex 32` (propietario) | 6 | sí |
| `MODAL_DISPATCH_URL` | URL de `dispatch` | salida de `modal deploy` | 6 | no |
| `GH_DISPATCH_TOKEN` | worker heredado hasta D1 | GitHub | existente | sí |
| `RAFAGA_CPU_CORES`, `RAFAGA_MEM_GIB` | medidor (2 / 4 en `app.py`) | `app.py` | 5 (defecto 1 / 2) | no |
| `GROQ_API_KEY` | ASR y LLM | console.groq.com | existente; 9 | sí |
| `GROQ_LIMITS` | límites de Groq en JSON | opcional | 10 | no |
| `ASR_PROVIDER`, `LLM_PROVIDER` | existentes | — | existente | no |
| `DEEPGRAM_API_KEY` | diarización | console.deepgram.com | existente; 10 (opcional) | sí |
| `PYTHON_BIN` | `faces.py` | `python3` | existente; 10 | no |
| `NEXT_PUBLIC_PIPELINE_VERSION` | `v1` (defecto) o `v2` | transición | 11 | no |
| `GOOGLE_CLIENT_ID/SECRET`, `DROPBOX_CLIENT_ID/SECRET` | importar/publicar | consolas | existente; 17 | secreto sí |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | publicar en TikTok | TikTok for Developers | 17 | secreto sí |
| `OAUTH_REDIRECT_BASE`, `WORKER_IDLE_SECONDS`, `WORKER_MAX_SECONDS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_TARIFFS`, `GLOBAL_DAILY_STT_MINUTES`, `NEXT_PUBLIC_PROCESSING_ENABLED` | existentes, sin cambios | — | existente | clave sí |

Secretos del worker en el secreto de Modal `rafaga-worker`; el propietario pega cada valor. La sonda R2 real la ejecuta
el propietario con `node --env-file=.env.local scripts/r2-multipart-probe.ts`. Ninguna puerta necesita `.env`.

### Archivos que deben confirmarse
| Archivo | Por qué | Excepción en `.gitignore` |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.claude/**` | agente (los confirma el Bootstrap en su propio commit) | — ningún patrón los cubre |
| migraciones 034–037 | esquema | — |
| `workers/modal/{app.py,requirements.txt,README.md}` | worker | — |
| `docs/PERF.md` | rendimiento | — |
| `blueprints/rafaga-clipping-v2/**` | bundle | — |
| `pnpm-lock.yaml` | fijado | — |

Lo que no se confirma ya lo ignora el `.gitignore` existente: `.fixtures/`, `*.mp4`, `node_modules/`, `.next/`. El venv de
Modal vive fuera del repo y `app.py` se comprueba con `ast.parse` (sin `__pycache__`).

### Bootstrap
Desde la raíz, sin preguntas; sale con 0 al repetirlo. `.gitignore` ya existe en el repo y precede a cualquier commit de
este bloque. **Se ejecuta en una sesión con permisos manuales** (el propietario o el hilo principal aprueban cada
comando): sus comandos (`cp`, `for`, `git init`, `git add -- <rutas>`, `git -c … commit`) no están en la lista `allow` de
`.claude/settings.json` a propósito, porque esa lista es para el constructor desatendido, que nunca ejecuta el
Bootstrap. El Bootstrap **confirma los archivos que copia de `workspace/` en su propio commit**, de modo que al empezar el
paso 1 el árbol solo tiene cambios bajo `blueprints/` (precondición del paso 1).
```bash
# orden: PATH → repo y primer commit solo si faltan (.gitignore ya está) → copia de workspace sin pisar → fusión de CLAUDE.md
#        → commit de esos archivos solo si cambiaron → instalar → comprobar
export PATH="$HOME/.local/bin:$PATH"
node --version
pnpm --version
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
git rev-parse -q --verify HEAD >/dev/null || { git add -A && git -c user.name=rafaga-builder -c user.email=builder@localhost commit -q -m "chore: base rafaga-v2"; }
W=blueprints/rafaga-clipping-v2/workspace
for f in AGENTS.md .claude/settings.json .claude/skills/apply-migration-locally/SKILL.md .claude/skills/modal-deploy-checklist/SKILL.md .claude/rules/migrations.md .claude/rules/composition-parity.md .claude/rules/worker-stages.md .claude/rules/api-routes.md; do mkdir -p "$(dirname "$f")" && { [ -e "$f" ] || cp "$W/$f" "$f"; }; done   # nunca pisa; [ -e ] || cp sale con 0 en ambas ramas (cp -Rn sale con 1 en macOS al saltar)
grep -q 'rafaga-v2:merged' CLAUDE.md || cp "$W/CLAUDE.md" CLAUDE.md   # workspace/CLAUDE.md = CLAUDE.md raíz literal + v2
test -z "$(git status --porcelain -- CLAUDE.md AGENTS.md .claude)" || { git add -- CLAUDE.md AGENTS.md .claude && git -c user.name="$(git config user.name || echo rafaga-builder)" -c user.email="$(git config user.email || echo builder@localhost)" commit -q -m "chore: espacio de trabajo rafaga-v2"; }   # segunda ejecución: nada que confirmar, sale con 0
pnpm install --frozen-lockfile
python3 -c "import sys; print(sys.version)"
pnpm test
```
Nunca se sobrescriben: `CLAUDE.md` ya fusionado, `AGENTS.md`, `.claude/**`, `package.json`, `pnpm-lock.yaml`.

---

## 11. Dependencias

Tabla de procedencia (informe de `stack-researcher`, 2026-11-13). **No se añaden dependencias npm** ni se actualiza
ninguna; si un paso necesitara una, usaría `pnpm add --filter <paquete> <nombre>@<versión exacta>` (ninguno lo necesita).
El paso 12 solo añade una subruta a `exports` de `packages/selection/package.json` (no es una dependencia).

| Paquete | Versión | Estado | Fuente | Comprobado | Instalado por | Propósito |
|---|---|---|---|---|---|---|
| next | 16.4.5 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap (`pnpm install --frozen-lockfile`) | web |
| react / react-dom | 19.3.1 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | UI |
| @supabase/supabase-js | ^2.119.0 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | cliente BD |
| tailwindcss / @tailwindcss/postcss | 4.3.5 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | estilos |
| typescript | ~5.9 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | typecheck |
| @electric-sql/pglite | 0.5.15 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | BD en pruebas |
| pnpm | 12.18.0 | repo lockfile, not upgraded, not re-checked | `package.json` | 2026-11-13 | requisito local; paso 6 (`app.py`: `npm install -g pnpm@12.18.0`) | gestor |
| modal (PyPI) | `modal==1.6.4` (requires_python >=3.10,<3.16) | VERIFIED | https://pypi.org/pypi/modal/1.6.4/json | 2026-11-13 | paso 6 (`~/.cache/rafaga/modal-venv/bin/pip install -r workers/modal/requirements.txt`) | SDK/CLI |
| Node (imagen Modal) | 24.22.3 (LTS Krypton), `node-v24.22.3-linux-x64.tar.xz`, SHASUMS256 | VERIFIED | https://nodejs.org/dist/index.json · https://nodejs.org/dist/v24.22.3/SHASUMS256.txt | 2026-11-13 | paso 6 (`app.py`) | runtime nube |
| ffmpeg (imagen Modal) | tag `autobuild-2026-11-10-12-39`, `ffmpeg-n9.0.2-48-gd4070a14ce-linux64-gpl-9.0.tar.xz`, SHA-256 `8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4` (nunca `latest`) | VERIFIED (repo pin + BtbN releases) | https://github.com/BtbN/FFmpeg-Builds/releases | 2026-11-13 | paso 6 (`app.py`); local en `~/.local/bin` | vídeo |
| opencv-python-headless | 4.10.0.84 con `numpy<2.1` (abi3 en 3.12; numpy ≥1.26). Nunca sin fijar (último 5.0.0.93, mayor nueva) | VERIFIED | https://pypi.org/pypi/opencv-python-headless/4.10.0.84/json | 2026-11-13 | paso 6 (`app.py`) | caras |
| Python (imagen Modal) | 3.12 | UNVERIFIED que `debian_slim(python_version="3.12")` se acepte; alternativa 3.13 + `numpy==2.1.3` | https://modal.com/docs/reference/changelog | 2026-11-13 | paso 6 (`app.py`) | intérprete |
| fastapi[standard] | sin fijar | UNVERIFIED — verify before install (no está en el informe; lo exige `fastapi_endpoint`) | UNVERIFIED — verify before install | 2026-11-13 | paso 6 (`app.py`) | endpoint `dispatch` |

| API / servicio | Dato | Estado | Fuente | Comprobado |
|---|---|---|---|---|
| Modal `Image.debian_slim`, `.apt_install`, `.run_commands`, `.add_local_dir(copy=True)`, `Secret.from_name`, `@modal.fastapi_endpoint`, `.spawn()`, `.map()`, `modal secret create`, `modal token new` | — | VERIFIED (docs) | https://modal.com/docs/guide/images · /docs/guide/webhooks · /docs/guide/secrets · /docs/reference/cli/token | 2026-11-13 |
| Modal `modal.App`, `@app.function(timeout=, cpu=, memory=, secrets=)`, `schedule=modal.Period(minutes=1)`, `modal deploy` | se leen del paquete instalado (paso 6) | UNVERIFIED — verify before install | — | 2026-11-13 |
| Groq `whisper-large-v3-turbo`, `openai/gpt-oss-120b` | Production; 100 MB por archivo (se usan ≤25 MB) | VERIFIED | https://console.groq.com/docs/models | 2026-11-13 |
| Groq `reasoning_effort` | admitido para gpt-oss (en producción desde `2fbd1a5`) | VERIFIED | https://console.groq.com/docs/reasoning | 2026-11-13 |
| Límites Groq | 20 RPM, 2K RPD, 7.2K audio-s/h, 28.8K/día; LLM 30 RPM, 1K RPD, 8K TPM, 200K TPD (base Developer; Free sin verificar → `GROQ_LIMITS` + 429) | PARTIAL | https://console.groq.com/docs/rate-limits | 2026-11-13 |
| Modal Starter | 30 USD/mes; método de pago obligatorio; factura el exceso | VERIFIED | https://modal.com/docs/guide/billing | 2026-11-13 |
| Tarifas CPU/memoria de Modal | no están en el informe | UNVERIFIED — LC-5 | https://modal.com/pricing | 2026-11-13 |
| R2 UploadPart prefirmado | no documentado (PUT con `partNumber`+`uploadId`) | UNVERIFIED — sonda LC-8, alternativa `parts` | Cloudflare R2 docs | 2026-11-13 |
| TikTok Content Posting (`open.tiktokapis.com/v2/post/publish/…`, `video.publish`) | según el informe | VERIFIED (informe) | informe | 2026-11-13 |
| Endpoints OAuth de TikTok | no están en el informe | UNVERIFIED — LC-10 | — | 2026-11-13 |
| Zonas seguras TikTok/Instagram/Shorts | se miden en el paso 13 de fuentes oficiales | UNVERIFIED hasta el paso 13 y LC-15 | páginas oficiales de cada plataforma | 2026-11-13 |
| Supabase Free · YouTube `videos.insert` | ver §16 / §17 | VERIFIED (informe) | informe | 2026-11-13 |

**Deliberadamente no usados:** yazl (sin publicar desde 2024-11; `ZipBuilder`), fflate, @aws-sdk/client-s3
(`presignV4`), zod (validación a mano), tsx/ts-node, ESLint/Biome/Prettier, opencv-python con GUI, Anthropic SDK.

---

## 12. Estrategia de despliegue

Web: Vercel Hobby, `pnpm --filter @rafaga/web build`, push a `main` por el propietario (`git push` denegado al
constructor). Worker: Modal app `rafaga-worker`, `~/.cache/rafaga/modal-venv/bin/modal deploy workers/modal/app.py`
(LC-3). BD: migraciones a mano (LC-4).

#### Referencia de `workers/modal/app.py`
```python
"""Ráfaga Studio — worker en Modal. Envoltorio fino: la lógica vive en node workers/media/src/stage.ts."""
import hmac, json, os, subprocess
import modal
try:  # FastAPI solo existe en la imagen; `modal deploy` importa este archivo en local sin ella.
    from fastapi import Header, HTTPException
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None

NODE_VERSION = "24.22.3"
NODE_TARBALL = f"node-v{NODE_VERSION}-linux-x64.tar.xz"
FF_TAG = "autobuild-2026-11-10-12-39"
FF_FILE = "ffmpeg-n9.0.2-48-gd4070a14ce-linux64-gpl-9.0.tar.xz"
FF_SHA256 = "8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4"
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAX_PARALLEL = 4
FN_ENV = {"RAFAGA_CPU_CORES": "2", "RAFAGA_MEM_GIB": "4", "PYTHON_BIN": "python3"}

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ca-certificates", "curl", "xz-utils", "fonts-liberation")
    .run_commands(
        f"curl -fsSLO https://nodejs.org/dist/v{NODE_VERSION}/{NODE_TARBALL}",
        f"curl -fsSLO https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt",
        f"grep ' {NODE_TARBALL}$' SHASUMS256.txt | sha256sum -c -",
        f"tar -xJf {NODE_TARBALL} -C /usr/local --strip-components=1",
        "npm install -g pnpm@12.18.0",
        f"curl -fsSLo /tmp/{FF_FILE} https://github.com/BtbN/FFmpeg-Builds/releases/download/{FF_TAG}/{FF_FILE}",
        f"echo '{FF_SHA256}  /tmp/{FF_FILE}' | sha256sum -c -",
        f"tar -xJf /tmp/{FF_FILE} -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'",
    )
    .pip_install("opencv-python-headless==4.10.0.84", "numpy<2.1", "fastapi[standard]")
    # excluir node_modules, .next, .git, .fixtures y blueprints con el parámetro que muestre inspect.signature(add_local_dir)
    .add_local_dir(REPO, remote_path="/repo", copy=True)
    .run_commands("cd /repo && pnpm install --frozen-lockfile")
)
app = modal.App("rafaga-worker")
secret = modal.Secret.from_name("rafaga-worker")

def _node(*args, timeout):  # solo opciones que imprime `stage.ts --list-flags`
    return subprocess.run(["node", "workers/media/src/stage.ts", *args], cwd="/repo", env={**os.environ, **FN_ENV},
                          timeout=timeout, capture_output=True, text=True)

def _plan_and_spawn():
    out = _node("--plan", timeout=60)
    plan = json.loads(out.stdout or "{}") if out.returncode == 0 else {}
    for _ in range(min(int(plan.get("ready", 0)), MAX_PARALLEL)):
        drain.spawn()
    if int(plan.get("legacy", 0)) > 0:
        run_legacy.spawn()
    return plan

@app.function(image=image, secrets=[secret], cpu=2.0, memory=4096, timeout=3600)
def drain():
    return _node("--drain", "--max-idle-s", "60", timeout=3540).returncode

@app.function(image=image, secrets=[secret], cpu=2.0, memory=4096, timeout=3600)
def run_legacy():  # tipos v1 durante la coexistencia; mismo código que en Actions
    return subprocess.run(["node", "src/run.ts"], cwd="/repo/workers/media", env={**os.environ, **FN_ENV}, timeout=3540).returncode

@app.function(image=image, secrets=[secret], timeout=60)
@modal.fastapi_endpoint(method="POST")
def dispatch(body: dict, x_rafaga_wake: str | None = (Header(default=None) if Header else None)):
    if not hmac.compare_digest((x_rafaga_wake or "").encode(), os.environ["WAKE_SECRET"].encode()):
        raise HTTPException(status_code=401, detail="bad_wake_secret")
    return {"accepted": True, "plan": _plan_and_spawn()}

@app.function(image=image, secrets=[secret], timeout=120, schedule=modal.Period(minutes=1))
def sweeper():
    _node("--sweep", timeout=60)  # sweep_stale + enqueue_due_publications
    _plan_and_spawn()

@app.function(image=image, secrets=[secret], timeout=1800, schedule=modal.Period(days=1))
def keep_alive():
    _node("--keep-alive", timeout=60)  # evita la pausa de Supabase Free (además del barrido por minuto)
    _node("--purge", timeout=1700)     # retención (paso 18)
```

| Entorno | Rama | URL | BD | Terceros |
|---|---|---|---|---|
| Construcción | — | — | PGlite | simulados |
| Producción | `main` | https://rafaga-studio.vercel.app | `rafaga-studio-beta` | reales |

CI: no existe pipeline de CI; la puerta de §20.1 se ejecuta en local. Vuelta atrás: «Promote» del despliegue anterior en
Vercel (~1 min), `modal deploy` desde la etiqueta anterior o el interruptor de §9.1; migraciones siempre antes del código
y aditivas; por paso, `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` (no destructivo). DNS/TLS sin cambios.

---

## 13. Estrategia de pruebas

| Capa | Framework | Cubre | Dónde |
|---|---|---|---|
| Unitaria | `node:test` + `node:assert/strict` | hash, partes, estimación, filtros, puntuación, cajas, plantillas, zonas seguras, escena, editor | `*.test.ts` junto al código |
| BD | `node:test` + PGlite 0.5.15 | migraciones desde cero, RLS, libro, etapas, retención, métricas | `supabase/tests/*.test.ts`, `workers/media/src/lifecycle.test.ts` |
| Rutas | `node:test` importando `route.ts` + `fakeSupabaseFetch` | contratos de §5 con RLS real | `apps/web/lib/*.test.ts` |
| CLI | `spawnSync` + `main(argv, { rpc })` | `--list`, `--list-flags`, `--plan`, `--sweep`, `--keep-alive`, 64/78 | `workers/media/src/stages.test.ts` |
| Medios | ffmpeg 9.0.2 real sobre fixtures `lavfi` que reproducen el archivo del propietario (1080p25, `pcm_s24le`, timecode, habla escasa) | validación, mezzanine, proxy, composiciones, exportación | `workers/media/src/*.test.ts` |
| Rendimiento | `scripts/perf-run.ts` | 7 tiempos p50/p95, concurrencia 2 | `docs/PERF.md` |
| Aceptación del propietario | archivo real (LC-16) | ≥8 clips o diferencia explicada; primer clip ≤3 min | lista de lanzamiento |

Cada archivo crea su propia PGlite y su propio transcript de prueba; ninguna prueba toca la red ni depende del orden;
ningún `Verify` necesita Docker. La llamada real a `faces.py` se prueba solo si `cv2` está instalado (se omite si no,
como `reframe.test.ts`); el resto de pruebas de hablantes usa un detector simulado. **Sin probar a propósito:** E2E de
navegador (no hay runner; la lógica de pantalla vive en `apps/web/lib` y se prueba) y servicios reales (lista de
lanzamiento).

---

## 14. Seguridad y secretos

| Asunto | Control | Dónde |
|---|---|---|
| Secretos | Vercel + secreto de Modal `rafaga-worker`; nunca en repo ni chat | LC-2, LC-9 |
| Rotación | `WAKE_SECRET` a la vez en Modal y Vercel; claves desde cada consola | propietario |
| Entrada | validación a mano antes de cada RPC; CHECK en columnas nuevas | rutas, migraciones |
| XSS / SQL | React escapa; RPC parametrizadas, `format('%I')` en SQL dinámico | — |
| AuthN/AuthZ | §8 | §8 |
| CSRF | API nueva solo con `Bearer` | rutas |
| Abuso | `allow(user, 600)`, límites de Groq, cuota 10 GB, presupuesto de cómputo | rutas, worker, SQL |
| Despachador | `X-Rafaga-Wake` en tiempo constante | `app.py` |
| SSRF | `checkUrl` + `isPublicIp` por salto | paso 17 |
| Datos personales | privados por defecto; original borrado tras la mezzanine; retención y papelera | R2, SQL |
| Registro | nunca tokens, claves ni URLs firmadas completas | `stage.ts`, rutas |
| Métricas | sin letras ni medios privados en ningún evento; solo agregados de tablas existentes | `product_metrics` |

Nunca se toca el proyecto Supabase `splitclaro`; nada se gasta sin autorización. Régimen: datos personales UE, uso
privado; la obligación práctica es el borrado efectivo.

---

## 15. Accesibilidad

Objetivo WCAG 2.2 AA en pantallas nuevas o editadas, sin cambiar el estilo visual: HTML semántico, un `h1` por página;
todo control por teclado (editor: ←/→ paso de fotograma, Ctrl+Z/Ctrl+Shift+Z; pantalla completa: Esc, ←/→, espacio);
foco visible del sistema; etiquetas en cada campo del panel de creación; `alt` en miniaturas; `prefers-reduced-motion`;
200 % de zoom; `aria-live="polite"` en subida y proceso; 2.5.7 alternativa con botones a arrastrar en la línea de
tiempo; 2.5.8 objetivos ≥24×24 px; 3.3.7 sin datos repetidos.
```bash
# Sin runner automático de accesibilidad (sin dependencias nuevas). Comprobación estática mínima:
grep -q 'aria-live' apps/web/components/ProcessingPanel.tsx
```
Pasadas manuales antes de lanzar: teclado de extremo a extremo, lector de pantalla y zoom.

---

## 16. Observabilidad y coste

| Señal | Herramienta | Qué captura |
|---|---|---|
| Errores | `job_stages.error_code/message`, `jobs.error_code`, logs de Vercel | fallos de etapa y ruta |
| Logs | stdout JSON de `stage.ts` en Modal (`{ts, job_id, stage, event, ms}`) | cada etapa |
| Métricas | `jobs.metrics` (`queue_ms`, `upload_ms`, `analysis_ms`, `first_clip_ms`, `all_clips_ms`, `render_ms`, `zip_ms`), salidas de etapa (`ai_windows`, `second_pass`, `relaxed`), `stage_timings`, `ai_usage` (`compute`), `product_metrics` | tiempos, cómputo, producto |
| Salud | `select public.dispatch_plan()`, `select public.compute_meter()` | cola y gasto |

| Métrica | Objetivo | Alerta |
|---|---|---|
| Cómputo del mes | < 27 USD | bloqueo automático al 90 % |
| Etapas fallidas 24 h | < 10 % | criterio de abandono |
| p95 `queue_ms` | tras `docs/PERF.md` | > 600000 ms |
| Generaciones con 0 clips sin aviso | 0 | cualquiera es un defecto (paso 12) |

| Servicio | Capa gratuita | v1 | 10× | Acantilado |
|---|---|---|---|---|
| Modal | 30 USD/mes | 0 € (presupuesto = crédito) | bloqueo al 90 % | exceso si no hay presupuesto (LC-1) |
| Groq | límites Free | 0 € | colas | 429 |
| Deepgram | crédito inicial | 0 € | respaldo visual | crédito agotado |
| Supabase | 500 MB, Realtime 200 conexiones / 2M mensajes / 256 KB | 0 € | filas pequeñas | pausa tras 7 días (mitigada) |
| R2 | 10 GB | 0 € (mezzanine ≈0.8 GB + proxy ≈0.3 GB por 18 min) | rechazo de subida | 10 GB |
| Vercel | Hobby | 0 € | — | uso no comercial |

**Coste estimado: 0 €.** Partida mayor: cómputo de Modal; palancas: caché por `input_hash`, render solo al exportar,
mezzanine en lugar de originales. Tarifas de Modal: LC-5; sin ellas `enqueue_job` falla cerrado. **Los límites de las
capas gratuitas pueden cambiar sin aviso: riesgo aceptado y vigilado.**

---

## 17. Enrutado de modelos

| Tarea | Modelo | Respaldo |
|---|---|---|
| Transcripción | Groq `whisper-large-v3-turbo` | `whisper-large-v3` (existente) |
| Momentos por modo, títulos, motivos, gancho | Groq `openai/gpt-oss-120b` con `reasoning_effort: "low"` y `max_completion_tokens` 8000 (desplegado en `2fbd1a5`) | reintento sin `response_format` ante `json_validate_failed`; ventana fallida aislada; segunda pasada con rangos excluidos; pasada léxica relajada anotada |
| Traducción de subtítulos | Groq `openai/gpt-oss-120b` | ninguno |
| Idioma | muestra de 30 s con whisper | `null` + corrección manual |
| Diarización | Deepgram nova-3 | hablante activo visual + `needs_review` |

Prompts en `packages/selection/src` (uno por `promptId`), versión en `RUBRIC_VERSION`, guardada en `component_versions`.
Control de coste: 0 € de proveedor; límites con `GroqLimiter` y unidades del usuario. Fallos: 120 s por llamada,
`withRetry` + `retry-after`, 3 intentos de etapa. Evaluación: `modes.test.ts` + `select.test.ts` deben seguir verdes ante
cualquier cambio de prompt o modelo.

---

## 18. Skills para la construcción

Ninguna skill externa: el diseño visual está fuera de alcance (descarta `ui-ux-pro-max`, `frontend-design`,
`emil-design-eng`) y no hay E2E (descarta `playwright-cli`). Skills del proyecto (§19.4), instaladas por la copia de
`workspace/` del Bootstrap:

| Skill | Pasos | Por qué | Instalación |
|---|---|---|---|
| `apply-migration-locally` | 1, 2, 3, 4, 7 | crear y comprobar migraciones en PGlite | §10 Bootstrap (copia de `workspace/.claude/skills/apply-migration-locally/SKILL.md`) |
| `modal-deploy-checklist` | 6 y LC | pasos del propietario en Modal | §10 Bootstrap (copia de `workspace/.claude/skills/modal-deploy-checklist/SKILL.md`) |

---

## 19. Espacio de trabajo del agente

Archivos reales en `blueprints/rafaga-clipping-v2/workspace/`, con su ruta del repo; el Bootstrap los copia sin pisar
(`[ -e "$f" ] || cp …`) y los confirma en su propio commit. **`workspace/CLAUDE.md` se fusiona con el `CLAUDE.md` raíz:**
contiene literalmente todo su texto actual y añade las secciones v2; lleva la marca `rafaga-v2:merged`. Nunca se emite
`.claude/commands/`.

- **19.1 `CLAUDE.md`** — comandos primero (con `export PATH`), raíz literal (encargo, prioridades, aislamiento,
  continuidad), reglas de la ampliación, regla de 0 €, Actions sin medios, fronteras, bucle con `tasks.json`; <200 líneas.
- **19.2 `AGENTS.md`** — descripción, comandos, reglas no negociables; remite a `CLAUDE.md`.
- **19.3 `.claude/settings.json`** — `allow`: cada comando de los `Verify`, Checkpoints, vuelta atrás (`git revert
  --no-edit`) y §20.1; `deny`: leer `.env*`, `git push`, `git reset --hard`, `modal deploy|secret|token`,
  `gh workflow run`, `vercel`, `supabase db push`, `psql`, `rm -rf`. No incluye los comandos del Bootstrap (§10).
- **19.4 Skills** — `apply-migration-locally` («nueva migración», «probar RLS»), `modal-deploy-checklist` («desplegar
  en Modal», «secretos de Modal»).
- **19.5 Reglas** — `migrations.md` (`supabase/**`), `composition-parity.md` (`packages/composition/**`,
  `apps/web/components/PreviewPlayer.tsx`), `worker-stages.md` (`workers/**`), `api-routes.md`
  (`apps/web/app/api/**`, `apps/web/lib/**`).

### 19.6 Configuración crítica para los Verify
NOT APPLICABLE en cuanto a archivos nuevos de `workspace/` — `node:test` no necesita configuración, PGlite corre en
proceso, los fixtures los genera `workers/media/src/fixtures.ts` (paso 9) y los `tsconfig` existentes ya admiten imports
`.ts`. El único manifiesto que cambia es `packages/selection/package.json` (paso 12, una subruta de `exports`), escrito
por su paso, no por `workspace/`.

| Archivo | Verify que lo usa | Resolución/entorno | Exclusión del bundle |
|---|---|---|---|
| `apps/web/tsconfig.json` (existente) | typecheck/build | `allowImportingTsExtensions`, `moduleResolution: "bundler"`; no lee entorno | n/a — `include` relativo a `apps/web/`, no alcanza `blueprints/` |
| `apps/web/next.config.ts` (existente) | build | `transpilePackages` con los cuatro `@rafaga/*` | n/a — compila solo lo alcanzable desde `apps/web/app` |
| script `test` del `package.json` raíz (existente) | `pnpm test` | globs explícitos | n/a — ningún glob alcanza `blueprints/` |
| `pnpm-workspace.yaml` (existente) | `pnpm install` | `apps/*`, `packages/*`, `workers/*` | n/a — no incluye `blueprints/*` |
| `packages/selection/package.json` (paso 12) | `select.test.ts`, `pnpm test` | `exports["./modes"] = "./src/modes.ts"` | n/a — no recorre el árbol |
| `.claude/settings.json` (emitido) | ninguno | — | n/a — no recorre el árbol |

#### Matriz de convención de resolución
**Convención:** imports relativos con `.ts` explícito; paquetes `@rafaga/<pkg>` o subrutas de su `exports`; lo nuevo de
`packages/composition` se publica por `src/index.ts`; lo nuevo de `packages/selection` por la subruta `./modes`;
`packages/composition` no importa `packages/selection`; solo sintaxis TS borrable (sin `enum`, `namespace`, propiedades
de parámetro ni `import x = require`).

| Contexto | Comando | Forma | Configuración |
|---|---|---|---|
| App | `pnpm --filter @rafaga/web build` | `../../lib/api.ts`, `@rafaga/composition` | `apps/web/tsconfig.json` (`allowImportingTsExtensions`), `next.config.ts` (`transpilePackages`) |
| Typecheck | `pnpm --filter @rafaga/web typecheck` | igual | `apps/web/tsconfig.json` |
| Pruebas | `pnpm test`, `node --test <archivo>` | `.ts` literal; las de `apps/web/lib` importan `../app/api/<r>/[[...slug]]/route.ts` | Node ≥24 elimina tipos; `@rafaga/*` resuelven por symlink al `src/*.ts` real (fuera de `node_modules`) |
| Worker → selección | `node --test workers/media/src/select.test.ts` | `import { MODES } from "@rafaga/selection/modes"` | `packages/selection/package.json` — `exports["./modes"]` (paso 12); `workers/media/package.json` ya depende de `@rafaga/selection` |
| Pruebas de selección | `node --test packages/selection/src/modes.test.ts` | `./modes.ts`; transcript de prueba dentro del propio archivo | Node ≥24 |
| Pruebas de composición | `node --test packages/composition/src/parity.test.ts` | `./layouts.ts`; transcript de prueba dentro del propio archivo | sin dependencia de `@rafaga/selection` |
| Scripts | `node scripts/perf-run.ts --quick` | `.ts` literal | Node ≥24 |
| CLI | `node workers/media/src/stage.ts --list-flags` | `.ts` literal; `import()` dinámico de `./stages/purge.ts` | Node ≥24; `workers/media/tsconfig.json` para el editor |
| Modal | `node workers/media/src/stage.ts --drain` | igual | Node 24.22.3 + `pnpm install --frozen-lockfile` en la imagen |
| Python | `python3 -c "import ast; …"`, `modal deploy` | FastAPI solo en `try` | `app.py` |

#### Reconciliación de valores entre artefactos
| Valor | Fuente | Literal | Otros sitios | Comparado |
|---|---|---|---|---|
| Bundle | este bundle | `blueprints/rafaga-clipping-v2/` | §10, §19, `workspace/CLAUDE.md`, epics, precondición del paso 1 | sí |
| Marca de fusión | `workspace/CLAUDE.md` | `rafaga-v2:merged` | §10 Bootstrap (`grep -q`), §19, §20.1 (`grep -c`) | sí |
| Etiquetas | §9 regla 6 | `rafaga-v2-step-NN` | Checkpoints, `tasks.json`, epics, §20.1, vuelta atrás `git revert` | sí |
| CLI | paso 5 | `workers/media/src/stage.ts` | `app.py`, pasos 5, 6, 9, `CLAUDE.md`, `settings.json` | sí |
| Opciones de la CLI | paso 5 `--list-flags` | `--list`, `--list-flags`, `--drain`, `--max-idle-s`, `--sweep`, `--keep-alive`, `--plan`, `--purge` | `app.py` (`_node`), `wake.test.ts`, `CLAUDE.md` | sí |
| Salidas CLI | paso 5 | `64` uso · `78` configuración | pasos 5 y 8, `tasks.json`, epics | sí |
| Cabecera | §5 | `X-Rafaga-Wake` | `app.py`, wake, `wake.test.ts` | sí |
| Secreto/app Modal | §10/§12 | `rafaga-worker` | `app.py`, README, skill, LC-2 | sí |
| SDK de Modal | §11 | `modal==1.6.4` | `workers/modal/requirements.txt`, Verify del paso 6 (`'1.6.4'`), skill | sí |
| opencv | §11 | `opencv-python-headless==4.10.0.84` | `app.py` (`pip_install`), `wake.test.ts`, `worker.yml` | sí |
| SHA ffmpeg | `worker.yml` | `8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4` | `app.py`, `wake.test.ts`, §11 | sí |
| Tarball Node | §11 | `node-v24.22.3-linux-x64.tar.xz` | `app.py`, `wake.test.ts` | sí |
| Venv Modal | paso 6 | `~/.cache/rafaga/modal-venv` | §9, §11, §12, `settings.json`, skill | sí |
| Informe de rendimiento | paso 18 | `docs/PERF.md` | `scripts/perf-run.ts`, Verify del paso 18, §10 (confirmados), §13, §16, LC-12 | sí |
| Migraciones | §4 | `20261113000034_clipping_v2_core.sql` … `20261113000037_upload_storage.sql` | §3, pasos 2, 3, 4, 7, `ledger.test.ts`, regla | sí |
| Tamaños | §5 | `4294967296`, `10737418240`, `16777216`, `47185920` | 037, pasos 7, 8, 9, 17, 18 | sí |
| Paquete web | `apps/web/package.json` | `@rafaga/web` | §9, §20.1, `settings.json` | sí |
| Subruta de selección | `packages/selection/package.json` | `./modes` → `./src/modes.ts` | `stages/select.ts`, §19.6 matriz | sí |
| Etapas | paso 5 `STAGES` | `validate` … `translate` | 036 CHECK de `job_stages.stage`, `request_generation`, `complete_upload` | sí |
| Rangos de duración | paso 11 `DURATION_BUCKETS` | `auto` [10,180], `lt30` [10,30], `30_60`, `60_90`, `90_180` | §6 (Auto 10 s–3 min), `CreationPanel` | sí |

#### Reconciliación byte a byte
NOT APPLICABLE — no se escriben archivos de salida esperada byte a byte: la paridad compara dos cálculos, los formatos se
comprueban por propiedades y el SHA-256 se compara con `node:crypto`.

---

## 20. Puerta de aceptación, riesgos y registro de decisiones

### 20.1 Puerta global
```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm install --frozen-lockfile
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list-flags
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/parity.test.ts apps/web/lib/wake.test.ts supabase/tests/job_stages.test.ts
export PATH="$HOME/.local/bin:$PATH" && python3 -c "import ast; ast.parse(open('workers/modal/app.py').read(), 'workers/modal/app.py')"
export PATH="$HOME/.local/bin:$PATH" && node scripts/r2-multipart-probe.ts --dry-run
test "$(git tag -l 'rafaga-v2-step-*' | wc -l | tr -d ' ')" = 18
```
Manuales (una vez):
- [ ] Cada archivo de §10 *Archivos que deben confirmarse* está en git, una ruta por invocación
      (`git ls-files --error-unmatch workers/modal/app.py`, …) y no está ignorado (`git check-ignore -q <ruta>; test $? -eq 1`).
- [ ] `.gitignore` precede a `rafaga-v2-step-01` (`git log --diff-filter=A --format=%H -- .gitignore`).
- [ ] El Bootstrap se ha ejecutado dos veces y **ha salido con 0** ambas; `grep -c 'rafaga-v2:merged' CLAUDE.md` imprime 1.
- [ ] Cada fila de §19.6 *Reconciliación de valores* dice `sí`; puertas ejecutadas con el bundle presente.
- [ ] §9.1: paridad probada, interruptor accionado una vez, camino antiguo desplegado.
- [ ] Ningún no-objetivo de §1 construido; ningún proyecto histórico reprocesado; la vista v1 de `p/[id]` intacta.
- [ ] Pasadas de accesibilidad (§15).

#### Lista de lanzamiento (acciones del propietario, no pasos de construcción)
| Id | Acción | Comprobación |
|---|---|---|
| LC-1 | Cuenta de Modal (método de pago) y **presupuesto del Workspace = 30 USD** | panel de Modal |
| LC-2 | `~/.cache/rafaga/modal-venv/bin/modal token new`; `modal secret create rafaga-worker SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… GROQ_API_KEY=… DEEPGRAM_API_KEY=… GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… DROPBOX_CLIENT_ID=… DROPBOX_CLIENT_SECRET=… TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… WAKE_SECRET=…` | — |
| LC-3 | `~/.cache/rafaga/modal-venv/bin/modal deploy workers/modal/app.py`; copiar URL de `dispatch` | POST sin secreto → `401` |
| LC-4 | Aplicar 034→037 en el editor SQL de `rafaga-studio-beta` | `select to_regclass('public.job_stages')` no nulo |
| LC-5 | Tarifas de https://modal.com/pricing en `platform_settings.modal_rate_card` | `compute_meter()->>'rate_card_set'` = `true` |
| LC-6 | `grant_units` inicial | `units_balance` > 0 |
| LC-7 | CORS del bucket: origen de producción, `PUT`/`GET`/`HEAD`, `ExposeHeaders: ["ETag"]` | LC-8 |
| LC-8 | `node --env-file=.env.local scripts/r2-multipart-probe.ts` | exit 0 → `multipart`; si no, `parts` |
| LC-9 | Vercel: `WORKER_BACKEND=actions`, `WAKE_SECRET`, `MODAL_DISPATCH_URL`, `UPLOAD_STRATEGY`, `NEXT_PUBLIC_PIPELINE_VERSION=v1`, `TIKTOK_*`, `GROQ_LIMITS` opcional | despliegue verde |
| LC-10 | Google Cloud (`youtube.upload`, usuario de prueba); TikTok for Developers (app, Content Posting, `video.publish`, redirección `…/app/conexiones/callback`); confirmar endpoints OAuth de TikTok | conexión de prueba |
| LC-11 | Autopruebas en Modal (paridad A1) | exit 0 |
| LC-12 | `node scripts/perf-run.ts --full` (5/30/60 min, concurrencia 2) | `docs/PERF.md` y objetivos |
| LC-13 | Registrar Modal, app, secreto y TikTok en `docs/provisioning-manifest.json` | entrada presente |
| LC-14 | Fases 2–3 de §9.1 y 7 días de vigilancia | — |
| LC-15 | Revisar `SAFE_ZONES` (fuentes y entradas «medido por nosotros, revisar») | valores confirmados |
| LC-16 | Aceptación E2E con `/Volumes/Nuevo vol/Alex - Backup Discos/Camp- Samueliyo (Octubre)/Export/DIA 1_Camp 2026 Panda Sur.mov`, 10 clips × 30–60 s, en un proyecto v2 | ≥8 clips o diferencia explicada; primer clip ≤3 min |
| D1 | Desmantelar el worker de Actions (§9.1, 6) | `test "$(grep -c 'run.ts' .github/workflows/worker.yml \|\| true)" = 0` |

`rafaga-lyric-studio-v2` empieza cuando esta puerta está verde.

### 20.2 Registro de riesgos
Los límites de las capas gratuitas pueden cambiar: riesgo aceptado y vigilado; cada fila tiene guarda y prueba.

| Riesgo | Prob. | Imp. | Señal | Mitigación (paso · prueba) |
|---|---|---|---|---|
| Crédito de Modal agotado / exceso | M | A | `compute_meter().pct` | presupuesto = crédito (LC-1) + rechazo al 90 % (4 · `job_stages.test.ts`), caché, render al exportar, reinicio mensual |
| Tarifa de Modal desconocida | A | M | `rate_card_set=false` | falla cerrado (4 · `job_stages.test.ts`) + LC-5 |
| Límites o JSON truncado de Groq | A | A | `wait_ms`, `ai_windows` < total | limitador (10 · `analysis.test.ts`); ventanas aisladas, segunda pasada, pasada relajada, nunca 0 sin aviso (12 · `select.test.ts`), sobre los arreglos ya desplegados |
| R2 lleno | M | M | `used_bytes` | cuota (7 · `uploads.test.ts`), borrado del original tras mezzanine (9 · `validate.test.ts`), purga (18 · `lifecycle.test.ts`) |
| Pausa de Supabase Free | B | A | proyecto pausado | barrido por minuto + `keep_alive` (6 · `wake.test.ts`; 5 · `stages.test.ts`) |
| Caída de Modal | B | M | `dispatch_plan.ready` crece | cola persistente, barrido, «En cola» con motivo (9 · `progress.test.ts`), interruptor (§9.1) |
| Contrato roto entre `app.py` y `stage.ts` | M | A | `dispatch` sin efecto | `--list-flags` + comprobación en `wake.test.ts` (6) y `--plan` numérico (5 · `stages.test.ts`) |
| Romper la vista v1 de `p/[id]` | M | A | proyectos antiguos sin brief | vista v2 detrás de `engine = 'v2'`; grep de `BriefFields` (10, 14) |
| Deepgram agotado | A | B | 402 | hablante visual + `needs_review` (10 · `analysis.test.ts`) |
| Deriva vista previa/exportación | M | A | subtítulos desfasados | un motor `sceneAt` + pruebas doradas (14 · `parity.test.ts`) |
| Zonas seguras mal medidas | M | M | texto tapado en la plataforma | fuente citada o «revisar» (13 · `compose.test.ts`) + LC-15 |
| Mezzanine defectuosa borra el original | B | A | ffprobe fuera de tolerancia | borrado solo tras comprobar duración ≤1 fotograma y pistas (9 · `validate.test.ts`) |
| Pérdida de trabajo en una vuelta atrás | B | A | — | `git revert` no destructivo; `git reset --hard` denegado en `settings.json` |
| Alcance | A | M | pasos que no caben | 18 pasos de ≤5 archivos, a oscuras tras `v1` |
| Cobros duplicados | M | A | filas repetidas | idempotencia (3, 4, 11 · pruebas 3×) |
| UploadPart prefirmado no funciona | M | M | LC-8 falla | estrategia `parts` (7 · `uploads.test.ts`) |
| Imagen de Modal no construye | M | M | `modal deploy` falla | firmas leídas del paquete (6), alternativa 3.13, skill |
| TikTok sin auditar | A | B | `unaudited_client…` | `requiere_auditoria` (17 · `integrations.test.ts`) |

### 20.3 Registro de decisiones
| # | Decisión | Alternativa | Por qué | Se revertiría si |
|---|---|---|---|---|
| 1 | Evolución por pasos con coexistencia | reescritura | encargo; menos riesgo | — |
| 2 | Modal | Actions, servidor propio, Mac | términos de GitHub; 0 € | Modal sin crédito gratuito |
| 3 | Cola en Postgres | cola gestionada | un servicio menos | >1000 etapas/h |
| 4 | Unidades `numeric(10,2)` | créditos enteros | política 0.2/0.1 u/min | se introduzca pago |
| 5 | Primera generación 1.0 + 0.2 u/min; gancho 0.1 × N | 1.0 todo incluido | la política devuelve «la parte de selección» | el propietario lo aclare |
| 6 | Render solo al exportar | render al generar | cómputo y tiempo al primer clip | paridad imposible |
| 7 | Rutas `[[...slug]]` con `Response.json` probadas importando `route.ts` | lógica en `lib/` + ruta por URL | menos archivos; prueba la ruta real | Next lo prohíba |
| 8 | ZIP en `export_batches` | `renders.kind='zip'` | `renders.clip_id` NOT NULL | rediseño de `renders` |
| 9 | `platform_settings` global | ajuste por workspace | presupuesto de toda la cuenta | multiinquilino |
| 10 | Destacados y Manual sin LLM | LLM en todos | ahorra cupo | calidad insuficiente medida |
| 11 | Sin CI, E2E ni linter | añadirlos | convención; sin dependencias | el propietario lo pida |
| 12 | Tarifa en BD, falla cerrado | constantes | precio no verificado | se verifique |
| 13 | Cómputo en `ai_usage` (kind `compute`) | tabla `compute_usage` | regla de reutilización | se necesite otro esquema |
| 14 | Composición en columnas de `clip_versions` | tabla `compositions` | regla de reutilización | varias composiciones vivas por versión |
| 15 | Mezzanine 1080p y borrado temprano del original | conservar el original 7 días | límite 4 GB con R2 de 10 GB | haya más almacenamiento |
| 16 | `sceneAt`, diseños y plantillas en `layouts.ts` | módulos separados | un motor compartido; límite de archivos | >600 líneas |
| 17 | `ast.parse` en vez de `py_compile` | `py_compile` | evita `__pycache__` en el repo | se ignore `__pycache__/` |
| 18 | Generar exige fuente `validated` (mezzanine hecha) | reservar durante la subida | duración real y cobro exacto | se quiera analizar antes |
| 19 | Pesos editoriales 0.30/0.20/0.25/0.15/0.10 | iguales | gancho y valor deciden un clip corto | la aceptación medida lo contradiga |
| 20 | Clips v2 hasta 180 s sin tocar `trim.ts` | subir `MAX_CLIP_SEC` | no cambiar el flujo v1 | se desmantele v1 |
| 21 | Vista v2 de `p/[id]` detrás de `jobs.engine` | sustituir la vista para todos | regla de no reprocesar ni romper proyectos v1 | se desmantele v1 |
| 22 | Cada prueba define su transcript de prueba; selección publica `./modes` | fixture compartido entre paquetes | composition no depende de selection; límite de archivos | se necesite el mismo fixture en 3+ sitios |
| 23 | Vuelta atrás con `git revert` | `git reset --hard` | no destruye trabajo ni historia | — |
| 24 | `stage.ts` exporta `main(argv, deps)` | solo CLI | probar `--plan`/`--sweep` con un `rpc` simulado | — |
| 25 | El Bootstrap confirma los archivos de `workspace/` en su propio commit | dejarlos sin confirmar hasta el paso 1 | el paso 1 exige un árbol limpio salvo `blueprints/` | — |

### 20.4 Qué construir después
1. Lyric Studio v2 — cuando §20.1 esté verde. 2. D1 — tras 7 días sin criterios de abandono. 3. CI de solo pruebas —
cuando se pida. 4. Instagram — con cuenta business. 5. Doblaje y b-roll IA — con generador gratuito de calidad.

---

*Fin del blueprint. El orden de construcción es §9. Se termina cuando §20.1 está en verde.*
