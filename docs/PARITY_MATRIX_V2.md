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
| Subtítulos | Presets Entrevista/Contexto, peso, caja, alineación, tracking, animación | — | Compositor por frames (Style Studio) | — | ⬜ |
| Lyric Studio | Canciones, alineación musical, 3 modos, fondos, hooks | — | Modelo de alineación para canto (por evaluar) | — | ⬜ |
| Style Studio | Editor de estilos, 28 tratamientos, compositor por frames | — | Decisión de motor (Canvas/WebGL/Remotion: licencia) | — | ⬜ |
| N variantes | Lotes, plan exacto N, ZIP | — | — | — | ⬜ |
| OpusClip | Recetas, herramientas IA, multipista, NLE | — | Proveedores IA (voz, b-roll, doblaje, upscale) | — | ⬜ |
| Conexiones | 38 destinos, OAuth, protocolos | — | Apps aprobadas por cada plataforma | — | ⬜ |
| Calendario | Programación y publicación | — | Conexiones | — | ⬜ |
| Analítica | Métricas internas reales | `app/app/analitica` | — | build | 🟡 |
| En vivo / Automatizaciones | HLS, RSS | — | — | — | ⬜ |
