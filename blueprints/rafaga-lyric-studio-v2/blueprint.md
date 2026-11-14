# Ráfaga Studio v2 · Lyric Studio — Blueprint de cambio (brownfield)

> Generado por The Architect el 2026-11-14 · incluye la AMPLIACIÓN 2026-11-13 del propietario, que prevalece
> Forma: generative-media-app (uso privado, sin pasarela de pago) · Pista: ts-node con las convenciones del repo
> Modo: bundle `blueprints/rafaga-lyric-studio-v2/` · Versión 1 · Versiones verificadas: 2026-11-13 (§11, tabla de clipping v2)

Este bundle vive **dentro** del repo y **depende del bundle `blueprints/rafaga-clipping-v2/`**, cuyos 18 pasos ya están
construidos (etiquetas `rafaga-v2-step-01` … `rafaga-v2-step-18`). De clipping v2 se usan: paso 2 (esquema 034), 3 (libro de
unidades 035), 4 (motor de etapas 036), 5–6 (`stage.ts` y Modal), 7–8 (subida reanudable), 14 (motor de escena y
`PreviewPlayer`), 16 (exportaciones, `request_exports`, `stages/export.ts`) y 17 (publicaciones, importación y ciclo de
vida). Las migraciones de este bundle empiezan en `20261201000100_` para no chocar nunca con la serie de clipping v2
(que va por `20261113000042`). El paso 1 comprueba esas etiquetas antes de tocar nada.

---

## 1. Visión general y no-objetivos

### Visión
Lyric Studio v2 convierte una canción del propietario en vídeos de letra verticales u horizontales: sube la canción con el
cargador compartido, sincroniza la letra que él aprueba (o pide una transcripción propuesta del canto), la corrige palabra
a palabra, elige **sus propios fondos** (vídeo, foto o color; incluso cortados de su propio videoclip), un estilo de texto
de 9 controles compartido con los subtítulos de clipping, un modo (Letra, Texto o Portada) y genera N variantes que se
exportan en 720p o 1080p y en SRT, VTT, LRC (de línea y por palabra), ASS karaoke y TXT, para publicarlas o programarlas en
YouTube y TikTok con las publicaciones de clipping v2. Mismo coste 0 € que clipping v2 (Modal Starter, Groq free, R2 10 GB,
Supabase Free, Vercel Hobby). La referencia funcional es LyricTune Studio (observada en modo lectura el 2026-11-13); no se
copia código, medios, nombres comerciales ni límites.

### Usuarios
| Persona | Qué viene a hacer | Frecuencia |
|---|---|---|
| Propietario (`owner`), artista y único usuario | subir canciones, sincronizar, elegir fondos y estilo, generar variantes, publicar | varias veces por semana |
| Revisor invitado (`reviewer`, existente) | ver entregas de variantes, comentar, aprobar | ocasional |

### Estado actual
| Área | Hecho leído del código (2026-11-14) |
|---|---|
| Paquete `packages/lyrics` | `index.ts` (`parseLyrics` ya importa TXT/LRC/SRT/VTT quitando tiempos, `alignLyrics` Needleman-Wunsch que nunca inventa palabras, `lyricsFromAsr`, `rng`, `planVariants`), `background.ts` (`BgSettings`, `DEFAULT_BG`, `FILTERS` con claves `midnight|super8|noir|vaporwave`, `sequenceFor`, `lyricFfmpegArgs`, `RAFAGA_COLLECTIONS` sin medios), `looks.ts` (`FPS = 30`, `LOOKS` `archivo|diario|panoramico`, `layoutLyrics`/`layoutToAss`/`frameState` = un motor con tiempos cuantizados, `CANVAS`, `lookFfmpegArgs` con `alimiter` en el audio), `beats.ts`, `moments.ts`, `audiomoments.ts`, `more.ts` (`planMore`, `restoreShots`, `swapShots`), `metrics.ts` (Liberation Sans), `ttf.ts` (`readMetrics`, `METRIC_CODEPOINTS`); pruebas al lado. `exports` = solo `.` |
| Paquete `packages/composition` | sin dependencias de otros paquetes; `subtitles.ts` (`SubtitleStyle`, `buildAss`, 21 `PRESETS`), `style.ts` (`validateStyle`, `surpriseStyle`), `fonts.ts` (`sniffFont`, `fontFamily`, `renderFamily`, `SYSTEM_FONT` Bootzy TM en el bucket `app-fonts`), `composition.ts` (`RATIO_SIZE` con 9:16, 4:5, 1:1, 16:9, 4:3; `escapeFilterPath`), `layouts.ts` y `safezones.ts` de clipping v2 (`planLayout`, `sceneAt`, `SAFE_ZONES`) |
| Worker | v1: `workers/media/src/run.ts` → `processLyrics` (trabajos `lyrics` `engine = 'v1'`; descarga de Supabase Storage `originals`; caché `song_alignments` por clave de letra+tramo; manual `manual:<sha>`). v2: `stage.ts` + `stages/{registry,runner,validate,analysis,select,compose,export,integrations,purge}.ts`; `STAGES` de `validate` a `translate`; `stages/export.ts` `render` lee `export_job_item` |
| Datos | `songs` (mime solo mp3/wav, ruta `<ws>/songs/…`, `studio_settings`), `song_alignments` (único `(song_id, lyrics_sha256)`), `lyric_videos` (por trabajo y variante), `media_collections`/`media_items` (007; ruta `<ws>/media/…`; sin `unique (workspace_id, id)`), `text_styles` (008; `style` < 4096 bytes; sin `unique (workspace_id, id)`), `workspace_fonts` (004). `projects.mode` ∈ `clips, captions, reframe, social, broll`. Migraciones 001–042 (las 034–042 son de clipping v2) |
| Web | `apps/web/app/app/lyric-studio/page.tsx` (456 líneas, `export default function LyricStudio`, usa `request_lyrics`), `style-studio/page.tsx` (`export default function StyleStudio`), `TapSync.tsx` (ya tiene modo «Mantener», velocidad 0.5/0.75/1 y empujar ±0.05 s; guarda con `save_manual_alignment`), `LyricSample`, `LookPreview`, `BeatAnalysis`, `Collections`, `MediaLibrary`, `SubtitleEditor`. Rutas API delgadas: `route.ts` llama a `apps/web/lib/routes/<recurso>.ts` (`handleX(req, slug, deps)`) |
| Pruebas | `pnpm test` = `node --test` sobre `packages/{composition,selection,lyrics,providers}/src/*.test.ts`, `apps/web/lib/*.test.ts`, `workers/media/src/*.test.ts`, `supabase/tests/*.test.ts` (los globs **no** bajan a subcarpetas) |
| Árbol | limpio salvo `blueprints/` |

### Estado objetivo
Una pieza de letra es una fila de `projects` con `mode = 'lyrics'` y su extensión 1:1 `lyric_projects`; la canción es una
`sources` de audio subida con el cargador compartido y una fila `songs` enlazada (`songs.source_id`); la sincronización es
una etapa `lyric_sync` del motor de etapas que guarda revisiones en `song_alignments`; el estilo es `CaptionStyleV2` (9
controles) en `text_styles`; la escena de letra (`lyricScene*` en `packages/composition`) alimenta la vista previa del
navegador y el ASS del render; las variantes son `clips` + `clip_versions` inmutables y sus salidas son `renders` pedidos con
`request_exports`; publicar y compartir usan `publications` y `deliveries` sin cambios. El flujo v1 sigue intacto detrás de
`NEXT_PUBLIC_LYRIC_VERSION` (por defecto `v1`).

### Objetivos v1
1. Subir una canción (mp3, wav, m4a/aac, flac, ogg; ≤ 60 MB, ≤ 10 min) y ver su tarjeta de validación.
2. Sincronizar letra aprobada sin modificarla nunca en silencio; transcripción del canto solo como propuesta.
3. Corregir palabra a palabra conservando lo corregido al re-sincronizar; restaurar la sincronización original.
4. Vista previa = exportación (≤ 1 fotograma en tiempos, ≤ 2 px en posición de texto).
5. N variantes (1–10) con candados; un fallo no bloquea las demás; reintento de la fallida.
6. Formatos de letra y publicación por la infraestructura compartida; coste 0 €.

### No-objetivos
| No se construye | Por qué | Revisar cuando |
|---|---|---|
| Metraje con licencia («LyricTune Collections») | no hay metraje gratuito con licencia; «Colecciones Ráfaga» sale vacío | el propietario consiga metraje con licencia |
| Instagram (publicar) | revisión de Meta y cuenta business | haya cuenta business |
| Vinilo giratorio y animaciones de portada avanzadas | la ampliación los deja para después | tras usar Portada un mes |
| Editor de estilo de ~40 controles (capas de animación, eco, caos, degradados) | decisión de simplificación: 9 controles | la aceptación medida lo pida |
| Migrar canciones v1 (Supabase Storage) a v2 | el worker v2 solo lee R2; re-subir es más simple y seguro | haya > 20 canciones v1 en uso |
| Usar `media_items` v1 (Supabase Storage) en el render v2 | mismo motivo; se marcan «Solo Looks clásicos» | igual |
| Piezas de letra en la rejilla de clipping (`/app/p/[id]`) | la pieza se trabaja en Lyric Studio | se pida |
| Nuevas dependencias npm, linter, CI o E2E | regla del repo | el propietario lo pida |
| Despliegues, cambios en producción, ejecuciones de pago, reprocesar históricos | no autorizados | orden expresa |
| **Congelada:** página v1 de Lyric Studio, `request_lyrics`, `save_manual_alignment`, `processLyrics` en `run.ts`, `FILTERS`, `LOOKS`, `lyricFfmpegArgs`, `lookFfmpegArgs` | coexistencia: siguen produciendo vídeos de canciones existentes | D2 (§9.1) |
| **Congelada:** filas existentes de `songs`, `song_alignments`, `lyric_videos`, `media_*`, `text_styles` | datos v1 | nunca se borran |
| **Congelada:** contratos de clipping v2 (`/api/uploads`, `/api/exports`, `/api/publish`, `/api/wake`, `enqueue_job`, `claim_stage`, `finish_stage`, `export_job_item`, `finish_render`) | los usa clipping | — |

El constructor no implementa nada de esta tabla. Si un paso parece requerirlo, se detiene e informa.

### Reglas de la ampliación (propietario, 2026-11-13)
Idénticas a la sección G del encargo de clipping: antes de tocar algo se lee su implementación y dependencias; se
reutilizan componentes, colas, almacenamiento y motores; **sin sistemas paralelos**; nada de refactorizaciones ajenas;
ninguna migración destructiva sin declarar su impacto; no se reprocesan históricos; no se despliega. Las métricas de
producto no incluyen letra ni medios privados en ningún evento.

### Ampliaciones: reutilización
| Ampliación | Reutiliza | Hueco | Cambio mínimo | Efecto en lo actual | Prueba de aceptación | Prueba de regresión |
|---|---|---|---|---|---|---|
| Pieza de letra | `projects` (+`mode`) | ajustes de letra tipados (canción, modo, tramo, estilo, fondos, gancho, portada, candados) | `projects.mode += 'lyrics'` + tabla 1:1 `lyric_projects` (meter 15 columnas en `projects` ensuciaría cada fila de clipping) | ninguno | `lyric_v2.test.ts` | `rls.test.ts` |
| Canción | `songs` + `sources` + `upload_sessions` | audio en R2, validación, más formatos | `songs.source_id`, métricas de audio, CHECK superconjunto de `mime` y `storage_path` | v1 igual | `lyric_song.test.ts` | `lyric_v2.test.ts` (alta v1) |
| Sincronización y revisiones | `song_alignments` | revisiones, anclas, propuesta | columnas `revision`, `kind`, `lyrics_text`, `flags` | v1 usa sus claves | `lyric_sync.test.ts` | `save_manual_alignment` en `lyric_v2.test.ts` |
| Trabajo de sincronización | `jobs` (`kind = 'lyrics'`, `engine = 'v2'`), `job_stages` | etapa | `job_stages.stage += lyric_sync` | `claim_job` sigue solo con v1 | `lyric_sync.test.ts` | `job_stages.test.ts` |
| Estilos | `text_styles` | límite 20 v2, esquema v2 | RPC `save_caption_style` | estilos v1 intactos | `styles.test.ts` | `style.test.ts` |
| Paquetes de ganchos | — (ninguna tabla guarda listas de textos) | ganchos | tabla `hook_packs` | ninguno | `lyricmodes.test.ts`, `lyric_v2.test.ts` | — |
| Paquetes de medios y Portadas | `media_collections`, `media_items` | R2, clasificación, oficial, segmentos | columnas aditivas; Portadas = colección con `purpose = 'artwork'` (sin tabla `artwork`) | v1 sigue con Supabase Storage | `lyric_media.test.ts` | `library.test.ts` |
| Variantes y salidas | `generations`, `clips`, `clip_versions`, `renders`, `export_batches`, `request_exports` | composición de letra | `clip_versions.aspect += 4:5`, `renders.kind += lrc, lrc_word, ass` | ninguno | `lyrics.test.ts` | `exports.test.ts` |
| Publicar, programar, compartir | `publications`, `request_publication`, `deliveries`, `share_links` | — | nada (las variantes son clips) | ninguno | `lyricshare.test.ts` | `integrations.test.ts` |
| Fuentes del contenido | `fonts.ts`, `workspace_fonts`, `ttf.ts` | 15 familias, métricas, licencias | `fontcatalog.ts` + archivos en `apps/web/public/fonts/caption/` | ninguno | `captionfonts.test.ts` | `fonts.test.ts` |
| Demo | `/app/demos` (idea), cargador | canción preparada | constante `DEMO_SONG` + `open_lyric_demo` (copia al abrir) | ninguno | `lyric_demo.test.ts` | — |

### Métricas de éxito
| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Deriva vista previa/exportación | ≤ 1 fotograma; ≤ 2 px | `lyricparity.test.ts` |
| Palabras corregidas que cambian al re-sincronizar | 0 | `lyric_sync.test.ts` |
| Coste | 0 € | `select public.compute_meter()` |
| Tiempos (canción sintética de 3 min, 3 variantes 1080p) | se miden: `sync_ms`, `preview_ready_ms`, `render_ms` p50/p95 | `docs/PERF.md` (paso 17) |

---

## 2. Stack tecnológico

| Capa | Decisión | Por qué (y qué se rechaza) |
|---|---|---|
| Runtime | TypeScript ejecutado por Node ≥24 | convención del repo; rechazados tsx/ts-node |
| Web | Next.js App Router, Tailwind y `apps/web/components/ui/` existentes | diseño fuera de alcance |
| Datos | Supabase Postgres + RPC `security definer` con el JWT del usuario | RLS decide en la BD; sin ORM |
| Segundo plano | etapas de clipping v2 en Modal (`stage.ts --drain`) | sin sistemas paralelos; Actions no procesa medios |
| Archivos | R2 con `presignV4`/`r2Url` | ya en uso, 10 GB gratis |
| Render | ffmpeg 9.0.2 + libass | el mismo binario que clipping |
| ASR | Groq `whisper-large-v3-turbo` | gratuito; ya integrado (`groqTranscribe`) |
| Fuentes del vídeo | Google Fonts (OFL/Apache) en `apps/web/public/fonts/caption/` | mismo archivo en navegador y worker = mismas métricas |
| Pagos | NOT APPLICABLE — uso privado | — |

**Compatibilidad:** comprobado contra `knowledge/stack-compatibility.md` — sin entradas para esta combinación y sin
combinaciones conocidas como malas; es exactamente el stack de clipping v2 sin paquetes nuevos.

---

## 3. Estructura de directorios

```
rafaga-studio/
  CLAUDE.md, AGENTS.md            # el Bootstrap AÑADE la sección de letra (marca rafaga-lyric-v2:merged); no pisa nada
  .claude/settings.json           # el Bootstrap lo crea o le une las entradas de letra (unión idempotente)
  .claude/rules/lyric-studio.md   # Bootstrap (copia de workspace/ sin pisar)
  blueprints/rafaga-lyric-studio-v2/   # este bundle; ninguna herramienta lo recorre (§19.6)
  supabase/migrations/
    20261201000100_lyric_v2.sql        # NUEVO 1  — tablas, columnas, CHECK superconjunto, RLS, RPC de estilos/proyectos/ganchos
    20261201000101_lyric_songs.sql     # NUEVO 2  — register_song, complete_upload (rama audio), song_validate, demo
    20261201000102_lyric_sync.sql      # NUEVO 5  — sincronización y revisiones
    20261201000103_lyric_media.sql     # NUEVO 12 — paquetes de medios y «Crear desde vídeo»
    20261201000104_lyric_variants.sql  # NUEVO 15 — variantes; request_exports con 4:5, lrc, lrc_word, ass
  supabase/tests/lyric_v2.test.ts      # NUEVO 1
  packages/lyrics/src/
    sync.ts, sync.test.ts              # NUEVO 4 — anclas, propuesta, ediciones, banderas, DEMO_SONG
    formats.ts, formats.test.ts        # NUEVO 4 — LRC (línea y palabra), SRT, VTT, ASS karaoke, TXT; importación
    index.ts                           # EDITA 4 — export * de sync.ts y formats.ts
  packages/composition/src/
    fontcatalog.ts                     # NUEVO 7 — lo escribe scripts/fetch-fonts.ts --write (métricas, sha256, licencia)
    style.ts                           # EDITA 8 — CaptionStyleV2 (9 controles), BEHAVIOUR_PRESETS; lo v1 sigue legible
    lyricscene.ts                      # NUEVO 8; EDITA 11 (modos), 14 (render, variantes)
    lyricscene.test.ts (8) · lyricparity.test.ts (10) · lyricmodes.test.ts (11) · lyricrender.test.ts (14)
    index.ts                           # EDITA 7 y 8 — export * de fontcatalog.ts y lyricscene.ts
  workers/media/src/
    stages/lyric.ts                    # NUEVO 2 (song_validate); EDITA 5 (lyric_sync), 12 (media_split), 14 (render), 16 (formatos), 17 (demo)
    stages/registry.ts                 # EDITA 2 — STAGES += song_validate, lyric_sync, media_split
    stages/export.ts                   # EDITA 14 — rama de composiciones de letra + extensiones lrc/ass
    fixtures.ts                        # EDITA 2 — canciones sintéticas y fixture de escenas
    lyric_song.test.ts (2) · lyric_sync.test.ts (5) · lyric_ass.test.ts (8) · lyric_media.test.ts (12)
    lyric_render.test.ts (14) · lyric_formats.test.ts (16) · lyric_demo.test.ts (17)
    run.ts                             # SIN CAMBIOS (v1)
  apps/web/
    app/api/lyrics/[[...slug]]/route.ts   # NUEVO 3 — delgada: llama a lib/routes/lyrics.ts
    lib/routes/lyrics.ts               # NUEVO 3; EDITA 5, 12, 15
    lib/lyrics.test.ts                 # NUEVO 3; EDITA 5, 12, 15
    lib/synceditor.ts, synceditor.test.ts (6) · captionfonts.test.ts (7) · styles.ts, styles.test.ts (9)
    lib/lyricpreview.ts, lyricpreview.test.ts (10) · lyricsettings.ts, lyricsettings.test.ts (13)
    lib/lyricshare.test.ts (16) · lyriccutover.ts, lyriccutover.test.ts (18)
    components/LyricStudioV2.tsx       # NUEVO 3; EDITA 6, 10, 11, 13, 15
    components/LyricSyncEditor.tsx (6) · CaptionStyleEditor.tsx (9; EDITA 18) · LyricPreview.tsx (10)
    components/LyricLibrary.tsx (11; EDITA 13, 18) · LyricSettings.tsx (13) · LyricResults.tsx (15; EDITA 16)
    components/TapSync.tsx (EDITA 6) · CreationPanel.tsx (EDITA 9)
    app/app/lyric-studio/page.tsx (EDITA 3) · app/app/style-studio/page.tsx (EDITA 9)
    public/fonts/caption/*.ttf         # NUEVO 7 — los descarga scripts/fetch-fonts.ts --write
  scripts/fetch-fonts.ts (7) · scripts/lyric-perf.ts (17)
  docs/PERF.md                         # EDITA 17 (lo escribe lyric-perf.ts entre marcas; la parte de clipping se conserva)
```

### Delta
Añadidos: lo marcado NUEVO. Modificados: lo marcado EDITA. Borrados: ninguno (D2 tras la construcción).

### Reglas de frontera
- `packages/composition` sigue sin depender de ningún paquete: la escena de letra, el esquema de estilo y el catálogo de
  fuentes viven ahí; `packages/lyrics` (alineación, formatos, demo) tampoco depende de `composition`. Solo `apps/web` y
  `workers/media` (que dependen de ambos) los combinan. Añadir una dependencia entre paquetes cambiaría `pnpm-lock.yaml`.
- `workers/media/src/stages/lyric.ts` no importa `@supabase/supabase-js`; recibe `StageCtx`.
- La vista previa (`LyricPreview.tsx`) y el render (`lyricRenderArgs` + `lyricAss`) toman cajas, tiempos y fondos de
  `lyricLayout`/`lyricSceneAt`/`lyricShots`/`bgRect`; ningún componente calcula posiciones por su cuenta.
- La v1 (`page.tsx` antigua, `run.ts`, `FILTERS`, `LOOKS`) no se edita salvo el envoltorio de la bandera en `page.tsx`.
- Convención de imports reconciliada en §19.6.

---

## 4. Modelo de datos

### Entidades y correspondencia
Pieza = `projects` (`mode = 'lyrics'`) + `lyric_projects` (1:1). Canción = `songs` (+ `sources` de audio para v2).
Alineación = revisiones de `song_alignments` (`revision`, `kind`). Estilo = `text_styles.style` con `rafagaStyle: 2`.
Paquete de medios = `media_collections` (`purpose = 'backgrounds'`); Portadas = `media_collections` (`purpose = 'artwork'`).
Paquete de ganchos = `hook_packs`. Lote de variantes = `generations` (una por petición) → `clips` (una por variante) →
`clip_versions` v1 (composición de letra inmutable) → `renders` (MP4 y formatos) en un `export_batches`.
Una canción → muchas piezas; una alineación (revisión) → muchas piezas (`lyric_projects.alignment_revision`).

### Delta
| Tipo | Detalle | Migración |
|---|---|---|
| Tablas nuevas | `hook_packs`, `lyric_projects` | 100 |
| Columnas | `songs`: `source_id`, `status`, `duration_ms`, `sample_rate`, `channels`, `loudness_lufs`, `codec`, `error_code`, `demo` · `song_alignments`: `revision`, `kind`, `lyrics_text`, `flags`, `created_by` · `media_collections`: `purpose`, `official`, `mood` · `media_items`: `storage_backend`, `status`, `duration_ms`, `width`, `height`, `category`, `motion`, `mood`, `source_id`, `segment_start_ms`, `segment_end_ms`, `cut_mode`, `audio_muted` | 100 |
| CHECK reescritas (superconjuntos) | `projects.mode` (+`lyrics`) · `songs.mime` (+`audio/mp3`, `audio/mp4`, `audio/x-m4a`, `audio/aac`, `audio/flac`, `audio/x-flac`, `audio/ogg`) · `songs.storage_path` (+ cualquier `<ws>/…` si hay `source_id`) · `clip_versions.aspect` (+`4:5`) · `renders.kind` (+`lrc`, `lrc_word`, `ass`) · `job_stages.stage` (+`song_validate`, `lyric_sync`, `media_split`) · `storage_objects.kind` (+`media`) | 100 |
| Únicas nuevas | `text_styles (workspace_id, id)`, `media_items (workspace_id, id)` (id ya es PK), índice único parcial `songs(source_id)` | 100 |
| Funciones nuevas | 100: `save_caption_style`, `delete_caption_style`, `save_hook_pack`, `create_lyric_project`, `save_lyric_project`, `create_media_collection`, `set_collection_official`, `classify_media_item` · 101: `register_song`, `song_by_source`, `finish_song_validate`, `song_object`, `open_lyric_demo` · 102: `request_lyric_sync`, `lyric_sync_context`, `save_song_asr`, `save_song_alignment`, `restore_original_alignment`, `song_alignment`, `set_song_lyrics` · 103: `create_media_item`, `complete_media_item`, `media_item_object`, `request_media_split`, `request_media_cut`, `media_split_context`, `add_split_item` · 104: `request_lyric_variants` | |
| Funciones recreadas con el mismo contrato | `complete_upload` (101: rama de audio → `song_validate`), `request_exports` (104: + `4:5`, `lrc`, `lrc_word`, `ass`) | |
| Borrado | ninguno | — |

