---
paths:
  - "packages/lyrics/**"
  - "packages/composition/src/style.ts"
  - "packages/composition/src/lyric*.ts"
  - "packages/composition/src/fontcatalog.ts"
  - "workers/media/src/stages/lyric.ts"
  - "workers/media/src/lyric_*.test.ts"
  - "apps/web/components/Lyric*.tsx"
  - "apps/web/components/CaptionStyleEditor.tsx"
  - "apps/web/lib/routes/lyrics.ts"
  - "apps/web/lib/{lyrics,synceditor,captionfonts,styles,lyricpreview,lyricsettings,lyricshare,lyriccutover}*.ts"
  - "supabase/migrations/202612010001*.sql"
  - "supabase/tests/lyric_v2.test.ts"
  - "scripts/fetch-fonts.ts"
  - "scripts/lyric-perf.ts"
---

# Lyric Studio v2

- Migraciones de letra: `20261201000100`…`20261201000104`; las siguientes continúan en `…105`. Aditivas; CHECK reescritas
  como superconjuntos; `complete_upload` y `request_exports` se recrean copiando literalmente su última definición.
- La letra guardada (`songs.lyrics_text`) solo cambia con `set_song_lyrics`; `transcribe` crea una revisión `proposal`.
- Revisiones en `song_alignments` con `lyrics_sha256 = 'v2:r<n>'`; ASR en caché con `'asr:<modelo>'`. Usuario: solo
  `kind = 'manual'` con `base_revision`; conflicto → `{ conflict, current_revision }`.
- Anclas: toda palabra con `manual: true` conserva `start` y `end` al re-sincronizar, insertar, borrar o restaurar.
- Unidades: `lyric_sync` reserva 1 por minuto de canción solo si hay que llamar al ASR; render y publicación, 0.
- Un motor: `lyricLayout`/`lyricSceneAt` (vista previa) y `lyricAss`/`lyricRenderArgs` (MP4) comparten cajas y tiempos
  al fotograma de 1/30 s; un `Dialogue` por palabra con `\an7\pos(x,y)`. Tolerancia: ≤ 1 fotograma, ≤ 2 px.
- Fuentes del vídeo: solo las de `CAPTION_FONTS`, mismo TTF en `apps/web/public/fonts/caption/` para navegador y worker;
  glifo ausente → `Inter`; la vista previa espera `document.fonts.load` antes de maquetar.
- Audio: solo el de la canción, `-c:a aac -b:a 192k`, sin filtros; los fondos siempre `-an`.
- Filtros v2 `none|noche|super8|bn|vapor` con las mismas cadenas que `FILTERS` v1, que no se toca.
- Estilos v2 en `text_styles` con `{ rafagaStyle: 2, style, preset }`, ≤ 20 por workspace, ≤ 4000 bytes, vía
  `save_caption_style`.
- `packages/composition` no importa `@rafaga/lyrics` y viceversa; las pruebas que comparan ambos viven en
  `apps/web/lib` o `workers/media/src`.
- Las pruebas nuevas van en un nivel que recorre `pnpm test`; nunca en `workers/media/src/stages/`.
- v1 intacta: página v1 detrás de `NEXT_PUBLIC_LYRIC_VERSION`, `request_lyrics`, `save_manual_alignment`, `run.ts`,
  `LOOKS`, `lyricFfmpegArgs`, `lookFfmpegArgs`.
- Errores propios de letra en `LYRIC_ERRORS` de `routes/lyrics.ts`; `api.ts` no se edita.
- Sin medios ni nombres de terceros: «Colecciones Ráfaga» sale vacío con su estado vacío explicado.
