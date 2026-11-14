# Épica 01: Canciones y sincronización

> Tras esta épica existen el esquema de Lyric Studio v2, la subida y validación de canciones con el cargador compartido,
> la API de letra, la sincronización por etapas (alineación de letra aprobada y transcripción propuesta) con revisiones y
> anclas, y el editor de sincronización palabra a palabra.

| | |
|---|---|
| **Id** | `01-canciones-y-sincronizacion` |
| **Tareas** | `E1-T1` … `E1-T6` (pasos 1–6 de `blueprint.md` §9) |
| **Depende de** | el bundle `blueprints/rafaga-clipping-v2/` completo (etiquetas `rafaga-v2-step-01` … `rafaga-v2-step-18`) |
| **Desbloquea** | `02-estilo-vista-previa-y-fondos`, `03-render-y-entrega` |
| **En paralelo con** | ninguna (`E2-T1` puede empezar tras `E1-T1`, pero con un solo constructor se sigue el orden del array) |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis borrable)
· Tailwind y componentes existentes de `apps/web/components/ui/` (sin cambios visuales) · Supabase Postgres con RLS (PGlite
en pruebas) · R2 · worker por etapas de clipping v2 (`workers/media/src/stage.ts`, `stages/*.ts`) · `packages/lyrics`
(`parseLyrics`, `alignLyrics`, `lyricsFromAsr`) · Groq `whisper-large-v3-turbo` (simulado en pruebas) · ffmpeg 9.0.2 ·
pnpm 12.18.0. Versiones en `pnpm-lock.yaml`; ninguna dependencia nueva.