### Claves de objetos en R2
| Objeto | Clave |
|---|---|
| Canción (original, nunca se borra: no hay mezzanine de audio) | `<ws>/<source>/original` |
| Audio de transcripción (opus 16 kHz mono) | `<ws>/<source>/audio.opus` |
| Elemento de paquete de medios o portada | `<ws>/media/<item>.<ext>` (`mp4`, `jpg`, `png`, `webp`) |
| Exportación de una variante | la de clipping: `<ws>/<clip>/v<version>-<12 hex>.<ext>` (`mp4`, `srt`, `vtt`, `lrc`, `ass`, `txt`) |

### Relaciones y cascadas
`projects→lyric_projects` cascada · `songs→lyric_projects` sin cascada · `hook_packs`, `text_styles`, `media_items →
lyric_projects` `set null` en su columna · `sources→songs` sin cascada · `songs→song_alignments` cascada (existente).

### Índices
`songs(source_id) where source_id is not null` (único) · `song_alignments(song_id, revision) where revision is not null`
(único) · `media_items(workspace_id, id)` (único).

### Esquema
SQL de referencia: cada paso lo pega en su migración y solo lo corrige si una prueba demuestra un error, sin cambiar
nombres, firmas ni códigos de error. Toda función `security definer` lleva `set search_path = public`, `revoke all …
from public, anon` y `grant execute` explícito.

#### 100 — `supabase/migrations/20261201000100_lyric_v2.sql` (paso 1)
```sql
-- Lyric Studio v2: esquema (paso 1). Aditiva. Impacto declarado: CHECK reescritas como superconjuntos exactos de las
-- vigentes (projects.mode, songs.mime, songs.storage_path, clip_versions.aspect, renders.kind, job_stages.stage,
-- storage_objects.kind); únicas (workspace_id, id) nuevas en text_styles y media_items (id ya es PK). Nada se borra.
-- El flujo v1 (request_lyrics, save_manual_alignment, run.ts) no cambia.
do $$ declare c record; begin
  for c in select conrelid::regclass::text as t, conname from pg_constraint where contype = 'c' and (
       (conrelid = 'public.projects'::regclass and pg_get_constraintdef(oid) like '%''broll''%')
    or (conrelid = 'public.songs'::regclass and (pg_get_constraintdef(oid) like '%audio/mpeg%' or pg_get_constraintdef(oid) like '%/songs/%'))
    or (conrelid = 'public.clip_versions'::regclass and pg_get_constraintdef(oid) like '%aspect%')
    or (conrelid = 'public.renders'::regclass and pg_get_constraintdef(oid) like '%''xmeml''%')
    or (conrelid = 'public.job_stages'::regclass and pg_get_constraintdef(oid) like '%''translate''%')
    or (conrelid = 'public.storage_objects'::regclass and pg_get_constraintdef(oid) like '%''stage_output''%'))
  loop execute format('alter table public.%I drop constraint %I', c.t, c.conname); end loop;
end $$;
alter table public.projects add constraint projects_mode_check check (mode in ('clips','captions','reframe','social','broll','lyrics'));
alter table public.clip_versions add constraint clip_versions_aspect_check check (aspect is null or aspect in ('9:16','16:9','1:1','4:5'));
alter table public.renders add constraint renders_kind_check check (kind in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl','lrc','lrc_word','ass'));
alter table public.job_stages add constraint job_stages_stage_check check (stage in ('validate','mezzanine','proxy','prepare','transcribe','scenes',
  'speakers','candidates','select','compose','previews','checks','render','zip','import','publish','translate','song_validate','lyric_sync','media_split'));
alter table public.storage_objects add constraint storage_objects_kind_check check (kind in ('original','original_part','mezzanine','proxy','audio',
  'thumb','preview','export','zip','sidecar','stage_output','media'));

alter table public.songs add column if not exists source_id uuid;
alter table public.songs add column if not exists status text not null default 'ready' check (status in ('pending','ready','failed'));
alter table public.songs add column if not exists duration_ms bigint check (duration_ms is null or duration_ms between 0 and 600000);
alter table public.songs add column if not exists sample_rate int check (sample_rate is null or sample_rate between 8000 and 192000);
alter table public.songs add column if not exists channels int check (channels is null or channels between 1 and 8);
alter table public.songs add column if not exists loudness_lufs numeric(6,2);
alter table public.songs add column if not exists codec text check (codec is null or char_length(codec) <= 40);
alter table public.songs add column if not exists error_code text;
alter table public.songs add column if not exists demo boolean not null default false;
alter table public.songs add constraint songs_mime_check check (mime in ('audio/mpeg','audio/wav','audio/x-wav','audio/wave')
  or (source_id is not null and mime in ('audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/ogg')));
alter table public.songs add constraint songs_storage_path_check check (storage_path like workspace_id::text || '/songs/%'
  or (source_id is not null and storage_path like workspace_id::text || '/%'));
alter table public.songs add constraint songs_v2_bytes_check check (source_id is null or bytes <= 62914560);
do $$ begin if not exists (select 1 from pg_constraint where conname = 'songs_source_fk') then
  alter table public.songs add constraint songs_source_fk foreign key (workspace_id, source_id) references public.sources(workspace_id, id); end if; end $$;
create unique index if not exists songs_source_uidx on public.songs(source_id) where source_id is not null;

alter table public.song_alignments add column if not exists revision int check (revision is null or revision >= 1);
alter table public.song_alignments add column if not exists kind text not null default 'legacy' check (kind in ('legacy','asr','aligned','proposal','manual'));
alter table public.song_alignments add column if not exists lyrics_text text check (lyrics_text is null or char_length(lyrics_text) <= 20000);
alter table public.song_alignments add column if not exists flags jsonb not null default '[]' check (jsonb_typeof(flags) = 'array');
alter table public.song_alignments add column if not exists created_by uuid;
create unique index if not exists song_alignments_revision_idx on public.song_alignments(song_id, revision) where revision is not null;

alter table public.media_collections add column if not exists purpose text not null default 'backgrounds' check (purpose in ('backgrounds','artwork'));
alter table public.media_collections add column if not exists official boolean not null default false;
alter table public.media_collections add column if not exists mood text check (mood is null or char_length(mood) <= 40);
alter table public.media_items add column if not exists storage_backend text not null default 'supabase' check (storage_backend in ('supabase','r2'));
alter table public.media_items add column if not exists status text not null default 'ready' check (status in ('pending','ready','failed','excluded'));
alter table public.media_items add column if not exists duration_ms bigint check (duration_ms is null or duration_ms between 0 and 3600000);
alter table public.media_items add column if not exists width int check (width is null or width between 16 and 8192);
alter table public.media_items add column if not exists height int check (height is null or height between 16 and 8192);
alter table public.media_items add column if not exists category text check (category is null or category in
  ('ciudad','naturaleza','carretera','lluvia','nostalgia_analogica','abstracto'));
alter table public.media_items add column if not exists motion text check (motion is null or motion in ('estatico','lento','rapido'));
alter table public.media_items add column if not exists mood text check (mood is null or char_length(mood) <= 40);
alter table public.media_items add column if not exists source_id uuid;
alter table public.media_items add column if not exists segment_start_ms bigint;
alter table public.media_items add column if not exists segment_end_ms bigint;
alter table public.media_items add column if not exists cut_mode text check (cut_mode is null or cut_mode in ('rapido','exacto'));
alter table public.media_items add column if not exists audio_muted boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'media_items_ws_id_key') then
    alter table public.media_items add constraint media_items_ws_id_key unique (workspace_id, id); end if;
  if not exists (select 1 from pg_constraint where conname = 'text_styles_ws_id_key') then
    alter table public.text_styles add constraint text_styles_ws_id_key unique (workspace_id, id); end if;
end $$;

create table if not exists public.hook_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  hooks text[] not null check (cardinality(hooks) between 1 and 200),
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, id), unique (workspace_id, name));

create table if not exists public.lyric_projects (
  project_id uuid primary key, workspace_id uuid not null, song_id uuid not null,
  mode text not null default 'letra' check (mode in ('letra','texto','portada')),
  range_start_ms bigint not null default 0 check (range_start_ms >= 0),
  range_end_ms bigint check (range_end_ms is null or range_end_ms > range_start_ms),
  alignment_revision int check (alignment_revision is null or alignment_revision >= 1),
  aspect text not null default '9:16' check (aspect in ('9:16','4:5','1:1','16:9')),
  res int not null default 1080 check (res in (720, 1080)),
  style jsonb check (style is null or pg_column_size(style) < 4096), style_id uuid,
  preset text check (preset is null or preset ~ '^[a-z_]{1,40}$'),
  background jsonb not null default '{}' check (jsonb_typeof(background) = 'object' and pg_column_size(background) < 8192),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 4096),
  collection_ids uuid[] not null default '{}' check (cardinality(collection_ids) <= 10),
  hook_pack_id uuid, hook jsonb, message jsonb, cover jsonb, artwork_front_id uuid, artwork_back_id uuid,
  locks jsonb not null default '{}' check (jsonb_typeof(locks) = 'object'),
  updated_at timestamptz not null default now(), unique (workspace_id, project_id),
  foreign key (workspace_id, project_id) references public.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, song_id) references public.songs(workspace_id, id),
  foreign key (workspace_id, style_id) references public.text_styles(workspace_id, id) on delete set null (style_id),
  foreign key (workspace_id, hook_pack_id) references public.hook_packs(workspace_id, id) on delete set null (hook_pack_id),
  foreign key (workspace_id, artwork_front_id) references public.media_items(workspace_id, id) on delete set null (artwork_front_id),
  foreign key (workspace_id, artwork_back_id) references public.media_items(workspace_id, id) on delete set null (artwork_back_id));

do $$ declare t text; begin
  foreach t in array array['hook_packs','lyric_projects'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('revoke all on public.%1$s from anon, authenticated', t);
    execute format('grant select on public.%1$s to authenticated', t);
  end loop;
end $$;

-- Estilos v2 (rafagaStyle = 2): ≤ 20 por workspace, JSON ≤ 4000 bytes. Los estilos v1 no cuentan ni cambian.
create or replace function public.save_caption_style(p_ws uuid, p_id uuid, p_name text, p_style jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare n int; sid uuid;
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_style) is distinct from 'object' or coalesce(p_style->>'rafagaStyle', '') <> '2' then raise exception 'invalid_style' using errcode = 'P0001'; end if;
  if octet_length(p_style::text) > 4000 then raise exception 'style_too_large' using errcode = 'P0001', detail = '{"limit":4000}'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"name"}'; end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('styles:' || p_ws));
    select count(*) into n from public.text_styles where workspace_id = p_ws and style->>'rafagaStyle' = '2';
    if n >= 20 then raise exception 'style_limit' using errcode = 'P0001', detail = '{"limit":20}'; end if;
    insert into public.text_styles(workspace_id, name, style, created_by) values (p_ws, btrim(p_name), p_style, auth.uid()) returning id into sid;
  else
    update public.text_styles set name = btrim(p_name), style = p_style where id = p_id and workspace_id = p_ws returning id into sid;
    if sid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return sid;
end $$;
create or replace function public.delete_caption_style(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.text_styles where id = p_id and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.save_hook_pack(p_ws uuid, p_id uuid, p_name text, p_hooks text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; h text; clean text[] := '{}';
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  foreach h in array coalesce(p_hooks, '{}') loop
    if char_length(btrim(h)) not between 1 and 120 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"hooks"}'; end if;
    clean := clean || btrim(h);
  end loop;
  if cardinality(clean) not between 1 and 200 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"hooks"}'; end if;
  if p_id is null then
    insert into public.hook_packs(workspace_id, name, hooks) values (p_ws, btrim(p_name), clean) returning id into hid;
  else
    update public.hook_packs set name = btrim(p_name), hooks = clean, updated_at = now() where id = p_id and workspace_id = p_ws returning id into hid;
    if hid is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return hid;
end $$;

-- Pieza nueva sobre una canción v2: proyecto (mode = lyrics, misma fuente) + su fila de letra.
create or replace function public.create_lyric_project(p_song uuid, p_mode text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; pid uuid;
begin
  select id, workspace_id, source_id, title into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.source_id is null then raise exception 'legacy_song' using errcode = 'P0001'; end if;
  if p_mode is null or p_mode not in ('letra','texto','portada') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  insert into public.projects(workspace_id, source_id, name, mode, created_by)
    values (s.workspace_id, s.source_id, left(coalesce(nullif(btrim(p_name), ''), s.title), 120), 'lyrics', auth.uid()) returning id into pid;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (pid, s.workspace_id, p_song, p_mode);
  return pid;
end $$;

-- Parche de la pieza. Cambiar de modo nunca borra letra, alineación ni recursos.
create or replace function public.save_lyric_project(p_project uuid, p_patch jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare lp record; k text; ts timestamptz;
begin
  select * into lp from public.lyric_projects where project_id = p_project;
  if not found or not public.can_edit(lp.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"patch"}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('mode','range_start_ms','range_end_ms','alignment_revision','aspect','res','style','style_id','preset','background','settings',
                 'collection_ids','hook_pack_id','hook','message','cover','artwork_front_id','artwork_back_id','locks') then
      raise exception 'invalid_params' using errcode = 'P0001', detail = json_build_object('field', k)::text; end if;
  end loop;
  if p_patch ? 'mode' and coalesce(p_patch->>'mode', '') not in ('letra','texto','portada') then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  update public.lyric_projects set
    mode = case when p_patch ? 'mode' then p_patch->>'mode' else mode end,
    range_start_ms = case when p_patch ? 'range_start_ms' then (p_patch->>'range_start_ms')::bigint else range_start_ms end,
    range_end_ms = case when p_patch ? 'range_end_ms' then (p_patch->>'range_end_ms')::bigint else range_end_ms end,
    alignment_revision = case when p_patch ? 'alignment_revision' then (p_patch->>'alignment_revision')::int else alignment_revision end,
    aspect = case when p_patch ? 'aspect' then p_patch->>'aspect' else aspect end,
    res = case when p_patch ? 'res' then (p_patch->>'res')::int else res end,
    style = case when p_patch ? 'style' then p_patch->'style' else style end,
    style_id = case when p_patch ? 'style_id' then (p_patch->>'style_id')::uuid else style_id end,
    preset = case when p_patch ? 'preset' then p_patch->>'preset' else preset end,
    background = case when p_patch ? 'background' then p_patch->'background' else background end,
    settings = case when p_patch ? 'settings' then p_patch->'settings' else settings end,
    collection_ids = case when p_patch ? 'collection_ids' then array(select jsonb_array_elements_text(p_patch->'collection_ids'))::uuid[] else collection_ids end,
    hook_pack_id = case when p_patch ? 'hook_pack_id' then (p_patch->>'hook_pack_id')::uuid else hook_pack_id end,
    hook = case when p_patch ? 'hook' then p_patch->'hook' else hook end,
    message = case when p_patch ? 'message' then p_patch->'message' else message end,
    cover = case when p_patch ? 'cover' then p_patch->'cover' else cover end,
    artwork_front_id = case when p_patch ? 'artwork_front_id' then (p_patch->>'artwork_front_id')::uuid else artwork_front_id end,
    artwork_back_id = case when p_patch ? 'artwork_back_id' then (p_patch->>'artwork_back_id')::uuid else artwork_back_id end,
    locks = case when p_patch ? 'locks' then p_patch->'locks' else locks end,
    updated_at = now()
  where project_id = p_project returning updated_at into ts;
  return ts;
end $$;

create or replace function public.create_media_collection(p_ws uuid, p_name text, p_purpose text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_purpose, '') not in ('backgrounds','artwork') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"purpose"}'; end if;
  insert into public.media_collections(workspace_id, name, created_by, purpose) values (p_ws, btrim(p_name), auth.uid(), p_purpose) returning id into cid;
  return cid;
end $$;
-- «Colecciones Ráfaga» = paquetes que el propietario marca como oficiales (el catálogo sale vacío).
create or replace function public.set_collection_official(p_collection uuid, p_official boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.media_collections set official = coalesce(p_official, false) where id = p_collection and public.can_admin(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
create or replace function public.classify_media_item(p_item uuid, p_category text, p_motion text, p_mood text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status is not null and p_status not in ('ready','excluded') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"status"}'; end if;
  update public.media_items set category = p_category, motion = p_motion, mood = nullif(btrim(p_mood), ''), status = coalesce(p_status, status)
   where id = p_item and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.save_caption_style(uuid,uuid,text,jsonb), public.delete_caption_style(uuid), public.save_hook_pack(uuid,uuid,text,text[]),
  public.create_lyric_project(uuid,text,text), public.save_lyric_project(uuid,jsonb), public.create_media_collection(uuid,text,text),
  public.set_collection_official(uuid,boolean), public.classify_media_item(uuid,text,text,text,text) from public, anon;
grant execute on function public.save_caption_style(uuid,uuid,text,jsonb), public.delete_caption_style(uuid), public.save_hook_pack(uuid,uuid,text,text[]),
  public.create_lyric_project(uuid,text,text), public.save_lyric_project(uuid,jsonb), public.create_media_collection(uuid,text,text),
  public.set_collection_official(uuid,boolean), public.classify_media_item(uuid,text,text,text,text) to authenticated;
```

#### 101 — `supabase/migrations/20261201000101_lyric_songs.sql` (paso 2)
```sql
-- Canciones v2 con el cargador compartido (paso 2). Aditiva; recrea complete_upload (037) copiando su cuerpo y
-- añadiendo solo la rama de audio. Mismo contrato y mismos errores.
create or replace function public.register_song(p_upload uuid, p_title text, p_artist text, p_lyrics text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u record; sid uuid; m text;
begin
  select * into u from public.upload_sessions where id = p_upload;
  if not found or u.created_by <> auth.uid() then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id into sid from public.songs where source_id = u.source_id;
  if found then return jsonb_build_object('song_id', sid, 'project_id', u.project_id, 'replay', true); end if;
  select mime into m from public.sources where id = u.source_id;
  if m is null or m not in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/mp4','audio/x-m4a','audio/aac',
                            'audio/flac','audio/x-flac','audio/ogg') then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if u.bytes > 62914560 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":62914560}'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"title"}'; end if;
  insert into public.songs(workspace_id, title, artist, storage_path, mime, bytes, lyrics_text, created_by, source_id, status)
    values (u.workspace_id, btrim(p_title), nullif(btrim(coalesce(p_artist, '')), ''), u.object_key, m, u.bytes, nullif(p_lyrics, ''), auth.uid(), u.source_id, 'pending')
    returning id into sid;
  update public.projects set mode = 'lyrics', name = left(btrim(p_title), 120) where id = u.project_id;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (u.project_id, u.workspace_id, sid, 'letra') on conflict (project_id) do nothing;
  return jsonb_build_object('song_id', sid, 'project_id', u.project_id, 'replay', false);
end $$;

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
  if coalesce((select mime from public.sources where id = u.source_id), '') like 'audio/%' then   -- canción: una sola etapa
    r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
           jsonb_build_object('stage','song_validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
         'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  else
    r := public.enqueue_job(u.workspace_id, 'ingest', jsonb_build_array(
           jsonb_build_object('stage','validate','seq',1,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
           jsonb_build_object('stage','mezzanine','seq',2,'units',0,'params', jsonb_build_object('source_id', u.source_id)),
           jsonb_build_object('stage','proxy','seq',3,'units',0,'params', jsonb_build_object('source_id', u.source_id))),
         'upload:' || p_upload, jsonb_build_object('source_id', u.source_id), u.project_id, null);
  end if;
  update public.upload_sessions set job_id = (r->>'job_id')::uuid where id = p_upload;
  select p.id into dup from public.sources s join public.projects p on p.source_id = s.id
   where s.workspace_id = u.workspace_id and s.sha256 = p_sha256 and s.id <> u.source_id and p.deleted_at is null limit 1;
  return jsonb_build_object('job_id', r->>'job_id', 'duplicate_of_project', dup);
end $$;

create or replace function public.song_by_source(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('song_id', s.id, 'workspace_id', s.workspace_id, 'source_id', s.source_id, 'key', s.storage_path,
    'mime', s.mime, 'bytes', s.bytes, 'demo', s.demo, 'title', s.title)
  from public.songs s where s.source_id = p_source $$;

create or replace function public.finish_song_validate(p_song uuid, p_status text, p_bytes bigint, p_duration_ms bigint, p_sample_rate int,
  p_channels int, p_lufs numeric, p_codec text, p_lyrics text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select id, source_id, lyrics_text into s from public.songs where id = p_song for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status not in ('ready','failed') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  update public.songs set status = p_status, bytes = coalesce(p_bytes, bytes), duration_ms = coalesce(p_duration_ms, duration_ms),
         sample_rate = coalesce(p_sample_rate, sample_rate), channels = coalesce(p_channels, channels), loudness_lufs = coalesce(p_lufs, loudness_lufs),
         codec = coalesce(p_codec, codec), error_code = p_error, lyrics_text = coalesce(s.lyrics_text, p_lyrics) where id = p_song;
  update public.sources set status = case when p_status = 'ready' then 'validated' else 'failed' end,
         duration_ms = coalesce(p_duration_ms, duration_ms), has_audio = (p_status = 'ready'), bytes = coalesce(p_bytes, bytes) where id = s.source_id;
end $$;

create or replace function public.song_object(p_song uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select id, workspace_id, storage_path, status, source_id, duration_ms into s from public.songs where id = p_song;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', s.storage_path, 'status', s.status, 'backend', case when s.source_id is null then 'supabase' else 'r2' end,
    'duration_ms', s.duration_ms);
end $$;

-- Demo: copia al abrir. Cada llamada crea su propia canción, fuente y pieza; el ejemplo compartido es la constante DEMO_SONG.
create or replace function public.open_lyric_demo(p_ws uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid uuid := gen_random_uuid(); song uuid; pid uuid; r jsonb; prev record; k text;
begin
  p_ws := coalesce(p_ws, (select active_workspace_id from public.profiles where id = auth.uid()),
                   (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'owner' limit 1));
  if p_ws is null or not public.can_edit(p_ws) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 120 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  select id, params into prev from public.jobs where workspace_id = p_ws and idempotency_key = 'demo:' || p_idem;
  if found then return jsonb_build_object('job_id', prev.id, 'song_id', prev.params->>'song_id', 'project_id', prev.params->>'project_id', 'replay', true); end if;
  k := p_ws || '/' || sid || '/original';
  insert into public.sources(id, workspace_id, kind, storage_path, status, mime, storage_backend, created_by)
    values (sid, p_ws, 'upload', k, 'uploaded', 'audio/mp4', 'r2', auth.uid());
  insert into public.songs(workspace_id, title, artist, storage_path, mime, bytes, created_by, source_id, status, demo)
    values (p_ws, 'Canción de demostración', 'Ráfaga', k, 'audio/mp4', 1, auth.uid(), sid, 'pending', true) returning id into song;
  insert into public.projects(workspace_id, source_id, name, mode, created_by) values (p_ws, sid, 'Demo · Canción de demostración', 'lyrics', auth.uid()) returning id into pid;
  insert into public.lyric_projects(project_id, workspace_id, song_id, mode) values (pid, p_ws, song, 'letra');
  r := public.enqueue_job(p_ws, 'ingest', jsonb_build_array(jsonb_build_object('stage','song_validate','seq',1,'units',0,
         'params', jsonb_build_object('source_id', sid, 'demo', true))), 'demo:' || p_idem,
       jsonb_build_object('source_id', sid, 'song_id', song, 'project_id', pid), pid, null);
  return jsonb_build_object('job_id', r->>'job_id', 'song_id', song, 'project_id', pid, 'replay', false);
end $$;

revoke all on function public.register_song(uuid,text,text,text), public.song_by_source(uuid),
  public.finish_song_validate(uuid,text,bigint,bigint,int,int,numeric,text,text,text), public.song_object(uuid), public.open_lyric_demo(uuid,text)
  from public, anon, authenticated;
grant execute on function public.register_song(uuid,text,text,text), public.song_object(uuid), public.open_lyric_demo(uuid,text) to authenticated;
grant execute on function public.song_by_source(uuid), public.finish_song_validate(uuid,text,bigint,bigint,int,int,numeric,text,text,text) to service_role;
grant execute on function public.complete_upload(uuid,text) to authenticated;
```

