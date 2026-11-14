# Épica 02: Estilo, vista previa y fondos

> Tras esta épica existen las fuentes del contenido con sus métricas y licencias, el estilo de 9 controles compartido con
> clipping, el motor de escena de letra (vista previa = exportación), Style Studio simplificado, la vista previa con
> paridad dorada, los modos Letra/Texto/Portada con ganchos, y los paquetes de medios con «Crear desde vídeo».

| | |
|---|---|
| **Id** | `02-estilo-vista-previa-y-fondos` |
| **Tareas** | `E2-T1` … `E2-T6` (pasos 7–12 de `blueprint.md` §9) |
| **Depende de** | `01-canciones-y-sincronizacion` (`E1-T1`, `E1-T5`, `E1-T6`) |
| **Desbloquea** | `03-render-y-entrega` |
| **En paralelo con** | ninguna |

No necesitas ningún otro archivo para completar esta épica. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Next.js App Router (`apps/web`) · TypeScript ejecutado directamente por Node ≥24 (imports `.ts`, solo sintaxis borrable)
· componentes existentes de `apps/web/components/ui/` (sin cambios visuales) · Supabase Postgres con RLS (PGlite en
pruebas) · R2 · worker por etapas · `packages/composition` (sin dependencias de otros paquetes: `RATIO_SIZE`,
`SubtitleStyle`, `buildAss`, `validateStyle`, `SAFE_ZONES`, `escapeFilterPath`) · `packages/lyrics` (`readMetrics`,
`METRIC_CODEPOINTS`, `FILTERS`, `LOOKS`) · ffmpeg 9.0.2 con libass y `scdet` · pnpm 12.18.0. Ninguna dependencia nueva.

