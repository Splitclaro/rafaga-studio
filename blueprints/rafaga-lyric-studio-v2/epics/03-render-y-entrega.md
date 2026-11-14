# Épica 03: Render y entrega

> Tras esta épica existen la interfaz de fondos, portadas y ajustes, el render de letra en el worker (vista previa =
> exportación, audio idéntico entre variantes), las N variantes con candados y aislamiento de fallos, los formatos de letra,
> la publicación y la entrega por la infraestructura compartida, la demo de canción, las cifras de rendimiento y la
> transición con «Looks clásicos».

| | |
|---|---|
| **Id** | `03-render-y-entrega` |
| **Tareas** | `E3-T1` … `E3-T6` (pasos 13–18 de `blueprint.md` §9) |
| **Depende de** | `02-estilo-vista-previa-y-fondos` (`E2-T5`, `E2-T6`) |
| **Desbloquea** | lista de lanzamiento (`blueprint.md` §20.1) |
| **En paralelo con** | ninguna |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis borrable)
· componentes existentes de `apps/web/components/ui/` · Supabase Postgres con RLS (PGlite en pruebas) · R2 · worker por
etapas (`stages/export.ts` `render`/`zip`, `stages/integrations.ts` `publish`) · `packages/composition` (escena de letra,
estilo v2, catálogo de fuentes) · `packages/lyrics` (formatos, `DEMO_SONG`, `FILTERS`, `LOOKS`) · ffmpeg 9.0.2 con libass
· pnpm 12.18.0. Ninguna dependencia nueva.