#### 102 — `supabase/migrations/20261201000102_lyric_sync.sql` (paso 5)
```sql
-- Sincronización v2 (paso 5). Aditiva. Revisiones en song_alignments: clave 'v2:r<n>'; ASR en caché: clave 'asr:<modelo>'.
-- Unidades: 1 por minuto de canción solo si hay que llamar al ASR; con ASR en caché, 0.
create or replace function public.request_lyric_sync(p_song uuid, p_mode text, p_hints jsonb, p_model text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; cached boolean; units numeric(10,2); r jsonb;
begin
  select * into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.source_id is null then raise exception 'legacy_song' using errcode = 'P0001'; end if;
  if s.status <> 'ready' then raise exception 'song_not_ready' using errcode = 'P0001'; end if;
  if coalesce(p_mode, '') not in ('align','transcribe') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"mode"}'; end if;
  if p_mode = 'align' and coalesce(btrim(s.lyrics_text), '') = '' then raise exception 'lyrics_required' using errcode = 'P0001'; end if;
  if p_hints is not null and (jsonb_typeof(p_hints) <> 'array' or pg_column_size(p_hints) > 6000) then raise exception 'hints_too_large' using errcode = 'P0001'; end if;
  cached := exists (select 1 from public.song_alignments where song_id = p_song and kind = 'asr' and lyrics_sha256 = 'asr:' || p_model);
  units := case when cached then 0 else greatest(0.01, round(s.duration_ms / 60000.0, 2)) end;
  r := public.enqueue_job(s.workspace_id, 'lyrics', jsonb_build_array(jsonb_build_object('stage','lyric_sync','seq',1,'units', units,
         'params', jsonb_build_object('song_id', p_song, 'mode', p_mode, 'model', p_model, 'hints', coalesce(p_hints, '[]'::jsonb)))),
       p_idem, jsonb_build_object('song_id', p_song, 'source_minutes', round(s.duration_ms / 60000.0, 2)), null, null,
       md5(p_song::text || '|' || p_mode || '|' || p_model || '|' || coalesce(p_hints::text, '')));
  return jsonb_build_object('job_id', r->>'job_id', 'units_reserved', (r->>'units_reserved')::numeric, 'cached', cached,
    'replay', coalesce((r->>'replay')::boolean, false));
end $$;

create or replace function public.lyric_sync_context(p_song uuid, p_model text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('song_id', s.id, 'workspace_id', s.workspace_id, 'source_id', s.source_id, 'key', s.storage_path,
    'audio_key', s.workspace_id || '/' || s.source_id || '/audio.opus', 'lyrics_text', s.lyrics_text, 'language', s.language,
    'duration_ms', s.duration_ms,
    'asr', (select a.words from public.song_alignments a where a.song_id = s.id and a.kind = 'asr' and a.lyrics_sha256 = 'asr:' || p_model),
    'latest', (select jsonb_build_object('revision', a.revision, 'kind', a.kind, 'words', a.words) from public.song_alignments a
               where a.song_id = s.id and a.revision is not null order by a.revision desc limit 1))
  from public.songs s where s.id = p_song $$;

create or replace function public.save_song_asr(p_song uuid, p_model text, p_words jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, kind)
  select s.workspace_id, s.id, 'asr:' || p_model, p_words, jsonb_array_length(p_words), 'asr' from public.songs s where s.id = p_song
  on conflict (song_id, lyrics_sha256) do nothing $$;

-- Nueva revisión. Usuario: solo kind 'manual' y base obligatoria. Worker (sin auth.uid): 'aligned' o 'proposal', sin base.
create or replace function public.save_song_alignment(p_song uuid, p_base_revision int, p_words jsonb, p_kind text, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; cur int; w jsonb; prev numeric := -1; st numeric; en numeric; n int;
begin
  select id, workspace_id, lyrics_text into s from public.songs where id = p_song;
  if not found or (auth.uid() is not null and not public.can_edit(s.workspace_id)) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_kind, '') not in ('aligned','proposal','manual') or (auth.uid() is not null and p_kind <> 'manual') then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"kind"}'; end if;
  if jsonb_typeof(p_words) is distinct from 'array' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  n := jsonb_array_length(p_words);
  if n = 0 or n > 4000 then raise exception 'invalid_words' using errcode = 'P0001'; end if;
  for w in select value from jsonb_array_elements(p_words) loop
    if jsonb_typeof(w->'start') <> 'number' or jsonb_typeof(w->'end') <> 'number' then raise exception 'invalid_words' using errcode = 'P0001'; end if;
    st := (w->>'start')::numeric; en := (w->>'end')::numeric;
    if st < 0 or en <= st or st < prev or coalesce(char_length(w->>'text'), 0) not between 1 and 80 then raise exception 'invalid_words' using errcode = 'P0001'; end if;
    prev := st;
  end loop;
  perform pg_advisory_xact_lock(hashtext('align:' || p_song));
  select coalesce(max(revision), 0) into cur from public.song_alignments where song_id = p_song and revision is not null;
  if auth.uid() is not null and p_base_revision is distinct from cur then return jsonb_build_object('conflict', true, 'current_revision', cur); end if;
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, revision, kind, lyrics_text, flags, created_by)
    values (s.workspace_id, p_song, 'v2:r' || (cur + 1), p_words, 0, cur + 1, p_kind,
            case when p_kind = 'proposal' then null else s.lyrics_text end, coalesce(p_flags, '[]'::jsonb), auth.uid());
  return jsonb_build_object('revision', cur + 1);
end $$;

create or replace function public.restore_original_alignment(p_song uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; o record; cur int;
begin
  select id, workspace_id, lyrics_text into s from public.songs where id = p_song;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select words, flags into o from public.song_alignments where song_id = p_song and kind = 'aligned' and revision is not null order by revision asc limit 1;
  if not found then raise exception 'no_original' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('align:' || p_song));
  select coalesce(max(revision), 0) into cur from public.song_alignments where song_id = p_song and revision is not null;
  insert into public.song_alignments(workspace_id, song_id, lyrics_sha256, words, asr_words, revision, kind, lyrics_text, flags, created_by)
    values (s.workspace_id, p_song, 'v2:r' || (cur + 1), o.words, 0, cur + 1, 'aligned', s.lyrics_text, o.flags, auth.uid());
  return jsonb_build_object('revision', cur + 1);
end $$;

create or replace function public.song_alignment(p_song uuid, p_revision int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s record; a record;
begin
  select id, workspace_id into s from public.songs where id = p_song;
  if not found or not public.is_member(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select revision, kind, words, flags, created_at into a from public.song_alignments
   where song_id = p_song and revision is not null and (p_revision is null or revision = p_revision) order by revision desc limit 1;
  if not found then return jsonb_build_object('revision', null, 'words', '[]'::jsonb); end if;
  return jsonb_build_object('revision', a.revision, 'kind', a.kind, 'words', a.words, 'flags', a.flags, 'created_at', a.created_at);
end $$;

create or replace function public.set_song_lyrics(p_song uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(p_text, '')) > 20000 then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"lyrics_text"}'; end if;
  update public.songs set lyrics_text = nullif(p_text, '') where id = p_song and public.can_edit(workspace_id);
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

revoke all on function public.request_lyric_sync(uuid,text,jsonb,text,text), public.lyric_sync_context(uuid,text), public.save_song_asr(uuid,text,jsonb),
  public.save_song_alignment(uuid,int,jsonb,text,jsonb), public.restore_original_alignment(uuid), public.song_alignment(uuid,int),
  public.set_song_lyrics(uuid,text) from public, anon, authenticated;
grant execute on function public.request_lyric_sync(uuid,text,jsonb,text,text), public.save_song_alignment(uuid,int,jsonb,text,jsonb),
  public.restore_original_alignment(uuid), public.song_alignment(uuid,int), public.set_song_lyrics(uuid,text) to authenticated;
grant execute on function public.lyric_sync_context(uuid,text), public.save_song_asr(uuid,text,jsonb), public.save_song_alignment(uuid,int,jsonb,text,jsonb) to service_role;
```

#### 103 — `supabase/migrations/20261201000103_lyric_media.sql` (paso 12)
```sql
-- Paquetes de medios en R2 y «Crear desde vídeo» (paso 12). Aditiva.
create or replace function public.create_media_item(p_collection uuid, p_name text, p_kind text, p_mime text, p_bytes bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; iid uuid := gen_random_uuid(); used bigint; ext text;
begin
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or not public.can_edit(c.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_kind, '') not in ('video','photo') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"kind"}'; end if;
  ext := case p_mime when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' when 'image/jpeg' then 'jpg'
                     when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if ext is null then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 209715200 then raise exception 'file_too_large' using errcode = 'P0001', detail = '{"limit":209715200}'; end if;
  used := public.storage_used(c.workspace_id);
  if used + p_bytes > 10737418240 then raise exception 'quota_exceeded' using errcode = 'P0001', detail = json_build_object('quota', 10737418240, 'used', used)::text; end if;
  insert into public.media_items(id, workspace_id, collection_id, kind, name, storage_path, mime, bytes, created_by, storage_backend, status)
    values (iid, c.workspace_id, p_collection, p_kind, left(coalesce(nullif(btrim(p_name), ''), 'Elemento'), 120),
            c.workspace_id || '/media/' || iid || '.' || ext, p_mime, p_bytes, auth.uid(), 'r2', 'pending');
  return jsonb_build_object('item_id', iid, 'key', c.workspace_id || '/media/' || iid || '.' || ext);
end $$;
create or replace function public.complete_media_item(p_item uuid, p_duration_ms bigint, p_width int, p_height int) returns text
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  select * into i from public.media_items where id = p_item for update;
  if not found or not public.can_edit(i.workspace_id) or i.storage_backend <> 'r2' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.media_items set status = 'ready', duration_ms = p_duration_ms, width = p_width, height = p_height where id = p_item;
  insert into public.storage_objects(workspace_id, key, bytes, kind) values (i.workspace_id, i.storage_path, i.bytes, 'media')
    on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
  return 'ready';
end $$;
create or replace function public.media_item_object(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i record;
begin
  select id, workspace_id, storage_path, storage_backend, status, kind into i from public.media_items where id = p_item;
  if not found or not public.is_member(i.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('key', i.storage_path, 'backend', i.storage_backend, 'status', i.status, 'kind', i.kind);
end $$;

-- p_params = {start_ms, end_ms, length_s ∈ 3|5|10|15|30, min_s, max_s}. Propone segmentos (sin cortar nada).
create or replace function public.request_media_split(p_source uuid, p_collection uuid, p_params jsonb, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; c record; r jsonb; a bigint; b bigint;
begin
  select id, workspace_id, status, duration_ms, width into s from public.sources where id = p_source;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or c.workspace_id <> s.workspace_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  if s.status <> 'validated' then raise exception 'source_not_ready' using errcode = 'P0001'; end if;
  if s.width is null then raise exception 'unsupported_file' using errcode = 'P0001'; end if;
  if coalesce((p_params->>'length_s')::int, 0) not in (3,5,10,15,30) then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"length_s"}'; end if;
  a := coalesce((p_params->>'start_ms')::bigint, 0); b := coalesce((p_params->>'end_ms')::bigint, s.duration_ms);
  if a < 0 or b <= a or b > s.duration_ms then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"end_ms"}'; end if;
  r := public.enqueue_job(s.workspace_id, 'ingest', jsonb_build_array(jsonb_build_object('stage','media_split','seq',1,'units',0,
         'params', p_params || jsonb_build_object('mode','propose','source_id', p_source, 'collection_id', p_collection, 'start_ms', a, 'end_ms', b))),
       p_idem, jsonb_build_object('source_id', p_source), null, null);
  return jsonb_build_object('job_id', r->>'job_id', 'replay', coalesce((r->>'replay')::boolean, false));
end $$;
-- p_segments = [{start_ms, end_ms}] (1–60), los revisados; p_cut_mode: 'rapido' (copia de flujo) | 'exacto' (recodifica).
create or replace function public.request_media_cut(p_source uuid, p_collection uuid, p_segments jsonb, p_cut_mode text, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; c record; g jsonb; r jsonb;
begin
  select id, workspace_id, status, duration_ms into s from public.sources where id = p_source;
  if not found or not public.can_edit(s.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found or c.workspace_id <> s.workspace_id then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(p_cut_mode, '') not in ('rapido','exacto') then raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"cut_mode"}'; end if;
  if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_array_length(p_segments) not between 1 and 60 then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"segments"}'; end if;
  for g in select * from jsonb_array_elements(p_segments) loop
    if (g->>'start_ms')::bigint < 0 or (g->>'end_ms')::bigint <= (g->>'start_ms')::bigint or (g->>'end_ms')::bigint > s.duration_ms then
      raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"segments"}'; end if;
  end loop;
  r := public.enqueue_job(s.workspace_id, 'ingest', jsonb_build_array(jsonb_build_object('stage','media_split','seq',1,'units',0,
         'params', jsonb_build_object('mode','cut','source_id', p_source, 'collection_id', p_collection, 'segments', p_segments, 'cut_mode', p_cut_mode))),
       p_idem, jsonb_build_object('source_id', p_source), null, null);
  return jsonb_build_object('job_id', r->>'job_id', 'replay', coalesce((r->>'replay')::boolean, false));
end $$;
create or replace function public.media_split_context(p_source uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('source_id', s.id, 'workspace_id', s.workspace_id, 'key', s.storage_path, 'duration_ms', s.duration_ms, 'created_by', s.created_by)
  from public.sources s where s.id = p_source $$;
create or replace function public.add_split_item(p_collection uuid, p_source uuid, p_item uuid, p_start_ms bigint, p_end_ms bigint, p_cut_mode text,
  p_key text, p_bytes bigint, p_duration_ms bigint, p_width int, p_height int, p_created_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, workspace_id into c from public.media_collections where id = p_collection;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_key not like c.workspace_id::text || '/media/%' then raise exception 'invalid_path' using errcode = 'P0001'; end if;
  insert into public.media_items(id, workspace_id, collection_id, kind, name, storage_path, mime, bytes, created_by, storage_backend, status,
                                 duration_ms, width, height, source_id, segment_start_ms, segment_end_ms, cut_mode, audio_muted)
    values (p_item, c.workspace_id, p_collection, 'video', 'Segmento ' || round(p_start_ms / 1000.0, 1) || ' s', p_key, 'video/mp4', p_bytes, p_created_by,
            'r2', 'ready', p_duration_ms, p_width, p_height, p_source, p_start_ms, p_end_ms, p_cut_mode, true) on conflict (id) do nothing;
  insert into public.storage_objects(workspace_id, key, bytes, kind, source_id) values (c.workspace_id, p_key, p_bytes, 'media', p_source)
    on conflict (key) do update set bytes = excluded.bytes, purged_at = null;
end $$;

revoke all on function public.create_media_item(uuid,text,text,text,bigint), public.complete_media_item(uuid,bigint,int,int), public.media_item_object(uuid),
  public.request_media_split(uuid,uuid,jsonb,text), public.request_media_cut(uuid,uuid,jsonb,text,text), public.media_split_context(uuid),
  public.add_split_item(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,int,int,uuid) from public, anon, authenticated;
grant execute on function public.create_media_item(uuid,text,text,text,bigint), public.complete_media_item(uuid,bigint,int,int), public.media_item_object(uuid),
  public.request_media_split(uuid,uuid,jsonb,text), public.request_media_cut(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function public.media_split_context(uuid), public.add_split_item(uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,int,int,uuid),
  public.media_item_object(uuid) to service_role;
```

#### 104 — `supabase/migrations/20261201000104_lyric_variants.sql` (paso 15)
```sql
-- Variantes de letra (paso 15). Aditiva. request_exports se recrea copiando LITERALMENTE su cuerpo de
-- 20261113000041_exports.sql y cambiando solo la línea de validación de tipo y formato por:
--   if k not in ('mp4','srt','vtt','txt','fcpxml','xmeml','edl','lrc','lrc_word','ass') or asp not in ('9:16','1:1','16:9','4:5') then
-- (mismo nombre, firma, revoke y grant). Las variantes no consumen unidades (render en Modal con el medidor compartido).
create or replace function public.request_lyric_variants(p_project uuid, p_variants jsonb, p_zip boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lp record; gid uuid; tid uuid; prev uuid; v jsonb; i int := 0; a int; b int; cid uuid; items jsonb := '[]'::jsonb;
        ids uuid[] := '{}'; hashes text[] := '{}'; warn jsonb := '[]'::jsonb; r jsonb; resp jsonb;
begin
  select l.*, p.source_id, s.title as song_title into lp from public.lyric_projects l
    join public.projects p on p.id = l.project_id join public.songs s on s.id = l.song_id
   where l.project_id = p_project and p.deleted_at is null;
  if not found or not public.can_edit(lp.workspace_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_idem is null or char_length(p_idem) not between 8 and 120 then raise exception 'bad_idempotency_key' using errcode = 'P0001'; end if;
  select id into prev from public.generations where workspace_id = lp.workspace_id and project_id = p_project and params->>'idempotency_key' = p_idem;
  if prev is not null then return (select params->'response' from public.generations where id = prev) || jsonb_build_object('replay', true); end if;
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) not between 1 and 10 then
    raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"variants"}'; end if;
  for v in select * from jsonb_array_elements(p_variants) loop
    if coalesce(v->>'kind', '') <> 'lyric' or pg_column_size(v) > 200000 or coalesce(v->>'aspect', '') not in ('9:16','4:5','1:1','16:9') then
      raise exception 'invalid_params' using errcode = 'P0001', detail = '{"field":"variants"}'; end if;
  end loop;
  insert into public.transcripts(workspace_id, source_id, words) values (lp.workspace_id, lp.source_id, coalesce(p_variants->0->'words', '[]'::jsonb)) returning id into tid;
  insert into public.generations(workspace_id, project_id, transcript_id, rubric_version, model, params, requested_count, component_versions)
    values (lp.workspace_id, p_project, tid, 'lyric-v2', 'n/a', jsonb_build_object('kind','lyric','idempotency_key', p_idem, 'n', jsonb_array_length(p_variants)),
            jsonb_array_length(p_variants), '{"lyric_engine":"1"}') returning id into gid;
  for v in select * from jsonb_array_elements(p_variants) loop
    i := i + 1;
    insert into public.clips(workspace_id, project_id, generation_id, title) values (lp.workspace_id, p_project, gid, left(lp.song_title || ' · #' || i, 160)) returning id into cid;
    insert into public.clip_versions(clip_id, workspace_id, version, composition, aspect, template, created_by)
      values (cid, lp.workspace_id, 1, v, v->>'aspect', 'lyric_' || coalesce(v->>'mode', 'letra'), auth.uid());
    ids := ids || cid; hashes := hashes || coalesce(v->>'variant_hash', md5(v::text));
    items := items || jsonb_build_array(jsonb_build_object('clip_id', cid, 'version', 1, 'aspect', v->>'aspect', 'burn_subtitles', true, 'kind', 'mp4'));
  end loop;
  for a in 1 .. i loop for b in a + 1 .. i loop
    if hashes[a] = hashes[b] then warn := warn || jsonb_build_array(jsonb_build_object('code', 'near_duplicate', 'variants', jsonb_build_array(a, b))); end if;
  end loop; end loop;
  r := public.request_exports(items, coalesce(p_zip, false), p_idem);
  resp := jsonb_build_object('generation_id', gid, 'clip_ids', to_jsonb(ids), 'export_ids', r->'export_ids', 'batch_id', r->'batch_id',
                             'job_id', r->'job_id', 'warnings', warn);
  update public.generations set warnings = warn, delivered_count = i, params = params || jsonb_build_object('response', resp) where id = gid;
  return resp || jsonb_build_object('replay', false);
end $$;
revoke all on function public.request_lyric_variants(uuid,jsonb,boolean,text) from public, anon;
grant execute on function public.request_lyric_variants(uuid,jsonb,boolean,text) to authenticated;
```

### Migraciones
Archivos aditivos, uno por paso con esquema (100 en el paso 1, 101 en el 2, 102 en el 5, 103 en el 12, 104 en el 15).
Durante la construcción ninguno está aplicado en producción: solo el paso que crea una migración la edita. Verificación
local con PGlite (`freshDb()`, glob ordenado). Producción: el propietario aplica 100→104 en el editor SQL después de
034→042 (LC-L1). Todas son compatibles con el código v1.

### Datos semilla
Sin semilla de producción. La demo no es semilla: `DEMO_SONG` (constante en `packages/lyrics/src/sync.ts`) y su audio
sintético se crean en el workspace del usuario al abrirla (`open_lyric_demo`).

---

## 5. Diseño de la API

### Convenciones
Las de clipping v2 (§5 de su blueprint): `/api/*`, `Authorization: Bearer <JWT>`, sobre de error
`{ "error": { "code", "message" } }` + campos extra al mismo nivel, `Idempotency-Key` (8–120 imprimibles) en todo POST que
crea trabajo o sesión, firmas de R2 solo tras una RPC como el usuario, `dynamic = "force-dynamic"`. Validación a mano en
`apps/web/lib/routes/lyrics.ts`. **Códigos propios de letra** (mapa `LYRIC_ERRORS` dentro de `routes/lyrics.ts`, antes de
caer en `mapDbError`, para no editar `api.ts`): `legacy_song` 409 · `song_not_ready` 409 · `lyrics_required` 409 ·
`no_original` 409 · `invalid_words` 400 · `invalid_params` 400 (+`field`) · `invalid_style` 400 · `style_too_large` 413
(+`limit`) · `style_limit` 409 (+`limit`) · `hints_too_large` 413 · `file_too_large` 413 (+`limit`) · `unsupported_file` 415 ·
`quota_exceeded` 507 (+`quota`) · `missing_idempotency_key` 400 · `not_found` 404 · `no_session` 401.

### Rutas
| Método | Ruta | Contrato | Auth | Paso |
|---|---|---|---|---|
| POST | `/api/lyrics/songs` | `{upload_id, title, artist?, lyrics_text?}` → 201 `{song_id, project_id}` (repetida: mismos ids, 200) · 413 · 415 | editor | 3 |
| GET | `/api/lyrics/songs/:id/audio` | `{url, expires_at}` (GET R2, 3600 s) · 404 · 409 `legacy_song` | miembro | 3 |
| POST | `/api/lyrics/projects` | `{song_id, mode, name?}` → 201 `{project_id}` | editor | 3 |
| PUT | `/api/lyrics/projects/:id` | parche (claves de `save_lyric_project`) → `{saved_at}` | editor | 3 |
| PUT | `/api/lyrics/songs/:id/lyrics` | `{lyrics_text}` → `{saved: true}` | editor | 5 |
| POST | `/api/lyrics/songs/:id/sync` | `{mode: "align"\|"transcribe", hints?}` + clave → 202 `{job_id, units_reserved, cached}` · 402 · 409 | editor | 5 |
| GET | `/api/lyrics/songs/:id/alignment?revision=` | `{revision, kind, words, flags}` | miembro | 5 |
| PUT | `/api/lyrics/songs/:id/alignment` | `{base_revision, words}` → 201 `{revision}` · 409 `{conflict: {current_revision}}` · 400 | editor | 5 |
| POST | `/api/lyrics/songs/:id/alignment/restore` | 201 `{revision}` · 409 `no_original` | editor | 5 |
| POST | `/api/lyrics/media/items` | `{collection_id, name, kind, mime, bytes}` → 201 `{item_id, url, expires_at}` (PUT R2 900 s) · 413 · 507 | editor | 12 |
| POST | `/api/lyrics/media/items/:id/complete` | `{duration_ms, width, height}` → `{status: "ready"}` | editor | 12 |
| GET | `/api/lyrics/media/items/:id/url` | `{url, expires_at}` (GET R2, 3600 s) | miembro | 12 |
| POST | `/api/lyrics/media/split` | `{source_id, collection_id, start_ms, end_ms, length_s, min_s, max_s}` + clave → 202 `{job_id}` | editor | 12 |
| POST | `/api/lyrics/media/cut` | `{source_id, collection_id, segments[{start_ms,end_ms}], cut_mode}` + clave → 202 `{job_id}` | editor | 12 |
| POST | `/api/lyrics/demo` | clave → 202 `{song_id, project_id, job_id}` | editor | 12 |
| POST | `/api/lyrics/projects/:id/variants` | `{variants[], zip?}` + clave → 202 `{generation_id, clip_ids, export_ids, batch_id, job_id, warnings}` | editor | 15 |
| (existente) | `/api/uploads`, `/api/exports`, `/api/exports/:id/{retry,renew,url}`, `/api/publish`, `/api/jobs/:id/cancel`, `/api/wake` | sin cambios | — | — |

Toda ruta que crea trabajo llama después a `/api/wake` sin esperar (dependencia inyectable `wake`, como `routes/exports.ts`).

### Endpoints críticos
- **`POST /api/lyrics/songs`** — `register_song` como el usuario; la UI lo llama tras `POST /api/uploads` y **antes** de
  subir las partes, así `song_validate` encuentra la canción por `source_id`.
- **`POST /api/lyrics/songs/:id/sync`** — `request_lyric_sync` con `model = "whisper-large-v3-turbo"`; 402 por
  `mapDbError` (`insufficient_units`); con ASR en caché no reserva nada.
- **`PUT /api/lyrics/songs/:id/alignment`** — valida en la ruta que cada palabra tenga `text` (1–80), `start`/`end`
  numéricos crecientes, `line` entero ≥ 0 y `manual` booleano; después `save_song_alignment(kind = 'manual')`.
- **`POST /api/lyrics/projects/:id/variants`** — `request_lyric_variants`; las composiciones las planifica el cliente con
  `planLyricVariants` (puro, `@rafaga/composition`) y el servidor solo las valida y fija como versiones inmutables.

