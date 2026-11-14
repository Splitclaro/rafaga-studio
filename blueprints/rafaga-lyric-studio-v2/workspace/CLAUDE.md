<!-- rafaga-lyric-v2:merged — sección AÑADIDA al CLAUDE.md raíz por el Bootstrap de blueprints/rafaga-lyric-studio-v2/ -->
# Construcción v2 · Lyric Studio (bundle `blueprints/rafaga-lyric-studio-v2/`)

Depende de clipping v2 terminado (`rafaga-v2-step-01…18`). Encargo: `blueprint.md` (porqués), `tasks.json` (qué toca) y
`epics/*.md` (cómo) de ese bundle. Todo lo de arriba (aislamiento, 0 €, reglas de código y de la ampliación) sigue mandando.

| Tarea | Comando (desde la raíz, con `export PATH="$HOME/.local/bin:$PATH" && …`) |
|---|---|
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| Fuentes del vídeo | `node scripts/fetch-fonts.ts --check` (sin red) · `--write` solo en el paso 7 |
| Rendimiento de letra | `node scripts/lyric-perf.ts --quick` |
| Etapas | `node workers/media/src/stage.ts --list` (incluye `song_validate`, `lyric_sync`, `media_split`) |
| Vuelta atrás | `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD` (paso 1: `rafaga-v2-step-18..HEAD`) |

**Bucle:** lee `blueprints/rafaga-lyric-studio-v2/tasks.json`; resuelve antes cualquier `in_progress` ejecutando su
`verify`; toma la primera tarea lista en orden del array, ponla `in_progress`, haz solo esa tarea según su épica, ejecuta
todo su `verify`, ponla `done` y haz su Checkpoint:
`git add -A && git commit -m "rafaga-lyric-v2: paso NN — …" && git tag rafaga-lyric-v2-step-NN`. Si algo bloquea, detente.

## Arquitectura de letra
Canción = `sources` de audio (cargador compartido) + `songs.source_id` → etapa `song_validate` → `lyric_sync` (Groq bajo
`GroqLimiter`, revisiones `v2:r<n>` en `song_alignments`) → pieza = `projects` (`mode = 'lyrics'`) + `lyric_projects` →
variantes = `clips` + `clip_versions` (`LyricComposition` inmutable) → `renders` vía `request_exports` → `stages/export.ts`
→ `renderLyricItem` (`stages/lyric.ts`) → publicar y compartir con `publications` y `deliveries` de clipping.

| Asunto | Fuente única |
|---|---|
| Escena, ASS y render de letra | `packages/composition/src/lyricscene.ts` (`lyricLayout`, `lyricSceneAt`, `lyricAss`, `lyricRenderArgs`) |
| Estilo de 9 controles (letra y subtítulos de clipping) | `packages/composition/src/style.ts` (`CaptionStyleV2`, `captionToSubtitleStyle`) |
| Fuentes del vídeo | `packages/composition/src/fontcatalog.ts` + `apps/web/public/fonts/caption/` |
| Alineación y formatos | `packages/lyrics/src/sync.ts`, `formats.ts` |
| Esquema | `supabase/migrations/20261201000100…104_*.sql` |

## Reglas de letra
1. La letra del usuario nunca cambia en silencio: alinear devuelve sus palabras; transcribir es solo una propuesta.
2. Las palabras `manual` son anclas: re-sincronizar, insertar o borrar no las mueve.
3. Un motor: la vista previa dibuja con `lyricSceneAt`; el MP4 usa `lyricAss` + `lyricRenderArgs`. ≤ 1 fotograma, ≤ 2 px.
4. El audio de la canción no se filtra ni se mezcla; el de los fondos nunca entra (`-an`).
5. `packages/composition` y `packages/lyrics` no se importan entre sí (cambiaría `pnpm-lock.yaml`).
6. v1 intacta detrás de `NEXT_PUBLIC_LYRIC_VERSION` (≠ `v2`): página v1, `request_lyrics`, `save_manual_alignment`,
   `run.ts`, `FILTERS`, `LOOKS`. Las canciones v1 no pasan al flujo v2.
7. Pruebas nuevas solo donde llega `pnpm test`: `*/src/*.test.ts`, `apps/web/lib/*.test.ts`, `supabase/tests/*.test.ts`.
8. Sin licencias ajenas: «Colecciones Ráfaga» sale vacío; solo medios del propietario y fuentes OFL/Apache con su licencia.

Regla diferida: `.claude/rules/lyric-studio.md` (letra, estilo, escena, fuentes, etapa, rutas y migraciones de letra).