| Tarea | Comando |
|---|---|
| Entorno (en cada comando) | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| Fuentes | `node scripts/fetch-fonts.ts --write` (con red, solo en el Hacer de `E2-T1`) · `node scripts/fetch-fonts.ts --check` (sin red) |
| ffmpeg | `ffmpeg -hide_banner -version` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD`; nunca `git reset --hard` |

**Puerta:** el array `verify` de la tarea, completo, más `pnpm test`; typecheck/build cuando la tarea toca `apps/web`. Sin
red en ningún `verify`. Ningún servicio local.

## Subárbol

```
scripts/fetch-fonts.ts                               # NUEVO T1
packages/composition/src/fontcatalog.ts              # NUEVO T1 (lo escribe fetch-fonts.ts --write; se confirma)
apps/web/public/fonts/caption/*.ttf                  # NUEVO T1 (los descarga fetch-fonts.ts --write)
apps/web/lib/captionfonts.test.ts                    # NUEVO T1
packages/composition/src/index.ts                    # EDITA T1 y T2 — export * de fontcatalog.ts y lyricscene.ts
packages/composition/src/style.ts                    # EDITA T2 — CaptionStyleV2 y presets (lo existente no cambia)
packages/composition/src/lyricscene.ts               # NUEVO T2; EDITA T5 (modos)
packages/composition/src/lyricscene.test.ts          # NUEVO T2
workers/media/src/lyric_ass.test.ts                  # NUEVO T2
apps/web/components/CaptionStyleEditor.tsx           # NUEVO T3
apps/web/lib/styles.ts, styles.test.ts               # NUEVO T3
apps/web/app/app/style-studio/page.tsx               # EDITA T3 — envoltorio de la bandera
apps/web/components/CreationPanel.tsx                # EDITA T3 — usa CaptionStyleEditor (clipping)
apps/web/components/LyricPreview.tsx                 # NUEVO T4
apps/web/lib/lyricpreview.ts, lyricpreview.test.ts   # NUEVO T4
packages/composition/src/lyricparity.test.ts         # NUEVO T4
apps/web/components/LyricStudioV2.tsx                # EDITA T4, T5
packages/composition/src/lyricmodes.test.ts          # NUEVO T5
apps/web/components/LyricLibrary.tsx                 # NUEVO T5
supabase/migrations/20261201000103_lyric_media.sql   # NUEVO T6
workers/media/src/stages/lyric.ts                    # EDITA T6 — etapa media_split
workers/media/src/lyric_media.test.ts                # NUEVO T6
apps/web/lib/routes/lyrics.ts, lyrics.test.ts        # EDITA T6
packages/lyrics/src/ttf.ts, metrics.ts, background.ts, looks.ts   # existen — solo lectura
packages/composition/src/subtitles.ts, composition.ts, safezones.ts, layouts.ts   # existen — solo lectura
```

Todo lo que no está aquí queda fuera de la épica. Si una tarea parece requerir otro archivo, detente e informa.

## Modelo de datos de esta épica

| Entidad | Campos | Notas |
|---|---|---|
| `text_styles` | `style = { rafagaStyle: 2, style: CaptionStyleV2, preset }` | `save_caption_style` (≤ 20 v2, ≤ 4000 bytes) |
| `hook_packs` | `name`, `hooks` | `save_hook_pack` |
| `media_collections` | `purpose` (`backgrounds`/`artwork`), `official`, `mood` | `create_media_collection`, `set_collection_official` |
| `media_items` | `storage_backend` (`r2`), `status`, `duration_ms`, `width`, `height`, `category`, `motion`, `mood`, `source_id`, `segment_start_ms`, `segment_end_ms`, `cut_mode`, `audio_muted` | `create_media_item`, `complete_media_item`, `add_split_item`, `classify_media_item` |
| `storage_objects` | `kind = 'media'` | cuenta en la cuota de 10 GB |

Claves de R2: elemento `<ws>/media/<id>.<ext>`; los cortes de «Crear desde vídeo» salen de la mezzanine
`<ws>/<source>/mezzanine.mp4` de clipping.

## Contratos

**Consumidos:** `freshDb`, `fakeSupabaseFetch`, `pgliteCtx`, `fakeR2`, `runOnce`, `enqueue_job`, `storage_used`,
`mezzaninePath` (`stages/analysis.ts`), `r2FromEnv`/`r2Url`, `handleLyrics` (épica 01), `@rafaga/lyrics` (`readMetrics`,
`METRIC_CODEPOINTS`, `FILTERS`, `DEMO_SONG`), `@rafaga/composition` (`RATIO_SIZE`, `buildAss`, `validateStyle`,
`SAFE_ZONES`, `sniffFont`, `fontFamily`).

**Producidos:**

| Export | Firma | Usado por |
|---|---|---|
| `@rafaga/composition` → `CAPTION_FONTS`, `FALLBACK_FAMILY`, `fontFor`, `measureText`, `coversText`, `resolveFamilyForText` | `measureText(text, family, weight, emPx) → number` | escena, editor, vista previa, worker |
| `@rafaga/composition` → `CaptionStyleV2`, `validateCaptionStyle`, `captionStyleBytes`, `captionToSubtitleStyle`, `captionFromSubtitleStyle`, `surpriseCaption`, `BEHAVIOUR_PRESETS` | `captionToSubtitleStyle(s) → SubtitleStyle` | clipping (`CreationPanel`), letra |
| `@rafaga/composition` → `LyricComposition`, `validateLyricComposition`, `lyricFrameSize`, `lyricLayout`, `lyricSceneAt`, `lyricShots`, `shakeOffset`, `lyricAss`, `switchLyricMode` | `lyricSceneAt(c, t) → escena` · `lyricAss(c) → string` | `LyricPreview`, worker (épica 03) |
| `workers/media/src/stages/lyric.ts` → `STAGE_IMPLS.media_split` | propone (`mode: "propose"`) o corta (`mode: "cut"`) | runner |
| `apps/web/lib/styles.ts`, `lyricpreview.ts` | estado puro | componentes |

## Convenciones que muerden aquí

- **Un motor:** la vista previa dibuja con `lyricSceneAt`; el ASS sale de `lyricAss`; ambos usan `lyricLayout` y el mismo
  redondeo al fotograma de 1/30 s. Ningún componente calcula posiciones de texto por su cuenta.
- `packages/composition` no importa `@rafaga/lyrics` ni ningún otro paquete (su `package.json` no tiene dependencias y
  cambiarlo exigiría tocar `pnpm-lock.yaml`). Las pruebas que comparan con `@rafaga/lyrics` viven en `apps/web/lib` o
  `workers/media/src`.
- Las fuentes del vídeo se sirven del mismo archivo en navegador (`/fonts/caption/…`) y worker
  (`apps/web/public/fonts/caption/`); el catálogo guarda sha256 y métricas, y `--check` lo re-deriva.
- El ASS mide la letra con la métrica del catálogo y fija `Fontsize = em × (ascent + descent)/unitsPerEm`, un
  `Dialogue` por palabra con `\an7\pos(x,y)` (así la escala o el subrayado de la palabra activa no mueven las demás).
- Lo v1 (`SubtitleStyle`, `PRESETS`, `validateStyle`, `surpriseStyle`, `FILTERS`, `LOOKS`) no cambia.
- Las zonas seguras solo se dibujan en la vista previa.
- El audio de los fondos nunca se conserva (`-an`, `audio_muted = true`).
- Rutas con `[` entre comillas simples en el shell.

Reglas: `CLAUDE.md`, `.claude/rules/lyric-studio.md`, `.claude/rules/composition-parity.md`,
`.claude/rules/worker-stages.md`, `.claude/rules/api-routes.md`, `.claude/rules/migrations.md`.

---

## Tareas

Mismo orden que `tasks.json`: ese orden es el de construcción.

### `E2-T1` — Fuentes para el contenido generado

**Depende de:** `E1-T1` · **Prioridad:** p0

Primero audita: `Bootzy TM` (`SYSTEM_FONT`, bucket `app-fonts`), `Liberation Sans` (imagen de Modal) y `workspace_fonts` ya
existen; de las 15 familias de referencia no hay ninguna. `scripts/fetch-fonts.ts --write` (importa por ruta relativa
`../packages/lyrics/src/ttf.ts` y `../packages/composition/src/fonts.ts`) descarga los TTF estáticos: pesos 400 y 700 para
Inter, Roboto, Playfair Display, Oswald, Montserrat, Raleway, Nunito, Space Mono y Dancing Script; solo 400 para Pacifico,
Bebas Neue, Righteous, Anton, Lobster y Abril Fatface. Pide `https://fonts.googleapis.com/css2?family=<Familia>:wght@<peso>`
con un `User-Agent` sin WOFF2 para recibir URLs `.ttf` (**verificado el 2026-11-14**; alterno: rutas raw de `google/fonts`; sale con 69 solo si ambos fallan;
entonces detente e informa). Guarda `apps/web/public/fonts/caption/<FamiliaSinEspacios>-<peso>.ttf`, comprueba
`sniffFont = "ttf"` y `fontFamily() = familia`, detecta la licencia (`…/google/fonts/main/ofl/<dir>/OFL.txt` o
`…/apache/<dir>/LICENSE.txt` en `raw.githubusercontent.com`), lee `unitsPerEm`, ascendente y descendente de
`head`/`hhea`, avances con `readMetrics(buf, METRIC_CODEPOINTS)`, cobertura de `á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ ¿ ¡`, y escribe
`fontcatalog.ts`. `--check` no usa red. Las fuentes del sistema van en el catálogo con `source: "sistema"` y `file: null`.

**Archivos**
- `scripts/fetch-fonts.ts` — nuevo
- `packages/composition/src/fontcatalog.ts` — nuevo (generado)
- `apps/web/public/fonts/caption/**` — nuevos (descargados)
- `apps/web/lib/captionfonts.test.ts` — nuevo
- `packages/composition/src/index.ts` — edita: `export * from "./fontcatalog.ts";`

**Aceptación**

Copiada del array `acceptance` de esta tarea en `tasks.json`.

1. **WHEN** se ejecuta `node scripts/fetch-fonts.ts --check` **THE SYSTEM SHALL** salir con 0 tras comprobar que cada archivo de `CAPTION_FONTS` existe en `apps/web/public/fonts/caption/`, que su sha256 coincide y que sus anchos de avance coinciden con `readMetrics` sobre el mismo archivo.
2. **WHEN** se lee `CAPTION_FONTS` **THE SYSTEM SHALL** contener Inter, Roboto, Playfair Display, Oswald, Pacifico, Bebas Neue, Montserrat, Raleway, Space Mono, Dancing Script, Righteous, Anton, Lobster, Nunito y Abril Fatface, cada una con licencia `OFL-1.1` o `Apache-2.0` y `licenceUrl` https, y las fuentes ya existentes Bootzy TM y Liberation Sans con `source: "sistema"` sin archivo duplicado.
3. **WHEN** se comprueba la cobertura de `á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ ¿ ¡` **THE SYSTEM SHALL** registrar `spanish` y la lista `missing` de cada fuente, y `resolveFamilyForText` SHALL devolver `Inter` para un texto con un glifo que la fuente elegida no tiene.
4. **WHEN** `measureText` mide el mismo texto con la misma fuente, peso y tamaño dos veces **THE SYSTEM SHALL** devolver el mismo ancho, y un texto con más caracteres SHALL medir más que su prefijo.

**Verify** — desde la raíz; cada línea sale con 0 si la tarea es correcta.

```bash
export PATH="$HOME/.local/bin:$PATH" && node scripts/fetch-fonts.ts --check
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/captionfonts.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 07 — fuentes" && git tag rafaga-lyric-v2-step-07
```

### `E2-T2` — Estilo v2 compartido y motor de escena de letra

**Depende de:** `E2-T1` · **Prioridad:** p0

`CaptionStyleV2 = { rafagaStyle: 2, font, weight: 400|700, case: "asis"|"upper"|"lower", color, activeColor, effect:
"none"|"shadow"|"glow"|"stroke"|"box", entrance: "none"|"fade"|"slide"|"pop"|"typewriter", entranceBy: "word"|"line",
active: "none"|"color"|"scale"|"underline"|"box", position: { x, y }, size: "S"|"M"|"L", sizeFine }`. Presets (unidad ·
agrupación palabras/líneas · activa · entrada · salida · ms): `frase_palabra_activa` (frase · 8/2 · color · fade · fade ·
180), `palabra_a_palabra` (palabra · 1/1 · none · pop · corte · 120), `escritura_progresiva` (palabra en la frase · 8/2 ·
none · typewriter · fade · 60), `texto_estatico` (línea · 10/2 · none · none · corte · 0), `entrada_deslizada` (línea · 8/2
· scale · slide · fade · 260). `LyricComposition` y las funciones de escena según `blueprint.md` §9 paso 8: em = H × {S:
0.045, M: 0.06, L: 0.08} × `sizeFine`; ancho de bloque ≤ 0.84 W; tiempos al fotograma con suelo de centésima (como
`assFrameTime` de `looks.ts`); sacudida en cortes de 100 ms con `shakeOffset` ∈ [−3, 3] px; fundido `\alpha&H40&`. En
`lyric_ass.test.ts` la ruta de fuentes se calcula con `new URL("../../../apps/web/public/fonts/caption/", import.meta.url)`
y el fotograma se lee como `rawvideo` `gray`.

**Archivos**
- `packages/composition/src/style.ts` — edita: añade el esquema v2 (lo existente igual)
- `packages/composition/src/lyricscene.ts` — nuevo
- `packages/composition/src/lyricscene.test.ts` — nuevo
- `packages/composition/src/index.ts` — edita: `export * from "./lyricscene.ts";`
- `workers/media/src/lyric_ass.test.ts` — nuevo

**Aceptación**

1. **WHEN** `validateCaptionStyle` recibe un estilo con valores fuera de rango, un estilo v1 (`SubtitleStyle`) o basura **THE SYSTEM SHALL** devolver un `CaptionStyleV2` válido con exactamente los 9 controles (fuente, peso, caja, colores de texto y palabra activa, efecto, entrada, palabra activa, posición y tamaño), y `captionStyleBytes` del resultado SHALL ser menor que 4000.
2. **WHEN** `captionToSubtitleStyle` convierte un `CaptionStyleV2` **THE SYSTEM SHALL** devolver un `SubtitleStyle` que `buildAss` acepta y que `validateStyle` deja igual, de modo que clipping y letra comparten el mismo esquema.
3. **WHEN** se leen `BEHAVIOUR_PRESETS` **THE SYSTEM SHALL** contener `frase_palabra_activa`, `palabra_a_palabra`, `escritura_progresiva`, `texto_estatico` y `entrada_deslizada`, cada uno con unidad, agrupación, palabra activa, entrada, salida y duración, y `surpriseCaption(seed)` SHALL devolver el mismo estilo válido para la misma semilla.
4. **WHEN** `lyricAss` genera el ASS de una composición de letra **THE SYSTEM SHALL** anclar cada palabra con `\an7\pos(x,y)` en su caja de `lyricLayout` y fijar cada inicio y fin en el fotograma de 1/30 s que usa `lyricSceneAt`.
5. **WHEN** ffmpeg dibuja con libass y la fuente Inter de `apps/web/public/fonts/caption/` el fotograma de t = 1.0 s de una composición de prueba **THE SYSTEM SHALL** producir píxeles de texto cuya caja envolvente cae dentro de la caja de la línea de `lyricLayout` ampliada 0.25 em y cubre al menos el 50 % de su ancho, y el fotograma de t = 0.1 s, antes de la primera palabra, SHALL tener luminancia máxima menor que 16.
6. **WHEN** la entrada es `typewriter` por palabra, la palabra activa es `underline` o `box`, o `shake` está activo **THE SYSTEM SHALL** producir en `lyricSceneAt` y en `lyricAss` el mismo conjunto de palabras visibles en cada fotograma de muestra.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricscene.test.ts workers/media/src/lyric_ass.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 08 — estilo y motor de escena" && git tag rafaga-lyric-v2-step-08
```

### `E2-T3` — Style Studio simplificado, presets y A/B

**Depende de:** `E2-T2` · **Prioridad:** p1

`styles.ts` es puro salvo `saveStyle`, que recibe la función RPC: comprueba `captionStyleBytes` antes de llamar y guarda
`{ rafagaStyle: 2, style, preset }` con `save_caption_style`. `applyPreset` solo toca la capa de animación y agrupación;
`styleLayers` separa fuente, posición y animación. El Style Studio v2 vive detrás de `NEXT_PUBLIC_LYRIC_VERSION === "v2"`
con el mismo renombrado que la página de Lyric Studio (la función por defecto pasa a `StyleStudioV1`). En
`CreationPanel.tsx` la galería de subtítulos usa `CaptionStyleEditor` y guarda `params.caption_style =
captionToSubtitleStyle(v2)`: `generations.test.ts` de clipping debe seguir verde. Sin estilos de interfaz nuevos.

**Archivos**
- `apps/web/components/CaptionStyleEditor.tsx` — nuevo
- `apps/web/lib/styles.ts` — nuevo
- `apps/web/lib/styles.test.ts` — nuevo
- `apps/web/app/app/style-studio/page.tsx` — edita: envoltorio de la bandera
- `apps/web/components/CreationPanel.tsx` — edita: galería con el editor compartido

**Aceptación**

1. **WHEN** se guardan 20 estilos v2 en un workspace y se intenta el 21.º con `saveStyle` **THE SYSTEM SHALL** rechazarlo con `style_limit` y conservar los 20, y borrar uno SHALL permitir guardar otro.
2. **WHEN** `saveStyle` recibe un estilo cuyo JSON supera 4000 bytes **THE SYSTEM SHALL** rechazarlo con `style_too_large` antes de llamar a la base de datos.
3. **WHEN** se alterna entre los estilos A y B con `toggleAB` **THE SYSTEM SHALL** conservar el mismo instante `t`, la misma letra y el mismo fondo, y cambiar solo el estilo.
4. **WHEN** `applyPreset` aplica un preset de comportamiento **THE SYSTEM SHALL** cambiar solo la capa de animación y agrupación y dejar idénticas la capa de fuente (familia, peso, caja, tamaño) y la de posición.
5. **WHEN** se ejecutan `grep -q 'CaptionStyleEditor' apps/web/app/app/style-studio/page.tsx`, `grep -q 'CaptionStyleEditor' apps/web/components/CreationPanel.tsx` y `grep -q 'captionToSubtitleStyle' apps/web/components/CreationPanel.tsx` **THE SYSTEM SHALL** salir con 0 en los tres: el editor de estilo es el mismo en clipping y en letra.
6. **WHEN** se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en ambos.

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

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 09 — Style Studio" && git tag rafaga-lyric-v2-step-09
```

### `E2-T4` — Vista previa de letra y paridad dorada

**Depende de:** `E2-T2`, `E1-T6` · **Prioridad:** p0

`lyricparity.test.ts` compara dos cálculos (no hay archivo dorado de bytes): parsea `\pos` y tiempos del ASS de
`lyricAss` y los enfrenta a `lyricLayout` y a `lyricSceneAt` fotograma a fotograma, en los formatos `9:16`, `4:5`, `1:1`
y `16:9`. `LyricPreview.tsx`: `<canvas>` en cada `requestAnimationFrame` con `lyricSceneAt`; fondo con `lyricShots` y
`<video>`/`<img>` de URLs firmadas; `await document.fonts.load(...)` de la fuente servida en `/fonts/caption/` antes de
maquetar; arrastre de la letra (con alternativa por teclado), deslizador de recorte, bucle/«Reiniciar»/«Otra variante»,
A/B con el mismo cabezal, zonas seguras (`SAFE_ZONES`, solo 9:16, solo vista previa), pantalla completa con `Escape`.
`prefers-reduced-motion` desactiva las animaciones solo en la vista previa de la interfaz.

**Archivos**
- `apps/web/components/LyricPreview.tsx` — nuevo
- `apps/web/lib/lyricpreview.ts` — nuevo
- `apps/web/lib/lyricpreview.test.ts` — nuevo
- `packages/composition/src/lyricparity.test.ts` — nuevo
- `apps/web/components/LyricStudioV2.tsx` — edita: usa la vista previa

**Aceptación**

1. **WHEN** `lyricparity.test.ts` compara, en una composición de 3 líneas por cada formato `9:16`, `4:5`, `1:1` y `16:9`, cada `\pos` del ASS de `lyricAss` con la caja de `lyricLayout` **THE SYSTEM SHALL** encontrar diferencias de 2 px como máximo en x y en y.
2. **WHEN** se comparan los inicios y fines de cada evento del ASS con la visibilidad que da `lyricSceneAt` **THE SYSTEM SHALL** encontrar diferencias de 1 fotograma (1/30 s) como máximo.
3. **WHEN** se arrastra la letra a un punto fuera del lienzo o se mueve con las flechas del teclado **THE SYSTEM SHALL** guardar `style.position` normalizada y acotada a [0,1] con pasos de 0.01, y el recorte SHALL acotarse a [0,1].
4. **WHEN** el bucle está activo y la reproducción pasa del final del tramo, o se pulsa «Reiniciar» o «Otra variante» **THE SYSTEM SHALL** volver a `t = 0`, y «Otra variante» SHALL cambiar la semilla sin cambiar la letra ni el estilo.
5. **WHEN** se ejecutan `grep -q 'lyricSceneAt' apps/web/components/LyricPreview.tsx`, `grep -q 'document.fonts.load' apps/web/components/LyricPreview.tsx` y `grep -q 'Escape' apps/web/components/LyricPreview.tsx` **THE SYSTEM SHALL** salir con 0 en los tres: la vista previa usa el motor de exportación, espera a la fuente antes de maquetar y la pantalla completa se cierra con Esc.
6. **WHEN** se ejecutan `pnpm --filter @rafaga/web typecheck` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en ambos.

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

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 10 — vista previa y paridad" && git tag rafaga-lyric-v2-step-10
```

### `E2-T5` — Modos Letra, Texto y Portada, ganchos y biblioteca

**Depende de:** `E2-T4` · **Prioridad:** p1

En `lyricscene.ts`: modo `texto` (solo `message` en su intervalo, centrado en `position`), modo `portada` (cuadrado de
0.7 W centrado a 0.4 H; delantera la primera mitad, trasera la segunda; zoom 1.00→1.06 en `lenta`, 1.00 en `estatica`;
título y artista debajo; letra solo con `cover.lyrics`), gancho en la franja superior (0.12 H, 0.75 em) solo en su
intervalo, y `switchLyricMode`. Todo pasa por `lyricSceneAt` y `lyricAss` con las mismas funciones. `LyricLibrary.tsx`:
pestañas Mis vídeos, Mis canciones, Paquetes de ganchos (un gancho por línea → `save_hook_pack`), Paquetes de medios
(lista), Estilos de texto, Portadas (lista). Cambiar de modo en `LyricStudioV2` llama a `PUT /api/lyrics/projects/:id`
con `mode` y nunca borra letra ni alineación.

**Archivos**
- `packages/composition/src/lyricscene.ts` — edita: modos, gancho, `switchLyricMode`
- `packages/composition/src/lyricmodes.test.ts` — nuevo
- `apps/web/components/LyricLibrary.tsx` — nuevo
- `apps/web/components/LyricStudioV2.tsx` — edita: selector de modo y gancho

**Aceptación**

1. **WHEN** la composición está en modo `texto` con un mensaje entre 5 s y 9 s **THE SYSTEM SHALL** mostrar en `lyricSceneAt` y en `lyricAss` solo ese mensaje y solo en [5, 9) s, sin palabras de la letra.
2. **WHEN** la composición está en modo `portada` con portada delantera y trasera **THE SYSTEM SHALL** mostrar el título y el artista, la portada delantera en la primera mitad y la trasera en la segunda, con un zoom creciente de 1.00 a 1.06 en modo `lenta` y fijo en `estatica`, y la letra solo si está activada.
3. **WHEN** `switchLyricMode` cambia entre `letra`, `texto` y `portada` **THE SYSTEM SHALL** conservar `words`, `style`, `background`, `range` y `seed` idénticos.
4. **WHEN** la composición tiene un gancho de un paquete **THE SYSTEM SHALL** mostrarlo solo dentro de su intervalo y en la franja superior, en `lyricSceneAt` y en `lyricAss`.
5. **WHEN** se ejecutan `grep -q 'save_hook_pack' apps/web/components/LyricLibrary.tsx`, `grep -q 'Paquetes de ganchos' apps/web/components/LyricLibrary.tsx` y `pnpm --filter @rafaga/web build` **THE SYSTEM SHALL** salir con 0 en los tres.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricmodes.test.ts
export PATH="$HOME/.local/bin:$PATH" && grep -q 'save_hook_pack' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && grep -q 'Paquetes de ganchos' apps/web/components/LyricLibrary.tsx
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web build
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 11 — modos y ganchos" && git tag rafaga-lyric-v2-step-11
```

### `E2-T6` — Paquetes de medios y Crear desde vídeo (103)

**Depende de:** `E1-T5` · **Prioridad:** p0

Pega el SQL de §4 (103). Etapa `media_split` en `lyric.ts`: `propose` descarga la mezzanine con `mezzaninePath`, ejecuta
`scdet` (`-vf scdet=threshold=10,metadata=print -f null -`) en el intervalo y devuelve (≤ 60) segmentos que empiezan y
terminan en cortes o en los extremos, entre `min_s` (defecto 1.5) y `max_s` (defecto `length_s` × 1.5), en
`job_stages.output.segments` (≤ 8192 bytes). `cut`: `rapido` = `-ss S -i <mezzanine> -t L -map 0:v:0 -c copy -an`; `exacto` =
recodifica H.264 `-an`; sube a `<ws>/media/<id>.mp4` y llama a `add_split_item`. En la prueba, registra el fixture `scenes`
como fuente `validated` con su mezzanine en el R2 simulado. Rutas: items (PUT firmado 900 s tras `create_media_item`),
complete, url (GET 3600 s tras `media_item_object`), split, cut y `/api/lyrics/demo` (`open_lyric_demo`; el worker la
completa en `E3-T5`).

**Archivos**
- `supabase/migrations/20261201000103_lyric_media.sql` — nuevo
- `workers/media/src/stages/lyric.ts` — edita: etapa `media_split`
- `workers/media/src/lyric_media.test.ts` — nuevo
- `apps/web/lib/routes/lyrics.ts` — edita: rutas de medios y demo
- `apps/web/lib/lyrics.test.ts` — edita

**Aceptación**

1. **WHEN** `media_split` propone segmentos de duración objetivo 3 s en el fixture `scenes` (cambios de color en 2 s y 4 s) **THE SYSTEM SHALL** devolver segmentos que empiezan y terminan en un cambio de escena detectado por `scdet` o en un extremo del intervalo, con 0.1 s de tolerancia, y de duración entre `min_s` y `max_s`.
2. **WHEN** se cortan los segmentos revisados con `cut_mode = "exacto"` **THE SYSTEM SHALL** crear un `media_items` por segmento con duración a 1 fotograma o menos de la pedida, y con `rapido` (copia de flujo sin recodificar) SHALL crearlo con duración a 1.05 s o menos de la pedida; en ambos casos sin pista de audio y con `audio_muted = true`.
3. **WHEN** se excluye un segmento en la revisión **THE SYSTEM SHALL** no crear su elemento, y cada elemento creado SHALL tener `storage_backend = 'r2'`, clave `<ws>/media/<id>.mp4` y un objeto registrado de tipo `media`.
4. **WHEN** `POST /api/lyrics/media/items` recibe un archivo de más de 209715200 bytes, o uno que con el uso actual supera 10737418240 **THE SYSTEM SHALL** responder 413 `{ limit: 209715200 }` o 507 `{ quota: 10737418240 }` sin crear el elemento, y con un archivo válido SHALL responder 201 `{ item_id, url, expires_at }` con una URL PUT de R2 de 900 s.
5. **WHEN** `POST /api/lyrics/media/split` o `POST /api/lyrics/media/cut` llega dos veces con la misma `Idempotency-Key` **THE SYSTEM SHALL** devolver el mismo `job_id`, y una duración objetivo distinta de 3, 5, 10, 15 o 30 s SHALL responder 400 `{ error: { code: "invalid_params" }, field: "length_s" }`.
6. **WHEN** el usuario B pide `GET /api/lyrics/media/items/:id/url` o `POST /api/lyrics/media/split` sobre recursos de A, o llega `POST /api/lyrics/demo` sin `Idempotency-Key` **THE SYSTEM SHALL** responder 404, 404 y 400, y `POST /api/lyrics/demo` con clave SHALL responder 202 `{ song_id, project_id, job_id }`.

**Verify**

```bash
export PATH="$HOME/.local/bin:$PATH" && ffmpeg -hide_banner -version
export PATH="$HOME/.local/bin:$PATH" && node --test workers/media/src/lyric_media.test.ts apps/web/lib/lyrics.test.ts
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && pnpm --filter @rafaga/web typecheck
```

**Checkpoint**

```bash
git add -A && git commit -m "rafaga-lyric-v2: paso 12 — paquetes de medios" && git tag rafaga-lyric-v2-step-12
```

---

## Aceptación de la épica

La épica termina cuando las 6 tareas están `done` **y**:

1. **WHEN** se generan con `lyricAss` las composiciones de prueba de los 5 presets en los 4 formatos **THE SYSTEM SHALL** pasar la comparación de paridad (≤ 2 px, ≤ 1 fotograma) en todas.
2. **WHEN** falta la fuente pedida para un glifo del texto **THE SYSTEM SHALL** usar `Inter` tanto en la escena como en el ASS, sin cuadros vacíos.

```bash
export PATH="$HOME/.local/bin:$PATH" && pnpm test
export PATH="$HOME/.local/bin:$PATH" && node --test packages/composition/src/lyricparity.test.ts workers/media/src/lyric_ass.test.ts
```

## Trampas

- **La API de Google Fonts devuelve WOFF2** — es la incógnita no verificada del bundle. Si `--write` sale con 69, detente
  e informa: no inventes URLs ni descargues de otro origen.
- **Fuentes variables** — solo valen TTF estáticos por peso; con una variable, el navegador y libass eligen instancias
  distintas y la paridad se rompe.
- **Importar `@rafaga/lyrics` desde `packages/composition`** — no resuelve (sin dependencia declarada). Compara en pruebas
  de `apps/web/lib` o `workers/media/src`.
- **Escala de la palabra activa en un evento de línea** — desplaza las palabras siguientes en libass; por eso un evento por
  palabra.
- **`CreationPanel` de clipping** — si cambia el tipo de `params.caption_style`, `generations.test.ts` falla.

## Antes de seguir

- [ ] Las 6 tareas están `done` en `tasks.json`; ninguna `in_progress`.
- [ ] Todos los comandos `verify` de cada tarea pasaron.
- [ ] Ningún `verify` se editó ni se saltó.
- [ ] Etiquetas `rafaga-lyric-v2-step-07` … `-12` presentes (`git tag -l 'rafaga-lyric-v2-step-*'`).
- [ ] `pnpm test` en verde desde la raíz.
- [ ] Los contratos «Producidos» existen con su firma.
- [ ] Ningún archivo fuera del subárbol cambió (salvo `tasks.json`).
- [ ] Ninguna variable de entorno nueva.
- [ ] Un commit por tarea seguido de su etiqueta.