### Delta
Nuevas todas las rutas `/api/lyrics/*`. Ninguna ruta existente cambia.

### Interfaces que se mantienen constantes
| Interfaz | Contrato | Prueba |
|---|---|---|
| `request_lyrics`, `save_manual_alignment`, trabajos `lyrics` `engine = 'v1'` | iguales; `claim_job` los sigue entregando | `lyric_v2.test.ts` |
| Página v1 de Lyric Studio | intacta con `NEXT_PUBLIC_LYRIC_VERSION` ≠ `v2` | grep de `request_lyrics` (paso 18) |
| `complete_upload` | mismo retorno; vídeo → `validate`/`mezzanine`/`proxy` | `lyric_song.test.ts`, `uploads.test.ts` |
| `request_exports` | mismo contrato; acepta además `4:5`, `lrc`, `lrc_word`, `ass` | `exports.test.ts`, `lyrics.test.ts` |
| `FILTERS`, `LOOKS`, `lyricFfmpegArgs`, `lookFfmpegArgs` | sin cambios | `lyric_render.test.ts`, `lyriccutover.test.ts` |

---

## 6. Arquitectura de frontend

| Ruta | Pantalla | Paso |
|---|---|---|
| `/app/lyric-studio` | con `NEXT_PUBLIC_LYRIC_VERSION === "v2"`: `LyricStudioV2` (Canción → Letra y sincronización → Estilo → Fondo y ajustes → Variantes → Resultados) y la biblioteca con pestañas **Mis vídeos, Mis canciones, Paquetes de ganchos, Paquetes de medios, Estilos de texto, Portadas**; si no, la página v1 actual | 3, 6, 10, 11, 13, 15, 18 |
| `/app/style-studio` | con la bandera v2: `CaptionStyleEditor` (9 controles, presets por comportamiento, Sorpréndeme, A/B, ≤ 20 guardados, «Looks clásicos»); si no, la v1 | 9, 18 |
| `/app/nuevo` (clipping) | `CreationPanel` usa el mismo `CaptionStyleEditor` y guarda `params.caption_style` como `SubtitleStyle` vía `captionToSubtitleStyle` | 9 |

**`LyricStudioV2`** (cliente): subida con `runUpload`/`httpApi` de `apps/web/lib/uploader.ts` → tarjeta de validación
(duración, frecuencia, canales, sonoridad LUFS, estado) → letra (pegar, importar TXT/LRC/SRT con `importLyrics`; las marcas
de tiempo se usan como pistas) → «Sincronizar letra» (alineación) o «Proponer letra del canto» (transcripción, propuesta que
el usuario acepta o descarta; nunca sustituye la letra en silencio) → `LyricSyncEditor` (palabras dudosas resaltadas,
mantener para marcar, 0.5×/0.75×, desplazar/redimensionar en la línea de tiempo, insertar/borrar, deshacer, «Restaurar
sincronización original») → estilo → `LyricPreview` (arrastrar la letra, recorte, bucle/reiniciar/otra variante, A/B con el
mismo cabezal, zonas seguras, pantalla completa) → `LyricSettings` → variantes con candados → `LyricResults`.
**Estado:** solo de filas y del estado puro de `synceditor.ts`/`lyricpreview.ts`/`lyricsettings.ts`; Realtime de `jobs` y
`renders` dispara relecturas. **Estados:** vacío, cargando, disponible, parcial, sin permiso y error en cada lista; botones
desactivados en vuelo. Limitación explicada en la UI: con voces superpuestas o coros, la alineación puede fallar; se marca
para revisión.

---

## 7. Sistema de diseño

NOT APPLICABLE — el propietario excluyó cambios de colores, fuentes y estilo de la interfaz; se reutilizan
`apps/web/components/ui/` y el tema existente. Ningún paso toma un contrato de esta sección. Las fuentes y estilos de
**letra** son contenido del vídeo, no interfaz: su esquema está en `packages/composition/src/style.ts` (paso 8) y su
catálogo en `packages/composition/src/fontcatalog.ts` (paso 7).

---

## 8. Autenticación y autorización

Supabase Auth existente, sin cambios. Rutas nuevas: `sessionUser(req)` + RPC con el mismo JWT (`rpc` de `api.ts`).

| Superficie | Regla | Dónde |
|---|---|---|
| `/api/lyrics/*` | sesión; permisos en RPC (`can_edit`/`is_member`) | `routes/lyrics.ts` + 100–104 |
| Etapas `song_validate`, `lyric_sync`, `media_split`, `render` de letra | `service_role` | grants de 101–103 |
| Oficial en «Colecciones Ráfaga» | `can_admin` | `set_collection_official` |

| Rol | Puede | No puede |
|---|---|---|
| owner / admin / editor | subir, sincronizar, editar, generar, exportar, publicar | — (oficial: solo owner/admin) |
| reviewer / viewer | ver, escuchar, descargar | escribir |

Aislamiento: RLS `is_member` en `hook_packs` y `lyric_projects`, escrituras solo por RPC, FK compuestas; URLs de R2
firmadas solo tras `song_object`/`media_item_object`/`export_object` como el usuario.

---

## 9. ORDEN DE CONSTRUCCIÓN

### Reglas
1. Una sesión por paso: ≤ 5 archivos, ≤ 6 criterios.
2. Cada paso: **Hacer → Hecho cuando → Verify → Checkpoint**, en ese orden.
3. Criterios EARS decididos por un comando aquí y hoy, sin secretos ni red (salvo la descarga de fuentes del **Hacer** del
   paso 7): `fetch` simulado, PGlite, ffmpeg `-f lavfi`, R2 simulado (`fakeR2`), ASR simulado.
4. Cada línea de `Verify` empieza por `export PATH="$HOME/.local/bin:$PATH" &&` y sale con 0 si el paso es correcto; los
   códigos esperados se afirman (`; test $? -eq N`), nunca con `!` ni `test $? -ne 0`.
5. Un paso termina cuando pasan sus `Verify` y los anteriores (`pnpm test` en todos).
6. Checkpoint: `git add -A && git commit -m "rafaga-lyric-v2: paso NN — <slug>" && git tag rafaga-lyric-v2-step-NN`.
   Ningún `Verify` comprueba estado que solo crea el Checkpoint. **Vuelta atrás no destructiva:**
   `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD` (paso 1: `rafaga-v2-step-18..HEAD`); nunca `git reset --hard`.
7. No adelantar pasos; si uno se bloquea, detenerse e informar.
8. Ningún paso rompe una puerta anterior: no hay validación global de entorno; las rutas y etapas responden
   `not_configured` si les falta algo; las pruebas fijan valores falsos en proceso.
9. Acciones del propietario → lista de lanzamiento (§20.1).
10. Rutas con `[` entre comillas simples en el shell.
11. Antes de tocar una parte, leer su implementación y dependencias; sin sistemas paralelos.

**18 pasos = 18 tareas = 18 bloques en 3 épicas de 6** (`01-canciones-y-sincronizacion`, `02-estilo-vista-previa-y-fondos`,
`03-render-y-entrega`).

### Mapa de pasos
| # | Paso | Depende | Archivos | Puerta |
|---|---|---|---|---|
| 1 | Requisitos de clipping v2 y esquema (100) | — | 100, `lyric_v2.test.ts` | `node --test supabase/tests/lyric_v2.test.ts` |
| 2 | Ingesta de canciones `song_validate` (101) | 1 | 101, `stages/lyric.ts`, `stages/registry.ts`, `fixtures.ts`, `lyric_song.test.ts` | `node --test workers/media/src/lyric_song.test.ts` |
| 3 | API de letra, subida y Mis canciones | 2 | `routes/lyrics.ts`, ruta, `lyrics.test.ts`, `LyricStudioV2.tsx`, `lyric-studio/page.tsx` | `node --test apps/web/lib/lyrics.test.ts` |
| 4 | Motor de sincronización y formatos (puro) | 1 | `sync.ts`, `sync.test.ts`, `formats.ts`, `formats.test.ts`, `lyrics/src/index.ts` | `node --test packages/lyrics/src/sync.test.ts …` |
| 5 | Etapa `lyric_sync` y API de sincronización (102) | 3, 4 | 102, `stages/lyric.ts`, `lyric_sync.test.ts`, `routes/lyrics.ts`, `lyrics.test.ts` | `node --test workers/media/src/lyric_sync.test.ts …` |
| 6 | Editor de sincronización | 5 | `synceditor.ts`, `synceditor.test.ts`, `LyricSyncEditor.tsx`, `TapSync.tsx`, `LyricStudioV2.tsx` | `node --test apps/web/lib/synceditor.test.ts` |
| 7 | Fuentes del contenido | 1 | `fetch-fonts.ts`, `fontcatalog.ts`, `public/fonts/caption/**`, `captionfonts.test.ts`, `composition/src/index.ts` | `node scripts/fetch-fonts.ts --check` |
| 8 | Estilo v2 compartido y motor de escena | 7 | `style.ts`, `lyricscene.ts`, `lyricscene.test.ts`, `composition/src/index.ts`, `lyric_ass.test.ts` | `node --test packages/composition/src/lyricscene.test.ts …` |
| 9 | Style Studio simplificado, presets y A/B | 8 | `CaptionStyleEditor.tsx`, `styles.ts`, `styles.test.ts`, `style-studio/page.tsx`, `CreationPanel.tsx` | `node --test apps/web/lib/styles.test.ts` |
| 10 | Vista previa y paridad dorada | 8, 6 | `LyricPreview.tsx`, `lyricpreview.ts`, `lyricpreview.test.ts`, `lyricparity.test.ts`, `LyricStudioV2.tsx` | `node --test packages/composition/src/lyricparity.test.ts …` |
| 11 | Modos, ganchos y biblioteca | 10 | `lyricscene.ts`, `lyricmodes.test.ts`, `LyricLibrary.tsx`, `LyricStudioV2.tsx` | `node --test packages/composition/src/lyricmodes.test.ts` |
| 12 | Paquetes de medios y «Crear desde vídeo» (103) | 5 | 103, `stages/lyric.ts`, `lyric_media.test.ts`, `routes/lyrics.ts`, `lyrics.test.ts` | `node --test workers/media/src/lyric_media.test.ts …` |
| 13 | Fondos, portadas y ajustes en la interfaz | 11, 12 | `LyricLibrary.tsx`, `LyricSettings.tsx`, `lyricsettings.ts`, `lyricsettings.test.ts`, `LyricStudioV2.tsx` | `node --test apps/web/lib/lyricsettings.test.ts` |
| 14 | Motor de render de letra | 11, 12 | `lyricscene.ts`, `lyricrender.test.ts`, `stages/export.ts`, `stages/lyric.ts`, `lyric_render.test.ts` | `node --test … lyric_render.test.ts` |
| 15 | Variantes, lotes y reintento (104) | 13, 14 | 104, `routes/lyrics.ts`, `lyrics.test.ts`, `LyricResults.tsx`, `LyricStudioV2.tsx` | `node --test apps/web/lib/lyrics.test.ts` |
| 16 | Formatos de letra y publicación | 15 | `stages/lyric.ts`, `lyric_formats.test.ts`, `LyricResults.tsx`, `lyricshare.test.ts` | `node --test workers/media/src/lyric_formats.test.ts …` |
| 17 | Demo y rendimiento | 16 | `stages/lyric.ts`, `lyric_demo.test.ts`, `lyric-perf.ts`, `docs/PERF.md` | `node scripts/lyric-perf.ts --quick` |
| 18 | Transición: Looks clásicos, vídeos anteriores y demo | 17 | `lyriccutover.ts`, `lyriccutover.test.ts`, `CaptionStyleEditor.tsx`, `LyricLibrary.tsx` | `node --test apps/web/lib/lyriccutover.test.ts` |

### Requisitos del encargo → pasos
| Requisito | Paso · prueba |
|---|---|
| Subida (formatos, ≤ 60 MB, ≤ 10 min) y tarjeta de validación | 2 (`lyric_song.test.ts`) · 3 |
| Re-sincronizar conserva palabras `manual` | 4 (`sync.test.ts`) · 5 (`lyric_sync.test.ts`) |
| Transcripción ≠ alineación; letra nunca modificada en silencio | 4 · 5 |
| Vista previa = exportación (≤ 1 fotograma, ≤ 2 px) | 8 (`lyric_ass.test.ts`) · 10 (`lyricparity.test.ts`) |
| Fondos propios, «Crear desde vídeo», color, secuencia, ajuste | 12 · 13 · 14 |
| 9 controles compartidos con clipping; ≤ 20; < 4 KB | 8 · 9 |
| Modos, ganchos, portadas | 11 |
| N variantes, candados, aislamiento, reintento, audio idéntico | 14 · 15 |
| Formatos y viaje de ida y vuelta LRC ≤ 10 ms | 4 · 16 |
| Consumo: sync 1 u/min solo con ASR; render y publicar 0 | 5 · 15 |
| Publicar/programar/compartir | 16 |
| Coexistencia y Looks clásicos | 1 · 18 |
| Rendimiento en `docs/PERF.md` | 17 |

---

#### Paso 1 — Requisitos de clipping v2 y esquema Lyric v2 (migración 100)
**Hacer**
- **Precondición:** `test -z "$(git status --porcelain | grep -v '^.. blueprints/')"` sale con 0 (el Bootstrap ya confirmó
  sus archivos). Si no, detente e informa: hay trabajo ajeno sin confirmar.
- Crear `supabase/migrations/20261201000100_lyric_v2.sql` con el SQL de §4 (100).
- Crear `supabase/tests/lyric_v2.test.ts` con `freshDb()` (tarifa de cómputo fijada en la prueba como en
  `exports.test.ts`): existencia de tablas y columnas, CHECK superconjunto (inserciones válidas nuevas y antiguas), RLS de B,
  `save_caption_style` (límite 20, tamaño, `invalid_style`, inserción directa v1 en `text_styles` aún permitida),
  canciones v1 y v2, `create_lyric_project`/`save_lyric_project` (cambio de modo sin tocar `song_alignments`), y la
  coexistencia: `request_lyrics` crea un trabajo `engine = 'v1'` que `claim_job()` entrega y `save_manual_alignment` sigue
  guardando la clave `manual:<sha>`.

**Hecho cuando**
- [ ] WHEN se ejecutan `git tag -l 'rafaga-v2-step-*'` y `git tag -l 'rafaga-v2-step-0[2-8]' 'rafaga-v2-step-1[467]'` THE SYSTEM SHALL listar 18 y 10 etiquetas respectivamente, y `packages/composition/src/layouts.ts`, `workers/media/src/stages/export.ts`, `workers/media/src/stages/integrations.ts` y `apps/web/lib/uploader.ts` SHALL existir.
- [ ] WHEN `freshDb()` aplica todas las migraciones, incluida `20261201000100_lyric_v2.sql`, THE SYSTEM SHALL exponer las tablas `lyric_projects` y `hook_packs`, las columnas `songs.source_id`, `songs.duration_ms`, `song_alignments.revision`, `media_collections.official`, `media_collections.purpose` y `media_items.storage_backend`, y aceptar `projects.mode = 'lyrics'`, `clip_versions.aspect = '4:5'`, `renders.kind` `lrc`, `lrc_word` y `ass`, `job_stages.stage` `song_validate`, `lyric_sync` y `media_split` y `storage_objects.kind = 'media'`.
- [ ] WHEN el usuario B consulta `lyric_projects` y `hook_packs` o inserta directamente en ellas con el `workspace_id` de A THE SYSTEM SHALL devolver 0 filas de A y rechazar la inserción.
- [ ] WHEN `save_caption_style` recibe un estilo de más de 4000 bytes, un estilo sin `rafagaStyle = 2` o el estilo número 21 del workspace THE SYSTEM SHALL lanzar `style_too_large`, `invalid_style` o `style_limit` sin escribir, y una inserción directa de un estilo v1 en `text_styles` SHALL seguir funcionando.
- [ ] WHEN se inserta una canción v1 (`audio/mpeg`, ruta `<ws>/songs/…`, sin `source_id`) y una v2 (`audio/flac`, ruta `<ws>/<source>/original`, con `source_id`) THE SYSTEM SHALL aceptar ambas, y una v2 de más de 62914560 bytes SHALL rechazarse.
- [ ] WHEN `save_lyric_project` cambia el modo de una pieza de `letra` a `portada` y vuelve, y `request_lyrics` crea un trabajo v1 THE SYSTEM SHALL conservar `song_id`, estilo y fondos sin cambiar el número de filas de `song_alignments`, y `claim_job()` SHALL entregar el trabajo `lyrics` con `engine = 'v1'`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && test "$(git tag -l 'rafaga-v2-step-*' | wc -l | tr -d ' ')" = 18
export PATH="$HOME/.local/bin:$PATH" && test "$(git tag -l 'rafaga-v2-step-0[2-8]' 'rafaga-v2-step-1[467]' | wc -l | tr -d ' ')" = 10
export PATH="$HOME/.local/bin:$PATH" && test -f packages/composition/src/layouts.ts && test -f workers/media/src/stages/export.ts && test -f workers/media/src/stages/integrations.ts && test -f apps/web/lib/uploader.ts
export PATH="$HOME/.local/bin:$PATH" && node --test supabase/tests/lyric_v2.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint**
```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 01 — esquema" && git tag rafaga-lyric-v2-step-01
git ls-files --error-unmatch supabase/migrations/20261201000100_lyric_v2.sql   # exit 0 — confirmado arriba
```

---

#### Paso 2 — Ingesta de canciones: etapa `song_validate` (migración 101)
**Hacer**
- `supabase/migrations/20261201000101_lyric_songs.sql` con el SQL de §4 (101).
- `workers/media/src/stages/registry.ts`: añadir al final de `STAGES` `"song_validate", "lyric_sync", "media_split"` y en
  `MODULE` las tres → `"./lyric.ts"` (las dos últimas responden `not_implemented` hasta los pasos 5 y 12).
- `workers/media/src/fixtures.ts`: ampliar `FixtureKind` con `song_wav` (12 s, 44100 Hz estéreo, tonos de 440 Hz de 1.2 s
  separados por 0.8 s de silencio: `-f lavfi -i "aevalsrc=exprs=0.5*sin(2*PI*440*t)*lt(mod(t\,2)\,1.2):s=44100:c=stereo:d=12"`),
  `song_m4a` (AAC), `song_flac`, `song_ogg` (Opus), `song_long` (601 s, 8 kHz mono, FLAC), `song180` (180 s, para el
  paso 17) y `scenes` (vídeo de 6 s, 640×360, 25 fps, tres bloques de color de 2 s con `color` + `concat`, sin audio). El
  encoder MP3 no se usa en fixtures: la detección MP3 se prueba con cabeceras construidas en la prueba.
- `workers/media/src/stages/lyric.ts` (nuevo): `audioKind(bytes)` por bytes mágicos (`ID3` o sincronía `0xFFE` → `mp3`;
  `RIFF`…`WAVE` → `wav`; `ftyp` → `m4a`; `0xFFF1`/`0xFFF9` → `aac`; `fLaC` → `flac`; `OggS` → `ogg`); etapa
  `song_validate`: `song_by_source` → descarga el original de R2 → `audioKind` → ffprobe (rechaza pista de vídeo) → límites
  (`too_large` > 62914560 bytes, `too_long` > 600 s) → `ebur128` (`-af ebur128=framelog=quiet -f null -`, se lee `I: … LUFS`)
  → opus 16 kHz mono a `<ws>/<source>/audio.opus` + `record_object` `audio` → `finish_song_validate`. Fallo →
  `finish_song_validate(failed, error_code)` y la etapa termina con ese código (no reintenta: códigos permanentes).
  `STAGE_IMPLS = { song_validate }`.
- `workers/media/src/lyric_song.test.ts`: PGlite + `pgliteCtx` + `fakeR2`; sesiones creadas con `create_upload_session`
  como A con `mime` de audio.

**Hecho cuando**
- [ ] WHEN `audioKind` recibe cabeceras de MP3 (`ID3` o sincronía `0xFFE`), WAV (`RIFF`…`WAVE`), M4A (`ftyp`), AAC ADTS (`0xFFF1` o `0xFFF9`), FLAC (`fLaC`) y OGG (`OggS`) THE SYSTEM SHALL devolver `mp3`, `wav`, `m4a`, `aac`, `flac` y `ogg`, y `null` para 64 bytes aleatorios.
- [ ] WHEN `song_validate` procesa los fixtures `song_wav`, `song_m4a`, `song_flac` y `song_ogg` THE SYSTEM SHALL dejar cada canción `ready` con duración 12 s ±0.1, 44100 Hz (48000 Hz en OGG Opus), 2 canales y sonoridad integrada finita entre −70 y 0 LUFS, la fuente `validated` y `<ws>/<source>/audio.opus` subido al R2 simulado.
- [ ] WHEN la canción dura más de 600 s, pesa más de 62914560 bytes o el archivo tiene pista de vídeo o no es audio THE SYSTEM SHALL cerrar la etapa con `too_long`, `too_large` o `unsupported_file`, dejar la canción `failed` con ese `error_code` y no subir nada al R2 simulado.
- [ ] WHEN `complete_upload` completa una sesión cuya fuente tiene `mime` de audio THE SYSTEM SHALL crear un único trabajo `ingest` con la sola etapa `song_validate`, y para una fuente de vídeo SHALL seguir creando `validate`, `mezzanine` y `proxy`.
- [ ] WHEN `register_song` se llama dos veces con la misma sesión de subida THE SYSTEM SHALL devolver el mismo `song_id` y `project_id`, poner `projects.mode = 'lyrics'` y crear una sola fila en `lyric_projects` con modo `letra`, y con más de 62914560 bytes SHALL lanzar `file_too_large`.
- [ ] WHEN se ejecuta `node workers/media/src/stage.ts --list` THE SYSTEM SHALL imprimir `song_validate`, `lyric_sync` y `media_split` después de `translate`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_song.test.ts
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list | grep -qx media_split
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 02 — ingesta de canciones" && git tag rafaga-lyric-v2-step-02`

---

#### Paso 3 — API de letra, subida de canciones y Mis canciones
**Hacer**
- `apps/web/lib/routes/lyrics.ts`: `handleLyrics(req, slug, deps: { f?, env?, wake? })` con el patrón de `routes/exports.ts`
  (`sessionUser`, `bearer`, `rpc`, `json`, `mapDbError`) y el mapa `LYRIC_ERRORS` de §5; rutas del paso 3 de §5. La URL de
  audio usa `r2FromEnv`/`r2Url` (`GET`, 3600 s) tras `song_object`; `backend = 'supabase'` → 409 `legacy_song`.
- `apps/web/app/api/lyrics/[[...slug]]/route.ts`: `dynamic`, `GET`, `POST`, `PUT` que llaman a `handleLyrics`.
- `apps/web/lib/lyrics.test.ts`: `freshDb`, `fakeSupabaseFetch`, sesiones de subida reales (`create_upload_session`).
- `apps/web/components/LyricStudioV2.tsx`: subida con `runUpload` + `httpApi` (comprueba antes ≤ 62914560 bytes y la
  cabecera con la misma lógica de bytes mágicos), `POST /api/lyrics/songs` tras crear la sesión y antes de subir partes,
  tarjeta de validación leída de `songs` (duración, frecuencia, canales, LUFS, estado, error en español), lista «Mis
  canciones» (v2 y v1; las v1 con la etiqueta «Clásica»), esqueleto de pasos. Solo componentes de `components/ui/`.
- `apps/web/app/app/lyric-studio/page.tsx`: renombrar `export default function LyricStudio()` a `function LyricStudioV1()`
  y añadir `export default function LyricStudio() { return process.env.NEXT_PUBLIC_LYRIC_VERSION === "v2" ? <LyricStudioV2 /> : <LyricStudioV1 />; }`.
  Nada más cambia en la página v1.

**Hecho cuando**
- [ ] WHEN `POST /api/lyrics/songs` recibe `{ upload_id, title }` de una sesión de audio del usuario THE SYSTEM SHALL responder 201 `{ song_id, project_id }`, y repetida con la misma sesión SHALL devolver los mismos identificadores.
- [ ] WHEN la sesión es de un archivo de más de 62914560 bytes o de `mime` que no es de audio THE SYSTEM SHALL responder 413 `{ error: { code: "file_too_large" }, limit: 62914560 }` o 415 `{ error: { code: "unsupported_file" } }` sin crear canción.
- [ ] WHEN el usuario B pide `GET /api/lyrics/songs/:id/audio` de una canción de A THE SYSTEM SHALL responder 404 sin firmar URL, y para A con la canción `ready` SHALL devolver `{ url, expires_at }` con una URL GET de R2 que caduca en 3600 s.
- [ ] WHEN `POST /api/lyrics/projects` recibe `{ song_id, mode: "texto" }` y después `PUT /api/lyrics/projects/:id` cambia `mode` a `letra` THE SYSTEM SHALL responder 201 `{ project_id }` y 200 `{ saved_at }`, y un `mode` desconocido SHALL responder 400 `{ error: { code: "invalid_params" }, field: "mode" }`.
- [ ] WHEN se ejecutan `grep -q 'NEXT_PUBLIC_LYRIC_VERSION' apps/web/app/app/lyric-studio/page.tsx` y `grep -q 'runUpload' apps/web/components/LyricStudioV2.tsx` THE SYSTEM SHALL salir con 0 en ambos: la vista v2 vive detrás de la bandera y sube con el cargador compartido.
- [ ] WHEN se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en ambos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'NEXT_PUBLIC_LYRIC_VERSION' apps/web/app/app/lyric-studio/page.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'runUpload' apps/web/components/LyricStudioV2.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 03 — API y canciones" && git tag rafaga-lyric-v2-step-03`

