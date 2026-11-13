# Épica 03: Edición y entrega

> Tras esta épica existen las composiciones con plantillas virales y zonas seguras, el motor de escena compartido con la
> rejilla de resultados y el reproductor a pantalla completa (vista v2), el editor v2, las exportaciones por lotes, la
> importación y publicación, la retención con purga, las métricas de producto y el arnés de rendimiento.

| | |
|---|---|
| **Id** | `03-edicion-y-entrega` |
| **Tareas** | `E3-T1` … `E3-T6` (pasos 13–18 de `blueprint.md` §9) |
| **Depende de** | `02-ingesta-y-analisis` (`E2-T6`, `E2-T4`) |
| **Desbloquea** | lista de lanzamiento (§20.1 de `blueprint.md`) y el bundle `rafaga-lyric-studio-v2` |
| **En paralelo con** | ninguna |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis
borrable) · Tailwind y componentes existentes (sin cambios visuales) · Supabase Postgres con RLS · R2 · worker por etapas
· `packages/composition` (`ffmpegArgs`, `buildAss`, `groupWords`, `layoutLines`, `mapTime`, `retimeWords`, `xAt`,
`RATIO_SIZE`, `toSRT`, `toVTT`, `toTranscript`, `editText`, `setTiming`) · `ZipBuilder` · ffmpeg 9.0.2 · pnpm 12.18.0.
Versiones en `pnpm-lock.yaml`; ninguna dependencia nueva.

