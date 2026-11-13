# Épica 02: Ingesta y análisis

> Tras esta épica un vídeo de hasta 4 GB y 60 min se sube de forma reanudable, se valida, se convierte en mezzanine
> 1080p (borrando el original), se analiza en etapas cacheadas, se configura con el panel de creación tipo Opus y se
> seleccionan clips con puntuación editorial, sin terminar nunca con 0 clips en silencio.

| | |
|---|---|
| **Id** | `02-ingesta-y-analisis` |
| **Tareas** | `E2-T1` … `E2-T6` (pasos 7–12 de `blueprint.md` §9) |
| **Depende de** | `01-fundamentos` (`E1-T4`, `E1-T5`) |
| **Desbloquea** | `03-edicion-y-entrega` |
| **En paralelo con** | ninguna |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis
borrable) · Tailwind y componentes existentes (sin cambios visuales) · Supabase Postgres con RLS y RPC `security
definer` · Cloudflare R2 con `presignV4` · worker por etapas (`workers/media/src/stages/*`) · Groq (`whisper-large-v3-turbo`,
`openai/gpt-oss-120b`) · Deepgram · ffmpeg 9.0.2 · pnpm 12.18.0. Versiones en `pnpm-lock.yaml`; ninguna dependencia nueva.

| Tarea | Comando |
|---|---|
| Entorno | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| ffmpeg | `ffmpeg -hide_banner -version` (las pruebas de medios fallan, no se omiten, si falta) |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` |

**Puerta:** `pnpm test` + typecheck/build cuando la tarea toca `apps/web`. Sin red: PGlite (`freshDb()`),
`fakeSupabaseFetch`, R2 simulado, Groq/Deepgram simulados, fixtures `ffmpeg -f lavfi` en `.fixtures/` (ignorado).

## Subárbol

```
packages/providers/src/r2.ts, r2.test.ts                 # EDITA T1 — multipart S3 (r2Url ya admite HEAD)
supabase/migrations/20261113000037_upload_storage.sql    # NUEVO T1
apps/web/app/api/uploads/[[...slug]]/route.ts            # NUEVO T1
apps/web/lib/uploads.test.ts                             # NUEVO T1
apps/web/lib/uploader.ts, uploader.test.ts, hash.worker.ts   # NUEVO T2
apps/web/components/UploadPanel.tsx                      # NUEVO T2
scripts/r2-multipart-probe.ts                            # NUEVO T2
workers/media/src/stages/validate.ts                     # NUEVO T3 — validate + mezzanine
workers/media/src/fixtures.ts, validate.test.ts          # NUEVO T3
apps/web/lib/progress.ts, progress.test.ts               # NUEVO T3
workers/media/src/stages/analysis.ts                     # NUEVO T4 — proxy, prepare, transcribe, scenes, speakers
workers/media/src/groqlimits.ts, analysis.test.ts        # NUEVO T4
apps/web/components/ProcessingPanel.tsx                  # NUEVO T4
apps/web/app/app/p/[id]/page.tsx                         # EDITA T4 — solo la vista v2 (engine = 'v2'); la v1 intacta
apps/web/app/api/generations/[[...slug]]/route.ts        # NUEVO T5
apps/web/lib/generations.ts, generations.test.ts         # NUEVO T5
apps/web/components/CreationPanel.tsx                    # NUEVO T5
apps/web/app/app/nuevo/page.tsx                          # EDITA T5
packages/selection/package.json                          # EDITA T6 — exports "./modes": "./src/modes.ts"
packages/selection/src/modes.ts, modes.test.ts           # NUEVO T6 (transcript de prueba dentro de modes.test.ts)
workers/media/src/stages/select.ts, select.test.ts       # NUEVO T6
packages/providers/src/groq.ts, workers/media/src/run.ts # existen — solo lectura (2fbd1a5, 1d1024f, f74e330 desplegados)
```

## Modelo de datos de esta épica

| Entidad | Campos | Notas |
|---|---|---|
| `upload_sessions` | estrategia, `r2_upload_id`, `part_size`, `total_parts`, `bytes` ≤ 4294967296, `idempotency_key` | 037 |
| `storage_objects` | `key`, `bytes`, `kind` (original, original_part, mezzanine, proxy, audio, thumb, …), `purged_at` | cuota sin listar R2 |
| `sources` | `sha256_prefix`; `storage_path` pasa a la mezzanine; `status='validated'` lo pone la etapa `mezzanine` | |
| `analyses`, `transcripts`, `generations` (`params`: receta, rango de duración, `caption_style`, `hook`, plantilla, brand kit) | — | creadas por `request_generation` |
| `clip_candidates.scores` | `{gancho, desarrollo, valor, afinidad, calidad_tecnica, overall 0–100, notes}` | jsonb existente |
| `generation_recipes` | «Mis recetas» | RLS `can_edit` |

El SQL de 037 está en `blueprint.md` §4: pégalo sin cambiar nombres, firmas ni códigos de error. Claves de R2:
original `<ws>/<source>/original`(+`.partNNN`), mezzanine `<ws>/<source>/mezzanine.mp4`, proxy `proxy.mp4`, audio
`audio.opus`, miniatura `thumb.jpg`, salidas grandes `<ws>/stages/<stage_id>.json`.

## Contratos

**Consumidos:** `freshDb`, `fakeSupabaseFetch`, `api.ts` (`json`, `fail`, `idempotencyKey`, `mapDbError`), SQL
`enqueue_job`, `request_generation`, `stage_eta`, `units_balance`, `StageCtx`/`StageImpl`/`loadStage`, `presignV4`,
`r2Url`, `groqTranscribe`, `groqProposeClips`, `groqChat`, `validateCandidates`, `brand_kits`, `text_styles`.

**Producidos:**

| Export | Firma | Usado por |
|---|---|---|
| `r2.ts` → `r2Multipart(cfg)` | `{ create, partUrl, list, complete, abort }`; `partsKey(key, n)` | T2, 03 |
| `GET /api/uploads/sources/:sourceId/proxy` | `{ url, expires_at }` | 03 (`PreviewPlayer`) |
| `fixtures.ts` → `makeFixture(kind, dir)`, `pgliteCtx(db)`, `fakeR2()` | — | T4, T6, 03 |
| `progress.ts` → `deriveProjectState({ job, stages, clips })`, `subscribe` | puro | 03 |
| `groqlimits.ts` → `GroqLimiter` | `wait(kind, cost) → wait_ms`, `on429(s)` | T6, 03 |
| `generations.ts` → `validateParams`, `estimateUnits`, `viableCount`, `DURATION_BUCKETS`, `componentVersions` | — | 03 |
| `CreationPanel` | panel de creación reutilizable como «Nueva generación» | 03 |
| `@rafaga/selection/modes` → `MODES`, `qualityFilters`, `editorialScore`, `EDITORIAL_WEIGHTS`, `minSecFor`, `shortfall` | subruta de `exports` | worker, 03 |

## Convenciones que muerden aquí

- Toda URL firmada se emite **después** de una RPC con el JWT del usuario; si no es suyo, 404 sin firmar.
- La mezzanine solo borra el original **tras** comprobar con ffprobe duración a ≤1 fotograma y pistas presentes.
- Nunca 0 clips en silencio: ventanas aisladas, segunda pasada con rangos excluidos, pasada relajada anotada, aviso
  `no_moments` o `shortfall`.
- `p/[id]` solo cambia para proyectos con algún trabajo `engine = 'v2'`; la vista v1 (`BriefFields`, «Volver a
  detectar», «Ajustar enfoque») queda intacta.
- El worker importa lo nuevo de selección como `@rafaga/selection/modes` (subruta añadida en T6), nunca por ruta
  relativa entre paquetes.
- Las recetas Solo subtítulos, Solo reencuadre y Limpiar grabación reutilizan lo existente (`projects.mode='captions'`,
  `request_reframe`, cortes de `cuts.ts`): ningún pipeline paralelo.
- La interfaz usa los componentes existentes; ningún color, fuente ni estilo nuevo. Los estilos de subtítulos son
  contenido del vídeo.
- Rutas con `[` entre comillas simples en el shell.

Reglas: `CLAUDE.md`, `.claude/rules/api-routes.md`, `.claude/rules/worker-stages.md`, `.claude/rules/migrations.md`.

---

## Tareas

### `E2-T1` — API de subida reanudable (037)

**Depende de:** `E1-T4` · **Prioridad:** p0

Pega 037. Amplía `r2.ts` con las cinco operaciones multipart firmadas por `presignV4` (parámetros en `query`) y un
analizador XML mínimo; `partsKey` para la estrategia `parts`. `r2Url` ya admite `HEAD`: no se cambia. La ruta
`[[...slug]]` implementa los contratos de `blueprint.md` §5 (creación, cuota, partes, estado, completar, abortar, URL del
proxy) con partes de 16777216 bytes (`multipart`) o 47185920 (`parts`, por `UPLOAD_STRATEGY`). En la prueba, el R2
simulado es el `other` de `fakeSupabaseFetch`.

**Archivos**
- `packages/providers/src/r2.ts` — edita
- `packages/providers/src/r2.test.ts` — edita
- `supabase/migrations/20261113000037_upload_storage.sql` — nuevo
- `apps/web/app/api/uploads/[[...slug]]/route.ts` — nuevo
- `apps/web/lib/uploads.test.ts` — nuevo

**Aceptación**
1. **WHEN** `r2Multipart` firma CreateMultipartUpload, UploadPart, ListParts, CompleteMultipartUpload y AbortMultipartUpload **THE SYSTEM SHALL** producir URLs con `uploads`, `partNumber` y `uploadId`, `uploadId`, `uploadId` y `uploadId` respectivamente, región `auto`, y la de UploadPart SHALL llevar `X-Amz-Expires=900`; la prueba del ejemplo de AWS SHALL seguir pasando.
2. **WHEN** `POST /api/uploads` recibe `bytes` mayor que 4294967296 **THE SYSTEM SHALL** responder 413 `{ error: { code: "file_too_large" }, limit: 4294967296 }`, y WHEN el uso del workspace más `bytes` supera 10737418240 SHALL responder 507 `{ error: { code: "quota_exceeded" }, quota: 10737418240 }`; en ambos casos sin crear sesión.
3. **WHEN** existe en el workspace una fuente no borrada con los mismos `bytes` y `sha256_prefix` **THE SYSTEM SHALL** responder 409 `{ duplicate_of_project }` salvo que el cuerpo lleve `force: true`.
4. **WHEN** `POST /api/uploads/:id/complete` recibe las ETag de todas las partes **THE SYSTEM SHALL** completar la subida en el R2 simulado, marcar la fuente `uploaded` y crear un único trabajo `engine = 'v2'` con las etapas `validate`, `mezzanine` y `proxy`, respondiendo 202 `{ job_id }`; repetida SHALL devolver el mismo `job_id` (criterio 1, servidor).
5. **WHEN** el usuario B pide `GET /api/uploads/:id`, `POST /api/uploads/:id/parts` o `GET /api/uploads/sources/:sourceId/proxy` sobre recursos de A **THE SYSTEM SHALL** responder 404 sin firmar ninguna URL.
6. **WHEN** `UPLOAD_STRATEGY=parts` **THE SYSTEM SHALL** devolver URLs PUT para objetos `original.partNNN` de 47185920 bytes como máximo, y `GET /api/uploads/:id` SHALL reconstruir las partes subidas con HEAD por objeto.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/providers/src/r2.test.ts apps/web/lib/uploads.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 07 — API de subida" && git tag rafaga-v2-step-07
```

### `E2-T2` — Cliente de subida

**Depende de:** `E2-T1` · **Prioridad:** p0

`uploader.ts` contiene la lógica pura (partes, `Sha256` incremental en TS puro porque WebCrypto no hace resumen
incremental, reanudación, ETA con media móvil) y la orquestación con dependencias inyectadas (3 partes en vuelo, 5
reintentos con 1/2/4/8/16 s, IndexedDB tras una interfaz). `hash.worker.ts` calcula `sha256_prefix` y `sha256` en un Web
Worker. `UploadPanel` ofrece soltar archivo, Subir, Google Drive, Dropbox y Enlace directo (estos tres llaman a
`/api/import/*`, que llega en la épica 03; hasta entonces muestran `not_configured`), cuota previa, progreso real,
cancelar, reanudar, aviso de duplicado y tarjeta final. La sonda solo ejecuta red sin `--dry-run` (la usa el propietario).

**Archivos**
- `apps/web/lib/uploader.ts` — nuevo
- `apps/web/lib/uploader.test.ts` — nuevo
- `apps/web/lib/hash.worker.ts` — nuevo
- `apps/web/components/UploadPanel.tsx` — nuevo
- `scripts/r2-multipart-probe.ts` — nuevo

**Aceptación**
1. **WHEN** `planParts` recibe 4294967296 bytes **THE SYSTEM SHALL** devolver 256 partes de 16777216 bytes, y para 20000000 bytes SHALL devolver 2 partes de 16777216 y 3222784 bytes.
2. **WHEN** `Sha256` incremental procesa un búfer de 5 MB en trozos irregulares **THE SYSTEM SHALL** producir el mismo resumen que `createHash('sha256')` de `node:crypto` sobre el búfer completo.
3. **WHEN** el servidor informa de las partes 1–3 subidas y el registro local tiene las partes 1–2 **THE SYSTEM SHALL** programar exactamente las partes que el servidor no informa como subidas.
4. **WHEN** el PUT de una parte falla dos veces por error de red y luego responde 200 **THE SYSTEM SHALL** completar con 3 intentos para esa parte y nunca más de 3 partes en vuelo, informando bytes enviados, velocidad y ETA en cada evento.
5. **WHEN** se llama a `cancel()` **THE SYSTEM SHALL** abortar los PUT en vuelo, enviar `DELETE /api/uploads/:id` y dejar el estado `cancelled`.
6. **WHEN** se ejecuta `node scripts/r2-multipart-probe.ts --dry-run` **THE SYSTEM SHALL** imprimir las cinco operaciones S3 previstas y salir con 0 sin red, y sin las variables R2 y sin `--dry-run` SHALL salir con 78.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/uploader.test.ts
export PATH="$HOME/.local/bin:$PATH" && node scripts/r2-multipart-probe.ts --dry-run
export PATH="$HOME/.local/bin:$PATH" && env -u R2_ACCOUNT_ID -u R2_BUCKET -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY node scripts/r2-multipart-probe.ts; test $? -eq 78
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 08 — cliente de subida" && git tag rafaga-v2-step-08
```

### `E2-T3` — Validación, mezzanine y estado derivado

**Depende de:** `E1-T5`, `E2-T1` · **Prioridad:** p0

Los fixtures reproducen el archivo real del propietario (1080p25 H.264, `pcm_s24le` estéreo, pista de timecode con
`-timecode 01:00:00:00` en MOV, habla escasa) a 6 s. `validate` comprueba bytes mágicos, ffprobe, límites (3600 s,
4294967296 bytes), idioma con una muestra de 30 s por Groq simulado y miniatura. `mezzanine` genera 1080p H.264 High
~6 Mbps VBV, AAC 192k, clave cada 1 s, `+faststart`, solo `0:v:0` y `0:a:0?`; si pasa la comprobación ffprobe, borra el
original (y partes), lo marca purgado, apunta `storage_path` a la mezzanine y pone `validated`; si no, falla sin borrar
nada. En la prueba del runner, crea el trabajo con `enqueue_job` y solo las etapas `validate` y `mezzanine`.

**Archivos**
- `workers/media/src/stages/validate.ts` — nuevo
- `workers/media/src/fixtures.ts` — nuevo
- `workers/media/src/validate.test.ts` — nuevo
- `apps/web/lib/progress.ts` — nuevo
- `apps/web/lib/progress.test.ts` — nuevo

**Aceptación**
1. **WHEN** `validate` analiza el fixture `ok` (1080p25 H.264, `pcm_s24le`, pista de timecode) **THE SYSTEM SHALL** devolver `status: "ok"` con duración 6 s ±0.1, 1920×1080, 25 fps, 1 pista de audio, la pista de datos ignorada y el idioma de la respuesta simulada de Groq.
2. **WHEN** el fixture no tiene audio **THE SYSTEM SHALL** devolver `status: "ok"` con el aviso `no_audio`, `modes_available` igual a `["manual", "destacados"]` y `subtitles: false`.
3. **WHEN** el archivo está truncado o no es un contenedor admitido **THE SYSTEM SHALL** devolver `unsupported` con `corrupt_file` o `unsupported_container` y un mensaje de solución en español; con más de 3600 s o más de 4294967296 bytes SHALL devolver `too_long` o `too_large`; con rotación de 90° o VFR SHALL devolver `needs_conversion` con `rotation` o `vfr`.
4. **WHEN** la etapa `mezzanine` procesa el fixture `ok` **THE SYSTEM SHALL** escribir un MP4 h264 de 1080 px de alto con audio AAC, sin pista de datos, `moov` antes de `mdat`, claves a ≤1 s y duración a ≤1 fotograma de la fuente, y solo entonces SHALL borrar el original del R2 simulado, marcarlo purgado y apuntar `sources.storage_path` a la mezzanine.
5. **WHEN** el runner ejecuta `validate` y `mezzanine` de un trabajo en cola usando solo filas de base de datos (PGlite, sin cliente HTTP) **THE SYSTEM SHALL** cerrar ambas etapas `done`, poner `sources.status = 'validated'` y el trabajo en `done` (criterio 1).
6. **WHEN** `deriveProjectState` recibe las mismas filas de `jobs`, `job_stages` y `clips` en cualquier orden **THE SYSTEM SHALL** devolver el mismo estado, con `partial: true` cuando hay al menos un clip `disponible` y etapas en curso, y `queued` con motivo cuando ninguna etapa corre (criterio 2).

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/validate.test.ts apps/web/lib/progress.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 09 — validación y mezzanine" && git tag rafaga-v2-step-09
```

### `E2-T4` — Análisis y Procesamiento (vista v2)

**Depende de:** `E2-T3` · **Prioridad:** p0

`GroqLimiter` con los valores por defecto `{"stt":{"rpm":20,"rpd":2000,"audio_s_per_h":7200,"audio_s_per_day":28800},
"llm":{"rpm":30,"rpd":1000,"tpm":8000,"tpd":200000}}`, sobrescribibles con `GROQ_LIMITS`, reloj inyectable y reacción a
429. Etapas desde la mezzanine: `proxy` 720p (`+faststart`, `-force_key_frames expr:gte(t,n_forced*1)`), `prepare`
(opus 16 kHz mono), `transcribe` (trozos ≤600 s con 2 s de solape en paralelo, `mergeChunks`; `inputs` = audio sha256,
`asr_model`, idioma, rango), `scenes` (`scdet` + `astats`), `speakers` (Deepgram o hablante visual con `faces.py` y
`needs_review`; el detector de caras es inyectable). En la prueba, el respaldo visual usa un detector de caras simulado
(no necesita opencv); la llamada real a `faces.py` solo se prueba si `python3 -c "import cv2"` funciona, y si no se omite
con `t.skip`, igual que `workers/media/src/reframe.test.ts`. `ProcessingPanel` muestra etapas, ETA o «aún no se puede
calcular» y «En cola» con motivo (`aria-live="polite"`). En `p/[id]/page.tsx` aparece **solo cuando el proyecto tiene
algún trabajo `engine = 'v2'`**; la vista v1 (`BriefFields`, «Volver a detectar», «Ajustar enfoque») no cambia.

**Archivos**
- `workers/media/src/stages/analysis.ts` — nuevo
- `workers/media/src/groqlimits.ts` — nuevo
- `workers/media/src/analysis.test.ts` — nuevo
- `apps/web/components/ProcessingPanel.tsx` — nuevo
- `apps/web/app/app/p/[id]/page.tsx` — edita (rama v2 con `ProcessingPanel`; rama v1 intacta)

**Aceptación**
1. **WHEN** `planChunks(3600)` se ejecuta **THE SYSTEM SHALL** devolver trozos de 600 s como máximo que se solapan 2 s y cubren [0, 3600] sin huecos.
2. **WHEN** `mergeChunks` une dos trozos cuyo solape de 2 s contiene las mismas palabras **THE SYSTEM SHALL** emitir cada palabra una sola vez, en orden y con marcas de tiempo globales.
3. **WHEN** el limitador usa los valores por defecto (20 peticiones/min, 7200 s de audio/h, 28800 s de audio/día) o los de `GROQ_LIMITS`, y recibe una 21.ª petición en el mismo minuto o un 429 con `retry-after: 7` **THE SYSTEM SHALL** retrasarla, con `wait_ms` ≥ 7000 en el caso del 429 (reloj simulado).
4. **WHEN** la etapa `proxy` procesa la mezzanine del fixture **THE SYSTEM SHALL** escribir un MP4 h264 de 720 px de alto con `moov` antes de `mdat` y fotogramas clave a ≤1 s.
5. **WHEN** `speakers` recibe 402 de Deepgram (simulado) o falta `DEEPGRAM_API_KEY` **THE SYSTEM SHALL** usar el hablante activo visual (detector de caras simulado) y marcar `needs_review: true`.
6. **WHEN** `transcribe` se ejecuta dos veces sobre el mismo audio y el mismo `asr_model` **THE SYSTEM SHALL** calcular el mismo `input_hash`, servir la segunda desde la caché y hacer 0 llamadas a la ASR la segunda vez (criterio 3, análisis).

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/analysis.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'BriefFields' 'apps/web/app/app/p/[id]/page.tsx'
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 10 — análisis" && git tag rafaga-v2-step-10
```

### `E2-T5` — Panel de creación, estimación y reserva

**Depende de:** `E2-T2`, `E2-T3` · **Prioridad:** p0

`generations.ts` es pura: `validateParams`, `DURATION_BUCKETS` (`auto` [10,180], `lt30` [10,30], `30_60` [30,60],
`60_90` [60,90], `90_180` [90,180]; la etiqueta «Auto» del panel dice «10 s–3 min»), `estimateUnits` (procesado 1.0/min
salvo análisis reutilizable, clipping 0.2/min, subtítulos 0, gancho 0.1 × N mejores clips; 2 decimales), `viableCount`,
`summary`, `componentVersions`. La ruta implementa `estimate` y la creación con `request_generation`. `CreationPanel`
replica el panel de Opus: receta (+ Mis recetas en `generation_recipes`), brand kit (`brand_kits`), ajustes (Clipping,
La IA elige, duración por rangos, Momentos a incluir con ayuda, intervalo), subtítulos con galería dibujada por el motor
de subtítulos (`groupWords`/`layoutLines` + presets) y edición de fuente/colores/tamaño/posición guardada en
`params.caption_style`, gancho automático con plantilla, plantilla viral y formato, y Resumen con desglose, «Aplicar
extras a los N mejores clips» y Crear idempotente. `nuevo/page.tsx` encadena `UploadPanel` (de `E2-T2`) → validación →
`CreationPanel` solo con `NEXT_PUBLIC_PIPELINE_VERSION === "v2"`; si no, el flujo actual intacto.

**Archivos**
- `apps/web/app/api/generations/[[...slug]]/route.ts` — nuevo
- `apps/web/lib/generations.ts` — nuevo
- `apps/web/lib/generations.test.ts` — nuevo
- `apps/web/components/CreationPanel.tsx` — nuevo
- `apps/web/app/app/nuevo/page.tsx` — edita

**Aceptación**
1. **WHEN** `POST /api/generations` se dispara 3 veces con la misma `Idempotency-Key` y el mismo cuerpo **THE SYSTEM SHALL** crear exactamente 1 generación, 1 trabajo y 1 fila `reserve` y responder 202 con el mismo `{ generation_id, job_id }` las 3 veces (criterio 6); con la misma clave y otro cuerpo SHALL responder 409 `idempotency_conflict`.
2. **WHEN** el saldo es menor que las unidades necesarias **THE SYSTEM SHALL** responder 402 `{ needed, balance }` sin escribir generación, trabajo ni movimiento en el libro.
3. **WHEN** se estima un tramo de 30 min sin análisis **THE SYSTEM SHALL** devolver `total: 36` (30 × 1.2), con análisis reutilizable `total: 6` (30 × 0.2), y con gancho en los 10 mejores clips SHALL sumar `hook: 1` (10 × 0.1).
4. **WHEN** alguna etapa del plan tiene menos de 5 muestras en `stage_timings` **THE SYSTEM SHALL** devolver `eta: null`, y con 5 o más SHALL devolver `{ p50_s, p90_s }` calculados a partir de ellas.
5. **WHEN** los parámetros violan los límites (rango de duración desconocido, número pedido mayor que 20, tramo fuera de la fuente, modo desconocido) o la fuente no está `validated` **THE SYSTEM SHALL** responder 400 `invalid_params` con el campo, o 409 `source_not_ready`.
6. **WHEN** el número pedido supera el viable (`floor(duración del tramo / mínimo del rango de duración)`) **THE SYSTEM SHALL** guardar el número pedido en `generations.requested_count` y la estimación SHALL incluir `viable_count`, y los rangos `auto`, `lt30`, `30_60`, `60_90` y `90_180` SHALL traducirse a [10,180], [10,30], [30,60], [60,90] y [90,180] segundos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/generations.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 11 — panel de creación" && git tag rafaga-v2-step-11
```

### `E2-T6` — Modos, puntuación editorial y selección robusta

**Depende de:** `E2-T4`, `E2-T5` · **Prioridad:** p0

Añade a `exports` de `packages/selection/package.json` la subruta `"./modes": "./src/modes.ts"` sin tocar las
existentes; el worker la importa como `@rafaga/selection/modes` (`workers/media` ya depende de `@rafaga/selection`).
`select.ts` **generaliza** dentro del módulo de etapa los arreglos ya desplegados en `run.ts`/`groq.ts` (`2fbd1a5`,
`1d1024f`, `f74e330`) sin tocar `run.ts`: cada ventana de candidatos va en su propio `try/catch` (`ai_windows` =
`"ok/total"`); `minSecFor` = 70 % del objetivo por debajo del máximo; si faltan clips tras validar, segunda pasada de IA
por ventana pidiendo momentos nuevos con los rangos de palabras ya elegidos excluidos (`second_pass`); si aún no queda
ninguno y hay habla, pasada léxica relajada (mín ×0.5, máx ×1.5) anotada en `reason` y `relaxed`; si sigue en 0, aviso
`no_moments` con motivos. `editorialScore` da los cinco motivos con texto y `overall` 0–100 con pesos 0.30 gancho, 0.20
desarrollo, 0.25 valor, 0.15 afinidad, 0.10 calidad técnica; los empates no se separan artificialmente: reciben
`notes.difference`. `modes.test.ts` y `select.test.ts` definen cada uno su propio transcript de prueba (≈4 min, habla
escasa) como constante del archivo, escrito para que con 10 pedidos pasen exactamente 3; no se comparte entre paquetes.
`translate` traduce por grupo con `groqChat` sin mover tiempos.

**Archivos**
- `packages/selection/package.json` — edita (subruta `./modes`)
- `packages/selection/src/modes.ts` — nuevo
- `packages/selection/src/modes.test.ts` — nuevo
- `workers/media/src/stages/select.ts` — nuevo
- `workers/media/src/select.test.ts` — nuevo

**Aceptación**
1. **WHEN** se lee `MODES` **THE SYSTEM SHALL** contener exactamente `automatico`, `por_tema`, `pregunta_respuesta`, `educativo`, `historia`, `destacados` y `manual`, cada uno con id de prompt, filtros y modelo, con `model: null` en `destacados` y `manual`.
2. **WHEN** los filtros de calidad se aplican a los candidatos del transcript de prueba de `modes.test.ts` **THE SYSTEM SHALL** descartar los que empiezan a mitad de frase, empiezan con un pronombre o deíctico sin antecedente, terminan sin cierre o se solapan más de un 50 % con uno ya aceptado.
3. **WHEN** se puntúan los candidatos del transcript de prueba **THE SYSTEM SHALL** exponer `gancho`, `desarrollo`, `valor`, `afinidad` y `calidad_tecnica` entre 0 y 1 con texto y `overall` entre 0 y 100, ordenar los candidatos de calidad distinta en el orden esperado, añadir `notes.difference` a los empatados sin alterar sus puntuaciones, y ningún `reason` SHALL contener «viral».
4. **WHEN** se piden 10 clips y solo 3 pasan los filtros **THE SYSTEM SHALL** entregar 3, poner `delivered_count = 3` y añadir a `generations.warnings` `{ "code": "shortfall", "requested": 10, "delivered": 3, "reasons": [...] }`; con 0 útiles SHALL devolver las unidades de `select` y mantener el cargo del análisis (criterio 8).
5. **WHEN** Groq (simulado) responde `400 json_validate_failed` en una de 3 ventanas y faltan clips tras validar aunque el transcript tiene habla **THE SYSTEM SHALL** procesar las otras 2 (`ai_windows = "2/3"`), pedir una segunda pasada con los rangos ya elegidos excluidos (`second_pass`), después la pasada relajada (mín ×0.5, máx ×1.5) anotada en `reason` y `relaxed`, y si sigue sin clips SHALL escribir el aviso `no_moments` con sus motivos en lugar de terminar con 0 en silencio.
6. **WHEN** `destacados` recibe picos de energía y cambios de escena **THE SYSTEM SHALL** proponer candidatos centrados en ellos con 0 llamadas al LLM (también `manual`), `exclude_previous` SHALL evitar todo solape con clips anteriores del proyecto, y `translate` SHALL conservar el inicio y el fin de cada grupo de subtítulos.

**Verify**
```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/selection/src/modes.test.ts workers/media/src/select.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
```

**Checkpoint**
```bash
git add -A && git commit -m "rafaga-v2: paso 12 — selección robusta" && git tag rafaga-v2-step-12
```

---

## Aceptación de la épica

1. **WHEN** se ejecuta `pnpm test` tras `E2-T6` **THE SYSTEM SHALL** salir con 0 con las pruebas de subida, validación, mezzanine, análisis, generación y selección verdes.
2. **WHEN** se ejecuta `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 con `UploadPanel`, `ProcessingPanel` y `CreationPanel` integrados.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

## Trampas

- **Borrar el original demasiado pronto** — solo tras la comprobación de la mezzanine; si falla, conserva todo.
- **Pistas de datos/timecode** — mapéalas fuera (`-map 0:v:0 -map 0:a:0?`) o ffmpeg fallará al escribir MP4.
- **Un fallo de Groq que descarta todo** — es el bug que ya corrigieron `2fbd1a5`/`f74e330` en `run.ts`: aísla cada
  ventana también en `select.ts`.
- **Romper la vista v1 de `p/[id]`** — la rama v2 va detrás de `engine = 'v2'`; el grep de `BriefFields` lo vigila.
- **Inventar números de duración** — usa `DURATION_BUCKETS`, no los límites fijos 15/90 del flujo v1.
- **Recetas nuevas como pipelines nuevos** — prohibido: reutiliza `captions`, `request_reframe` y `cuts.ts`.
- **Importar entre paquetes por ruta relativa** — usa `@rafaga/selection/modes`.

## Antes de seguir

- [ ] Las 6 tareas `done`; ningún `verify` editado ni saltado.
- [ ] Etiquetas `rafaga-v2-step-07` … `rafaga-v2-step-12` en git.
- [ ] Contratos producidos con su firma.
- [ ] Nada editado fuera del subárbol. Variables nuevas de esta épica (`UPLOAD_STRATEGY`, `GROQ_LIMITS`,
      `NEXT_PUBLIC_PIPELINE_VERSION`) documentadas en `blueprint.md` §10; ninguna se escribe en un `.env` del repo.