---

#### Paso 4 — Motor de sincronización y formatos de letra (puro)
**Hacer**
- `packages/lyrics/src/sync.ts`: `SyncWord = { text, start, end, line, occurrence, manual, confidence, origin:
  "asr"|"interpolated"|"manual"|"hint", flags: ("doubtful"|"not_heard"|"vocalisation"|"sustained")[] }`;
  `importLyrics(raw)` → `{ format: "txt"|"lrc"|"srt"|"vtt", lines, hints: { line, start, end|null }[] }` (usa
  `parseLrc`/`parseSrtCues`); `lineOccurrences(lines)`; `alignWithAnchors(lines, asr, { anchors?, hints? })` →
  `{ words, extras, instrumentals }` (las palabras `manual` de `anchors` se copian exactas; entre anclas se alinea con
  `alignLyrics` sobre el subconjunto del ASR de ese hueco; una línea sin parejas pero con pista empieza en la pista;
  `doubtful` si confianza < 0.5, `not_heard` si interpolada, `vocalisation` por
  `/^(o+h*|a+h+|u+h+|m+|la+|na+|ye+a+h*|eh)$/i` normalizado, `sustained` si dura > 1.5 s; `extras` = palabras del ASR sin
  pareja; `instrumentals` = huecos > 4 s sin palabras); `resyncKeepingManual(prev, lines, asr)`;
  `transcriptionProposal(asr)` → `{ text, words }` (vía `lyricsFromAsr`; no toca nada guardado); `insertWord`,
  `deleteWord`, `nudgeWord`, `resizeWord` (marcan `manual` solo la palabra editada, mantienen tiempos crecientes, no tocan
  el resto); `DEMO_SONG` = `{ title: "Canción de demostración", artist: "Ráfaga", duration: 24, lyrics:
  "Llueve sobre Madrid\ncanto sin mirar\n¿dónde vas ahora?\n¡vuelve a empezar!", words }` con la palabra k (0–11) en
  `[2k, 2k + 1.2)` s, `manual: true`, y `DEMO_AUDIO_EXPR` (la misma `aevalsrc` de `song_wav` con `d=24`).
- `packages/lyrics/src/formats.ts`: `toLrc(words, meta?)` (`[mm:ss.xx]línea`), `toLrcEnhanced(words)`
  (`[mm:ss.xx]<mm:ss.xx>palabra <mm:ss.xx>palabra …` y una marca final `<mm:ss.xx>` con el fin de la línea),
  `parseLrc(text)` (ambos; ignora `[ar:]`, `[ti:]`…; varias marcas por línea = repeticiones), `toSrtLyrics`,
  `toVttLyrics`, `parseSrtCues` (SRT y VTT), `toAssKaraoke(words)` (un `Dialogue` por línea, `{\kN}` por palabra con N en
  centésimas, huecos como `{\kN}` vacíos), `toTxtLyrics(words)`.
- `packages/lyrics/src/index.ts`: `export * from "./sync.ts"; export * from "./formats.ts";` (sin nombres que choquen).
- `sync.test.ts` y `formats.test.ts` con su propia letra y ASR de prueba.

**Hecho cuando**
- [ ] WHEN `resyncKeepingManual` realinea una letra en la que 3 palabras tienen `manual: true` THE SYSTEM SHALL dejar `start` y `end` de esas 3 palabras idénticos y recalcular solo las demás.
- [ ] WHEN `alignWithAnchors` alinea una letra aprobada contra un ASR con palabras de más, de menos y distintas THE SYSTEM SHALL devolver exactamente las palabras de la letra en el mismo orden y con el mismo texto, marcar `doubtful` las de confianza menor que 0.5 y `not_heard` las interpoladas, y listar en `extras` las palabras del ASR sin pareja.
- [ ] WHEN la letra repite un estribillo y el audio tiene un tramo de más de 4 s sin palabras THE SYSTEM SHALL asignar `occurrence` 1 y 2 a cada repetición con tiempos independientes y listar el tramo en `instrumentals`, y las vocalizaciones (`oh`, `ah`, `la`, `yeah`) y las palabras de más de 1.5 s SHALL marcarse `vocalisation` y `sustained`.
- [ ] WHEN `insertWord`, `deleteWord`, `nudgeWord` o `resizeWord` editan una palabra THE SYSTEM SHALL marcar `manual: true` solo en la palabra editada, mantener los tiempos crecientes y dejar idénticas todas las palabras no afectadas, incluidas las corregidas antes.
- [ ] WHEN `toLrcEnhanced`, `toLrc`, `toSrtLyrics` y `toVttLyrics` exportan una letra y `importLyrics` la vuelve a leer THE SYSTEM SHALL recuperar las mismas líneas y el inicio de cada palabra (LRC mejorado) o de cada línea (LRC, SRT, VTT) con 10 ms de diferencia como máximo.
- [ ] WHEN `toAssKaraoke` exporta una letra THE SYSTEM SHALL escribir un evento `Dialogue` por línea con una etiqueta `{\kN}` por palabra cuya suma, en centésimas, difiere de la duración de la línea en 1 centésima por palabra como máximo, y las palabras de `DEMO_SONG` SHALL ser crecientes y caber en sus 24 s.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/lyrics/src/sync.test.ts packages/lyrics/src/formats.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 04 — sincronización y formatos" && git tag rafaga-lyric-v2-step-04`

---

#### Paso 5 — Etapa `lyric_sync` y API de sincronización (migración 102)
**Hacer**
- `supabase/migrations/20261201000102_lyric_sync.sql` con el SQL de §4 (102).
- `workers/media/src/stages/lyric.ts`: etapa `lyric_sync` (`inputs` = `{song_id, mode, model, hints, latest_revision}`):
  `lyric_sync_context` → si no hay ASR en caché, descarga `audio.opus` y transcribe con `ctx.deps.transcribe` o, por
  defecto, `groqTranscribe` (`aiConfig(ctx.env)`, `ctx.fetch`) bajo `GroqLimiter` (`limitsFromEnv`), y guarda con
  `save_song_asr`; `align` → `alignWithAnchors(parseLyrics(lyrics_text), asr, { anchors: palabras manual de la última
  revisión, hints })` → `save_song_alignment(kind 'aligned', flags)`; `transcribe` → `transcriptionProposal` →
  `save_song_alignment(kind 'proposal')`. `units_actual` = minutos si llamó al ASR, 0 si no.
- `workers/media/src/lyric_sync.test.ts`: PGlite, `fakeR2`, ASR simulado que cuenta llamadas, `runOnce` del runner.
- `apps/web/lib/routes/lyrics.ts` y `apps/web/lib/lyrics.test.ts`: rutas del paso 5 de §5.

**Hecho cuando**
- [ ] WHEN `POST /api/lyrics/songs/:id/sync` llega sin ASR en caché para una canción de 180 s THE SYSTEM SHALL responder 202 `{ job_id, units_reserved: 3, cached: false }` y escribir una fila `reserve` de 3 unidades, y con el ASR ya guardado SHALL responder `units_reserved: 0` y `cached: true` sin ninguna fila nueva en `credit_ledger`.
- [ ] WHEN la etapa `lyric_sync` se ejecuta con un ASR simulado THE SYSTEM SHALL llamar al ASR una sola vez, guardar sus palabras como fila `asr`, crear la revisión 1 de tipo `aligned` y liquidar las unidades, y una segunda sincronización SHALL hacer 0 llamadas al ASR.
- [ ] WHEN el modo es `transcribe` THE SYSTEM SHALL guardar una revisión de tipo `proposal` y dejar `songs.lyrics_text` idéntico, y WHEN el modo es `align` sin letra guardada SHALL responder 409 `{ error: { code: "lyrics_required" } }`.
- [ ] WHEN una revisión guardada con `PUT /api/lyrics/songs/:id/alignment` tiene palabras con `manual: true` y se vuelve a sincronizar THE SYSTEM SHALL conservar el `start` y el `end` de cada palabra `manual` en la nueva revisión.
- [ ] WHEN `PUT /api/lyrics/songs/:id/alignment` llega con un `base_revision` obsoleto o con tiempos decrecientes THE SYSTEM SHALL responder 409 `{ conflict: { current_revision } }` o 400 `{ error: { code: "invalid_words" } }` sin crear revisión, y `POST /api/lyrics/songs/:id/alignment/restore` SHALL crear una revisión nueva con las palabras de la primera revisión `aligned`.
- [ ] WHEN el usuario B pide `GET /api/lyrics/songs/:id/alignment` o `POST /api/lyrics/songs/:id/sync` sobre una canción de A THE SYSTEM SHALL responder 404.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_sync.test.ts apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 05 — etapa de sincronización" && git tag rafaga-lyric-v2-step-05`

---

#### Paso 6 — Editor de sincronización
**Hacer**
- `apps/web/lib/synceditor.ts` (puro): estado `{ words, cursor, rate, holding, past, future }`; acciones `holdStart(t)`,
  `holdEnd(t)` (fija la palabra del cursor en `[t0, t1]`, `manual: true`, avanza), `tap(t)`, `setRate(0.5|0.75|1)`,
  `nudge`, `resize`, `insert`, `remove` (delegan en `@rafaga/lyrics`), `undo`, `redo`; `doubtfulIndexes(words)`;
  `toPayload(state, baseRevision)` para `PUT …/alignment`. Los tiempos son segundos de la canción (el llamador pasa
  `audio.currentTime`), no del reloj.
- `apps/web/lib/synceditor.test.ts`.
- `apps/web/components/LyricSyncEditor.tsx`: línea de tiempo con palabras arrastrables (desplazar y redimensionar con
  `pointerdown`/`pointermove`, y con botones ◀ ▶ y teclado como alternativa — WCAG 2.5.7), resaltado de dudosas, botones
  Insertar/Borrar/Deshacer/Rehacer/«Restaurar sincronización original», guardado con `PUT …/alignment` y aviso de conflicto.
- `apps/web/components/TapSync.tsx`: añadir la prop opcional `onMarks?: (marks) => void`; con ella, «Guardar» entrega las
  marcas al llamador en vez de llamar a `save_manual_alignment` (sin ella, comportamiento v1 idéntico). El modo
  «Mantener» y la velocidad 0.5/0.75/1 ya existen y se reutilizan.
- `apps/web/components/LyricStudioV2.tsx`: monta `LyricSyncEditor` (con `TapSync onMarks`) tras la sincronización.

**Hecho cuando**
- [ ] WHEN se mantiene pulsada la tecla o el botón de marcar desde t = 10.00 s hasta t = 10.80 s sobre la palabra actual THE SYSTEM SHALL fijar esa palabra en `start: 10` y `end: 10.8` con `manual: true` y avanzar a la siguiente.
- [ ] WHEN se elige la velocidad 0.5 o 0.75 THE SYSTEM SHALL guardar `rate` 0.5 o 0.75 en el estado y los tiempos marcados SHALL seguir expresados en segundos de la canción.
- [ ] WHEN se desplaza, se redimensiona, se inserta o se borra una palabra y después se deshace THE SYSTEM SHALL volver al estado anterior idéntico, y las palabras no afectadas SHALL conservar sus tiempos y su marca `manual`.
- [ ] WHEN el estado tiene palabras con confianza menor que 0.5 THE SYSTEM SHALL devolver sus índices en `doubtfulIndexes` para resaltarlas.
- [ ] WHEN se ejecutan `grep -q 'onMarks' apps/web/components/TapSync.tsx`, `grep -q 'pointerdown' apps/web/components/LyricSyncEditor.tsx` y `grep -q 'LyricSyncEditor' apps/web/components/LyricStudioV2.tsx` THE SYSTEM SHALL salir con 0 en los tres.
- [ ] WHEN se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en ambos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/synceditor.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'onMarks' apps/web/components/TapSync.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'pointerdown' apps/web/components/LyricSyncEditor.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'LyricSyncEditor' apps/web/components/LyricStudioV2.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 06 — editor de sincronización" && git tag rafaga-lyric-v2-step-06`

---

#### Paso 7 — Fuentes para el contenido generado
**Hacer**
- **Auditoría primero:** existen `Bootzy TM` (`SYSTEM_FONT`, bucket `app-fonts`, fuera del repo), `Liberation Sans` (imagen de
  Modal `fonts-liberation`; métricas en `packages/lyrics/src/metrics.ts`) y las fuentes propias de `workspace_fonts`.
  Ninguna de las 15 familias de referencia está en el repo: se añaden todas, y las existentes se catalogan sin duplicar.
- `scripts/fetch-fonts.ts` (importa por ruta relativa `../packages/lyrics/src/ttf.ts` y `../packages/composition/src/fonts.ts`):
  - `--write` (con red): para Inter, Roboto, Playfair Display, Oswald, Montserrat, Raleway, Nunito y Space Mono pesos 400 y
    700; para Dancing Script 400 y 700; para Pacifico, Bebas Neue, Righteous, Anton, Lobster y Abril Fatface solo 400. Pide
    `https://fonts.googleapis.com/css2?family=<Familia>:wght@<peso>` con un `User-Agent` sin soporte de WOFF2 para recibir
    URLs `.ttf` estáticas (**verificado el 2026-11-14**: con `User-Agent: Mozilla/4.0` la API CSS devuelve `src: url(https://fonts.gstatic.com/…ttf) format('truetype')`; si algún día no trajera ningún `.ttf`, el script usa el camino alterno `https://raw.githubusercontent.com/google/fonts/main/<ofl|apache>/<dir>/<Familia>-<Estilo>.ttf`, y solo si ambos fallan sale con 69); descarga cada
    TTF a `apps/web/public/fonts/caption/<Familia-sin-espacios>-<peso>.ttf`; comprueba `sniffFont = "ttf"` y que
    `fontFamily()` coincide con la familia; detecta la licencia pidiendo
    `https://raw.githubusercontent.com/google/fonts/main/ofl/<dir>/OFL.txt` y, si no existe,
    `…/apache/<dir>/LICENSE.txt` (`licence` `OFL-1.1` o `Apache-2.0`, `licenceUrl` la que respondió 200); lee `unitsPerEm`,
    ascendente y descendente de `head`/`hhea` y los avances con `readMetrics(buf, METRIC_CODEPOINTS)`; cobertura de
    `á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ ¿ ¡`; y escribe `packages/composition/src/fontcatalog.ts`.
  - `--check` (sin red): cada archivo del catálogo existe, su sha256 coincide y `readMetrics` sobre él da los mismos avances;
    salida 0 bien, 1 discrepancia.
- `packages/composition/src/fontcatalog.ts` (generado, se confirma): `CaptionFont = { family, weight, file | null, sha256 |
  null, bytes, licence, licenceUrl, source: "google-fonts" | "sistema", spanish, missing, unitsPerEm, ascent, descent,
  advance, fallback }`; `CAPTION_FONTS` (las 15 familias + Bootzy TM y Liberation Sans con `source: "sistema"`, `file:
  null`); `FALLBACK_FAMILY = "Inter"`; `fontFor(family, weight)`; `measureText(text, family, weight, emPx)`;
  `coversText(font, text)`; `resolveFamilyForText(family, weight, text)` (devuelve `Inter` si falta un glifo).
- `packages/composition/src/index.ts`: `export * from "./fontcatalog.ts";`.
- `apps/web/lib/captionfonts.test.ts` (importa `@rafaga/composition` y `@rafaga/lyrics`): re-deriva métricas, cobertura,
  respaldo y medidas.

**Hecho cuando**
- [ ] WHEN se ejecuta `node scripts/fetch-fonts.ts --check` THE SYSTEM SHALL salir con 0 tras comprobar que cada archivo de `CAPTION_FONTS` existe en `apps/web/public/fonts/caption/`, que su sha256 coincide y que sus anchos de avance coinciden con `readMetrics` sobre el mismo archivo.
- [ ] WHEN se lee `CAPTION_FONTS` THE SYSTEM SHALL contener Inter, Roboto, Playfair Display, Oswald, Pacifico, Bebas Neue, Montserrat, Raleway, Space Mono, Dancing Script, Righteous, Anton, Lobster, Nunito y Abril Fatface, cada una con licencia `OFL-1.1` o `Apache-2.0` y `licenceUrl` https, y las fuentes ya existentes Bootzy TM y Liberation Sans con `source: "sistema"` sin archivo duplicado.
- [ ] WHEN se comprueba la cobertura de `á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ ¿ ¡` THE SYSTEM SHALL registrar `spanish` y la lista `missing` de cada fuente, y `resolveFamilyForText` SHALL devolver `Inter` para un texto con un glifo que la fuente elegida no tiene.
- [ ] WHEN `measureText` mide el mismo texto con la misma fuente, peso y tamaño dos veces THE SYSTEM SHALL devolver el mismo ancho, y un texto con más caracteres SHALL medir más que su prefijo.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node scripts/fetch-fonts.ts --check
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/captionfonts.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 07 — fuentes" && git tag rafaga-lyric-v2-step-07`

---

#### Paso 8 — Esquema de estilo v2 compartido y motor de escena de letra
**Hacer**
- `packages/composition/src/style.ts` (añadir; lo existente no cambia): `CaptionStyleV2 = { rafagaStyle: 2, font, weight:
  400|700, case: "asis"|"upper"|"lower", color, activeColor, effect: "none"|"shadow"|"glow"|"stroke"|"box", entrance:
  "none"|"fade"|"slide"|"pop"|"typewriter", entranceBy: "word"|"line", active: "none"|"color"|"scale"|"underline"|"box",
  position: { x, y } (0–1), size: "S"|"M"|"L", sizeFine: 0.6–1.6 }` (9 controles: fuente, peso, caja, colores, efecto,
  entrada, palabra activa, posición, tamaño); `validateCaptionStyle(raw)` (acepta v2, v1 `SubtitleStyle` vía
  `captionFromSubtitleStyle` o basura → valores seguros; fuente desconocida → la primera del catálogo); `captionStyleBytes`;
  `captionToSubtitleStyle(v2)` (para clipping y `buildAss`); `surpriseCaption(seed)`; `BEHAVIOUR_PRESETS` (5, abajo);
  `BehaviourPresetId`.

  | Preset | Unidad | Agrupación (palabras, líneas) | Palabra activa | Entrada | Salida | Duración (ms) |
  |---|---|---|---|---|---|---|
  | `frase_palabra_activa` | frase | 8, 2 | `color` | `fade` | `fade` | 180 |
  | `palabra_a_palabra` | palabra | 1, 1 | `none` | `pop` | corte | 120 |
  | `escritura_progresiva` | palabra (dentro de la frase) | 8, 2 | `none` | `typewriter` | `fade` | 60 |
  | `texto_estatico` | línea | 10, 2 | `none` | `none` | corte | 0 |
  | `entrada_deslizada` | línea | 8, 2 | `scale` | `slide` | `fade` | 260 |

- `packages/composition/src/lyricscene.ts` (nuevo): `LyricWord`, `LyricBgItem`, `LyricComposition = { kind: "lyric", v:
  1, aspect: "9:16"|"4:5"|"1:1"|"16:9", res: 720|1080, fps: 30, mode: "letra"|"texto"|"portada", range: { start, end },
  duration, words, style: CaptionStyleV2, preset, background: { kind: "media"|"color", color, items, sequence, interval,
  order: "aleatorio"|"fijo", loop, fit: "preserve"|"fill"|"band" }, settings: { crop, dim, filter:
  "none"|"noche"|"super8"|"bn"|"vapor", shake, blend, variation }, hook, message, cover, seed, variant_hash? }`;
  `validateLyricComposition`; `lyricFrameSize(c)` (`RATIO_SIZE` × res/1080, pares); `lyricLayout(c)` (páginas por preset
  y ancho ≤ 0.84 W medido con `measureText`; em = H × {S: 0.045, M: 0.06, L: 0.08} × sizeFine; bloque centrado en
  `position`; cada palabra con su caja en px pares; alto de línea = em × (ascent + descent)/unitsPerEm);
  `lyricSceneAt(c, t)` (palabras visibles con caja, alfa, escala y desplazamiento de entrada, palabra activa, gancho,
  mensaje, portada, desplazamiento de sacudida, barras); `lyricShots(c)` (planos deterministas por semilla, intervalo y
  orden); `shakeOffset(slice, seed)` (enteros en [−3, 3] cada 100 ms); `lyricAss(c)` (fuente del catálogo con
  `resolveFamilyForText`, `Fontsize = em × (ascent + descent)/unitsPerEm`, un `Dialogue` por palabra y por intervalo de
  estado con `\an7\pos(x,y)` de su caja, tiempos al fotograma de 1/30 s con suelo de centésima como `assFrameTime` de
  `looks.ts`; entradas `\fad`, `\move`, `\fscx\fscy\t`; activa `\c`, `\fscx115\fscy115`, `\u1` o caja `\p1` en capa
  inferior; efecto en el estilo ASS; sacudida = cortes de 100 ms; fundido = `\alpha&H40&`).
- `packages/composition/src/index.ts`: `export * from "./lyricscene.ts";`.
- `packages/composition/src/lyricscene.test.ts` (palabras de prueba propias) y `workers/media/src/lyric_ass.test.ts`
  (ffmpeg real: `color` negro 1080×1920 + `subtitles=<ass>:fontsdir=<repo>/apps/web/public/fonts/caption`, un fotograma
  a `rawvideo` `gray`, caja envolvente de píxeles > 128; la ruta de fuentes se resuelve con `new URL(…, import.meta.url)`).

**Hecho cuando**
- [ ] WHEN `validateCaptionStyle` recibe un estilo con valores fuera de rango, un estilo v1 (`SubtitleStyle`) o basura THE SYSTEM SHALL devolver un `CaptionStyleV2` válido con exactamente los 9 controles (fuente, peso, caja, colores de texto y palabra activa, efecto, entrada, palabra activa, posición y tamaño), y `captionStyleBytes` del resultado SHALL ser menor que 4000.
- [ ] WHEN `captionToSubtitleStyle` convierte un `CaptionStyleV2` THE SYSTEM SHALL devolver un `SubtitleStyle` que `buildAss` acepta y que `validateStyle` deja igual, de modo que clipping y letra comparten el mismo esquema.
- [ ] WHEN se leen `BEHAVIOUR_PRESETS` THE SYSTEM SHALL contener `frase_palabra_activa`, `palabra_a_palabra`, `escritura_progresiva`, `texto_estatico` y `entrada_deslizada`, cada uno con unidad, agrupación, palabra activa, entrada, salida y duración, y `surpriseCaption(seed)` SHALL devolver el mismo estilo válido para la misma semilla.
- [ ] WHEN `lyricAss` genera el ASS de una composición de letra THE SYSTEM SHALL anclar cada palabra con `\an7\pos(x,y)` en su caja de `lyricLayout` y fijar cada inicio y fin en el fotograma de 1/30 s que usa `lyricSceneAt`.
- [ ] WHEN ffmpeg dibuja con libass y la fuente Inter de `apps/web/public/fonts/caption/` el fotograma de t = 1.0 s de una composición de prueba THE SYSTEM SHALL producir píxeles de texto cuya caja envolvente cae dentro de la caja de la línea de `lyricLayout` ampliada 0.25 em y cubre al menos el 50 % de su ancho, y el fotograma de t = 0.1 s, antes de la primera palabra, SHALL tener luminancia máxima menor que 16.
- [ ] WHEN la entrada es `typewriter` por palabra, la palabra activa es `underline` o `box`, o `shake` está activo THE SYSTEM SHALL producir en `lyricSceneAt` y en `lyricAss` el mismo conjunto de palabras visibles en cada fotograma de muestra.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricscene.test.ts workers/media/src/lyric_ass.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 08 — estilo y motor de escena" && git tag rafaga-lyric-v2-step-08`

---

#### Paso 9 — Style Studio simplificado (9 controles), presets y A/B
**Hacer**
- `apps/web/lib/styles.ts`: `saveStyle(rpcFn, ws, id, name, style, preset)` (comprueba `captionStyleBytes` ≤ 4000 antes de
  llamar y guarda `{ rafagaStyle: 2, style, preset }` con `save_caption_style`), `listStylesV2(rows)`,
  `applyPreset(style, presetId)` (solo capa de animación y agrupación), `styleLayers(style)` (`font`: familia, peso,
  caja, tamaño · `layout`: posición · `animation`: entrada, palabra activa, preset), `abState`/`toggleAB` (mismo `t`).
