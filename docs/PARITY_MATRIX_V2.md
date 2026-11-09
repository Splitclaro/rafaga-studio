# Matriz de paridad V2 (estado honesto, 2026-11-09)

Estados: ✅ probado en entorno real · 🟡 implementado sin prueba real completa · 🔧 en desarrollo · ⛔ bloqueado (dependencia externa) · ⬜ no iniciado.
Referencias: las capturas/observaciones de LyricTune, OpusClip y Restream de esta sesión se limitaron a las pestañas abiertas; no se probaron exports ni integraciones de las referencias.

| Área | Requisito (master/AMPLIACION_V2.md) | Implementación | Dependencia | Test / evidencia | Estado |
|---|---|---|---|---|---|
| Diseño | UI monocroma, sidebar plegable, workspace/perfil, navegación V2 | `apps/web/app/globals.css`, `app/app/layout.tsx` | — | build + revisión 1440/390 (sesión simulada local) | 🟡 |
| Clipping | Subida directa a Storage, validación formato/tamaño/duración | `lib/projects.ts` | Supabase Free: 50 MB/archivo | manual del usuario (fallo por vídeo de 2,9 s → ahora rechazado antes) | 🟡 |
| Clipping | Subida reanudable TUS, progreso real, URL HTTPS con SSRF, Drive | — | — | — | ⬜ |
| Brief | Campo, ≤2000, «Detectar…»/«Volver a detectar» encolan job idempotente | RPC `request_detection`, página proyecto | — | RLS test 8/8 (PGlite) | 🟡 |
| Brief | «Ajustar enfoque» (interpretación editable) | — | — | — | ⬜ |
| Selección | LLM con brief/exclusiones, validación de intervalos | `packages/selection`, `packages/providers` | **Anthropic sin saldo** | autoprueba: 400 «credit balance too low» | ⛔ |
| Selección | Respaldo sin IA (léxico) etiquetado | `packages/selection/src/lexical.ts` | — | autoprueba nube run 42629711496: ventas/historia/sin coincidencia correctos | ✅ (respaldo) |
| ASR | Deepgram nova-3, palabras con tiempos, ES | `providers/transcribe` | — | autoprueba: 199 palabras, ES, 0,3–1,2 s | ✅ |
| Worker | Cola durable, claim skip-locked, worker caliente, primer clip antes del lote | `workers/media/src/run.ts`, `worker.yml` | Arranque inmediato requiere `GH_DISPATCH_TOKEN` en Vercel | run 42626338501: job recogido 25 s tras arrancar | 🟡 |
| Render | 9:16 fondo desenfocado + ASS palabra activa | `packages/composition` | — | autoprueba: 1080×1920 h264/aac, 14 s render | ✅ |
| Subtítulos | Editor de clip: corregir texto (conserva intervalo), dividir/unir, inicio/fin por palabra, desfase global, búsqueda y salto, deshacer/rehacer, autosave con versiones inmutables y detección de conflicto, presets (Impacto/Limpio/Karaoke) + restaurar, estilo, safe area 9:16, SRT/VTT/TXT | `apps/web/app/app/c/[id]`, `packages/composition/src/edit.ts` | — | 6 tests unitarios de edición; **UI sin probar con sesión real** | 🟡 |
| Export | MP4 bajo demanda por versión/formato (9:16, 1:1, 16:9), con/sin subtítulos, reutiliza export idéntico | RPC `request_render` (migración 3 aplicada), worker `processRender` | — | `scripts/test-render.ts`: 3 formatos OK (dims, 30 fps, AAC, 12,00 s); RLS 9/9 | 🟡 |
| Fuentes | Fuentes propias por workspace (TTF/OTF validadas, privadas), mismas en preview y render; negrita configurable | Brand kits, migración 4, worker `fontsFor` | Licencia de cada fuente: responsabilidad del workspace | libass selecciona «Bootzy TM» (prueba local); RLS | 🟡 |
| Subtítulos | Presets Entrevista/Contexto, caja, alineación, tracking, animación | — | Compositor por frames (Style Studio) | — | ⬜ |
| Lyric Studio | Canciones MP3/WAV privadas, letra pegada o importada (TXT/LRC/SRT/VTT), tramo desde/hasta | `app/app/lyric-studio`, migración 5 | Supabase Free 50 MB | RLS 11/11 | 🟡 |
| Lyric Studio | Alineación letra↔ASR (DP, conserva texto, interpola y marca), sin letra → líneas por pausas, caché por letra+tramo | `packages/lyrics`, worker `processLyrics` | Canto real con instrumental: **sin validar** (Deepgram es ASR de habla) | autoprueba nube run 42634468349 (voz recitada): 19/20 emparejadas, texto original conservado | 🟡 |
| N variantes | Plan exacto N (1–200 por petición), round-robin barajado con semilla, aviso de repeticiones, reintento sin repetir variantes listas, cancelación entre variantes | `planVariants`, `request_lyrics`, worker | — | 4 tests + autoprueba: 3 variantes distintas, ~1,5 s render c/u | 🟡 |
| Lyric Studio | Modos Text y LP Cover, fondos de vídeo/foto y colecciones, packs desde vídeo, hooks, filtros, 720p, ZIP | — | — | — | ⬜ |
| Style Studio | Editor de estilos propios (fuente, tamaño, mayúsculas, colores, contorno, sombra, animación reveal/dim/color, composición), Sorpréndeme reversible, guardar/duplicar/borrar, importar/exportar con esquema, usarlos en clips y letras | `style-studio`, `style.ts`, migración 8 | — | 3 tests de validación; RLS | 🟡 |
| Style Studio | 28 tratamientos, capas de entrada, loops, caos con semilla, glow/degradado | — | Compositor por frames (decisión de motor pendiente) | — | ⬜ |
| OpusClip | Recetas, herramientas IA, multipista, NLE | — | Proveedores IA (voz, b-roll, doblaje, upscale) | — | ⬜ |
| Conexiones | Catálogo de 38 destinos con capacidades y requisitos orientativos; estado honesto «no configurado» | `conexiones`, `lib/platforms.ts` | Apps aprobadas por cada plataforma; verificación de docs | build | 🟡 (catálogo) · ⬜ (OAuth y protocolos) |
| Calendario | Mes/semana/lista, zona IANA + UTC + DST, adjuntar clip/letra, destinos, borrador/planificada/publicada/cancelada; planificador manual (sin publicación automática) | `app/app/calendario`, `lib/tz.ts`, migración 9 | Conexiones reales para publicar | `lib/tz.test.ts` 4 tests (DST Madrid/NY); RLS | 🟡 |
| Analítica | Métricas internas reales | `app/app/analitica` | — | build | 🟡 |
| Automatizaciones | RSS https con enclosure de vídeo, cursor al activar, dedupe por GUID, límite diario, historial, comprobar ahora, planificador 15 min mientras el worker vive | `automatizaciones`, `net.ts`, worker `checkRule`, migraciones 9 y 11 | Worker activo; vídeos ≤50 MB (Free) | 4 tests SSRF/feed + RLS; **sin prueba con un feed real aún** | 🟡 |
| En vivo | Captura HLS (MPEG-TS) autorizada en ventanas de ~2 min → proyecto por ventana → clips; pausa/parar/reanudar; huecos sin unir; reconexión; resumen textual | `en-vivo`, `hls.ts`, worker `processLive`, migración 12 | Worker; solo MPEG-TS sin DRM; fMP4 no soportado | `scripts/test-hls-live.ts`: 4 ventanas válidas con corte de fuente real; **no probada en cloud ni ≥10 min** | 🟡 |

| Inicio | Pestañas de tipo de generación, panel de carga visible, recetas Captions/Reframe/Social/B-roll operativas (worker `processWhole`), proyectos recientes con imagen, «Ver todos», proyecto en curso | `app/app/page.tsx`, `lib/projects.ts` | Worker | build; **modos no probados con vídeo real en cloud** | 🟡 |
| Galería | Puntuación /100 con desglose A–C, orden por puntuación/tiempo, duración, favoritos, descartar, descarga, «por qué no se eligieron» | `app/app/p/[id]` | — | build | 🟡 |
| Editor | Encuadre (desenfocado/rellenar con posición manual/ajustar), Social edits por red, B-roll desde Custom Collections, 4:5 | `app/app/c/[id]`, `composition.ts` | Seguimiento facial; B-roll con IA (proveedor) | 12 combinaciones layout×ratio con FFmpeg real | 🟡 |
| Lyric Studio | Selector de tramo con forma de onda; «3 mejores momentos» por energía+repetición | `RangePicker`, `moments.ts` | — | 4 tests de momentos | 🟡 |
| Biblioteca | Vídeos, clips exportados, vídeos con letra, canciones, colecciones, fuentes, estilos con búsqueda, descarga y borrado | `biblioteca` | — | build | 🟡 |
