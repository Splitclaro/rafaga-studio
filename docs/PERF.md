# Rendimiento (modo rápido)

Generado por `node scripts/perf-run.ts --quick` el 2026-11-23. **Línea base local, no una promesa de tiempos.**

- Material: 2 proyectos a la vez, vídeo de 5 min a 640×360 (H.264), audio `pcm_s24le` y timecode.
- Recorrido: subida (copia) → validate → mezzanine → proxy → análisis → selección → composición → previews → comprobaciones → exportación MP4 de cada clip → ZIP.
- Sustituido por simulación: transcripción (ASR), selección con LLM y detección de caras; R2 en memoria; base de datos PGlite.
- Entorno: darwin arm64, 10 núcleos, ffmpeg version 9.0.2-https://www.martin-riedl.de Copyright (c) 2000-2026 the FFmpeg developers.
- Límite de la medida: un solo hilo de JavaScript (ffmpeg bloquea), así que los 2 proyectos se intercalan pero no corren en paralelo real; sin cola de Modal ni red.

| Fase (ms) | p50 | p95 | muestras |
|---|---|---|---|
| `upload_ms` | 121 | 124 | 2 |
| `queue_ms` | 7 | 132 | 2 |
| `analysis_ms` | 90656 | 105306 | 2 |
| `first_clip_ms` | 73922 | 73943 | 2 |
| `all_clips_ms` | 74248 | 74305 | 2 |
| `render_ms` | 6107 | 9112 | 2 |
| `zip_ms` | 29 | 1537 | 2 |

Con 2 muestras por fase, p95 coincide con el máximo. Fases: `upload_ms` copia del archivo; `queue_ms` espera de la primera etapa; `analysis_ms` ingesta + análisis; `first_clip_ms` desde pedir la generación hasta el primer clip; `all_clips_ms` hasta terminar las comprobaciones; `render_ms` desde pedir la exportación hasta el último MP4; `zip_ms` empaquetado del lote.

## Pendiente

Los objetivos de rendimiento se fijan después de medir vídeos de 5, 30 y 60 min con Modal real y ASR/LLM reales, con una concurrencia definida. Hasta entonces la interfaz muestra la etapa actual y rangos estimados con datos reales, sin porcentajes inventados.

<!-- lyric-perf:start -->
## Lyric Studio (modo rápido)

Generado por `node scripts/lyric-perf.ts --quick` el 2026-11-14. **Línea base local, no una promesa de tiempos.**

- Material: canción sintética de 180 s (WAV 44,1 kHz), letra de 600 palabras; ASR simulado con retardo fijo de 1,5 s; R2 en memoria; base de datos PGlite.
- Recorrido: validación de la canción → sincronización (ASR + alineación) → vista previa (diseño + primera escena + ASS) → 3 variantes de 15 s a 1080p con el render real (ffmpeg + libass).
- Entorno: darwin arm64, 10 núcleos, ffmpeg version 9.0.2-https://www.martin-riedl.de Copyright (c) 2000-2026 the FFmpeg developers.
- Límite de la medida: un solo hilo de JavaScript (ffmpeg bloquea): las 3 variantes se intercalan, no corren en paralelo real; sin cola de Modal ni red. Con 3 muestras, p95 coincide con el máximo.

| Métrica | ms |
|---|---|
| `sync_ms` | 2557 |
| `preview_ready_ms` | 3 |
| `render_ms_p50` | 9901 |
| `render_ms_p95` | 14896 |
<!-- lyric-perf:end -->