- `apps/web/lib/styles.test.ts` (PGlite + `fakeSupabaseFetch` para el límite de 20).
- `apps/web/components/CaptionStyleEditor.tsx`: los 9 controles con selector de fuente del catálogo (y de
  `workspace_fonts`), selectores de color, presets por comportamiento, «Sorpréndeme», guardar/cargar (≤ 20), A/B.
- `apps/web/app/app/style-studio/page.tsx`: con `NEXT_PUBLIC_LYRIC_VERSION === "v2"` muestra `CaptionStyleEditor`; si no, la v1
  (mismo patrón de renombrado que el paso 3).
- `apps/web/components/CreationPanel.tsx` (clipping): la galería de subtítulos usa `CaptionStyleEditor` y guarda
  `params.caption_style = captionToSubtitleStyle(v2)`; `generations.test.ts` debe seguir verde.

**Hecho cuando**
- [ ] WHEN se guardan 20 estilos v2 en un workspace y se intenta el 21.º con `saveStyle` THE SYSTEM SHALL rechazarlo con `style_limit` y conservar los 20, y borrar uno SHALL permitir guardar otro.
- [ ] WHEN `saveStyle` recibe un estilo cuyo JSON supera 4000 bytes THE SYSTEM SHALL rechazarlo con `style_too_large` antes de llamar a la base de datos.
- [ ] WHEN se alterna entre los estilos A y B con `toggleAB` THE SYSTEM SHALL conservar el mismo instante `t`, la misma letra y el mismo fondo, y cambiar solo el estilo.
- [ ] WHEN `applyPreset` aplica un preset de comportamiento THE SYSTEM SHALL cambiar solo la capa de animación y agrupación y dejar idénticas la capa de fuente (familia, peso, caja, tamaño) y la de posición.
- [ ] WHEN se ejecutan `grep -q 'CaptionStyleEditor' apps/web/app/app/style-studio/page.tsx`, `grep -q 'CaptionStyleEditor' apps/web/components/CreationPanel.tsx` y `grep -q 'captionToSubtitleStyle' apps/web/components/CreationPanel.tsx` THE SYSTEM SHALL salir con 0 en los tres: el editor de estilo es el mismo en clipping y en letra.
- [ ] WHEN se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en ambos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/styles.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'CaptionStyleEditor' apps/web/app/app/style-studio/page.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'CaptionStyleEditor' apps/web/components/CreationPanel.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'captionToSubtitleStyle' apps/web/components/CreationPanel.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 09 — Style Studio" && git tag rafaga-lyric-v2-step-09`

---

#### Paso 10 — Vista previa de letra sobre el motor compartido y paridad dorada
**Hacer**
- `packages/composition/src/lyricparity.test.ts`: composición de 3 líneas por formato (`9:16`, `4:5`, `1:1`, `16:9`),
  parsea `lyricAss` (`\pos`, inicio, fin) y lo compara con `lyricLayout` y con `lyricSceneAt` en cada fotograma.
- `apps/web/lib/lyricpreview.ts` (puro): `pointerToPosition(px, py, frame)` y `keyNudge(pos, key)` (normalizadas, acotadas
  a [0,1], pasos de 0.01), `clampCrop`, `loopTime(t, duration, loop)`, `restart()`, `nextVariantSeed(seed)`.
- `apps/web/lib/lyricpreview.test.ts`.
- `apps/web/components/LyricPreview.tsx`: `<canvas>` dibujado en cada `requestAnimationFrame` con `lyricSceneAt` (y
  `lyricShots`/`bgRect` para el fondo: `<video>`/`<img>` con URLs firmadas); antes de maquetar, `await
  document.fonts.load(…)` de la fuente del estilo servida desde `/fonts/caption/`; arrastrar la letra (escribe
  `style.position`), deslizador de recorte, bucle/«Reiniciar»/«Otra variante», A/B con el mismo cabezal, zonas seguras
  (`SAFE_ZONES`, solo 9:16, solo en la vista previa), pantalla completa (`Escape` cierra).
- `apps/web/components/LyricStudioV2.tsx`: usa `LyricPreview`.

**Hecho cuando**
- [ ] WHEN `lyricparity.test.ts` compara, en una composición de 3 líneas por cada formato `9:16`, `4:5`, `1:1` y `16:9`, cada `\pos` del ASS de `lyricAss` con la caja de `lyricLayout` THE SYSTEM SHALL encontrar diferencias de 2 px como máximo en x y en y.
- [ ] WHEN se comparan los inicios y fines de cada evento del ASS con la visibilidad que da `lyricSceneAt` THE SYSTEM SHALL encontrar diferencias de 1 fotograma (1/30 s) como máximo.
- [ ] WHEN se arrastra la letra a un punto fuera del lienzo o se mueve con las flechas del teclado THE SYSTEM SHALL guardar `style.position` normalizada y acotada a [0,1] con pasos de 0.01, y el recorte SHALL acotarse a [0,1].
- [ ] WHEN el bucle está activo y la reproducción pasa del final del tramo, o se pulsa «Reiniciar» o «Otra variante» THE SYSTEM SHALL volver a `t = 0`, y «Otra variante» SHALL cambiar la semilla sin cambiar la letra ni el estilo.
- [ ] WHEN se ejecutan `grep -q 'lyricSceneAt' apps/web/components/LyricPreview.tsx`, `grep -q 'document.fonts.load' apps/web/components/LyricPreview.tsx` y `grep -q 'Escape' apps/web/components/LyricPreview.tsx` THE SYSTEM SHALL salir con 0 en los tres: la vista previa usa el motor de exportación, espera a la fuente antes de maquetar y la pantalla completa se cierra con Esc.
- [ ] WHEN se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en ambos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricparity.test.ts apps/web/lib/lyricpreview.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'lyricSceneAt' apps/web/components/LyricPreview.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'document.fonts.load' apps/web/components/LyricPreview.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Escape' apps/web/components/LyricPreview.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 10 — vista previa y paridad" && git tag rafaga-lyric-v2-step-10`

---

#### Paso 11 — Modos Letra, Texto y Portada, ganchos y biblioteca
**Hacer**
- `packages/composition/src/lyricscene.ts`: modo `texto` (solo `message` en su intervalo, centrado en `position`, sin
  letra), modo `portada` (portada delantera en la primera mitad y trasera en la segunda, cuadrado de 0.7 W centrado a 0.4 H,
  zoom 1.00→1.06 en `lenta` y 1.00 fijo en `estatica`, título y artista debajo; letra solo si `cover.lyrics`), gancho
  (`hook` en la franja superior a 0.12 H, 0.75 em, solo en su intervalo), `switchLyricMode(c, mode)` (no toca `words`,
  `style`, `background`, `range`, `seed`). Todo en `lyricSceneAt` y en `lyricAss` con las mismas funciones.
- `packages/composition/src/lyricmodes.test.ts`.
- `apps/web/components/LyricLibrary.tsx` (nuevo): pestañas **Mis vídeos** (exportaciones v2 de la pieza), **Mis
  canciones**, **Paquetes de ganchos** (nombre + un gancho por línea; `save_hook_pack`), **Paquetes de medios** (lista;
  subida en el paso 13), **Estilos de texto** (estilos v2), **Portadas** (colecciones `artwork`; subida en el paso 13).
- `apps/web/components/LyricStudioV2.tsx`: selector de modo (cambiar de modo conserva canción y recursos y nunca borra
  letra ni alineación), intervalo del mensaje, paquete de ganchos y gancho elegido, título/artista de portada.

**Hecho cuando**
- [ ] WHEN la composición está en modo `texto` con un mensaje entre 5 s y 9 s THE SYSTEM SHALL mostrar en `lyricSceneAt` y en `lyricAss` solo ese mensaje y solo en [5, 9) s, sin palabras de la letra.
- [ ] WHEN la composición está en modo `portada` con portada delantera y trasera THE SYSTEM SHALL mostrar el título y el artista, la portada delantera en la primera mitad y la trasera en la segunda, con un zoom creciente de 1.00 a 1.06 en modo `lenta` y fijo en `estatica`, y la letra solo si está activada.
- [ ] WHEN `switchLyricMode` cambia entre `letra`, `texto` y `portada` THE SYSTEM SHALL conservar `words`, `style`, `background`, `range` y `seed` idénticos.
- [ ] WHEN la composición tiene un gancho de un paquete THE SYSTEM SHALL mostrarlo solo dentro de su intervalo y en la franja superior, en `lyricSceneAt` y en `lyricAss`.
- [ ] WHEN se ejecutan `grep -q 'save_hook_pack' apps/web/components/LyricLibrary.tsx`, `grep -q 'Paquetes de ganchos' apps/web/components/LyricLibrary.tsx` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en los tres.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricmodes.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'save_hook_pack' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Paquetes de ganchos' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 11 — modos y ganchos" && git tag rafaga-lyric-v2-step-11`

---

#### Paso 12 — Fondos: paquetes de medios y «Crear desde vídeo» (migración 103)
**Hacer**
- `supabase/migrations/20261201000103_lyric_media.sql` con el SQL de §4 (103).
- `workers/media/src/stages/lyric.ts`: etapa `media_split`. `mode: "propose"`: descarga la mezzanine
  (`mezzaninePath` de `stages/analysis.ts`), `scdet` (`-vf scdet=threshold=10,metadata=print -f null -`) en el
  intervalo, segmentos de duración objetivo `length_s` que empiezan y terminan en cortes detectados o en los extremos del
  intervalo, entre `min_s` (por defecto 1.5) y `max_s` (por defecto `length_s` × 1.5); salida (≤ 60 segmentos) en
  `job_stages.output.segments`. `mode: "cut"`: por segmento, `rapido` = `-ss S -i mezz -t L -map 0:v:0 -c copy -an`
  (empieza en el fotograma clave anterior: la mezzanine tiene uno por segundo) o `exacto` = recodifica H.264 `-an` a la
  duración pedida; sube a `<ws>/media/<id>.mp4` y llama a `add_split_item`. El audio del fondo nunca se conserva.
- `workers/media/src/lyric_media.test.ts` (fixture `scenes` registrado como fuente `validated` con su mezzanine en el R2
  simulado).
- `apps/web/lib/routes/lyrics.ts` y `apps/web/lib/lyrics.test.ts`: rutas del paso 12 de §5 (incluida `/api/lyrics/demo` →
  `open_lyric_demo`; el worker la completa en el paso 17).

**Hecho cuando**
- [ ] WHEN `media_split` propone segmentos de duración objetivo 3 s en el fixture `scenes` (cambios de color en 2 s y 4 s) THE SYSTEM SHALL devolver segmentos que empiezan y terminan en un cambio de escena detectado por `scdet` o en un extremo del intervalo, con 0.1 s de tolerancia, y de duración entre `min_s` y `max_s`.
- [ ] WHEN se cortan los segmentos revisados con `cut_mode = "exacto"` THE SYSTEM SHALL crear un `media_items` por segmento con duración a 1 fotograma o menos de la pedida, y con `rapido` (copia de flujo sin recodificar) SHALL crearlo con duración a 1.05 s o menos de la pedida; en ambos casos sin pista de audio y con `audio_muted = true`.
- [ ] WHEN se excluye un segmento en la revisión THE SYSTEM SHALL no crear su elemento, y cada elemento creado SHALL tener `storage_backend = 'r2'`, clave `<ws>/media/<id>.mp4` y un objeto registrado de tipo `media`.
- [ ] WHEN `POST /api/lyrics/media/items` recibe un archivo de más de 209715200 bytes, o uno que con el uso actual supera 10737418240 THE SYSTEM SHALL responder 413 `{ limit: 209715200 }` o 507 `{ quota: 10737418240 }` sin crear el elemento, y con un archivo válido SHALL responder 201 `{ item_id, url, expires_at }` con una URL PUT de R2 de 900 s.
- [ ] WHEN `POST /api/lyrics/media/split` o `POST /api/lyrics/media/cut` llega dos veces con la misma `Idempotency-Key` THE SYSTEM SHALL devolver el mismo `job_id`, y una duración objetivo distinta de 3, 5, 10, 15 o 30 s SHALL responder 400 `{ error: { code: "invalid_params" }, field: "length_s" }`.
- [ ] WHEN el usuario B pide `GET /api/lyrics/media/items/:id/url` o `POST /api/lyrics/media/split` sobre recursos de A, o llega `POST /api/lyrics/demo` sin `Idempotency-Key` THE SYSTEM SHALL responder 404, 404 y 400, y `POST /api/lyrics/demo` con clave SHALL responder 202 `{ song_id, project_id, job_id }`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_media.test.ts apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 12 — paquetes de medios" && git tag rafaga-lyric-v2-step-12`

---

#### Paso 13 — Fondos, portadas y ajustes en la interfaz
**Hacer**
- `apps/web/lib/lyricsettings.ts` (puro): `FILTER_OPTIONS` = `none`, `noche`, `super8`, `bn`, `vapor` con etiquetas propias
  («Ninguno», «Noche», «Super 8», «Blanco y negro», «Vapor»); `validateLyricSettings` (recorte 0–1, oscurecer 0–0.8,
  intervalo 2–15 s, `sizeFine` 0.6–1.6, filtro desconocido → `none`, ajuste `preserve|fill|band`);
  `settingsToComposition(c, ui)` (solo `background` y `settings`); `orientationOf(w, h)` (`vertical`, `horizontal`,
  `cuadrado`); `filterByClass(items, filtros)`; `officialCollections(rows)` → `{ items, empty }` con el texto del estado vacío.
- `apps/web/lib/lyricsettings.test.ts`.
- `apps/web/components/LyricSettings.tsx`: secuencia/intervalo/orden/bucle/ajuste, recorte cinematográfico, oscurecer,
  filtros, tamaño S/M/L + fino, sacudida, fundir con el vídeo, ligeras variaciones, color sólido.
- `apps/web/components/LyricLibrary.tsx`: «Paquetes de medios» (subida directa: `POST /api/lyrics/media/items` → PUT →
  `…/complete` con duración y tamaño leídos en el navegador; clasificar categoría/movimiento/ánimo; excluir), asistente
  **«Crear desde vídeo»** (fuente existente o subida con el cargador actual → intervalo → 3/5/10/15/30 s → revisar/excluir →
  rápido o exacto → guardar), **«Colecciones Ráfaga»** (estado vacío que explica cómo marcar un paquete propio como
  oficial), «Portadas» (subida a una colección `artwork`).
- `apps/web/components/LyricStudioV2.tsx`: usa `LyricSettings` y la elección de colecciones de fondo.

**Hecho cuando**
- [ ] WHEN `validateLyricSettings` recibe recorte 1.4, oscurecer 0.95, intervalo 0.5 s, tamaño fino 2 y un filtro desconocido THE SYSTEM SHALL devolver recorte 1, oscurecer 0.8, intervalo 2 s, tamaño fino 1.6 y filtro `none`.
- [ ] WHEN se leen las opciones de filtro THE SYSTEM SHALL ofrecer exactamente `none`, `noche`, `super8`, `bn` y `vapor`, y ninguna etiqueta visible SHALL ser `Midnight`, `Noir` ni `Vaporwave`.
- [ ] WHEN `filterByClass` filtra elementos por categoría, movimiento, ánimo y orientación (`vertical`, `horizontal` o `cuadrado`, derivada de ancho y alto) THE SYSTEM SHALL devolver solo los que cumplen todos los filtros elegidos.
- [ ] WHEN `officialCollections` recibe 0 colecciones oficiales THE SYSTEM SHALL devolver `empty` con el texto que explica cómo marcar un paquete propio como oficial y ningún elemento.
- [ ] WHEN `settingsToComposition` aplica los ajustes a una composición THE SYSTEM SHALL cambiar solo `background` y `settings` y dejar idénticos `words`, `style`, `range` y `seed`.
- [ ] WHEN se ejecutan `grep -q 'Crear desde vídeo' apps/web/components/LyricLibrary.tsx`, `grep -q 'Colecciones Ráfaga' apps/web/components/LyricLibrary.tsx` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en los tres.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyricsettings.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Crear desde vídeo' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Colecciones Ráfaga' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 13 — fondos y ajustes" && git tag rafaga-lyric-v2-step-13`

---

#### Paso 14 — Motor de render de letra en el worker
**Hacer**
- `packages/composition/src/lyricscene.ts`: `LYRIC_FILTERS` (`noche`, `super8`, `bn`, `vapor`: **las mismas cadenas** que
  `FILTERS.midnight`, `.super8`, `.noir`, `.vaporwave` de `packages/lyrics/src/background.ts`, copiadas; `FILTERS` no se
  toca), `LYRIC_FILTER_CSS` (aproximación para el canvas), `bgRect(fit, item, W, H)` (`fill` recorta, `preserve` cabe
  con negro, `band` banda 16:9 centrada), `lyricRenderArgs(c, io: { audio, items, coverFront?, coverBack?, ass, fontsDir,
  out })` (planos de `lyricShots` con `-stream_loop -1 -ss <entrada> -t <dur>` o `-loop 1 -framerate 30 -t <dur>`, o
  `color` lavfi; `bgRect` → `setsar=1,fps=30,format=yuv420p,trim,setpts`; `concat`; filtro; oscurecer `drawbox`; barras
  `drawbox` de `round(crop × 0.4 × H / 2)` px pares; `subtitles=<ass>:fontsdir=<dir>`; audio `-ss range.start -t duration -i
  <canción>` y **solo** `-map <n>:a:0 -c:a aac -b:a 192k`, sin filtros de audio; `-c:v libx264 -preset superfast -crf 20 -r
  30 -t duration -movflags +faststart`), `planLyricVariants(base, n, locks, opts)` (candados `song_range`,
  `lyrics_sync`, `style`, `background`, `format`; N exactas; semilla `seed × 1000 + i`; lo no bloqueado rota entre
  `opts.styles`, `opts.collections`, `opts.aspects`, `opts.ranges` —momentos musicales de `audioMoments`—; `variation` >
  0 aplica jitter acotado), `variantHash(c)` (FNV-1a de 64 bits en hex de los parámetros que varían),
  `nearDuplicates(items, maxBits = 4)`.
- `packages/composition/src/lyricrender.test.ts` (argumentos puros, planificador, hashes).
- `workers/media/src/stages/export.ts`: en `render.run`, antes de la rama de texto, `if ((it.composition as { kind?: string
  }).kind === "lyric") return renderLyricItem(ctx, it, { key, dir: d, fail })` (de `./lyric.ts`); en `EXT` y `MIME` añadir
  `lrc: "lrc"`, `lrc_word: "lrc"`, `ass: "ass"` y `text/plain`, `text/plain`, `text/x-ssa`. Nada más cambia.
- `workers/media/src/stages/lyric.ts`: `renderLyricItem` (MP4): descarga el original de la canción, los fondos y las portadas
  de R2, escribe `lyricAss`, ejecuta `lyricRenderArgs`, ffprobe (H.264 yuv420p, tamaño de `lyricFrameSize`), hash
  perceptivo del primer fotograma (8×8 gris → 16 hex) en `probe.ahash`, sube a `exportKey(it)` y `finish_render`; fallo →
  `fail("render_failed", …)` (el lote sigue). Tipos de texto → `not_implemented` hasta el paso 16.
- `workers/media/src/lyric_render.test.ts` (ffmpeg real a 720p sobre composiciones de 3 s; R2 simulado; compara
  `LYRIC_FILTERS` con `FILTERS` de `@rafaga/lyrics`).

**Hecho cuando**
- [ ] WHEN `lyricRenderArgs` genera los argumentos para cada ajuste (recorte, oscurecer, cada filtro, sacudida, fundido, ajuste `preserve`, `fill` y `band`, secuencia y color sólido) THE SYSTEM SHALL producir argumentos sin shell en los que el audio se mapea solo desde la canción, sin filtros de audio, con `-c:a aac -b:a 192k`.
- [ ] WHEN `LYRIC_FILTERS` se compara con `FILTERS` de `@rafaga/lyrics` THE SYSTEM SHALL tener `noche`, `super8`, `bn` y `vapor` idénticos a `midnight`, `super8`, `noir` y `vaporwave`, y `FILTERS` de v1 SHALL seguir sin cambios.
- [ ] WHEN el worker renderiza a 720p una composición de 3 s con cada ajuste THE SYSTEM SHALL producir un MP4 H.264 yuv420p de 720×1280 en 9:16, el recorte SHALL dejar negras las filas de las barras, oscurecer SHALL bajar la luminancia media y `bn` SHALL dejar la saturación media por debajo de 2.
- [ ] WHEN se renderizan dos variantes con estilos y fondos distintos sobre el mismo tramo de la misma canción THE SYSTEM SHALL producir pistas de audio cuyo MD5 de las muestras decodificadas (`ffmpeg -map 0:a -f md5`) es idéntico.
- [ ] WHEN `planLyricVariants` planifica N variantes con candados de canción y tramo, letra y sincronización, estilo, colección de fondo y formato THE SYSTEM SHALL devolver exactamente N composiciones con semillas distintas que solo difieren en lo no bloqueado, y `nearDuplicates` SHALL marcar los pares cuyo `variantHash` coincide o cuyo hash perceptivo del primer fotograma dista 4 bits o menos.
- [ ] WHEN un lote de 2 variantes de letra tiene una cuyo fondo no existe en el R2 simulado THE SYSTEM SHALL dejar esa exportación `failed` con `render_failed` y la otra `ready` con `probe.ahash` de 16 caracteres hexadecimales, y el lote SHALL quedar `partial`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricrender.test.ts workers/media/src/lyric_render.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 14 — render de letra" && git tag rafaga-lyric-v2-step-14`

---

#### Paso 15 — Variantes N con candados, lotes y reintento (migración 104)
**Hacer**
- `supabase/migrations/20261201000104_lyric_variants.sql` con el SQL de §4 (104), incluida la recreación literal de
  `request_exports` con la línea de validación ampliada.
- `apps/web/lib/routes/lyrics.ts` y `apps/web/lib/lyrics.test.ts`: `POST /api/lyrics/projects/:id/variants`; la prueba de
  aislamiento usa `handleExports` (`routes/exports.ts`) para la URL y el reintento.
- `apps/web/components/LyricResults.tsx` (nuevo): variantes con estado, avisos `near_duplicate`, descarga (`GET
  /api/exports/:id/url`), «Reintentar» (`POST /api/exports/:id/retry`), ZIP del lote.
- `apps/web/components/LyricStudioV2.tsx`: panel «Generar N variantes» (1–10) con candados, planifica con
  `planLyricVariants`, 720p/1080p, formato 9:16 por defecto (también 1:1, 4:5, 16:9).

**Hecho cuando**
- [ ] WHEN `POST /api/lyrics/projects/:id/variants` llega 3 veces con la misma `Idempotency-Key` y 3 variantes THE SYSTEM SHALL crear 1 generación, 3 clips con su versión 1 inmutable, 3 exportaciones MP4 en un lote y 1 trabajo, y responder 202 con los mismos identificadores las 3 veces.
- [ ] WHEN se piden 0 u 11 variantes o una composición que no es de letra THE SYSTEM SHALL responder 400 `{ error: { code: "invalid_params" }, field: "variants" }` sin escribir nada.
- [ ] WHEN dos variantes tienen el mismo `variant_hash` THE SYSTEM SHALL crearlas igualmente y añadir a `generations.warnings` `{ "code": "near_duplicate", "variants": [i, j] }`.
- [ ] WHEN una de las 3 exportaciones del lote falla THE SYSTEM SHALL mantener las otras 2 descargables con `GET /api/exports/:id/url`, y `POST /api/exports/:id/retry` SHALL reencolar solo la fallida.
- [ ] WHEN se pide un lote de variantes THE SYSTEM SHALL escribir 0 filas en `credit_ledger`, y `request_exports` SHALL aceptar `4:5`, `lrc`, `lrc_word` y `ass` además de los formatos y tipos de clipping.
- [ ] WHEN se ejecutan `grep -q 'planLyricVariants' apps/web/components/LyricStudioV2.tsx`, `grep -q 'retry' apps/web/components/LyricResults.tsx` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en los tres.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'planLyricVariants' apps/web/components/LyricStudioV2.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'retry' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 15 — variantes" && git tag rafaga-lyric-v2-step-15`

---

#### Paso 16 — Formatos de letra y publicación
**Hacer**
- `workers/media/src/stages/lyric.ts`: `renderLyricItem` para `srt` (`toSrtLyrics`), `vtt` (`toVttLyrics`), `lrc`
  (`toLrc`), `lrc_word` (`toLrcEnhanced`), `ass` (`toAssKaraoke`), `txt` (`toTxtLyrics`) con las palabras de la composición
  relativas al tramo; sube con su MIME y `finish_render`.