| Tarea | Comando |
|---|---|
| Entorno (en cada comando) | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| Rendimiento | `node scripts/lyric-perf.ts --quick` |
| ffmpeg | `ffmpeg -hide_banner -version` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD`; nunca `git reset --hard` |

**Puerta:** el array `verify` de la tarea, completo, más `pnpm test`; typecheck/build cuando la tarea toca `apps/web`. Sin
red: PGlite, `fakeSupabaseFetch`, `fakeR2`, plataformas simuladas, fixtures `ffmpeg -f lavfi`.

## Subárbol

```
apps/web/components/LyricLibrary.tsx                 # EDITA T1 (medios, «Crear desde vídeo», portadas), T6 (vídeos v1, demo)
apps/web/components/LyricSettings.tsx                # NUEVO T1
apps/web/lib/lyricsettings.ts, lyricsettings.test.ts # NUEVO T1
apps/web/components/LyricStudioV2.tsx                # EDITA T1, T3
packages/composition/src/lyricscene.ts               # EDITA T2 — filtros v2, bgRect, lyricRenderArgs, variantes
packages/composition/src/lyricrender.test.ts         # NUEVO T2
workers/media/src/stages/export.ts                   # EDITA T2 — rama de letra + extensiones lrc/ass (nada más)
workers/media/src/stages/lyric.ts                    # EDITA T2 (render MP4), T4 (formatos), T5 (demo)
workers/media/src/lyric_render.test.ts               # NUEVO T2
supabase/migrations/20261201000104_lyric_variants.sql   # NUEVO T3
apps/web/lib/routes/lyrics.ts, lyrics.test.ts        # EDITA T3
apps/web/components/LyricResults.tsx                 # NUEVO T3; EDITA T4
workers/media/src/lyric_formats.test.ts              # NUEVO T4
apps/web/lib/lyricshare.test.ts                      # NUEVO T4
workers/media/src/lyric_demo.test.ts                 # NUEVO T5
scripts/lyric-perf.ts                                # NUEVO T5
docs/PERF.md                                         # EDITA T5 (lo escribe lyric-perf.ts entre marcas)
apps/web/lib/lyriccutover.ts, lyriccutover.test.ts   # NUEVO T6
apps/web/components/CaptionStyleEditor.tsx           # EDITA T6 — grupo «Looks clásicos»
apps/web/lib/routes/exports.ts, integrations.ts      # existen — solo lectura (handleExports, handleIntegrations)
workers/media/src/stages/integrations.ts             # existe — solo lectura (STAGE_IMPLS.publish, TIKTOK_UNAUDITED)
apps/web/app/app/lyric-studio/page.tsx               # existe — solo lectura en esta épica (sigue llamando a request_lyrics)
```

Todo lo que no está aquí queda fuera de la épica. Si una tarea parece requerir otro archivo, detente e informa.

## Modelo de datos de esta épica

| Entidad | Campos | Notas |
|---|---|---|
| `generations` | una por petición de variantes; `params.kind = 'lyric'`, `params.idempotency_key`, `params.response`, `warnings`, `requested_count`, `delivered_count` | `transcript_id` apunta a una instantánea de la letra |
| `clips` + `clip_versions` | una por variante; `composition` = `LyricComposition` inmutable; `aspect`, `template = 'lyric_<modo>'` | `request_lyric_variants` |
| `renders` | `kind` `mp4`/`srt`/`vtt`/`lrc`/`lrc_word`/`ass`/`txt`, `ratio` incluido `4:5`, `probe.ahash` | `request_exports` (recreado), `finish_render` |
| `export_batches` | lote de variantes | `partial` si alguna falla |
| `publications`, `deliveries`, `delivery_items`, `share_links` | sin cambios | las variantes son clips |
| `lyric_videos` | sin cambios (v1) | listados en «Mis vídeos» |

Claves de R2: exportación `<ws>/<clip>/v<version>-<12 hex>.<ext>` (`exportKey` de `stages/export.ts`), ZIP
`<ws>/batches/<batch>.zip`; entradas del render: canción `<ws>/<source>/original`, fondos `<ws>/media/<id>.<ext>`.

## Contratos

**Consumidos:** `handleLyrics`, `lyricSceneAt`, `lyricAss`, `lyricLayout`, `lyricShots`, `shakeOffset`,
`lyricFrameSize`, `validateLyricComposition`, `switchLyricMode`, `CaptionStyleV2`, `validateCaptionStyle`,
`BEHAVIOUR_PRESETS`, `CaptionStyleEditor`, `LyricLibrary`, `LyricPreview`, `importLyrics`, `toLrc`, `toLrcEnhanced`,
`toSrtLyrics`, `toVttLyrics`, `toAssKaraoke`, `toTxtLyrics`, `DEMO_SONG`, `DEMO_AUDIO_EXPR`, `audioMoments`, `FILTERS`,
`LOOKS`, `request_exports`, `export_job_item`, `finish_render`, `batch_renders`, `finish_batch`, `retry_export`,
`request_publication`, `create_delivery`, `open_lyric_demo`, `save_song_alignment`, `finish_song_validate`.

**Producidos:**

| Export | Firma | Usado por |
|---|---|---|
| `@rafaga/composition` → `LYRIC_FILTERS`, `LYRIC_FILTER_CSS`, `bgRect`, `lyricRenderArgs` | `lyricRenderArgs(c, { audio, items, coverFront?, coverBack?, ass, fontsDir, out }) → string[]` | worker, `lyric-perf.ts` |
| `@rafaga/composition` → `planLyricVariants`, `variantHash`, `nearDuplicates` | `planLyricVariants(base, n, locks, opts) → LyricComposition[]` | `LyricStudioV2` |
| `workers/media/src/stages/lyric.ts` → `renderLyricItem` | `renderLyricItem(ctx, it, { key, dir, fail }) → StageResult` | `stages/export.ts` |
| SQL `request_lyric_variants(p_project, p_variants, p_zip, p_idem)` | → `{ generation_id, clip_ids, export_ids, batch_id, job_id, warnings, replay }` | `routes/lyrics.ts` |
| `apps/web/lib/lyricsettings.ts`, `lyriccutover.ts` | puros | componentes |

## Convenciones que muerden aquí

- **Audio intocable:** el render mapea solo el audio de la canción, `-c:a aac -b:a 192k`, sin filtros (nada de `alimiter`
  como en `lookFfmpegArgs`); el audio de los fondos nunca entra. Por eso el MD5 de las muestras es igual entre variantes.
- `stages/export.ts` solo gana la rama `kind === "lyric"` y las extensiones `lrc`/`lrc_word`/`ass`; lo de clipping no
  cambia. Una variante fallida no detiene la etapa (el lote queda `partial`).
- `request_exports` se recrea copiando literalmente `20261113000041_exports.sql` y cambiando solo la línea de validación.
- `FILTERS`, `LOOKS`, `lyricFfmpegArgs`, `lookFfmpegArgs`, `run.ts` y la página v1 no cambian.
- Las variantes no consumen unidades; el medidor de cómputo de clipping es el freno (falla cerrado).
- Publicar en Instagram está fuera de alcance.
- Rutas con `[` entre comillas simples en el shell.

Reglas: `CLAUDE.md`, `.claude/rules/lyric-studio.md`, `.claude/rules/worker-stages.md`, `.claude/rules/api-routes.md`,
`.claude/rules/migrations.md`, `.claude/rules/composition-parity.md`.

---

## Tareas

Mismo orden que `tasks.json`: ese orden es el de construcción.

### `E3-T1` — Fondos, portadas y ajustes en la interfaz

**Depende de:** `E2-T5`, `E2-T6` · **Prioridad:** p1

`lyricsettings.ts` es puro: `FILTER_OPTIONS` (`none` «Ninguno», `noche` «Noche», `super8` «Super 8», `bn` «Blanco y negro»,
`vapor` «Vapor»), `validateLyricSettings`, `settingsToComposition` (solo `background` y `settings`), `orientationOf`,
`filterByClass`, `officialCollections`. `LyricLibrary.tsx`: subida directa a «Paquetes de medios» (`POST
/api/lyrics/media/items` → PUT firmado → `…/complete` con duración y tamaño leídos en el navegador), clasificación
(`classify_media_item`), asistente «Crear desde vídeo» (fuente existente o subida con el cargador actual → intervalo →
3/5/10/15/30 s → revisar/excluir → rápido o exacto → guardar con `…/media/split` y `…/media/cut`), «Colecciones Ráfaga» con
estado vacío, «Portadas» (colección `artwork`). `LyricSettings.tsx` con todos los ajustes y alternativa por teclado.

**Archivos**
- `apps/web/components/LyricLibrary.tsx` — edita: medios, «Crear desde vídeo», «Colecciones Ráfaga», portadas
- `apps/web/components/LyricSettings.tsx` — nuevo
- `apps/web/lib/lyricsettings.ts` — nuevo
- `apps/web/lib/lyricsettings.test.ts` — nuevo
- `apps/web/components/LyricStudioV2.tsx` — edita: usa los ajustes

**Aceptación**

Copiada del array `acceptance` de esta tarea en `tasks.json`.

1. **WHEN** `validateLyricSettings` recibe recorte 1.4, oscurecer 0.95, intervalo 0.5 s, tamaño fino 2 y un filtro desconocido **THE SYSTEM SHALL** devolver recorte 1, oscurecer 0.8, intervalo 2 s, tamaño fino 1.6 y filtro `none`.
2. **WHEN** se leen las opciones de filtro **THE SYSTEM SHALL** ofrecer exactamente `none`, `noche`, `super8`, `bn` y `vapor`, y ninguna etiqueta visible SHALL ser `Midnight`, `Noir` ni `Vaporwave`.
3. **WHEN** `filterByClass` filtra elementos por categoría, movimiento, ánimo y orientación (`vertical`, `horizontal` o `cuadrado`, derivada de ancho y alto) **THE SYSTEM SHALL** devolver solo los que cumplen todos los filtros elegidos.
4. **WHEN** `officialCollections` recibe 0 colecciones oficiales **THE SYSTEM SHALL** devolver `empty` con el texto que explica cómo marcar un paquete propio como oficial y ningún elemento.
5. **WHEN** `settingsToComposition` aplica los ajustes a una composición **THE SYSTEM SHALL** cambiar solo `background` y `settings` y dejar idénticos `words`, `style`, `range` y `seed`.
6. **WHEN** se ejecutan `grep -q 'Crear desde vídeo' apps/web/components/LyricLibrary.tsx`, `grep -q 'Colecciones Ráfaga' apps/web/components/LyricLibrary.tsx` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en los tres.

**Verify** — desde la raíz; cada línea sale con 0 si la tarea es correcta.

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyricsettings.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Crear desde vídeo' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Colecciones Ráfaga' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 13 — fondos y ajustes" && git tag rafaga-lyric-v2-step-13
```

### `E3-T2` — Motor de render de letra en el worker

**Depende de:** `E2-T5`, `E2-T6` · **Prioridad:** p0

En `lyricscene.ts`: `LYRIC_FILTERS` con las **mismas cadenas** que `FILTERS.midnight`, `.super8`, `.noir`, `.vaporwave` (se
copian; `FILTERS` no se toca), `LYRIC_FILTER_CSS`, `bgRect` (`fill` recorta, `preserve` cabe con negro, `band` banda 16:9),
`lyricRenderArgs` (planos de `lyricShots` con `-stream_loop -1 -ss <entrada> -t <dur>` o `-loop 1 -framerate 30 -t <dur>`, o
`color` lavfi; `setsar=1,fps=30,format=yuv420p,trim,setpts`; `concat`; filtro; oscurecer `drawbox`; barras de
`round(crop × 0.4 × H / 2)` px pares; `subtitles=<ass>:fontsdir=<dir>`; audio `-ss range.start -t duration -i <canción>`
mapeado solo con `-c:a aac -b:a 192k`; `-c:v libx264 -preset superfast -crf 20 -r 30 -t duration -movflags +faststart`),
`planLyricVariants` (candados `song_range`, `lyrics_sync`, `style`, `background`, `format`; N exactas; semilla
`seed × 1000 + i`; lo libre rota entre `opts.styles`, `opts.collections`, `opts.aspects`, `opts.ranges`), `variantHash`
(FNV-1a de 64 bits en hex) y `nearDuplicates`. En `export.ts`, antes de la rama de texto de clipping:
`if ((it.composition as { kind?: string }).kind === "lyric") return renderLyricItem(ctx, it, { key, dir: d, fail })`, y en
`EXT`/`MIME` `lrc`→`lrc`/`text/plain`, `lrc_word`→`lrc`/`text/plain`, `ass`→`ass`/`text/x-ssa`. `renderLyricItem` (MP4):
descarga canción, fondos y portadas, escribe `lyricAss`, ejecuta, ffprobe, hash perceptivo del primer fotograma (8×8 gris →
16 hex) en `probe.ahash`, sube y `finish_render`; los tipos de texto responden `not_implemented` hasta `E3-T4`.

**Archivos**
- `packages/composition/src/lyricscene.ts` — edita: render y variantes
- `packages/composition/src/lyricrender.test.ts` — nuevo
- `workers/media/src/stages/export.ts` — edita: rama de letra y extensiones
- `workers/media/src/stages/lyric.ts` — edita: `renderLyricItem`
- `workers/media/src/lyric_render.test.ts` — nuevo

**Aceptación**

1. **WHEN** `lyricRenderArgs` genera los argumentos para cada ajuste (recorte, oscurecer, cada filtro, sacudida, fundido, ajuste `preserve`, `fill` y `band`, secuencia y color sólido) **THE SYSTEM SHALL** producir argumentos sin shell en los que el audio se mapea solo desde la canción, sin filtros de audio, con `-c:a aac -b:a 192k`.
2. **WHEN** `LYRIC_FILTERS` se compara con `FILTERS` de `@rafaga/lyrics` **THE SYSTEM SHALL** tener `noche`, `super8`, `bn` y `vapor` idénticos a `midnight`, `super8`, `noir` y `vaporwave`, y `FILTERS` de v1 SHALL seguir sin cambios.
3. **WHEN** el worker renderiza a 720p una composición de 3 s con cada ajuste **THE SYSTEM SHALL** producir un MP4 H.264 yuv420p de 720×1280 en 9:16, el recorte SHALL dejar negras las filas de las barras, oscurecer SHALL bajar la luminancia media y `bn` SHALL dejar la saturación media por debajo de 2.
4. **WHEN** se renderizan dos variantes con estilos y fondos distintos sobre el mismo tramo de la misma canción **THE SYSTEM SHALL** producir pistas de audio cuyo MD5 de las muestras decodificadas (`ffmpeg -map 0:a -f md5`) es idéntico.
5. **WHEN** `planLyricVariants` planifica N variantes con candados de canción y tramo, letra y sincronización, estilo, colección de fondo y formato **THE SYSTEM SHALL** devolver exactamente N composiciones con semillas distintas que solo difieren en lo no bloqueado, y `nearDuplicates` SHALL marcar los pares cuyo `variantHash` coincide o cuyo hash perceptivo del primer fotograma dista 4 bits o menos.
6. **WHEN** un lote de 2 variantes de letra tiene una cuyo fondo no existe en el R2 simulado **THE SYSTEM SHALL** dejar esa exportación `failed` con `render_failed` y la otra `ready` con `probe.ahash` de 16 caracteres hexadecimales, y el lote SHALL quedar `partial`.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricrender.test.ts workers/media/src/lyric_render.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 14 — render de letra" && git tag rafaga-lyric-v2-step-14
```

### `E3-T3` — Variantes N con candados, lotes y reintento (104)

**Depende de:** `E3-T1`, `E3-T2` · **Prioridad:** p0

Pega el SQL de §4 (104): `request_lyric_variants` y la recreación de `request_exports` (copia literal de
`20261113000041_exports.sql`, solo cambia la línea de validación a `k not in ('mp4','srt','vtt','txt','fcpxml','xmeml',
'edl','lrc','lrc_word','ass') or asp not in ('9:16','1:1','16:9','4:5')`). La ruta valida `variants` (1–10, `kind =
"lyric"`), llama a la RPC y despierta al worker sin esperar. En la prueba de aislamiento, marca una exportación `failed`
directamente en PGlite y usa `handleExports` para la URL de las otras y el reintento. `LyricResults.tsx`: estado por
variante, avisos `near_duplicate`, descargar, «Reintentar», ZIP. En `LyricStudioV2.tsx`, el panel «Generar N variantes»
(1–10) con candados planifica con `planLyricVariants` (los tramos alternativos salen de `audioMoments`: unidades musicales,
no reglas de conversación) y ofrece 720p/1080p y 9:16 (defecto), 1:1, 4:5, 16:9.

**Archivos**
- `supabase/migrations/20261201000104_lyric_variants.sql` — nuevo
- `apps/web/lib/routes/lyrics.ts` — edita: variantes
- `apps/web/lib/lyrics.test.ts` — edita
- `apps/web/components/LyricResults.tsx` — nuevo
- `apps/web/components/LyricStudioV2.tsx` — edita: panel de variantes

**Aceptación**

1. **WHEN** `POST /api/lyrics/projects/:id/variants` llega 3 veces con la misma `Idempotency-Key` y 3 variantes **THE SYSTEM SHALL** crear 1 generación, 3 clips con su versión 1 inmutable, 3 exportaciones MP4 en un lote y 1 trabajo, y responder 202 con los mismos identificadores las 3 veces.
2. **WHEN** se piden 0 u 11 variantes o una composición que no es de letra **THE SYSTEM SHALL** responder 400 `{ error: { code: "invalid_params" }, field: "variants" }` sin escribir nada.
3. **WHEN** dos variantes tienen el mismo `variant_hash` **THE SYSTEM SHALL** crearlas igualmente y añadir a `generations.warnings` `{ "code": "near_duplicate", "variants": [i, j] }`.
4. **WHEN** una de las 3 exportaciones del lote falla **THE SYSTEM SHALL** mantener las otras 2 descargables con `GET /api/exports/:id/url`, y `POST /api/exports/:id/retry` SHALL reencolar solo la fallida.
5. **WHEN** se pide un lote de variantes **THE SYSTEM SHALL** escribir 0 filas en `credit_ledger`, y `request_exports` SHALL aceptar `4:5`, `lrc`, `lrc_word` y `ass` además de los formatos y tipos de clipping.
6. **WHEN** se ejecutan `grep -q 'planLyricVariants' apps/web/components/LyricStudioV2.tsx`, `grep -q 'retry' apps/web/components/LyricResults.tsx` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en los tres.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'planLyricVariants' apps/web/components/LyricStudioV2.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'retry' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 15 — variantes" && git tag rafaga-lyric-v2-step-15
```

### `E3-T4` — Formatos de letra y publicación

**Depende de:** `E3-T3` · **Prioridad:** p0

`renderLyricItem` gana los tipos de texto con las palabras de la composición relativas al tramo: `srt` → `toSrtLyrics`,
`vtt` → `toVttLyrics`, `lrc` → `toLrc`, `lrc_word` → `toLrcEnhanced`, `ass` → `toAssKaraoke`, `txt` → `toTxtLyrics`; sube
con su MIME y `finish_render`. `LyricResults.tsx`: menú de formatos (`POST /api/exports` con `kind`), quemado o limpio,
«Publicar»/«Programar» con `POST /api/publish` (YouTube y TikTok, mismos estados y errores que clipping; Instagram no),
«Compartir» con `create_delivery` (clip y versión) y enlace con `share_links`. `lyricshare.test.ts` sigue el patrón de
`apps/web/lib/integrations.test.ts`: importa `handleIntegrations` y `STAGE_IMPLS` de
`../../../workers/media/src/stages/integrations.ts` y simula `fetch`.

**Archivos**
- `workers/media/src/stages/lyric.ts` — edita: formatos de texto
- `workers/media/src/lyric_formats.test.ts` — nuevo
- `apps/web/components/LyricResults.tsx` — edita: formatos, publicar, compartir
- `apps/web/lib/lyricshare.test.ts` — nuevo

**Aceptación**

1. **WHEN** el worker exporta una variante de letra como `srt`, `vtt`, `lrc`, `lrc_word`, `ass` y `txt` **THE SYSTEM SHALL** subir un archivo por formato con su extensión y tipo MIME, y `importLyrics` SHALL leer el SRT, el VTT y los dos LRC con las mismas líneas y tiempos a 10 ms o menos de la composición.
2. **WHEN** se exportan `lrc` y `lrc_word` **THE SYSTEM SHALL** escribir el LRC de línea `[mm:ss.xx]texto` y el LRC mejorado con `<mm:ss.xx>` antes de cada palabra, y `ass` SHALL llevar una etiqueta `{\kN}` por palabra.
3. **WHEN** `POST /api/publish` llega para una exportación MP4 de letra hacia YouTube con la plataforma simulada **THE SYSTEM SHALL** crear la publicación, y la etapa `publish` SHALL enviar `videos.insert` con la privacidad elegida y dejar `private_pending_review` si la respuesta queda en privado cuando se pidió otra.
4. **WHEN** TikTok responde `unaudited_client_can_only_post_to_private_accounts` para una variante de letra **THE SYSTEM SHALL** dejar la publicación en `requiere_auditoria`, y con `scheduled_at` futuro SHALL quedar `scheduled` sin llamar a la plataforma.
5. **WHEN** se crea una entrega con `create_delivery` con 2 variantes de letra (clip y versión) **THE SYSTEM SHALL** crear la entrega con sus 2 elementos fijados a la versión 1, y el usuario B SHALL no verla.
6. **WHEN** se ejecutan `grep -q '/api/publish' apps/web/components/LyricResults.tsx`, `grep -q 'create_delivery' apps/web/components/LyricResults.tsx` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en los tres.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_formats.test.ts apps/web/lib/lyricshare.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q '/api/publish' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'create_delivery' apps/web/components/LyricResults.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 16 — formatos y publicación" && git tag rafaga-lyric-v2-step-16
```

### `E3-T5` — Demo de canción y rendimiento

**Depende de:** `E3-T4` · **Prioridad:** p1

En `song_validate`, con `params.demo`: sintetiza el audio con `DEMO_AUDIO_EXPR` (AAC en M4A), lo sube a la clave del
original, valida como cualquier canción, `finish_song_validate` con `p_lyrics = DEMO_SONG.lyrics` y guarda
`save_song_alignment(kind 'manual')` con `DEMO_SONG.words`; nunca llama al ASR. `scripts/lyric-perf.ts --quick` importa por
ruta relativa como `scripts/perf-run.ts` (`../supabase/tests/migrate.ts`, `../workers/media/src/fixtures.ts`,
`../workers/media/src/stages/runner.ts`, `../workers/media/src/stages/lyric.ts`): fixture `song180`, `song_validate` +
`lyric_sync` con ASR simulado de 1500 ms → `sync_ms`; `lyricLayout` + primer `lyricSceneAt` + `lyricAss` →
`preview_ready_ms`; 3 variantes 1080p en paralelo → `render_ms_p50`, `render_ms_p95` (rango más cercano; con 3 muestras,
p95 = máximo). Escribe entre `<!-- lyric-perf:start -->` y `<!-- lyric-perf:end -->` de `docs/PERF.md` (crea la sección si
falta, la sustituye si existe) con fecha y entorno; el resto del archivo no se toca.

**Archivos**
- `workers/media/src/stages/lyric.ts` — edita: rama de demo en `song_validate`
- `workers/media/src/lyric_demo.test.ts` — nuevo
- `scripts/lyric-perf.ts` — nuevo
- `docs/PERF.md` — edita (lo escribe el script)

**Aceptación**

1. **WHEN** `open_lyric_demo` se ejecuta dos veces y el worker procesa ambas **THE SYSTEM SHALL** crear dos canciones `ready` distintas en el workspace con el audio sintético de `DEMO_SONG` en R2 y su revisión 1 `manual` con las palabras de `DEMO_SONG`, sin ninguna llamada al ASR.
2. **WHEN** se edita la alineación de la primera copia **THE SYSTEM SHALL** dejar idénticas la alineación de la segunda copia y la constante `DEMO_SONG`.
3. **WHEN** se ejecuta `node scripts/lyric-perf.ts --quick` **THE SYSTEM SHALL** generar una canción sintética de 180 s, sincronizarla con ASR simulado, renderizar 3 variantes a 1080p en paralelo y escribir en `docs/PERF.md`, entre `<!-- lyric-perf:start -->` y `<!-- lyric-perf:end -->`, `sync_ms`, `preview_ready_ms`, `render_ms_p50` y `render_ms_p95`.
4. **WHEN** `docs/PERF.md` ya tiene la sección de clipping **THE SYSTEM SHALL** conservarla (`first_clip_ms` sigue presente) y una segunda ejecución SHALL sustituir la sección de letra en lugar de duplicarla.

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

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 17 — demo y rendimiento" && git tag rafaga-lyric-v2-step-17
```

### `E3-T6` — Transición: Looks clásicos, vídeos anteriores y demo

**Depende de:** `E3-T5` · **Prioridad:** p1

`lyriccutover.ts` (importa `@rafaga/lyrics` y `@rafaga/composition`): `classicPresets()` convierte `LOOKS.archivo`,
`.diario`, `.panoramico` en presets «Looks clásicos» (caja `lower`, color y peso del look, posición del bloque; fondo
`fill` o `band` según la relación de aspecto, recorte y oscurecer derivados) — son aproximaciones declaradas, no clones;
`libraryVideos(legacy, v2)`; `songBadge(song)` («Clásica» sin `source_id`). `CaptionStyleEditor.tsx`: grupo «Looks
clásicos». `LyricLibrary.tsx`: «Mis vídeos» con las filas `lyric_videos` (descarga actual de Supabase Storage), canciones
v1 con «Clásica» y solo el enlace al flujo v1, botón «Probar con la canción de demostración» (`POST /api/lyrics/demo`). La
página v1 no se toca.

**Archivos**
- `apps/web/lib/lyriccutover.ts` — nuevo
- `apps/web/lib/lyriccutover.test.ts` — nuevo
- `apps/web/components/CaptionStyleEditor.tsx` — edita: «Looks clásicos»
- `apps/web/components/LyricLibrary.tsx` — edita: vídeos v1, «Clásica», demo

**Aceptación**

1. **WHEN** `classicPresets()` convierte `archivo`, `diario` y `panoramico` **THE SYSTEM SHALL** devolver tres presets «Looks clásicos» con un `CaptionStyleV2` válido (caja `lower`, color del look, peso 400 o 700) y ajustes de fondo derivados del look, y `LOOKS` de v1 SHALL seguir sin cambios.
2. **WHEN** `libraryVideos` recibe filas de `lyric_videos` anteriores y exportaciones v2 **THE SYSTEM SHALL** incluir ambas con su estado y su origen, y las anteriores `ready` SHALL conservar su ruta de descarga de Supabase Storage.
3. **WHEN** una canción no tiene `source_id` **THE SYSTEM SHALL** marcarla «Clásica» con `songBadge` y no ofrecerla al flujo v2.
4. **WHEN** se ejecutan `grep -q 'Looks clásicos' apps/web/components/CaptionStyleEditor.tsx`, `grep -q '/api/lyrics/demo' apps/web/components/LyricLibrary.tsx` y `grep -q 'lyric_videos' apps/web/components/LyricLibrary.tsx` **THE SYSTEM SHALL** salir con 0 en los tres.
5. **WHEN** se ejecutan `grep -q 'request_lyrics' apps/web/app/app/lyric-studio/page.tsx`, `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en los tres: la página v1 sigue pidiendo vídeos con `request_lyrics`.

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

## Aceptación de la épica

La épica termina cuando las 6 tareas están `done` **y**:

1. **WHEN** se piden 3 variantes de una pieza y el worker las renderiza **THE SYSTEM SHALL** dejar 3 MP4 `ready` con audio idéntico, descargables y publicables por las rutas de clipping.
2. **WHEN** una variante falla **THE SYSTEM SHALL** dejar el lote `partial` con las demás descargables y permitir reintentar solo la fallida.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_render.test.ts apps/web/lib/lyrics.test.ts
```

## Trampas

- **`alimiter` en el audio** — `lookFfmpegArgs` lo usa; el render v2 no: cualquier filtro de audio rompe la igualdad entre
  variantes.
- **Romper clipping en `export.ts`** — la rama de letra va antes de todo y no toca `textOutput`; `export.test.ts` debe
  seguir verde.
- **`request_exports` reescrito de memoria** — cópialo literal del archivo 041; solo cambia la línea de validación.
- **`p95` con 3 muestras** — es el máximo (rango más cercano); no interpoles.
- **Demo que muta el ejemplo** — cada apertura crea su canción y su alineación; `DEMO_SONG` es una constante.

## Antes de seguir

- [ ] Las 6 tareas están `done` en `tasks.json`; ninguna `in_progress`.
- [ ] Todos los comandos `verify` de cada tarea pasaron.
- [ ] Ningún `verify` se editó ni se saltó.
- [ ] Etiquetas `rafaga-lyric-v2-step-13` … `-18` presentes; en total 18 (`git tag -l 'rafaga-lyric-v2-step-*'`).
- [ ] `pnpm test` en verde desde la raíz.
- [ ] Los contratos «Producidos» existen con su firma.
- [ ] Ningún archivo fuera del subárbol cambió (salvo `tasks.json`).
- [ ] Ninguna variable de entorno nueva.
- [ ] Un commit por tarea seguido de su etiqueta.