| Tarea | Comando |
|---|---|
| Entorno (en cada comando) | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| CLI del worker | `node workers/media/src/stage.ts --list` |
| ffmpeg | `ffmpeg -hide_banner -version` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD` (paso 1: `rafaga-v2-step-18..HEAD`); nunca `git reset --hard` |

**Puerta:** el array `verify` de la tarea, completo, más `pnpm test`; typecheck/build cuando la tarea toca `apps/web`. Sin
red: PGlite (`freshDb()`), `fakeSupabaseFetch`, `fakeR2`, ASR simulado, fixtures `ffmpeg -f lavfi`. Ningún servicio local.

## Subárbol

```
supabase/migrations/20261201000100_lyric_v2.sql      # NUEVO T1
supabase/migrations/20261201000101_lyric_songs.sql   # NUEVO T2
supabase/migrations/20261201000102_lyric_sync.sql    # NUEVO T5
supabase/tests/lyric_v2.test.ts                      # NUEVO T1
supabase/tests/migrate.ts, fake-supabase.ts          # existen — solo lectura (freshDb, fakeSupabaseFetch, tokenFor)
workers/media/src/stages/lyric.ts                    # NUEVO T2 (song_validate); EDITA T5 (lyric_sync)
workers/media/src/stages/registry.ts                 # EDITA T2 — STAGES += song_validate, lyric_sync, media_split
workers/media/src/fixtures.ts                        # EDITA T2 — canciones sintéticas y fixture de escenas
workers/media/src/lyric_song.test.ts                 # NUEVO T2
workers/media/src/lyric_sync.test.ts                 # NUEVO T5
workers/media/src/stages/analysis.ts, runner.ts      # existen — solo lectura (mezzaninePath, runOnce)
workers/media/src/groqlimits.ts                      # existe — solo lectura (GroqLimiter, limitsFromEnv)
workers/media/src/run.ts                             # existe — NO se toca (flujo v1)
packages/lyrics/src/sync.ts, sync.test.ts            # NUEVO T4
packages/lyrics/src/formats.ts, formats.test.ts      # NUEVO T4
packages/lyrics/src/index.ts                         # EDITA T4 — export * de sync.ts y formats.ts
apps/web/lib/routes/lyrics.ts                        # NUEVO T3; EDITA T5
apps/web/app/api/lyrics/[[...slug]]/route.ts         # NUEVO T3
apps/web/lib/lyrics.test.ts                          # NUEVO T3; EDITA T5
apps/web/lib/synceditor.ts, synceditor.test.ts       # NUEVO T6
apps/web/components/LyricStudioV2.tsx                # NUEVO T3; EDITA T6
apps/web/components/LyricSyncEditor.tsx              # NUEVO T6
apps/web/components/TapSync.tsx                      # EDITA T6 — prop opcional onMarks
apps/web/app/app/lyric-studio/page.tsx               # EDITA T3 — solo el envoltorio de la bandera
apps/web/lib/uploader.ts, api.ts, routes/exports.ts  # existen — solo lectura (runUpload, httpApi, rpc, patrón de ruta)
```

Todo lo que no está aquí queda fuera de la épica. Si una tarea parece requerir otro archivo, detente e informa.

## Modelo de datos de esta épica

| Entidad | Campos | Notas |
|---|---|---|
| `projects` | `mode` (+`lyrics`) | CHECK superconjunto |
| `lyric_projects` | `project_id` (PK), `song_id`, `mode` (`letra`/`texto`/`portada`), tramo, `alignment_revision`, `aspect`, `res`, `style`, `style_id`, `preset`, `background`, `settings`, `collection_ids`, `hook_pack_id`, `hook`, `message`, `cover`, `artwork_front_id`, `artwork_back_id`, `locks` | 1:1 con `projects`; escritura solo por `create_lyric_project`/`save_lyric_project` |
| `hook_packs` | `name`, `hooks text[]` (1–200, cada uno 1–120) | `save_hook_pack` |
| `songs` | `source_id`, `status` (`pending`/`ready`/`failed`), `duration_ms` (≤ 600000), `sample_rate`, `channels`, `loudness_lufs`, `codec`, `error_code`, `demo` | v1: sin `source_id`, ruta `<ws>/songs/…`; v2: ruta `<ws>/<source>/original`, ≤ 62914560 bytes |
| `song_alignments` | `revision`, `kind` (`legacy`/`asr`/`aligned`/`proposal`/`manual`), `lyrics_text`, `flags`, `created_by` | v2: `lyrics_sha256 = 'v2:r<n>'`; ASR en caché: `'asr:<modelo>'` |
| `sources` | `mime` de audio | `complete_upload` encola `song_validate` |
| `text_styles`, `media_items` | `unique (workspace_id, id)` | para FK compuestas |

Claves de R2: canción `<ws>/<source>/original` (nunca se borra), audio de ASR `<ws>/<source>/audio.opus`.

## Contratos

**Consumidos** (de clipping v2, no se reconstruyen): `freshDb`, `fakeSupabaseFetch`, `tokenFor`, `pgliteCtx`, `fakeR2`,
`runOnce`, `enqueue_job`, `claim_stage`, `finish_stage`, `create_upload_session`, `complete_upload` (se recrea en T2 con el
mismo contrato), `storage_used`, `record_object`, `set_source_ready`, `r2FromEnv`/`r2Url`, `runUpload`/`httpApi`,
`groqTranscribe`/`aiConfig`, `GroqLimiter`/`limitsFromEnv`, `sessionUser`/`bearer`/`rpc`/`json`/`mapDbError`/`idempotencyKey`.

**Producidos:**

| Export | Firma | Usado por |
|---|---|---|
| `@rafaga/lyrics` → `SyncWord`, `importLyrics`, `alignWithAnchors`, `resyncKeepingManual`, `transcriptionProposal`, `insertWord`, `deleteWord`, `nudgeWord`, `resizeWord`, `lineOccurrences`, `instrumentalGaps`, `DEMO_SONG`, `DEMO_AUDIO_EXPR` | `alignWithAnchors(lines, asr, { anchors?, hints? }) → { words, extras, instrumentals }` | T5, T6, épicas 02 y 03 |
| `@rafaga/lyrics` → `toLrc`, `toLrcEnhanced`, `parseLrc`, `toSrtLyrics`, `toVttLyrics`, `parseSrtCues`, `toAssKaraoke`, `toTxtLyrics` | texto ↔ palabras | `E3-T4` |
| `workers/media/src/stages/lyric.ts` → `audioKind`, `STAGE_IMPLS.song_validate`, `STAGE_IMPLS.lyric_sync` | `audioKind(bytes) → "mp3"\|"wav"\|"m4a"\|"aac"\|"flac"\|"ogg"\|null` | runner, épica 03 |
| `apps/web/lib/routes/lyrics.ts` → `handleLyrics` | `handleLyrics(req, slug, { f?, env?, wake? }) → Response` | `route.ts`, épicas 02 y 03 |
| `apps/web/lib/synceditor.ts` | reductor puro + `doubtfulIndexes`, `toPayload` | `LyricSyncEditor` |
| SQL | `register_song`, `song_object`, `open_lyric_demo`, `request_lyric_sync`, `save_song_alignment`, `restore_original_alignment`, `song_alignment`, `set_song_lyrics`, `save_caption_style`, `save_hook_pack`, `create_lyric_project`, `save_lyric_project`, … | épicas 02 y 03 |

## Convenciones que muerden aquí

- La letra del usuario **nunca** se modifica en silencio: `align` devuelve exactamente sus palabras; `transcribe` solo crea
  una revisión `proposal` y `songs.lyrics_text` solo cambia con `set_song_lyrics`.
- Las palabras `manual` son anclas: re-sincronizar, insertar o borrar no las mueve.
- `run.ts`, la página v1 (salvo el envoltorio), `request_lyrics`, `save_manual_alignment`, `FILTERS` y `LOOKS` no cambian.
- `complete_upload` se recrea copiando literalmente su cuerpo de `20261113000037_upload_storage.sql`; solo se añade la rama
  de audio.
- Las pruebas nuevas viven en un nivel que el script `test` recorre (`workers/media/src/*.test.ts`, `apps/web/lib/*.test.ts`,
  `packages/lyrics/src/*.test.ts`, `supabase/tests/*.test.ts`); nunca en `stages/`.
- Errores propios de letra en el mapa `LYRIC_ERRORS` de `routes/lyrics.ts` (no se edita `api.ts`).
- Rutas con `[` entre comillas simples en el shell.

Reglas: `CLAUDE.md`, `.claude/rules/lyric-studio.md`, `.claude/rules/migrations.md`, `.claude/rules/worker-stages.md`,
`.claude/rules/api-routes.md`.

---

## Tareas

Mismo orden que `tasks.json`: ese orden es el de construcción.

### `E1-T1` — Requisitos de clipping v2 y esquema Lyric v2 (100)

**Depende de:** nada · **Prioridad:** p0 — metadato para recortes de alcance, no un orden

Precondición: `test -z "$(git status --porcelain | grep -v '^.. blueprints/')"` debe salir con 0; si no, detente e informa.
Pega en la migración el SQL de §4 (100) de `blueprint.md`: el bloque `do $$` borra solo las CHECK cuya definición contiene
`'broll'`, `audio/mpeg` o `/songs/`, `aspect`, `'xmeml'`, `'translate'` o `'stage_output'` y las vuelve a crear como
superconjuntos; las únicas `(workspace_id, id)` de `text_styles` y `media_items` van antes de crear `lyric_projects`. En la
prueba fija la tarifa de cómputo como `exports.test.ts` (`update platform_settings set value = '{"usd_per_core_s":0.001,
"usd_per_gib_s":0.0001}' where key = 'modal_rate_card'`). Si una sentencia falla en PGlite, corrige el shim de
`migrate.ts`, nunca el SQL salvo error demostrado por una prueba.

**Archivos**
- `supabase/migrations/20261201000100_lyric_v2.sql` — nuevo
- `supabase/tests/lyric_v2.test.ts` — nuevo

**Aceptación**

Copiada del array `acceptance` de esta tarea en `tasks.json`.

1. **WHEN** se ejecutan `git tag -l 'rafaga-v2-step-*'` y `git tag -l 'rafaga-v2-step-0[2-8]' 'rafaga-v2-step-1[467]'` **THE SYSTEM SHALL** listar 18 y 10 etiquetas respectivamente, y `packages/composition/src/layouts.ts`, `workers/media/src/stages/export.ts`, `workers/media/src/stages/integrations.ts` y `apps/web/lib/uploader.ts` SHALL existir.
2. **WHEN** `freshDb()` aplica todas las migraciones, incluida `20261201000100_lyric_v2.sql`, **THE SYSTEM SHALL** exponer las tablas `lyric_projects` y `hook_packs`, las columnas `songs.source_id`, `songs.duration_ms`, `song_alignments.revision`, `media_collections.official`, `media_collections.purpose` y `media_items.storage_backend`, y aceptar `projects.mode = 'lyrics'`, `clip_versions.aspect = '4:5'`, `renders.kind` `lrc`, `lrc_word` y `ass`, `job_stages.stage` `song_validate`, `lyric_sync` y `media_split` y `storage_objects.kind = 'media'`.
3. **WHEN** el usuario B consulta `lyric_projects` y `hook_packs` o inserta directamente en ellas con el `workspace_id` de A **THE SYSTEM SHALL** devolver 0 filas de A y rechazar la inserción.
4. **WHEN** `save_caption_style` recibe un estilo de más de 4000 bytes, un estilo sin `rafagaStyle = 2` o el estilo número 21 del workspace **THE SYSTEM SHALL** lanzar `style_too_large`, `invalid_style` o `style_limit` sin escribir, y una inserción directa de un estilo v1 en `text_styles` SHALL seguir funcionando.
5. **WHEN** se inserta una canción v1 (`audio/mpeg`, ruta `<ws>/songs/…`, sin `source_id`) y una v2 (`audio/flac`, ruta `<ws>/<source>/original`, con `source_id`) **THE SYSTEM SHALL** aceptar ambas, y una v2 de más de 62914560 bytes SHALL rechazarse.
6. **WHEN** `save_lyric_project` cambia el modo de una pieza de `letra` a `portada` y vuelve, y `request_lyrics` crea un trabajo v1 **THE SYSTEM SHALL** conservar `song_id`, estilo y fondos sin cambiar el número de filas de `song_alignments`, y `claim_job()` SHALL entregar el trabajo `lyrics` con `engine = 'v1'`.

**Verify** — desde la raíz; cada línea sale con 0 si la tarea es correcta.

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

### `E1-T2` — Ingesta de canciones: etapa song_validate (101)

**Depende de:** `E1-T1` · **Prioridad:** p0

Pega el SQL de §4 (101). En `registry.ts` añade al final de `STAGES` `"song_validate", "lyric_sync", "media_split"` y en
`MODULE` las tres → `"./lyric.ts"`; `stages.test.ts` compara `--list` con `STAGES`, así que sigue verde. En `fixtures.ts`
amplía `FixtureKind` con `song_wav` (12 s, 44100 Hz estéreo: `-f lavfi -i "aevalsrc=exprs=0.5*sin(2*PI*440*t)*lt(mod(t\,2)\,1.2):s=44100:c=stereo:d=12"`),
`song_m4a` (AAC), `song_flac`, `song_ogg` (Opus), `song_long` (601 s, 8 kHz mono, FLAC), `song180` (180 s) y `scenes` (6 s,
640×360, 25 fps, tres bloques de color de 2 s, sin audio). No codifiques MP3: la detección MP3 se prueba con cabeceras
construidas. `song_validate`: `song_by_source` → descarga → `audioKind` → ffprobe (con pista de vídeo → `unsupported_file`)
→ `too_large`/`too_long` → `ebur128` (lee `I: … LUFS`) → opus 16 kHz mono a `<ws>/<source>/audio.opus` + `record_object`
`audio` → `finish_song_validate`. En fallo, `finish_song_validate(failed, código)` y lanza `StageError` con ese código
(`finish_stage` no reintenta `too_long`, `too_large`, `unsupported_file`).

**Archivos**
- `supabase/migrations/20261201000101_lyric_songs.sql` — nuevo
- `workers/media/src/stages/lyric.ts` — nuevo
- `workers/media/src/stages/registry.ts` — edita: tres etapas al final
- `workers/media/src/fixtures.ts` — edita: fixtures de canciones y escenas
- `workers/media/src/lyric_song.test.ts` — nuevo

**Aceptación**

1. **WHEN** `audioKind` recibe cabeceras de MP3 (`ID3` o sincronía `0xFFE`), WAV (`RIFF`…`WAVE`), M4A (`ftyp`), AAC ADTS (`0xFFF1` o `0xFFF9`), FLAC (`fLaC`) y OGG (`OggS`) **THE SYSTEM SHALL** devolver `mp3`, `wav`, `m4a`, `aac`, `flac` y `ogg`, y `null` para 64 bytes aleatorios.
2. **WHEN** `song_validate` procesa los fixtures `song_wav`, `song_m4a`, `song_flac` y `song_ogg` **THE SYSTEM SHALL** dejar cada canción `ready` con duración 12 s ±0.1, 44100 Hz (48000 Hz en OGG Opus), 2 canales y sonoridad integrada finita entre −70 y 0 LUFS, la fuente `validated` y `<ws>/<source>/audio.opus` subido al R2 simulado.
3. **WHEN** la canción dura más de 600 s, pesa más de 62914560 bytes o el archivo tiene pista de vídeo o no es audio **THE SYSTEM SHALL** cerrar la etapa con `too_long`, `too_large` o `unsupported_file`, dejar la canción `failed` con ese `error_code` y no subir nada al R2 simulado.
4. **WHEN** `complete_upload` completa una sesión cuya fuente tiene `mime` de audio **THE SYSTEM SHALL** crear un único trabajo `ingest` con la sola etapa `song_validate`, y para una fuente de vídeo SHALL seguir creando `validate`, `mezzanine` y `proxy`.
5. **WHEN** `register_song` se llama dos veces con la misma sesión de subida **THE SYSTEM SHALL** devolver el mismo `song_id` y `project_id`, poner `projects.mode = 'lyrics'` y crear una sola fila en `lyric_projects` con modo `letra`, y con más de 62914560 bytes SHALL lanzar `file_too_large`.
6. **WHEN** se ejecuta `node workers/media/src/stage.ts --list` **THE SYSTEM SHALL** imprimir `song_validate`, `lyric_sync` y `media_split` después de `translate`.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_song.test.ts
export PATH="$HOME/.local/bin:$PATH" && node workers/media/src/stage.ts --list | grep -qx media_split
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 02 — ingesta de canciones" && git tag rafaga-lyric-v2-step-02
```

### `E1-T3` — API de letra, subida de canciones y Mis canciones

**Depende de:** `E1-T2` · **Prioridad:** p0

Sigue el patrón exacto de `apps/web/lib/routes/exports.ts`: `handleLyrics(req, slug, d)` con `f`, `env`, `wake`
inyectables; `route.ts` delgada (`dynamic = "force-dynamic"`, `GET`/`POST`/`PUT` que esperan `ctx.params`). Mapa
`LYRIC_ERRORS` antes de `mapDbError`. URL de audio: `song_object` como el usuario → si `backend = 'supabase'` 409
`legacy_song` → `r2Url(cfg, "GET", key, 3600)`. En `LyricStudioV2.tsx` el orden es: `POST /api/uploads` (sesión) → `POST
/api/lyrics/songs` → subir partes con `runUpload` → completar; si registrar falla, `DELETE /api/uploads/:id`. En la página
v1 solo renombra la función por defecto a `LyricStudioV1` y añade el envoltorio con `NEXT_PUBLIC_LYRIC_VERSION`.

**Archivos**
- `apps/web/lib/routes/lyrics.ts` — nuevo
- `apps/web/app/api/lyrics/[[...slug]]/route.ts` — nuevo
- `apps/web/lib/lyrics.test.ts` — nuevo
- `apps/web/components/LyricStudioV2.tsx` — nuevo
- `apps/web/app/app/lyric-studio/page.tsx` — edita: envoltorio de la bandera

**Aceptación**

1. **WHEN** `POST /api/lyrics/songs` recibe `{ upload_id, title }` de una sesión de audio del usuario **THE SYSTEM SHALL** responder 201 `{ song_id, project_id }`, y repetida con la misma sesión SHALL devolver los mismos identificadores.
2. **WHEN** la sesión es de un archivo de más de 62914560 bytes o de `mime` que no es de audio **THE SYSTEM SHALL** responder 413 `{ error: { code: "file_too_large" }, limit: 62914560 }` o 415 `{ error: { code: "unsupported_file" } }` sin crear canción.
3. **WHEN** el usuario B pide `GET /api/lyrics/songs/:id/audio` de una canción de A **THE SYSTEM SHALL** responder 404 sin firmar URL, y para A con la canción `ready` SHALL devolver `{ url, expires_at }` con una URL GET de R2 que caduca en 3600 s.
4. **WHEN** `POST /api/lyrics/projects` recibe `{ song_id, mode: "texto" }` y después `PUT /api/lyrics/projects/:id` cambia `mode` a `letra` **THE SYSTEM SHALL** responder 201 `{ project_id }` y 200 `{ saved_at }`, y un `mode` desconocido SHALL responder 400 `{ error: { code: "invalid_params" }, field: "mode" }`.
5. **WHEN** se ejecutan `grep -q 'NEXT_PUBLIC_LYRIC_VERSION' apps/web/app/app/lyric-studio/page.tsx` y `grep -q 'runUpload' apps/web/components/LyricStudioV2.tsx` **THE SYSTEM SHALL** salir con 0 en ambos: la vista v2 vive detrás de la bandera y sube con el cargador compartido.
6. **WHEN** se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en ambos.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'NEXT_PUBLIC_LYRIC_VERSION' apps/web/app/app/lyric-studio/page.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'runUpload' apps/web/components/LyricStudioV2.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 03 — API y canciones" && git tag rafaga-lyric-v2-step-03
```

### `E1-T4` — Motor de sincronización y formatos de letra (puro)

**Depende de:** `E1-T1` · **Prioridad:** p0

Código puro en `packages/lyrics` (como `background.ts`, puede importar `alignLyrics`/`lyricsFromAsr`/`parseLyrics` de
`./index.ts`). `alignWithAnchors`: copia las palabras `manual` de `anchors` tal cual y alinea cada hueco entre anclas con
`alignLyrics` sobre el subconjunto del ASR cuyo tiempo cae en el hueco; banderas: `doubtful` (confianza < 0.5),
`not_heard` (interpolada), `vocalisation` (`/^(o+h*|a+h+|u+h+|m+|la+|na+|ye+a+h*|eh)$/i` tras normalizar), `sustained` (>
1.5 s); `extras` (ASR sin pareja); `instrumentals` (> 4 s sin palabras). `occurrence` por texto de línea normalizado.
Formatos: LRC de línea `[mm:ss.xx]`, LRC mejorado `[mm:ss.xx]<mm:ss.xx>palabra …<mm:ss.xx>` (la última marca es el fin
de la línea), SRT `HH:MM:SS,mmm`, VTT `WEBVTT` + `HH:MM:SS.mmm`, ASS karaoke con `{\kN}` en centésimas. `DEMO_SONG`: 12
palabras de las líneas «Llueve sobre Madrid / canto sin mirar / ¿dónde vas ahora? / ¡vuelve a empezar!», la k-ésima en
`[2k, 2k + 1.2)` s, `manual: true`; `DEMO_AUDIO_EXPR` = la `aevalsrc` de `song_wav` con `d=24`. Sin nombres que choquen con
los `export *` existentes del índice.

**Archivos**
- `packages/lyrics/src/sync.ts` — nuevo
- `packages/lyrics/src/sync.test.ts` — nuevo
- `packages/lyrics/src/formats.ts` — nuevo
- `packages/lyrics/src/formats.test.ts` — nuevo
- `packages/lyrics/src/index.ts` — edita: dos `export *`

**Aceptación**

1. **WHEN** `resyncKeepingManual` realinea una letra en la que 3 palabras tienen `manual: true` **THE SYSTEM SHALL** dejar `start` y `end` de esas 3 palabras idénticos y recalcular solo las demás.
2. **WHEN** `alignWithAnchors` alinea una letra aprobada contra un ASR con palabras de más, de menos y distintas **THE SYSTEM SHALL** devolver exactamente las palabras de la letra en el mismo orden y con el mismo texto, marcar `doubtful` las de confianza menor que 0.5 y `not_heard` las interpoladas, y listar en `extras` las palabras del ASR sin pareja.
3. **WHEN** la letra repite un estribillo y el audio tiene un tramo de más de 4 s sin palabras **THE SYSTEM SHALL** asignar `occurrence` 1 y 2 a cada repetición con tiempos independientes y listar el tramo en `instrumentals`, y las vocalizaciones (`oh`, `ah`, `la`, `yeah`) y las palabras de más de 1.5 s SHALL marcarse `vocalisation` y `sustained`.
4. **WHEN** `insertWord`, `deleteWord`, `nudgeWord` o `resizeWord` editan una palabra **THE SYSTEM SHALL** marcar `manual: true` solo en la palabra editada, mantener los tiempos crecientes y dejar idénticas todas las palabras no afectadas, incluidas las corregidas antes.
5. **WHEN** `toLrcEnhanced`, `toLrc`, `toSrtLyrics` y `toVttLyrics` exportan una letra y `importLyrics` la vuelve a leer **THE SYSTEM SHALL** recuperar las mismas líneas y el inicio de cada palabra (LRC mejorado) o de cada línea (LRC, SRT, VTT) con 10 ms de diferencia como máximo.
6. **WHEN** `toAssKaraoke` exporta una letra **THE SYSTEM SHALL** escribir un evento `Dialogue` por línea con una etiqueta `{\kN}` por palabra cuya suma, en centésimas, difiere de la duración de la línea en 1 centésima por palabra como máximo, y las palabras de `DEMO_SONG` SHALL ser crecientes y caber en sus 24 s.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/lyrics/src/sync.test.ts packages/lyrics/src/formats.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 04 — sincronización y formatos" && git tag rafaga-lyric-v2-step-04
```

### `E1-T5` — Etapa lyric_sync y API de sincronización (102)

**Depende de:** `E1-T3`, `E1-T4` · **Prioridad:** p0

Pega el SQL de §4 (102). `request_lyric_sync` pasa un `p_request_hash` explícito a `enqueue_job` (canción, modo, modelo y
pistas), así que repetir la misma petición tras terminar la sincronización devuelve el mismo trabajo en vez de
`idempotency_conflict`. Etapa `lyric_sync` en `lyric.ts`: `inputs` incluye `latest_revision` para que una re-sincronización
tras una edición no se sirva de la caché del runner. ASR: `ctx.deps.transcribe` en pruebas; por defecto `groqTranscribe`
bajo `GroqLimiter`. `align` usa como anclas las palabras `manual` de la última revisión. `units_actual` = minutos si llamó
al ASR, 0 si no. En la ruta, valida las palabras (texto 1–80, `start`/`end` numéricos crecientes, `line` entero ≥ 0,
`manual` booleano) antes de la RPC; modelo fijo `whisper-large-v3-turbo`.

**Archivos**
- `supabase/migrations/20261201000102_lyric_sync.sql` — nuevo
- `workers/media/src/stages/lyric.ts` — edita: etapa `lyric_sync`
- `workers/media/src/lyric_sync.test.ts` — nuevo
- `apps/web/lib/routes/lyrics.ts` — edita: letra, sync, alineación, restaurar
- `apps/web/lib/lyrics.test.ts` — edita

**Aceptación**

1. **WHEN** `POST /api/lyrics/songs/:id/sync` llega sin ASR en caché para una canción de 180 s **THE SYSTEM SHALL** responder 202 `{ job_id, units_reserved: 3, cached: false }` y escribir una fila `reserve` de 3 unidades, y con el ASR ya guardado SHALL responder `units_reserved: 0` y `cached: true` sin ninguna fila nueva en `credit_ledger`.
2. **WHEN** la etapa `lyric_sync` se ejecuta con un ASR simulado **THE SYSTEM SHALL** llamar al ASR una sola vez, guardar sus palabras como fila `asr`, crear la revisión 1 de tipo `aligned` y liquidar las unidades, y una segunda sincronización SHALL hacer 0 llamadas al ASR.
3. **WHEN** el modo es `transcribe` **THE SYSTEM SHALL** guardar una revisión de tipo `proposal` y dejar `songs.lyrics_text` idéntico, y WHEN el modo es `align` sin letra guardada SHALL responder 409 `{ error: { code: "lyrics_required" } }`.
4. **WHEN** una revisión guardada con `PUT /api/lyrics/songs/:id/alignment` tiene palabras con `manual: true` y se vuelve a sincronizar **THE SYSTEM SHALL** conservar el `start` y el `end` de cada palabra `manual` en la nueva revisión.
5. **WHEN** `PUT /api/lyrics/songs/:id/alignment` llega con un `base_revision` obsoleto o con tiempos decrecientes **THE SYSTEM SHALL** responder 409 `{ conflict: { current_revision } }` o 400 `{ error: { code: "invalid_words" } }` sin crear revisión, y `POST /api/lyrics/songs/:id/alignment/restore` SHALL crear una revisión nueva con las palabras de la primera revisión `aligned`.
6. **WHEN** el usuario B pide `GET /api/lyrics/songs/:id/alignment` o `POST /api/lyrics/songs/:id/sync` sobre una canción de A **THE SYSTEM SHALL** responder 404.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_sync.test.ts apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 05 — etapa de sincronización" && git tag rafaga-lyric-v2-step-05
```

### `E1-T6` — Editor de sincronización

**Depende de:** `E1-T5` · **Prioridad:** p0

`TapSync.tsx` ya tiene el modo «Mantener», la velocidad 0.5/0.75/1 y empujar ±0.05 s: reutilízalos. Solo añade la prop
opcional `onMarks?: (marks) => void`; con ella, «Guardar» entrega las marcas al llamador; sin ella, el comportamiento v1
(`save_manual_alignment`) no cambia. `synceditor.ts` es un reductor puro (tiempos en segundos de la canción, nunca del
reloj) que delega las ediciones en `@rafaga/lyrics`. `LyricSyncEditor.tsx`: palabras arrastrables con
`pointerdown`/`pointermove` y alternativa con botones y teclado (←/→ desplazar, Mayús+←/→ redimensionar, Supr borrar,
Ctrl+Z/Ctrl+Mayús+Z); dudosas resaltadas también con texto; «Restaurar sincronización original»; aviso de conflicto si
`PUT` devuelve 409. Sin estilos nuevos.

**Archivos**
- `apps/web/lib/synceditor.ts` — nuevo
- `apps/web/lib/synceditor.test.ts` — nuevo
- `apps/web/components/LyricSyncEditor.tsx` — nuevo
- `apps/web/components/TapSync.tsx` — edita: prop `onMarks`
- `apps/web/components/LyricStudioV2.tsx` — edita: monta el editor

**Aceptación**

1. **WHEN** se mantiene pulsada la tecla o el botón de marcar desde t = 10.00 s hasta t = 10.80 s sobre la palabra actual **THE SYSTEM SHALL** fijar esa palabra en `start: 10` y `end: 10.8` con `manual: true` y avanzar a la siguiente.
2. **WHEN** se elige la velocidad 0.5 o 0.75 **THE SYSTEM SHALL** guardar `rate` 0.5 o 0.75 en el estado y los tiempos marcados SHALL seguir expresados en segundos de la canción.
3. **WHEN** se desplaza, se redimensiona, se inserta o se borra una palabra y después se deshace **THE SYSTEM SHALL** volver al estado anterior idéntico, y las palabras no afectadas SHALL conservar sus tiempos y su marca `manual`.
4. **WHEN** el estado tiene palabras con confianza menor que 0.5 **THE SYSTEM SHALL** devolver sus índices en `doubtfulIndexes` para resaltarlas.
5. **WHEN** se ejecutan `grep -q 'onMarks' apps/web/components/TapSync.tsx`, `grep -q 'pointerdown' apps/web/components/LyricSyncEditor.tsx` y `grep -q 'LyricSyncEditor' apps/web/components/LyricStudioV2.tsx` **THE SYSTEM SHALL** salir con 0 en los tres.
6. **WHEN** se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en ambos.

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

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 06 — editor de sincronización" && git tag rafaga-lyric-v2-step-06
```

---

## Aceptación de la épica

La épica termina cuando las 6 tareas están `done` **y**:

1. **WHEN** una canción sintética subida con el cargador compartido se valida, se sincroniza con un ASR simulado, se corrigen tres palabras y se re-sincroniza **THE SYSTEM SHALL** dejar esas tres palabras con los mismos tiempos y la letra guardada sin cambios.
2. **WHEN** el ASR simulado falla tres veces seguidas **THE SYSTEM SHALL** dejar la etapa `failed` y devolver las unidades reservadas.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_sync.test.ts
```

## Trampas

- **Nombre de clave de idempotencia demasiado largo** — `open_lyric_demo` antepone `demo:`; por eso acepta claves de ≤ 120.
- **`complete_upload` recreado a medias** — si se omite la rama de vídeo, `uploads.test.ts` y `validate.test.ts` de clipping
  fallan. Copia el cuerpo literal.
- **La caché del runner sirve una sincronización vieja** — `inputs` de `lyric_sync` incluye la última revisión.
- **Opus cambia la frecuencia** — un OGG Opus siempre informa 48000 Hz; la prueba lo espera.
- **Pruebas en subcarpetas** — `pnpm test` no las recorre; `lyric_*.test.ts` va en `workers/media/src/`.

## Antes de seguir

- [ ] Las 6 tareas están `done` en `tasks.json`; ninguna `in_progress`.
- [ ] Todos los comandos `verify` de cada tarea pasaron, no solo el primero.
- [ ] Ningún `verify` se editó ni se saltó.
- [ ] Cada tarea tiene su etiqueta `rafaga-lyric-v2-step-01` … `-06` (`git tag -l 'rafaga-lyric-v2-step-*'`).
- [ ] `pnpm test` en verde desde la raíz.
- [ ] Los contratos «Producidos» existen con su firma.
- [ ] Ningún archivo fuera del subárbol cambió (salvo `tasks.json`).
- [ ] Ninguna variable de entorno nueva salvo `NEXT_PUBLIC_LYRIC_VERSION` (documentada en `blueprint.md` §10).
- [ ] Un commit por tarea con su mensaje `rafaga-lyric-v2: paso NN — …` seguido de su etiqueta.