- `workers/media/src/lyric_formats.test.ts` (R2 simulado; re-lee cada archivo con `importLyrics`).
- `apps/web/components/LyricResults.tsx`: menú de formatos (pide `request_exports` vía `POST /api/exports` con `kind`),
  quemado o limpio, «Publicar»/«Programar» (`POST /api/publish`, YouTube y TikTok; estados y errores de clipping),
  «Compartir» (`create_delivery` con clip y versión; enlace con `share_links`).
- `apps/web/lib/lyricshare.test.ts`: como `integrations.test.ts`, importa `handleIntegrations` y `STAGE_IMPLS` de
  `../../../workers/media/src/stages/integrations.ts` con `fetch` simulado; entregas con PGlite.

**Hecho cuando**
- [ ] WHEN el worker exporta una variante de letra como `srt`, `vtt`, `lrc`, `lrc_word`, `ass` y `txt` THE SYSTEM SHALL subir un archivo por formato con su extensión y tipo MIME, y `importLyrics` SHALL leer el SRT, el VTT y los dos LRC con las mismas líneas y tiempos a 10 ms o menos de la composición.
- [ ] WHEN se exportan `lrc` y `lrc_word` THE SYSTEM SHALL escribir el LRC de línea `[mm:ss.xx]texto` y el LRC mejorado con `<mm:ss.xx>` antes de cada palabra, y `ass` SHALL llevar una etiqueta `{\kN}` por palabra.
- [ ] WHEN `POST /api/publish` llega para una exportación MP4 de letra hacia YouTube con la plataforma simulada THE SYSTEM SHALL crear la publicación, y la etapa `publish` SHALL enviar `videos.insert` con la privacidad elegida y dejar `private_pending_review` si la respuesta queda en privado cuando se pidió otra.
- [ ] WHEN TikTok responde `unaudited_client_can_only_post_to_private_accounts` para una variante de letra THE SYSTEM SHALL dejar la publicación en `requiere_auditoria`, y con `scheduled_at` futuro SHALL quedar `scheduled` sin llamar a la plataforma.
- [ ] WHEN se crea una entrega con `create_delivery` con 2 variantes de letra (clip y versión) THE SYSTEM SHALL crear la entrega con sus 2 elementos fijados a la versión 1, y el usuario B SHALL no verla.
- [ ] WHEN se ejecutan `grep -q '/api/publish' apps/web/components/LyricResults.tsx`, `grep -q 'create_delivery' apps/web/components/LyricResults.tsx` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en los tres.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_formats.test.ts apps/web/lib/lyricshare.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q '/api/publish' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'create_delivery' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 16 — formatos y publicación" && git tag rafaga-lyric-v2-step-16`

---

#### Paso 17 — Demo de canción y rendimiento
**Hacer**
- `workers/media/src/stages/lyric.ts`: en `song_validate`, si `params.demo`, sintetiza el audio con `DEMO_AUDIO_EXPR`
  (AAC en contenedor M4A), lo sube a la clave del original, valida como cualquier canción, llama a `finish_song_validate`
  con `p_lyrics = DEMO_SONG.lyrics` y guarda `save_song_alignment(kind 'manual')` con `DEMO_SONG.words` (sin ASR).
- `workers/media/src/lyric_demo.test.ts`.
- `scripts/lyric-perf.ts --quick` (importa SOLO por ruta relativa, como `scripts/perf-run.ts`: `../workers/media/src/fixtures.ts`, `../workers/media/src/stages/runner.ts`, `../supabase/tests/migrate.ts`, `../workers/media/src/stages/lyric.ts` y `../packages/composition/src/index.ts`; nunca `@rafaga/*` desde `scripts/`, porque la raíz no lo declara): fixture `song180`, `song_validate` + `lyric_sync` con ASR simulado de retardo fijo (1500 ms) sobre
  PGlite → `sync_ms`; `lyricLayout` + primer `lyricSceneAt` + `lyricAss` → `preview_ready_ms`; 3 variantes 1080p en
  paralelo con `renderLyricItem` y R2 simulado → `render_ms` p50 y p95 (rango más cercano: con 3 muestras, p95 = máximo);
  escribe la sección entre `<!-- lyric-perf:start -->` y `<!-- lyric-perf:end -->` de `docs/PERF.md` (la crea si no
  existe, la sustituye si existe) con fecha, entorno (CPU, SO, ffmpeg) y la tabla `sync_ms`, `preview_ready_ms`,
  `render_ms_p50`, `render_ms_p95`; el resto del archivo no se toca.
- `docs/PERF.md`: actualizado por el script.

**Hecho cuando**
- [ ] WHEN `open_lyric_demo` se ejecuta dos veces y el worker procesa ambas THE SYSTEM SHALL crear dos canciones `ready` distintas en el workspace con el audio sintético de `DEMO_SONG` en R2 y su revisión 1 `manual` con las palabras de `DEMO_SONG`, sin ninguna llamada al ASR.
- [ ] WHEN se edita la alineación de la primera copia THE SYSTEM SHALL dejar idénticas la alineación de la segunda copia y la constante `DEMO_SONG`.
- [ ] WHEN se ejecuta `node scripts/lyric-perf.ts --quick` THE SYSTEM SHALL generar una canción sintética de 180 s, sincronizarla con ASR simulado, renderizar 3 variantes a 1080p en paralelo y escribir en `docs/PERF.md`, entre `<!-- lyric-perf:start -->` y `<!-- lyric-perf:end -->`, `sync_ms`, `preview_ready_ms`, `render_ms_p50` y `render_ms_p95`.
- [ ] WHEN `docs/PERF.md` ya tiene la sección de clipping THE SYSTEM SHALL conservarla (`first_clip_ms` sigue presente) y una segunda ejecución SHALL sustituir la sección de letra en lugar de duplicarla.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_demo.test.ts
export PATH="$HOME/.local/bin:$PATH" && node scripts/lyric-perf.ts --quick
export PATH="$HOME/.local/bin:$PATH" && grep -q 'render_ms_p95' docs/PERF.md
export PATH="$HOME/.local/bin:$PATH" && grep -q 'first_clip_ms' docs/PERF.md
export PATH="$HOME/.local/bin:$PATH" && test "$(grep -c 'lyric-perf:start' docs/PERF.md)" = 1
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```
**Checkpoint:** `git add -A && git commit -m "rafaga-lyric-v2: paso 17 — demo y rendimiento" && git tag rafaga-lyric-v2-step-17`

---

#### Paso 18 — Transición: Looks clásicos, vídeos anteriores y demo en la interfaz
**Hacer**
- `apps/web/lib/lyriccutover.ts` (importa `@rafaga/lyrics` y `@rafaga/composition`): `classicPresets()` convierte
  `LOOKS.archivo|diario|panoramico` en presets «Looks clásicos» (`CaptionStyleV2` con caja `lower`, color y peso del look,
  posición del bloque; fondo con ajuste `fill`/`band` según la relación de aspecto de la imagen, recorte y oscurecer
  derivados); `libraryVideos(legacy, v2)` (une filas de `lyric_videos` y exportaciones v2 con su estado y su origen);
  `songBadge(song)` («Clásica» si no hay `source_id`).
- `apps/web/lib/lyriccutover.test.ts`.
- `apps/web/components/CaptionStyleEditor.tsx`: grupo «Looks clásicos».
- `apps/web/components/LyricLibrary.tsx`: «Mis vídeos» incluye `lyric_videos` anteriores (`ready` con su descarga actual de
  Supabase Storage), canciones v1 con «Clásica» y solo el enlace al flujo v1, botón «Probar con la canción de demostración»
  (`POST /api/lyrics/demo`).

**Hecho cuando**
- [ ] WHEN `classicPresets()` convierte `archivo`, `diario` y `panoramico` THE SYSTEM SHALL devolver tres presets «Looks clásicos» con un `CaptionStyleV2` válido (caja `lower`, color del look, peso 400 o 700) y ajustes de fondo derivados del look, y `LOOKS` de v1 SHALL seguir sin cambios.
- [ ] WHEN `libraryVideos` recibe filas de `lyric_videos` anteriores y exportaciones v2 THE SYSTEM SHALL incluir ambas con su estado y su origen, y las anteriores `ready` SHALL conservar su ruta de descarga de Supabase Storage.
- [ ] WHEN una canción no tiene `source_id` THE SYSTEM SHALL marcarla «Clásica» con `songBadge` y no ofrecerla al flujo v2.
- [ ] WHEN se ejecutan `grep -q 'Looks clásicos' apps/web/components/CaptionStyleEditor.tsx`, `grep -q '/api/lyrics/demo' apps/web/components/LyricLibrary.tsx` y `grep -q 'lyric_videos' apps/web/components/LyricLibrary.tsx` THE SYSTEM SHALL salir con 0 en los tres.
- [ ] WHEN se ejecutan `grep -q 'request_lyrics' apps/web/app/app/lyric-studio/page.tsx`, `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` THE SYSTEM SHALL salir con 0 en los tres: la página v1 sigue pidiendo vídeos con `request_lyrics`.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyriccutover.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Looks clásicos' apps/web/components/CaptionStyleEditor.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q '/api/lyrics/demo' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'lyric_videos' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'request_lyrics' apps/web/app/app/lyric-studio/page.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```
**Checkpoint**
```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 18 — transición" && git tag rafaga-lyric-v2-step-18
test "$(git tag -l 'rafaga-lyric-v2-step-*' | wc -l | tr -d ' ')" = 18   # exit 0 — la etiqueta de arriba es la 18.ª
```

---

### 9.1 Paridad y transición
Migración: Lyric Studio v1 (página actual, trabajos `lyrics` `engine = 'v1'`, `run.ts`, `songs`/`song_alignments`/
`lyric_videos`, looks `archivo|diario|panoramico`) → flujo v2 (etapas, `renders`, motor de escena compartido).

#### Paridad
| # | Comportamiento que se mantiene | Prueba | Tolerancia |
|---|---|---|---|
| 1 | La página v1 sigue creando vídeos de canciones existentes | `request_lyrics` → trabajo `engine = 'v1'` que `claim_job()` entrega (`lyric_v2.test.ts`); `grep -q 'request_lyrics'` en la página (paso 18) | exacta |
| 2 | Sincronización manual v1 | `save_manual_alignment` guarda `manual:<sha>` (`lyric_v2.test.ts`) | exacta |
| 3 | `lyric_videos` anteriores listados y descargables | `libraryVideos` (paso 18) + RLS de `lyric_videos` intacta | exacta |
| 4 | Looks v1 | `LOOKS`, `FILTERS` sin cambios (pasos 14 y 18); los «Looks clásicos» v2 son aproximaciones, no clones | v1 exacta; v2 aproximada a propósito |
| 5 | Subidas de vídeo de clipping | `complete_upload` sigue creando `validate`/`mezzanine`/`proxy` (paso 2) + `uploads.test.ts` | exacta |
| 6 | Exportaciones de clipping | `request_exports` recreado como superconjunto + `exports.test.ts` | exacta |
| 7 | Vista previa = exportación (v2) | `lyricparity.test.ts`, `lyric_ass.test.ts` | ≤ 1 fotograma; ≤ 2 px |

**Sombra:** 14 días con `NEXT_PUBLIC_LYRIC_VERSION=v2` en el despliegue de vista previa de Vercel y `v1` en producción; el
propietario genera en paralelo con las mismas canciones (re-subidas) en v1 y v2. Paridad = 0 fallos de `pnpm test` en
`main` y < 10 % de renders de letra fallidos por cada 24 h.

#### Transición
| Fase | Cambio | Afecta a | Se revierte con | Comprobación |
|---|---|---|---|---|
| 1 Oscuro | migraciones 100–104 aplicadas; `NEXT_PUBLIC_LYRIC_VERSION` sin definir (= v1) | nadie | dejar la bandera en `v1` (las migraciones aditivas se quedan) | `select to_regclass('public.lyric_projects')` no nulo |
| 2 Canario | `NEXT_PUBLIC_LYRIC_VERSION=v2` solo en Preview | el propietario | quitar la variable + redeploy | manual: aceptación LC-L3 (canción cantada real), sin código de salida |
| 3 Completa | `NEXT_PUBLIC_LYRIC_VERSION=v2` en Production | todo uso nuevo | `v1` + redeploy (~2–3 min) | `select count(*) from renders r join clip_versions v on v.clip_id = r.clip_id and v.version = r.clip_version where v.composition->>'kind' = 'lyric' and r.status = 'ready'` > 0 |
| 4 Desmantelar | D2 | todos | `git revert` del commit de D2 + redeploy | `test "$(grep -c 'LyricStudioV1' apps/web/app/app/lyric-studio/page.tsx \|\| true)" = 0` |

Todas son acciones del propietario. **Interruptor:** `NEXT_PUBLIC_LYRIC_VERSION=v1` en Vercel + redeploy (~2–3 min, no
instantáneo); los trabajos y renders v2 en curso terminan igualmente.

#### Criterios de abandono (los vigila el propietario)
- [ ] WHEN la fracción de renders de letra (`composition->>'kind' = 'lyric'`) `failed` en 24 h supera 0.10 THE SYSTEM SHALL volver a `NEXT_PUBLIC_LYRIC_VERSION=v1`.
- [ ] WHEN la fracción de etapas `lyric_sync` `failed` en 24 h supera 0.20 THE SYSTEM SHALL volver a v1.
- [ ] WHEN `(public.compute_meter()->>'pct')::numeric` supera 90 THE SYSTEM SHALL detener las variantes nuevas (falla cerrado por `enqueue_job`) hasta el mes siguiente.
- [ ] WHEN `lyricparity.test.ts` falla en `main` THE SYSTEM SHALL volver a v1.

#### Migración de datos
NOT APPLICABLE — no se mueven datos: las canciones v1 siguen en Supabase Storage y en el flujo v1; para usar una en v2 se
re-sube. No hay punto de no retorno hasta D2.

#### Desmantelamiento — tarea D2
Tras 14 días seguidos sin criterios de abandono: (1) quitar `LyricStudioV1` y la rama de la bandera de
`lyric-studio/page.tsx` y `style-studio/page.tsx`; (2) dejar de encolar `request_lyrics` (la función se queda para los
datos); (3) quitar `processLyrics` de `run.ts` solo cuando D1 de clipping haya retirado el worker heredado; (4) registrar
en `docs/STATUS.md` y `docs/provisioning-manifest.json`. Respaldo: etiqueta `rafaga-lyric-v2-step-18`.

---

## 10. Configuración del entorno

### Requisitos previos
| Herramienta | Versión | Comprobación |
|---|---|---|
| Node.js | ≥ 24 | `node --version` |
| pnpm | 12.18.0 en `~/.local/bin` | `pnpm --version` |
| ffmpeg/ffprobe (con libass, `scdet`, `ebur128`, libopus) | 9.0.2 en `~/.local/bin` | `ffmpeg -hide_banner -version` |
| Python | 3.10–3.15 | `python3 -c "import sys; print(sys.version)"` |
| Red | npm; Google Fonts y GitHub raw solo para `node scripts/fetch-fonts.ts --write` (Hacer del paso 7) | — |

Cuentas: las de clipping v2; ninguna nueva. Ninguna hace falta para construir.

### Variables de entorno
Sin validador global; cada ruta o etapa lee las suyas y responde `not_configured` si faltan. Las pruebas no leen `.env`.

| Variable | Para qué | Dónde se obtiene | Requerida desde | Secreto |
|---|---|---|---|---|
| `NEXT_PUBLIC_LYRIC_VERSION` | `v1` (defecto) o `v2`: qué Lyric Studio y Style Studio se muestran | transición (§9.1) | 3 (opcional; sin ella = v1) | no |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | firmar audio, medios y subidas | existentes (clipping) | 3 | claves sí |
| `GROQ_API_KEY`, `GROQ_LIMITS` | ASR de `lyric_sync` | existentes | 5 (las pruebas usan ASR simulado) | clave sí |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RAFAGA_CPU_CORES`, `RAFAGA_MEM_GIB`, `WORKER_BACKEND`, `WAKE_SECRET`, `MODAL_DISPATCH_URL`, `GOOGLE_*`, `TIKTOK_*` | worker, despacho y publicación | existentes (clipping) | sin cambios | según clipping |

### Archivos que deben confirmarse
| Archivo | Por qué | Excepción en `.gitignore` |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/rules/lyric-studio.md` | agente (los confirma el Bootstrap en su propio commit) | — ningún patrón los cubre |
| migraciones 100–104 | esquema | — |
| `apps/web/public/fonts/caption/*.ttf`, `packages/composition/src/fontcatalog.ts` | fuentes del vídeo | — `.gitignore` no cubre `.ttf` |
| `docs/PERF.md` | rendimiento | — |
| `blueprints/rafaga-lyric-studio-v2/**` | bundle | — |

Lo que no se confirma ya lo ignora el `.gitignore` existente (`.fixtures/`, `*.mp4`, `node_modules/`, `.next/`). El
`.gitignore` ya existe y precede a cualquier commit de este bundle; ningún paso lo crea ni lo edita.

### Bootstrap
Desde la raíz, sin preguntas; sale con 0 al repetirlo. Es el de clipping v2 más la copia/fusión del espacio de trabajo de
letra. **Se ejecuta en una sesión con permisos manuales** (el propietario o el hilo principal): sus comandos de copia y
fusión no están en `allow` a propósito, porque esa lista es del constructor desatendido. Confirma lo que fusiona en su
propio commit, de modo que el paso 1 empieza con el árbol limpio salvo `blueprints/`.
```bash
# orden: PATH → repo y primer commit solo si faltan (.gitignore ya existe y va antes) → regla copiada sin pisar
#        → fusión de CLAUDE.md, AGENTS.md y settings.json (idempotente) → commit solo si cambió algo → instalar → comprobar
export PATH="$HOME/.local/bin:$PATH"
node --version
pnpm --version
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
git rev-parse -q --verify HEAD >/dev/null || { git add -A && git -c user.name=rafaga-builder -c user.email=builder@localhost commit -q -m "chore: base rafaga-lyric-v2"; }
W=blueprints/rafaga-lyric-studio-v2/workspace
mkdir -p .claude/rules && { [ -e .claude/rules/lyric-studio.md ] || cp "$W/.claude/rules/lyric-studio.md" .claude/rules/lyric-studio.md; }   # nunca pisa; las dos ramas salen con 0
grep -q 'rafaga-lyric-v2:merged' CLAUDE.md || { printf '\n' >> CLAUDE.md && cat "$W/CLAUDE.md" >> CLAUDE.md; }   # añade la sección de letra una sola vez
grep -q 'rafaga-lyric-v2:merged' AGENTS.md || { printf '\n' >> AGENTS.md && cat "$W/AGENTS.md" >> AGENTS.md; }
node -e 'const fs=require("fs");const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const p=".claude/settings.json";const r=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{permissions:{allow:[],deny:[]}};r.permissions=r.permissions||{};for(const k of ["allow","deny"]){const s=new Set(r.permissions[k]||[]);for(const x of w.permissions[k])s.add(x);r.permissions[k]=[...s];}fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n");' "$W/.claude/settings.json"   # unión: repetirla no cambia nada
test -z "$(git status --porcelain -- CLAUDE.md AGENTS.md .claude)" || { git add -- CLAUDE.md AGENTS.md .claude && git -c user.name="$(git config user.name || echo rafaga-builder)" -c user.email="$(git config user.email || echo builder@localhost)" commit -q -m "chore: espacio de trabajo rafaga-lyric-v2"; }   # segunda ejecución: nada que confirmar, sale con 0
pnpm install --frozen-lockfile
python3 -c "import sys; print(sys.version)"
pnpm test
```
Nunca se sobrescriben: `CLAUDE.md` (solo se le añade una vez), `AGENTS.md` (ídem), `.claude/settings.json` (solo se unen
entradas), `.claude/rules/*`, `package.json`, `pnpm-lock.yaml`.

---

## 11. Dependencias

Tabla de procedencia **reutilizada literalmente del bundle de clipping v2** (informe de `stack-researcher`, 2026-11-13). **No
se añaden dependencias npm** ni se actualiza ninguna; ningún `package.json` cambia (salvo nada: este bundle no añade
subrutas de `exports`).

| Paquete | Versión | Estado | Fuente | Comprobado | Instalado por | Propósito |
|---|---|---|---|---|---|---|
| next | 16.4.5 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap (`pnpm install --frozen-lockfile`) | web |
| react / react-dom | 19.3.1 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | UI |
| @supabase/supabase-js | ^2.119.0 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | cliente BD |
| tailwindcss / @tailwindcss/postcss | 4.3.5 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | estilos |
| typescript | ~5.9 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | typecheck |
| @electric-sql/pglite | 0.5.15 | repo lockfile, not upgraded, not re-checked | `pnpm-lock.yaml` | 2026-11-13 | §10 Bootstrap | BD en pruebas |
| pnpm | 12.18.0 | repo lockfile, not upgraded, not re-checked | `package.json` | 2026-11-13 | requisito local | gestor |
| ffmpeg (local e imagen Modal) | 9.0.2; imagen: tag `autobuild-2026-11-10-12-39`, SHA-256 `8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4` | VERIFIED (repo pin + BtbN releases) | https://github.com/BtbN/FFmpeg-Builds/releases | 2026-11-13 | requisito local; imagen de clipping (`app.py`, sin cambios) | render, libass, `scdet`, `ebur128` |
| Node (imagen Modal) | 24.22.3 | VERIFIED | https://nodejs.org/dist/index.json | 2026-11-13 | imagen de clipping (sin cambios) | runtime nube |

| Recurso | Dato | Estado | Fuente | Comprobado | Instalado por |
|---|---|---|---|---|---|
| Groq `whisper-large-v3-turbo` | Production; ≤ 25 MB por archivo usado | VERIFIED (informe de clipping) | https://console.groq.com/docs/models | 2026-11-13 | — (API) |
| Fuentes de Google Fonts (15 familias, pesos de §9 paso 7) | archivos TTF estáticos; sha256 y licencia por archivo en `fontcatalog.ts` | VERIFIED 2026-11-14 (API CSS con UA antiguo → TTF; rutas raw de google/fonts → 200) — verify before install (no están en el informe; que la API CSS devuelva TTF a un agente sin WOFF2 no está comprobado) | https://fonts.google.com · https://github.com/google/fonts | 2026-11-13 | paso 7 (`node scripts/fetch-fonts.ts --write`) |

**Deliberadamente no usados:** opentype.js y fontkit (`readMetrics` existente), una librería de LRC/SRT (formatos en
`formats.ts`), wavesurfer.js (línea de tiempo propia), cualquier SDK de TikTok/YouTube (los de clipping), sharp (hash
perceptivo con ffmpeg).

---

## 12. Estrategia de despliegue

Igual que clipping v2: web en Vercel Hobby (`pnpm --filter @rafaga/web build`, push a `main` por el propietario), worker
en Modal app `rafaga-worker` **sin cambios en `workers/modal/app.py`** (las etapas nuevas viven en el mismo `stage.ts
--drain`; `dispatch` lanza hasta `MAX_PARALLEL = 4` contenedores, así que las variantes de un lote se renderizan hasta 4 a
la vez, una por contenedor), migraciones a mano (LC-L1). Las fuentes viajan dentro del repo que la imagen copia
(`apps/web/public/fonts/caption/`). Vuelta atrás: «Promote» del despliegue anterior en Vercel, interruptor de §9.1, por
paso `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD`. Sin CI (la puerta de §20.1 se ejecuta en local). DNS/TLS sin
cambios.

| Entorno | Rama | URL | BD | Terceros |
|---|---|---|---|---|
| Construcción | — | — | PGlite | simulados |
| Preview | ramas | automática de Vercel | `rafaga-studio-beta` | reales (canario §9.1) |
| Producción | `main` | https://rafaga-studio.vercel.app | `rafaga-studio-beta` | reales |

---

## 13. Estrategia de pruebas

| Capa | Framework | Cubre | Dónde |
|---|---|---|---|
| Unitaria | `node:test` + `node:assert/strict` | alineación, anclas, ediciones, formatos, estilo, escena, modos, ajustes, variantes, catálogo | `packages/*/src/*.test.ts`, `apps/web/lib/*.test.ts` |
| BD | PGlite 0.5.15 | esquema, RLS, RPC, libro, idempotencia | `supabase/tests/lyric_v2.test.ts`, pruebas de ruta y de etapa |
| Rutas | `node:test` + `fakeSupabaseFetch` + `handleLyrics`/`handleExports`/`handleIntegrations` | contratos de §5 | `apps/web/lib/lyrics.test.ts`, `lyricshare.test.ts` |
| Medios | ffmpeg 9.0.2 real sobre fixtures `lavfi` (canción sintética = tonos + silencios; vídeo de escenas) | validación, `ebur128`, `scdet`, cortes, libass, render, audio idéntico | `workers/media/src/lyric_*.test.ts` |
| Paridad | ASS ↔ escena | ≤ 1 fotograma, ≤ 2 px | `lyricparity.test.ts`, `lyric_ass.test.ts` |
| Rendimiento | `scripts/lyric-perf.ts --quick` | `sync_ms`, `preview_ready_ms`, `render_ms` p50/p95 | `docs/PERF.md` |