| Tarea | Comando |
|---|---|
| Entorno | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| Rendimiento | `node scripts/perf-run.ts --quick` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` |

**Puerta:** `pnpm test` + typecheck/build cuando la tarea toca `apps/web`. Sin red: PGlite, `fakeSupabaseFetch`, R2 y
plataformas simulados, fixtures `ffmpeg -f lavfi` de `workers/media/src/fixtures.ts`.

## Subárbol

```
packages/composition/src/layouts.ts           # NUEVO T1 (diseños, plantillas, toLegacyComposition); EDITA T2 (sceneAt)
packages/composition/src/safezones.ts         # NUEVO T1
packages/composition/src/index.ts             # EDITA T1 — export * de layouts.ts y safezones.ts
packages/composition/src/parity.test.ts       # NUEVO T2 (transcript de prueba propio; composition no importa selection)
workers/media/src/stages/compose.ts           # NUEVO T1 (compose, previews, checks)
workers/media/src/compose.test.ts             # NUEVO T1
apps/web/components/PreviewPlayer.tsx         # NUEVO T2 (incluye pantalla completa)
apps/web/components/ResultsGrid.tsx           # NUEVO T2 — vista v2 de resultados
apps/web/app/app/p/[id]/page.tsx              # EDITA T2 — rama v2 (engine = 'v2'); la rama v1 intacta
apps/web/lib/editor.ts, editor.test.ts        # NUEVO T3
apps/web/app/api/clips/[[...slug]]/route.ts   # NUEVO T3
apps/web/app/app/c/[id]/page.tsx              # EDITA T3
apps/web/app/app/demos/page.tsx               # EDITA T3
workers/media/src/stages/export.ts, export.test.ts   # NUEVO T4
apps/web/app/api/exports/[[...slug]]/route.ts # NUEVO T4
apps/web/lib/exports.test.ts                  # NUEVO T4
apps/web/app/app/exports/page.tsx             # EDITA T4
workers/media/src/stages/integrations.ts      # NUEVO T5
apps/web/app/api/[integration]/[[...rest]]/route.ts  # NUEVO T5
apps/web/lib/integrations.test.ts             # NUEVO T5
packages/providers/src/oauth.ts               # EDITA T5
apps/web/lib/oauthserver.ts                   # EDITA T5
workers/media/src/stages/purge.ts, lifecycle.test.ts # NUEVO T6 (stage.ts --purge ya lo carga con import())
apps/web/app/app/uso/page.tsx                 # NUEVO T6
scripts/perf-run.ts                           # NUEVO T6
docs/PERF.md                                  # NUEVO T6 (lo escribe perf-run.ts)
packages/composition/src/trim.ts              # existe — NO se toca (MAX_CLIP_SEC del flujo v1)
apps/web/components/BriefFields.tsx, BriefUnderstanding.tsx   # existen — NO se borran (vista v1)
```

## Modelo de datos de esta épica

| Entidad | Campos | Notas |
|---|---|---|
| `clip_versions` | `composition`, `aspect`, `layout`, `template` | inmutable; `save_clip_version` crea n+1 |
| `clip_drafts` | autoguardado | `save_clip_draft` |
| `transcript_revisions` | correcciones | `apply_transcript_revision` → `follow_clips` |
| `renders` | `kind`, `settings_hash`, `bytes`, `duration_ms`, `width`, `height`, `expires_at`, `error_code`, `batch_id`, `downloaded_at` | clave única existente decide la reutilización |
| `export_batches` | `status`, `zip_path` | ZIP del lote |
| `publications`, `imports`, `oauth_connections` (`tiktok`) | estados por plataforma | |
| `storage_objects`, `projects.purge_at` | retención | `purge_candidates`, `mark_purged`, `trash_project`, `restore_project`, `storage_summary`, `product_metrics` |

Claves de R2: exportación `<ws>/<clip>/v<version>-<12 hex>.<ext>`, ZIP `<ws>/batches/<batch>.zip`, miniatura de clip
`<ws>/<clip>/preview.jpg`. Las exportaciones se renderizan desde `<ws>/<source>/mezzanine.mp4`.

## Contratos

**Consumidos:** `freshDb`, `fakeSupabaseFetch`, `api.ts`, SQL de 034–037, `StageCtx`, `fixtures.ts`, `GroqLimiter`,
`deriveProjectState`, `CreationPanel`, `@rafaga/selection/modes` (`editorialScore`), `GET
/api/uploads/sources/:sourceId/proxy`, `ZipBuilder`, `checkUrl`, `isPublicIp`, `oauth_token`, `duplicate_project`.

**Producidos:**

| Export | Firma | Usado por |
|---|---|---|
| `@rafaga/composition` → `planLayout`, `switchLayout`, `toLegacyComposition`, `TEMPLATES`, `sceneAt` | `sceneAt(comp, t, srcW, srcH, opts?) → { video, headline, subtitles, overlays }` | Lyric Studio v2 |
| `@rafaga/composition` → `SAFE_ZONES`, `SAFE_ZONES_VERSION`, `safeArea`, `validateSafeZones` | — | editor, exportaciones |
| `PreviewPlayer` | vista previa + pantalla completa + zonas seguras | editor |
| `stages/purge.ts` | lo carga `stage.ts --purge` (import dinámico del paso 5) | Modal (`keep_alive`) |

## Convenciones que muerden aquí

- Un solo motor: la vista previa dibuja con `sceneAt`; la exportación usa `toLegacyComposition` → `ffmpegArgs`; ambos
  sobre `planLayout`. Las zonas seguras se dibujan solo en la vista previa.
- `packages/composition` no importa `@rafaga/selection`: cada prueba define su propio transcript de prueba.
- Los valores de `SAFE_ZONES` se **miden** en las páginas oficiales de especificaciones creativas y se citan (`source`);
  si no hay fuente pública, `note: "medido por nosotros, revisar"`. Nunca se inventan.
- `render` lee siempre `(clip_id, clip_version)` de la fila `renders`, nunca la versión actual.
- `p/[id]` muestra `ResultsGrid` solo en proyectos con algún trabajo `engine = 'v2'`; los proyectos v1 conservan su
  vista actual (`BriefFields`, «Volver a detectar», «Ajustar enfoque»).
- Las demos son ejemplos preparados: «Abrir copia editable» con `duplicate_project`; nunca simulan una generación en vivo
  ni presentan su tiempo de carga como tiempo de proceso.
- `trim.ts` no se toca: los clips v2 (hasta 180 s) tienen su propio límite en `editor.ts`.
- `stage.ts` no se edita en esta épica: `--purge` ya carga `./stages/purge.ts` con `import()`.
- Rutas con `[` entre comillas simples en el shell.

Reglas: `CLAUDE.md`, `.claude/rules/composition-parity.md`, `.claude/rules/api-routes.md`, `.claude/rules/worker-stages.md`.

---

## Tareas

### `E3-T1` — Composiciones, plantillas virales y zonas seguras

**Depende de:** `E2-T6` · **Prioridad:** p0

`layouts.ts` define `CompositionV2`, `planLayout` (cajas pares), el respaldo de encuadre, `switchLayout`,
`toLegacyComposition` (single_track → fill + `reframe.kf`; split_two → split con hablante por mitad; active_speaker →
speaker; screen_presenter → fit + cam; fit_full → blur/fit/fill; manual → fill + kf) y `TEMPLATES`:
`titular_video_subtitulos` (fondo desenfocado del mismo vídeo, banda 16:9 o 4:5 centrada, titular de 1–2 líneas arriba
—primera blanca, segunda en color de acento, píldora roja opcional— y subtítulos debajo), `pantalla_dividida`,
`hablante_seguimiento`, `cambio_hablante`, `presentacion_ponente`, `presentacion_sola`, `titular_en_caja`,
`titular_sobre_desenfoque`, `video_completo`. `safezones.ts` guarda los rectángulos inseguros de 9:16 por plataforma con
su fuente. `index.ts` añade `export * from "./layouts.ts"; export * from "./safezones.ts";` sin nombres que choquen.
`compose` crea la versión 1 por clip (formato, diseño, plantilla, `caption_style`; gancho con `groqChat` para los N
mejores; `units_actual` = 0.1 × ganchos hechos), `previews` la miniatura y `checks` los avisos (incluido `safe_zone`).
Las pruebas de `layouts.ts` y `safezones.ts` viven en `compose.test.ts`, con palabras de subtítulos definidas en la
propia prueba.

**Archivos**
- `packages/composition/src/layouts.ts` — nuevo
- `packages/composition/src/safezones.ts` — nuevo
- `packages/composition/src/index.ts` — edita
- `workers/media/src/stages/compose.ts` — nuevo
- `workers/media/src/compose.test.ts` — nuevo

**Aceptación**
1. **WHEN** `planLayout` se ejecuta para cada uno de los 6 diseños en cada uno de los 3 formatos (18 combinaciones) **THE SYSTEM SHALL** devolver cajas dentro del fotograma con dimensiones pares.
2. **WHEN** la cobertura del seguimiento cae por debajo de `minCoverage` **THE SYSTEM SHALL** usar la última caja buena ponderada al centro y después `fit_full` y marcar `needs_review: true`, y `switchLayout` SHALL conservar fragmentos, cortes, subtítulos, audio y extras.
3. **WHEN** cada plantilla de `TEMPLATES` se genera para 9:16, 1:1 y 16:9 **THE SYSTEM SHALL** devolver rectángulos normalizados en [0,1], y `titular_video_subtitulos` en 9:16 SHALL colocar el titular por encima de la banda de vídeo y los subtítulos por debajo, con fondo desenfocado.
4. **WHEN** se leen `SAFE_ZONES` **THE SYSTEM SHALL** tener entradas para `tiktok`, `instagram_reels` y `youtube_shorts` con rectángulos en [0,1] y una `source` https o la `note` "medido por nosotros, revisar", las plantillas con plataformas seleccionadas SHALL quedar dentro de `safeArea`, y `validateSafeZones` SHALL marcar una caja de texto que invade un rectángulo inseguro.
5. **WHEN** ffmpeg renderiza el fixture de 3 s con los 6 diseños en 9:16, `fit_full` en 16:9 y 1:1, y `titular_video_subtitulos` en 9:16 **THE SYSTEM SHALL** salir con 0 y ffprobe SHALL informar h264 con el ancho y el alto de `RATIO_SIZE` de cada formato.
6. **WHEN** la etapa `compose` se ejecuta para una generación **THE SYSTEM SHALL** crear por clip la versión 1 con `aspect`, `layout` y `template`, poner `technical_state = 'disponible'` y crear 0 filas en `renders`, y `checks` SHALL añadir el aviso `safe_zone` a un clip cuyo texto invade la zona insegura.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/compose.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 13 — composiciones y plantillas" && git tag rafaga-v2-step-13
```

### `E3-T2` — Motor de escena, resultados y pantalla completa (vista v2)

**Depende de:** `E3-T1`, `E2-T4` · **Prioridad:** p0

Añade `sceneAt` a `layouts.ts` con las mismas funciones que la exportación; `opts.safeZones` produce `overlays` solo
para la vista previa. `parity.test.ts` define su transcript de prueba como constante del archivo. `PreviewPlayer` dibuja
sobre el proxy en un `<canvas>` con `sceneAt`, tiene selector de zonas seguras y modo pantalla completa (`Escape`,
`ArrowLeft`/`ArrowRight`, espacio; título, puntuación, motivos, Editar, Exportar). `ResultsGrid` es la **vista v2**
completa de resultados: rejilla de Opus (puntuación 0–100, título, duración, acciones, cabecera con el prompt, búsqueda,
filtro/orden, rejilla/lista, selección múltiple), grupos por generación, mapa temporal sobre la línea de tiempo de la
fuente y «Nueva generación» (abre `CreationPanel`, conserva resultados); no importa `BriefFields` ni
`BriefUnderstanding`. En `p/[id]/page.tsx`, si el proyecto tiene algún trabajo `engine = 'v2'` se muestra `ResultsGrid`
con el resumen y Realtime (`postgres_changes` en `jobs`, `job_stages` y `clips`); si no, la vista v1 actual sin cambios
(`BriefFields`, «Volver a detectar», «Ajustar enfoque»).

**Archivos**
- `packages/composition/src/layouts.ts` — edita
- `packages/composition/src/parity.test.ts` — nuevo
- `apps/web/components/PreviewPlayer.tsx` — nuevo
- `apps/web/components/ResultsGrid.tsx` — nuevo
- `apps/web/app/app/p/[id]/page.tsx` — edita (rama v2; rama v1 intacta)

**Aceptación**
1. **WHEN** `parity.test.ts` compara, para cada grupo de subtítulos de su transcript de prueba, el inicio y el fin del evento `Dialogue` de `buildAss` con el intervalo de `sceneAt` **THE SYSTEM SHALL** encontrar diferencias de 1 fotograma (1/30 s) como máximo.
2. **WHEN** se comparan las cajas de `ffmpegArgs` (vía `toLegacyComposition`) con las de `sceneAt` **THE SYSTEM SHALL** encontrarlas iguales en los diseños sin fotogramas clave y el mismo arreglo `kf` en los demás, y los `overlays` de zonas seguras SHALL aparecer en `sceneAt` con `safeZones` y nunca en los argumentos de ffmpeg.
3. **WHEN** se ejecutan `grep -q 'sceneAt' apps/web/components/PreviewPlayer.tsx` y `grep -q 'Escape' apps/web/components/PreviewPlayer.tsx` **THE SYSTEM SHALL** salir con 0 en ambos: la vista previa usa el motor de exportación y la pantalla completa se cierra con Esc.
4. **WHEN** se ejecutan `grep -q 'postgres_changes' 'apps/web/app/app/p/[id]/page.tsx'`, `grep -q 'ResultsGrid' 'apps/web/app/app/p/[id]/page.tsx'` y `grep -q 'BriefFields' 'apps/web/app/app/p/[id]/page.tsx'` **THE SYSTEM SHALL** salir con 0 en los tres (la vista v1 conserva `BriefFields`), `grep -q 'BriefFields' apps/web/components/ResultsGrid.tsx` SHALL salir con 1 (la vista v2 no lo usa), y `pnpm --filter @rafaga/web build` SHALL salir con 0.

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

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 14 — resultados y pantalla completa" && git tag rafaga-v2-step-14
```

### `E3-T3` — Editor v2 y demos editables

**Depende de:** `E3-T2` · **Prioridad:** p0

`editor.ts`: historial, operaciones sobre `CompositionV2` (paso de fotograma, extender con la mezzanine, editar por
transcript, borrar/restaurar fragmentos vía `cuts`, corregir subtítulos con `editText`/`setTiming`, composición y
plantilla, volumen) con cortes que actualizan vídeo, audio y subtítulos; autoguardado de 800 ms. La ruta de clips cubre
versiones, borrador, revisión de transcript (`apply_transcript_revision` + `save_clip_version(…, p_user_edit => false)`
para `follow_clips`) y traducción (0.1 × minutos). `c/[id]` monta el editor con `PreviewPlayer`, pantalla completa y
zonas seguras para clips de proyectos v2; los clips v1 conservan el editor actual. `demos/page.tsx` añade «Abrir copia
editable» con `duplicate_project` e identifica la fuente y si es vista previa o pieza completa.

**Archivos**
- `apps/web/lib/editor.ts` — nuevo
- `apps/web/lib/editor.test.ts` — nuevo
- `apps/web/app/api/clips/[[...slug]]/route.ts` — nuevo
- `apps/web/app/app/c/[id]/page.tsx` — edita
- `apps/web/app/app/demos/page.tsx` — edita

**Aceptación**
1. **WHEN** se borra un fragmento y después se restaura **THE SYSTEM SHALL** quitar y devolver sus palabras de los subtítulos y acortar y restaurar la línea de tiempo, `mapTime` SHALL llevar cada instante superviviente a tiempo de edición y de vuelta con error de 1 ms como máximo, y N deshacer tras N ediciones SHALL devolver la especificación inicial que N rehacer vuelve a aplicar.
2. **WHEN** hay ediciones en t = 0, 300 y 600 ms **THE SYSTEM SHALL** escribir un único borrador en t = 1400 ms pasando por `guardando` y `guardado`, y si la escritura falla SHALL mostrar `error al guardar` sin perder la edición en memoria.
3. **WHEN** `POST /api/clips/:id/versions` llega con un `base_version` obsoleto **THE SYSTEM SHALL** responder 409 `{ conflict: { current_version } }` sin crear versión; con la vigente SHALL responder 201 `{ version }`, y aplicar otra composición o plantilla así SHALL crear 0 trabajos, 0 etapas y 0 movimientos en el libro (criterio 3).
4. **WHEN** se guarda una nueva revisión del transcript **THE SYSTEM SHALL** crear una versión nueva con los subtítulos corregidos solo para los clips con `user_edited = false` y dejar idénticas las versiones de los editados por el usuario (criterio 4).
5. **WHEN** se lanza una nueva generación sobre el mismo proyecto **THE SYSTEM SHALL** dejar sin cambios todas las filas anteriores de `clips` y `clip_versions` (criterio 4).
6. **WHEN** se ejecuta `grep -q 'duplicate_project' apps/web/app/app/demos/page.tsx` **THE SYSTEM SHALL** salir con 0: abrir una demo crea una copia editable y nunca modifica el ejemplo compartido.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/editor.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'duplicate_project' apps/web/app/app/demos/page.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 15 — editor v2" && git tag rafaga-v2-step-15
```

### `E3-T4` — Exportaciones

**Depende de:** `E3-T3` · **Prioridad:** p0

`render` parte de la mezzanine y de la versión pinchada en la fila `renders`; H.264 High, AAC LC, yuv420p, `+faststart`,
ffprobe; caducidad +30 días; sidecars SRT/VTT/TXT y FCPXML 1.10, xmeml v4 y EDL CMX3600 con constructores en el mismo
módulo; un fallo solo falla su etapa. `zip` usa `ZipBuilder`. La ruta reutiliza filas iguales, reintenta solo fallidas,
firma tras búsqueda RLS (404 si no es suyo), re-renderiza gratis si se purgó y fija `downloaded_at` en la primera
descarga. La página de exportaciones muestra el aviso `safe_zone` en el diálogo.

**Archivos**
- `workers/media/src/stages/export.ts` — nuevo
- `workers/media/src/export.test.ts` — nuevo
- `apps/web/app/api/exports/[[...slug]]/route.ts` — nuevo
- `apps/web/lib/exports.test.ts` — nuevo
- `apps/web/app/app/exports/page.tsx` — edita

**Aceptación**
1. **WHEN** `render` exporta la versión 1 de un clip y después se guarda la versión 2 **THE SYSTEM SHALL** producir el MP4 a partir de la composición de `(clip_id, 1)` y la mezzanine —H.264 High, AAC LC, yuv420p y `moov` antes de `mdat`— y la fila de `renders` SHALL seguir con `clip_version = 1` (criterio 5).
2. **WHEN** un lote de 3 exportaciones tiene una que falla **THE SYSTEM SHALL** dejar las otras 2 en `ready` y descargables y el lote en `partial`, y `POST /api/exports/:id/retry` SHALL reencolar solo la fallida (criterio 7).
3. **WHEN** se pide dos veces la misma exportación (versión, formato, subtítulos y tipo) **THE SYSTEM SHALL** reutilizar la fila de `renders` sin crear un trabajo nuevo.
4. **WHEN** el usuario B pide `GET /api/exports/:id/url` de una exportación de A **THE SYSTEM SHALL** responder 404 sin firmar ninguna URL, y para A SHALL devolver `{ url, expires_at }` y fijar `downloaded_at` solo en la primera descarga (criterio 9, ruta).
5. **WHEN** `zip` empaqueta un lote **THE SYSTEM SHALL** producir con `ZipBuilder` una entrada por exportación `ready`, y las salidas SRT, VTT, TXT, FCPXML, xmeml y EDL SHALL cumplir su formato: `<fcpxml version="1.10">`, `<xmeml version="4">`, una línea `TITLE:` y un evento por fragmento en la EDL.
6. **WHEN** se pide la URL de una exportación cuyo objeto se purgó **THE SYSTEM SHALL** volver a renderizarla desde su versión inmutable sin ningún movimiento en el libro.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/export.test.ts apps/web/lib/exports.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 16 — exportaciones" && git tag rafaga-v2-step-16
```

### `E3-T5` — Importación y publicación

**Depende de:** `E3-T4` · **Prioridad:** p1

TikTok entra como proveedor OAuth (endpoints de autorización/token no verificados: el propietario los confirma; las
pruebas los simulan). La etapa `import` aplica la guarda SSRF en cada salto, límites de 4294967296 bytes y tipo de
vídeo, descarga en flujo a R2 por partes y encola validación/mezzanine/proxy. `publish`: YouTube con la privacidad
elegida y `private_pending_review` solo si la respuesta lo indica; TikTok con `creator_info/query`, `video/init`
(`FILE_UPLOAD`), PUT y `status/fetch`, y `requiere_auditoria` ante el error de cliente sin auditar. La ruta dinámica
`[integration]` atiende `/api/import/{link,drive,dropbox}` y `/api/publish`; cualquier otro valor → 404.

**Archivos**
- `workers/media/src/stages/integrations.ts` — nuevo
- `apps/web/app/api/[integration]/[[...rest]]/route.ts` — nuevo
- `apps/web/lib/integrations.test.ts` — nuevo
- `packages/providers/src/oauth.ts` — edita
- `apps/web/lib/oauthserver.ts` — edita

**Aceptación**
1. **WHEN** `POST /api/import/link` recibe una URL `http:`, una que resuelve a una IP privada o de loopback, o una cuya redirección apunta a un rango privado **THE SYSTEM SHALL** responder 400 `{ reason }` con `not_https`, `private_address` o `redirect_private` sin crear ningún trabajo.
2. **WHEN** `import` descarga un enlace con `content-length` mayor que 4294967296 o `content-type` que no es de vídeo **THE SYSTEM SHALL** fallar con `too_large` o `unsupported_file` sin escribir en R2, y con un enlace válido SHALL subirlo a R2 por partes y encolar `validate`.
3. **WHEN** `POST /api/publish` llega para YouTube **THE SYSTEM SHALL** enviar `videos.insert` (simulado) con la privacidad elegida, `private` por defecto, y si la respuesta trae `status.privacyStatus` `private` cuando se pidió otra SHALL poner la publicación en `private_pending_review`.
4. **WHEN** TikTok responde `unaudited_client_can_only_post_to_private_accounts` **THE SYSTEM SHALL** poner la publicación en `requiere_auditoria` con su explicación, y el `privacy_level` enviado SHALL ser uno de `privacy_level_options`.
5. **WHEN** una publicación tiene `scheduled_at` futuro **THE SYSTEM SHALL** dejarla en `scheduled` sin llamar a la plataforma hasta que `enqueue_due_publications()` la encuentre vencida.
6. **WHEN** se inicia una conexión con `publish_tiktok` o `publish_youtube` **THE SYSTEM SHALL** usar `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` o `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y el alcance `video.publish` o `https://www.googleapis.com/auth/youtube.upload`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/integrations.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 17 — importación y publicación" && git tag rafaga-v2-step-17
```

### `E3-T6` — Ciclo de vida, métricas, Uso y rendimiento

**Depende de:** `E3-T4` · **Prioridad:** p1

`purge.ts` borra en R2 lo que devuelve `purge_candidates` (un 404 cuenta como borrado) y llama a `mark_purged`; lo
carga `stage.ts --purge` con `import()` dinámico desde el paso 5, así que `stage.ts` no se edita. `lifecycle.test.ts`
cubre purga, papelera, `storage_summary` y `product_metrics` (si la consulta de referencia de 037 necesita
simplificarse, se hace sin cambiar los nombres de sus cinco campos). La página Uso muestra almacenamiento, saldo,
cómputo frente a 30 USD con el aviso al 90 %, caducidades y consecuencias de borrar. `perf-run.ts --quick` genera
fixtures de 5 min (360p, `pcm_s24le`, timecode), ejecuta 2 proyectos a la vez por las etapas locales sobre PGlite con
ASR/LLM simulados y escribe `docs/PERF.md`.

**Archivos**
- `workers/media/src/stages/purge.ts` — nuevo
- `workers/media/src/lifecycle.test.ts` — nuevo
- `apps/web/app/app/uso/page.tsx` — nuevo
- `scripts/perf-run.ts` — nuevo
- `docs/PERF.md` — nuevo (lo escribe `perf-run.ts`)

**Aceptación**
1. **WHEN** `purge_candidates()` se ejecuta **THE SYSTEM SHALL** devolver el original de una fuente con mezzanine registrada, las exportaciones con `expires_at` vencido y todos los objetos de proyectos con `purge_at` vencido, y SHALL no devolver el proxy ni la mezzanine de un proyecto fuera de la papelera.
2. **WHEN** `purge` borra esos objetos en el R2 simulado **THE SYSTEM SHALL** llamar a `mark_purged` y `storage_used` SHALL bajar exactamente en la suma de sus bytes.
3. **WHEN** un proyecto se envía a la papelera **THE SYSTEM SHALL** fijar `purge_at` 30 días después de `deleted_at`, y `restore_project` antes de esa fecha SHALL devolverlo con sus clips y versiones intactos.
4. **WHEN** `storage_summary()` se llama **THE SYSTEM SHALL** devolver `used_bytes`, `quota_bytes = 10737418240`, el saldo, el cómputo del mes frente a `budget_usd` y las próximas caducidades del workspace, y para el usuario B sobre el workspace de A SHALL lanzar `not_found`.
5. **WHEN** `product_metrics` se calcula sobre datos de prueba **THE SYSTEM SHALL** devolver `first_approved_s`, `acceptance_rate`, `active_correction_s`, `second_variant_s` y `approved_downloaded_per_creator`, contando solo proyectos con generaciones v2 y cada descarga repetida una sola vez.
6. **WHEN** se ejecuta `node scripts/perf-run.ts --quick` **THE SYSTEM SHALL** generar fixtures de 5 min, ejecutar 2 proyectos a la vez con ASR y LLM simulados y escribir `docs/PERF.md` con p50 y p95 de `upload_ms`, `queue_ms`, `analysis_ms`, `first_clip_ms`, `all_clips_ms`, `render_ms` y `zip_ms`.

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

## Aceptación de la épica

1. **WHEN** se ejecuta la puerta global (§20.1 de `blueprint.md`) **THE SYSTEM SHALL** salir con 0 en cada línea.
2. **WHEN** se ejecuta `node --test packages/composition/src/parity.test.ts` **THE SYSTEM SHALL** salir con 0: vista previa y exportación coinciden con ≤1 fotograma.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/parity.test.ts apps/web/lib/wake.test.ts supabase/tests/job_stages.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

## Trampas

- **Dos motores de dibujo** — si `PreviewPlayer` calcula una posición por su cuenta, la paridad se rompe en silencio.
- **Composition importando selection** — prohibido; el transcript de prueba vive en `parity.test.ts`.
- **Romper la vista v1 de `p/[id]`** — `ResultsGrid` solo para proyectos v2; `BriefFields` sigue en la página.
- **Zonas seguras inventadas** — sin fuente pública, `note: "medido por nosotros, revisar"`; nunca un número «plausible».
- **Exportar la versión actual** — la fila `renders` fija la versión; léela de ahí.
- **Una demo que simula generación** — prohibido: es un ejemplo preparado y se abre como copia.
- **Purga sin `mark_purged`** — la cuota no bajaría y las URLs apuntarían a objetos borrados.

## Antes de seguir

- [ ] Las 6 tareas `done`; ningún `verify` editado ni saltado.
- [ ] Etiquetas `rafaga-v2-step-13` … `rafaga-v2-step-18` en git (18 en total).
- [ ] Contratos producidos con su firma.
- [ ] Nada editado fuera del subárbol; `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` documentadas en `blueprint.md` §10 y
      no escritas en ningún `.env` del repo.