Cada archivo crea su PGlite y sus datos; ninguna prueba toca la red ni depende del orden; si falta ffmpeg, las pruebas de
medios fallan. **Sin probar a propósito:** E2E de navegador (no hay runner; la lógica vive en `apps/web/lib` y se prueba),
Groq y plataformas reales (lista de lanzamiento), y el aspecto visual de los «Looks clásicos» frente a v1 (aproximación
declarada).

---

## 14. Seguridad y secretos

| Asunto | Control | Dónde |
|---|---|---|
| Secretos | Vercel + secreto de Modal `rafaga-worker`; nunca en repo ni chat | clipping |
| Entrada | validación a mano en `routes/lyrics.ts`; CHECK y validación en RPC | rutas, 100–104 |
| SQL | RPC parametrizadas; `format('%I')` en SQL dinámico | migraciones |
| ffmpeg | argumentos sin shell; texto del usuario solo dentro del ASS escapado (`escapeAss`-equivalente: sin `{}` ni `\`) | `lyricscene.ts` |
| Acceso a archivos | URLs firmadas solo tras `song_object`/`media_item_object`/`export_object` como el usuario; 404 sin firmar | rutas |
| Abuso | ≤ 60 MB y ≤ 10 min por canción, ≤ 200 MB por medio, cuota 10 GB, ≤ 10 variantes, medidor de cómputo | SQL, etapas |
| Datos personales | canciones y medios privados; ninguna letra ni medio en métricas o eventos | — |
| Licencias de fuentes | OFL/Apache registradas por archivo con su URL | `fontcatalog.ts` |
| Registro | nunca tokens, claves, URLs firmadas completas ni letras | `stage.ts`, rutas |

Nunca se toca el proyecto Supabase `splitclaro`. Régimen: datos personales UE, uso privado.

---

## 15. Accesibilidad

WCAG 2.2 AA en las pantallas nuevas sin cambiar el estilo: un `h1` por página; todo por teclado (marcar con la barra
espaciadora mantenida, ←/→ para desplazar una palabra, Mayús+←/→ para redimensionar, Supr para borrar, Ctrl+Z/Ctrl+Mayús+Z;
vista previa: espacio, Esc, flechas para mover la letra); alternativa con botones a todo arrastre (2.5.7); objetivos ≥ 24 px
(2.5.8); `aria-live="polite"` en subida, validación, sincronización y render; palabras dudosas marcadas también con texto
(no solo color); `prefers-reduced-motion` desactiva las animaciones de entrada **en la vista previa de la interfaz**
(el vídeo exportado no cambia).
```bash
# Sin runner automático (sin dependencias nuevas). Comprobación estática mínima:
grep -q 'aria-live' apps/web/components/LyricStudioV2.tsx
```
Pasadas manuales antes de lanzar: teclado de extremo a extremo, lector de pantalla y zoom al 200 %.

---

## 16. Observabilidad y coste

| Señal | Herramienta | Qué captura |
|---|---|---|
| Errores | `job_stages.error_code`, `renders.error_code`, `songs.error_code`, logs de Vercel | fallos de etapa, render y ruta |
| Logs | stdout JSON de `stage.ts` en Modal | cada etapa |
| Métricas | `job_stages` (tiempos), `ai_usage` (`compute`, `stt`), `docs/PERF.md` | tiempos y cómputo |

| Métrica | Objetivo | Alerta |
|---|---|---|
| Renders de letra fallidos 24 h | < 10 % | criterio de abandono |
| `lyric_sync` fallidas 24 h | < 20 % | criterio de abandono |
| Cómputo del mes | < 27 USD | bloqueo automático al 90 % |

| Servicio | Capa gratuita | Uso v1 | Acantilado |
|---|---|---|---|
| Modal | 30 USD/mes | 3 variantes 1080p de 3 min ≈ el tiempo de render medido en `docs/PERF.md` × 2 núcleos | bloqueo al 90 % |
| Groq | límites Free | ≤ 10 min de audio por canción; caché por canción | 429 → `GroqLimiter` |
| R2 | 10 GB | canción ≤ 60 MB; medios ≤ 200 MB c/u; exportaciones caducan a 30 días | cuota |
| Supabase / Vercel | Free / Hobby | filas pequeñas | — |

**Coste estimado: 0 €.** Partida mayor: render en Modal; palancas: render solo al pedir variantes, caché del ASR,
reutilización de exportaciones idénticas. Los límites gratuitos pueden cambiar sin aviso: riesgo aceptado y vigilado.

---

## 17. Enrutado de modelos

| Tarea | Modelo | Respaldo |
|---|---|---|
| Transcripción del canto (ASR con marcas por palabra) para alinear o proponer | Groq `whisper-large-v3-turbo` (el que ya usa clipping, bajo `GroqLimiter`) | reintento de la etapa (3 intentos); sin ASR, «Sincronización manual» con `TapSync` |

No se llama a ningún LLM de texto. El nombre del modelo forma parte de la clave de caché (`asr:<modelo>`) y de `inputs` de
`lyric_sync`, así que cambiar de modelo vuelve a transcribir y vuelve a cobrar. Evaluación: `lyric_sync.test.ts` y
`sync.test.ts` deben seguir verdes ante cualquier cambio.

---

## 18. Skills para la construcción

Ninguna skill externa: el diseño visual está fuera de alcance (descarta `ui-ux-pro-max`, `frontend-design`,
`emil-design-eng`) y no hay E2E (descarta `playwright-cli`). Se reutiliza la skill del proyecto que instaló el Bootstrap de
clipping v2 y ya está en `.claude/skills/`:

| Skill | Pasos | Por qué | Instalación |
|---|---|---|---|
| `apply-migration-locally` | 1, 2, 5, 12, 15 | crear y comprobar migraciones en PGlite | ya presente en `.claude/skills/apply-migration-locally/SKILL.md` (Bootstrap de clipping v2: copia de `blueprints/rafaga-clipping-v2/workspace/.claude/skills/apply-migration-locally/SKILL.md`) |

---

## 19. Espacio de trabajo del agente

Archivos reales en `blueprints/rafaga-lyric-studio-v2/workspace/`, con su ruta del repo. **Este bundle no sustituye nada
del espacio de trabajo de clipping v2: lo amplía.** El Bootstrap (§10) añade una sola vez `workspace/CLAUDE.md` al final del
`CLAUDE.md` raíz y `workspace/AGENTS.md` al final del `AGENTS.md` raíz (marca `rafaga-lyric-v2:merged`), une las listas de
`workspace/.claude/settings.json` con las del raíz y copia sin pisar `workspace/.claude/rules/lyric-studio.md`. Nunca se
emite `.claude/commands/`.

- **19.1 `CLAUDE.md`** — sección adicional (corta; el total tras la fusión debe quedar bajo 200 líneas: `wc -l < CLAUDE.md`): comandos de letra, bucle sobre
  `blueprints/rafaga-lyric-studio-v2/tasks.json`, fronteras, reglas de letra, bandera, etiquetas y vuelta atrás.
- **19.2 `AGENTS.md`** — apéndice breve para agentes que no leen `CLAUDE.md`.
- **19.3 `.claude/settings.json`** — `allow`: todo lo de clipping v2 más `node scripts/fetch-fonts.ts:*` y
  `node scripts/lyric-perf.ts:*`; cubre cada comando de los `Verify`, los Checkpoints, la vuelta atrás y §20.1. `deny`: el
  de clipping (`.env*`, `git push`, `git reset --hard`, `modal …`, `gh workflow run`, `vercel`, `supabase db push`, `psql`,
  `rm -rf`).
- **19.4 Skills** — ninguna nueva (§18).
- **19.5 Reglas** — `lyric-studio.md` (letra, estilo, escena, fuentes, etapa, rutas y migraciones de letra). Las de
  clipping (`migrations.md`, `composition-parity.md`, `worker-stages.md`, `api-routes.md`) siguen aplicando.

### 19.6 Configuración crítica para los Verify
NOT APPLICABLE en cuanto a archivos de configuración nuevos — `node:test` no necesita configuración, PGlite corre en
proceso, los fixtures los genera `workers/media/src/fixtures.ts` (paso 2) y los `tsconfig` existentes ya admiten imports
`.ts`. Los archivos que los `Verify` necesitan los crean sus pasos (pruebas, `fontcatalog.ts` y TTF del paso 7).

| Archivo | Verify que lo usa | Resolución/entorno | Exclusión del bundle |
|---|---|---|---|
| script `test` del `package.json` raíz (existente) | `pnpm test` | globs explícitos de un nivel; por eso todas las pruebas nuevas viven en `*/src/*.test.ts`, `apps/web/lib/*.test.ts` o `supabase/tests/*.test.ts` | n/a — ningún glob alcanza `blueprints/` |
| `apps/web/tsconfig.json`, `next.config.ts` (existentes) | typecheck/build | `allowImportingTsExtensions`; `transpilePackages` con los `@rafaga/*` | n/a — compilan lo alcanzable desde `apps/web/app` |
| `pnpm-workspace.yaml` (existente) | `pnpm install` | `apps/*`, `packages/*`, `workers/*` | n/a — no incluye `blueprints/*` |
| `.claude/settings.json` (fusionado) | ninguno | — | n/a — no recorre el árbol |

#### Matriz de convención de resolución
**Convención:** imports relativos con `.ts` explícito; entre paquetes solo `@rafaga/<pkg>` por su `exports` (`.`);
`packages/composition` y `packages/lyrics` no se importan entre sí; `apps/web` y `workers/media` importan ambos; los scripts
y las pruebas de `apps/web/lib` pueden importar archivos de otros árboles por ruta relativa (precedente:
`apps/web/lib/integrations.test.ts`, `scripts/perf-run.ts`); solo sintaxis TS borrable.

| Contexto | Comando | Forma | Configuración |
|---|---|---|---|
| App | `pnpm --filter @rafaga/web build` | `@rafaga/composition`, `@rafaga/lyrics`, `../../lib/routes/lyrics.ts` | `apps/web/tsconfig.json`, `next.config.ts` (`transpilePackages`) |
| Typecheck | `pnpm --filter @rafaga/web typecheck` | igual | `apps/web/tsconfig.json` |
| Pruebas de paquete | `node --test packages/composition/src/lyricscene.test.ts` | `./lyricscene.ts`, `./fontcatalog.ts` | Node ≥ 24 (elimina tipos) |
| Pruebas web | `node --test apps/web/lib/lyrics.test.ts` | `./routes/lyrics.ts`, `../../../supabase/tests/migrate.ts`, `../../../workers/media/src/stages/integrations.ts` | Node ≥ 24; `@rafaga/*` por symlink de `apps/web/node_modules` |
| Pruebas worker | `node --test workers/media/src/lyric_render.test.ts` | `./stages/lyric.ts`, `@rafaga/composition`, `@rafaga/lyrics` | `workers/media/package.json` ya depende de ambos |
| Scripts | `node scripts/fetch-fonts.ts --check`, `node scripts/lyric-perf.ts --quick` | `../packages/lyrics/src/ttf.ts`, `../workers/media/src/fixtures.ts` | Node ≥ 24; imports solo relativos (`../packages/composition/src/index.ts`, `../workers/media/src/stages/lyric.ts`); nunca `@rafaga/*` desde `scripts/`; las dependencias que arrastran esos módulos se resuelven desde `workers/media` |
| CLI | `node workers/media/src/stage.ts --list` | `import()` perezoso de `./lyric.ts` | `registry.ts` |
| libass | `ffmpeg … subtitles=…:fontsdir=…` | ruta absoluta de `apps/web/public/fonts/caption/` calculada con `new URL(…, import.meta.url)` | fuentes del paso 7 |

#### Reconciliación de valores entre artefactos
| Valor | Fuente | Literal | Otros sitios | Comparado |
|---|---|---|---|---|
| Bundle | este bundle | `blueprints/rafaga-lyric-studio-v2/` | §10 Bootstrap (`W=`), `workspace/CLAUDE.md`, `workspace/AGENTS.md`, epics | sí |
| Marca de fusión | `workspace/CLAUDE.md` y `workspace/AGENTS.md` | `rafaga-lyric-v2:merged` | §10 Bootstrap (`grep -q`), §20.1 | sí |
| Etiquetas | §9 regla 6 | `rafaga-lyric-v2-step-NN` | Checkpoints, `tasks.json`, epics, §20.1, `workspace/CLAUDE.md` | sí |
| Etiquetas requeridas | brief | `rafaga-v2-step-*` (18), `rafaga-v2-step-0[2-8]` + `rafaga-v2-step-1[467]` (10) | paso 1, `tasks.json` E1-T1, epic 01 | sí |
| Bandera | §10 | `NEXT_PUBLIC_LYRIC_VERSION` (`v1`/`v2`) | pasos 3, 9, §9.1, `workspace/CLAUDE.md` | sí |
| Etapas | paso 2 `STAGES` | `song_validate`, `lyric_sync`, `media_split` | 100 (CHECK), 101 (`complete_upload`, `open_lyric_demo`), 102, 103, `stage.ts --list` | sí |
| Migraciones | §4 | `20261201000100_lyric_v2.sql` … `20261201000104_lyric_variants.sql` | §3, pasos 1, 2, 5, 12, 15, regla `lyric-studio.md` | sí |
| Tamaños | §4 | `62914560` (canción), `600000` ms, `209715200` (medio), `10737418240` (cuota), `4000` (estilo), `20` (estilos), `10` (variantes) | 100–104, pasos 1–3, 9, 12, 15 | sí |
| Fuentes | paso 7 | `apps/web/public/fonts/caption/` | `fontcatalog.ts`, `lyric_ass.test.ts`, `LyricPreview.tsx` (`/fonts/caption/`), §12 | sí |
| Filtros v2 | paso 14 | `none`, `noche`, `super8`, `bn`, `vapor` | `lyricsettings.ts`, `LyricComposition.settings.filter` | sí |
| Tipos de render | 100 | `lrc`, `lrc_word`, `ass` (+ los de clipping) | 104 (`request_exports`), `export.ts` (`EXT`/`MIME`), paso 16 | sí |
| Clave ASR | 102 | `asr:<modelo>`, modelo `whisper-large-v3-turbo` | `routes/lyrics.ts`, `lyric_sync` | sí |
| Revisiones | 102 | `v2:r<n>` en `lyrics_sha256` | `save_song_alignment`, `restore_original_alignment` | sí |
| Marcas de rendimiento | paso 17 | `<!-- lyric-perf:start -->` / `<!-- lyric-perf:end -->` | Verify del paso 17, §20.1 | sí |
| Paquete web | `apps/web/package.json` | `@rafaga/web` | §9, §20.1, `settings.json` | sí |

#### Reconciliación byte a byte
NOT APPLICABLE — este blueprint no escribe salida esperada byte a byte: los formatos se comprueban por propiedades y por
ida y vuelta (`importLyrics`), la paridad compara dos cálculos y el render se mide con ffprobe y estadísticas de píxeles.

---

## 20. Puerta de aceptación, riesgos y registro de decisiones

### 20.1 Puerta global
```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm install --frozen-lockfile
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list | grep -qx lyric_sync
export PATH="$HOME/.local/bin:$PATH" && node scripts/fetch-fonts.ts --check
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricparity.test.ts workers/media/src/lyric_ass.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'lyric-perf:start' docs/PERF.md
export PATH="$HOME/.local/bin:$PATH" && test "$(git tag -l 'rafaga-lyric-v2-step-*' | wc -l | tr -d ' ')" = 18
```
Manuales (una vez):
- [ ] Cada archivo de §10 *Archivos que deben confirmarse* está en git, una ruta por invocación
      (`git ls-files --error-unmatch supabase/migrations/20261201000104_lyric_variants.sql`, …) y no está ignorado
      (`git check-ignore -q <ruta>; test $? -eq 1`).
- [ ] El Bootstrap se ha ejecutado dos veces y **ha salido con 0** ambas; `grep -c 'rafaga-lyric-v2:merged' CLAUDE.md`
      imprime 1 y `wc -l < CLAUDE.md` es menor que 200.
- [ ] Cada fila de §19.6 *Reconciliación de valores* dice `sí`; puertas ejecutadas con el bundle presente.
- [ ] §9.1: paridad probada, interruptor accionado una vez, flujo v1 aún operativo.
- [ ] Ningún no-objetivo de §1 construido; ningún proyecto histórico reprocesado.
- [ ] Pasadas de accesibilidad (§15).

#### Lista de lanzamiento (acciones del propietario, no pasos de construcción)
| Id | Acción | Comprobación |
|---|---|---|
| LC-L1 | Aplicar 100→104 en el editor SQL de `rafaga-studio-beta` (después de 034→042) | `select to_regclass('public.lyric_projects')` no nulo |
| LC-L2 | `NEXT_PUBLIC_LYRIC_VERSION=v2` en Preview (canario) y después en Production (§9.1) | despliegue verde |
| LC-L3 | Aceptación con una canción real cantada: subir, sincronizar con Groq real, revisar palabras dudosas, corregir, re-sincronizar | las correcciones se conservan; dudosas resaltadas |
| LC-L4 | Publicar una variante en privado en YouTube y en TikTok | estados `published`/`private_pending_review`/`requiere_auditoria` coherentes |
| LC-L5 | `node scripts/lyric-perf.ts --quick` en el entorno real o comparación con los tiempos de Modal | `docs/PERF.md` actualizado |
| LC-L6 | Revisar las licencias de `CAPTION_FONTS` (`licenceUrl`) | lista confirmada |
| LC-L7 | Registrar en `docs/provisioning-manifest.json` y `docs/STATUS.md` | entradas presentes |
| D2 | Desmantelar el flujo v1 de letra (§9.1) tras 14 días sin criterios de abandono | `test "$(grep -c 'LyricStudioV1' apps/web/app/app/lyric-studio/page.tsx \|\| true)" = 0` |

### 20.2 Registro de riesgos
| Riesgo | Prob. | Imp. | Señal | Mitigación (paso · prueba automática) |
|---|---|---|---|---|
| No hay metraje con licencia gratuito | A | M | «Colecciones Ráfaga» vacío | paquetes propios + «Crear desde vídeo» + estado vacío explicado (12 · `lyric_media.test.ts`; 13 · `lyricsettings.test.ts`) |
| El ASR alinea mal la voz cantada | A | A | muchas palabras `doubtful` | anclas `manual` conservadas, edición fina, resaltado de confianza < 0.5, propuesta separada (4 · `sync.test.ts`; 5 · `lyric_sync.test.ts`; 6 · `synceditor.test.ts`) |
| Deriva vista previa/exportación | M | A | letra desfasada en el MP4 | un motor (`lyricSceneAt`/`lyricAss`) + pruebas doradas y de píxel (8 · `lyric_ass.test.ts`; 10 · `lyricparity.test.ts`) |
| Métricas de fuente distintas en navegador y worker | M | A | texto desplazado | mismo TTF en ambos, sha256 y re-derivación (7 · `fetch-fonts.ts --check`, `captionfonts.test.ts`) |
| Google Fonts no devuelve TTF al script | M | M | `--write` sale con 69 solo si fallan la API CSS y el camino alterno de `google/fonts` (ambos comprobados el 2026-11-14) | sin fuentes, el paso 7 no puede cerrarse en verde (7 · `--check`) |
| Presupuesto de Modal | M | A | `compute_meter().pct` | medidor compartido falla cerrado (clipping 4 · `job_stages.test.ts`); render solo al pedir variantes (15 · `lyrics.test.ts`) |
| Canciones largas | M | M | renders lentos | tope de 10 min y 60 MB (2 · `lyric_song.test.ts`) |
| TikTok sin auditar | A | B | `unaudited_client…` | estado `requiere_auditoria` explicado (16 · `lyricshare.test.ts`) |
| Romper clipping al tocar `complete_upload`, `request_exports`, `export.ts` o `CreationPanel` | M | A | pruebas de clipping rojas | recreaciones como superconjunto y `pnpm test` completo en cada paso (2, 9, 14, 15) |
| Variantes casi idénticas | M | B | aviso `near_duplicate` | `variantHash` + hash perceptivo (14 · `lyricrender.test.ts`; 15 · `lyrics.test.ts`) |
| Explosión de eventos ASS con «sacudida» | B | M | render lento | cortes de 100 ms solo con `shake`; medido en `docs/PERF.md` (14, 17) |

### 20.3 Registro de decisiones
| # | Decisión | Alternativa | Por qué | Se revertiría si |
|---|---|---|---|---|
| 1 | Pieza = `projects` (`mode = 'lyrics'`) + tabla 1:1 `lyric_projects` | 15 columnas en `projects` | regla de reutilización sin ensuciar las filas de clipping | `projects` gane un campo jsonb genérico |
| 2 | Variantes = `clips` + `clip_versions`; salidas = `renders` con `request_exports` | seguir con `lyric_videos` | publicaciones, entregas, reintento, ZIP y retención gratis | `renders.clip_id` deje de ser obligatorio |
| 3 | Escena, estilo y catálogo de fuentes en `packages/composition` | motor en `packages/lyrics` + dependencia entre paquetes | sin cambio de `pnpm-lock.yaml`; un esquema compartido con clipping | se permita un enlace de workspace |
| 4 | `lyricRenderArgs` nuevo en vez de ampliar `lyricFfmpegArgs` | ampliar la función v1 | coexistencia: la v1 no cambia; el encargo pedía ampliarla | D2 retire la v1 |
| 5 | Filtros v2 `noche`, `super8`, `bn`, `vapor` con las mismas cadenas ffmpeg | conservar `midnight`/`noir`/`vaporwave` | la lista coincidía con la del competidor; el encargo daba los nombres propios | — |
| 6 | Un `Dialogue` por palabra con `\pos` | un evento por línea | escala/subrayado de la palabra activa sin mover las demás; paridad ≤ 2 px exacta por construcción | libass penalice el número de eventos |
| 7 | Prueba de píxel con `rawvideo gray` y caja envolvente | `cropdetect`/`signalstats` | medida directa y determinista | — |
| 8 | Canciones v1 se quedan en v1; re-subir para v2 | migrar a R2 | el worker v2 solo lee R2; sin cliente de Storage en etapas | > 20 canciones v1 en uso |
| 9 | Una sola etapa `media_split` con `mode` propose/cut | dos etapas | menos superficie en `STAGES` y CHECK | — |
| 10 | Revisiones en `song_alignments` (`v2:r<n>`) | tabla `lyric_alignments` | regla de reutilización | se necesite historial con diff |
| 11 | Unidades: 1/min solo si corre el ASR; caché por canción y modelo | cobrar cada sincronización | encargo | — |
| 12 | Límite de 20 estilos solo para estilos v2 (en la RPC) | trigger sobre toda la tabla | no romper el Style Studio v1 si ya tiene > 20 | D2 |
| 13 | Portadas = colecciones `purpose = 'artwork'` | tabla `artwork` | regla de reutilización | se necesiten metadatos de LP |
| 14 | Demo = constante `DEMO_SONG` + audio sintetizado al abrir | MP3 en `public/` | sin binarios nuevos; copia al abrir; nunca muta el ejemplo | se quiera una demo con voz real |
| 15 | Bandera `NEXT_PUBLIC_LYRIC_VERSION` propia | reutilizar `NEXT_PUBLIC_PIPELINE_VERSION` | transición de letra independiente de la de clipping | ambas se desmantelen |
| 16 | `lrc` (línea) y `lrc_word` (mejorado) como tipos distintos | un tipo con opción | la clave de exportación y su hash los distinguen sin parámetros extra | — |
| 17 | Variantes en paralelo hasta `MAX_PARALLEL = 4` contenedores | un contenedor por variante sin tope | `app.py` sin cambios; protege el presupuesto | el propietario suba el tope |
| 18 | Errores de letra mapeados en `routes/lyrics.ts` | ampliar `ERROR_CODES` de `api.ts` | no tocar el catálogo de clipping | se unifiquen catálogos |
| 19 | Bootstrap añade secciones a `CLAUDE.md`/`AGENTS.md` y une `settings.json` | sustituir archivos | conserva lo de clipping y lo ajeno | — |
| 20 | 18 pasos en 3 épicas de 6 | 12 pasos del encargo | ≤ 5 archivos por paso con tests y UI separados | — |

### 20.4 Qué construir después
1. D2 — tras 14 días sin criterios de abandono. 2. Vinilo y animaciones de portada — tras un mes usando Portada.
3. Migrar canciones v1 a R2 — si hay > 20 en uso. 4. Instagram — con cuenta business. 5. Metraje con licencia en
«Colecciones Ráfaga» — si el propietario lo consigue.

---

*Fin del blueprint. El orden de construcción es §9. Se termina cuando §20.1 está en verde.*
