# STATUS — Ráfaga Studio

Estado: **entrega parcial: beta aún no verificada** (sesión 1, 2026-11-09).

## Hecho
- ZIP localizado, entradas validadas (sin rutas fuera del destino), extraído en carpeta temporal nueva.
- Seis documentos leídos íntegros y copiados a `master/` con SHA-256 verificados (`master/manifest.json`).
- Proyecto creado en `/Users/studio/Documents/Codex/rafaga-studio`, `CLAUDE.md` raíz, manifiesto de recursos.

## Sesión 1 — avance técnico
- Instalados en `~/.local/bin`: pnpm 12.18, ffmpeg/ffprobe 9.0.2 (martin-riedl.de, arm64; libass, drawtext, libx264, aac).
- `packages/composition`: agrupación de palabras, `activeWordAt` única, generador ASS con escape; 6 tests OK.
- Spike `scripts/spike-subs.ts`: fixture sintético ES 9:16, export 1080x1920 H.264/AAC; transiciones de palabra activa export vs. función de preview: **0 frames de diferencia** (6 transiciones). Evidencia: `docs/evidence/subs-impacto-9x16-t1.5.png`. Solo fixture local; falta 1:1, 16:9, otros presets y worker cloud.

## Sesión 1 (cont.)
- `docs/REFERENCE_REVIEW.md`: 7 vídeos revisados por hoja de contactos (sin audio); las 10 imágenes siguen sin revisar.
- `supabase/migrations/20261109000001_core.sql`: perfiles, workspaces, membresías, fuentes, proyectos (brief ≤2000), transcripts, generaciones, candidatos, clips/versiones, jobs, renders, ledger, brand kits, notificaciones, outbox; RLS, FK compuestas por workspace, buckets privados. Pendiente: automatizaciones, live_*, invitaciones, conexiones sociales.
- `supabase/tests/rls.test.ts` (PGlite con auth/storage simulados): 7/7 OK. **No sustituye la prueba A/B contra Supabase real.**
- `apps/web` (Next 16.4.5, React 19.3.1, Tailwind 4): landing mínima y `/editor/demo` con preview que usa `activeWordAt` del paquete compartido; edición de texto conserva intervalos. typecheck y build OK; comprobado en navegador que la palabra activa coincide con los tiempos. Fixture, sin vídeo real, sin guardado, sin auth.

## Preflight
- OK: git 2.39, node 24.18, npm 11, python 3.12, gh 2.100 (cuenta activa **Splitclaro**, scopes repo/read:org).
- Faltan: pnpm, ffmpeg/ffprobe, Vercel CLI/login, Supabase CLI, Docker. Sin claves de Deepgram/Anthropic/Trigger.dev en el entorno.
- Verificado en Chrome: Supabase org Splitclaro (Free), Vercel equipo split-claro-app (Hobby), GitHub Splitclaro. Repo creado: https://github.com/Splitclaro/rafaga-studio.

## Sesión 1 (cont. 2) — worker GitHub Actions
- Selector (`packages/selection`, 8 tests), proveedores Deepgram/Anthropic (endpoints verificados en docs; **sin probar con claves reales**), composición/FFmpeg (`packages/composition`, 4 tests + `scripts/test-render.ts`: 1080x1920 H.264/AAC 30 fps, 12,00 s, OK; evidencia `docs/evidence/render-blur-9x16-t3.png`).
- Migración 2 aplicada en Supabase (request_detection, claim_job); RLS tests 8/8 (PGlite).
- Web: «Detectar momentos virales»/«Volver a detectar» encolan job real; muestra estado y clips con URL firmada. Sin worker activo el job permanece en cola.

## Sesión 2 — V2 (2026-11-09)
- Encargo V2 en `master/AMPLIACION_V2.md`; `CLAUDE.md` raíz actualizado; matrices `docs/PARITY_MATRIX_V2.md`, `docs/STYLE_PARITY_V2.md`; `docs/COSTS.md`, `docs/RUNBOOK.md`.
- **Velocidad:** causa del «tarda mucho» = el cron de GitHub nunca se ejecutó. Worker ahora queda caliente 10 min (sondeo 3 s), descarga el original una vez, primer clip solo y resto de 2 en 2, x264 superfast. `/api/wake` arranca el worker al pulsar Detectar (requiere `GH_DISPATCH_TOKEN`).
- **Fallo del usuario:** su vídeo «elio 4» dura 2,9 s → ahora se rechaza antes de subir y el worker da un mensaje claro.
- **Autoprueba nube (run 42629711496):** Deepgram ES OK (199 palabras, 0,3–1,1 s); Anthropic sin saldo → selector léxico: ventas 6,9–19,8 s sin patrocinador, historia 48,4–65,9 s, brief sin coincidencias → 0. Render 1080×1920 h264/aac ~14 s.
- **UI monocroma** y navegación V2 (sidebar plegable, menú de workspace, analítica interna real; módulos no hechos marcados «Pronto»).

## Sesión 4 — todas las páginas construidas (2026-11-10)
- **Audio de los 7 vídeos transcrito localmente** (Whisper) → `docs/REFERENCE_REVIEW_V2.md` §I. Aprendido: en vivo con etapas, % viralidad, señales de risa/grito, split gaming automático, buscador de canales (no replicado).
- **Diseño premium/tech** (misma paleta): tokens, sombras en capas, ⌘K, notificaciones reales, menú agrupado Crear/Publicar/Automatizar.
- **Páginas ya existentes y funcionales:** Inicio (OpusClip-like), Proyectos, Proyecto (galería), Editor de clip (texto/estilo/encuadre/social/B-roll/exportar), Lyric Studio (tramo, 3 mejores momentos, colecciones, ajustes, N variantes), Style Studio, Biblioteca, Brand kit, Automatizaciones, En vivo, Calendario, Conexiones (catálogo), Analítica, Ajustes.
- Migraciones 8–12 aplicadas y **verificadas** con consultas.
- Pruebas: `pnpm test` en raíz (composición, selección, letras, providers/SSRF/HLS, tz, RLS 16 tests PGlite) + render FFmpeg real + captura HLS real progresiva.

## Pendiente conocido (honesto)
- Nada de lo nuevo se ha probado todavía en el entorno desplegado con datos reales: modos de herramienta, B-roll en export, automatización con feed real, En vivo en cloud, Style Studio en export de clips.
- Anthropic sin saldo → selección sin IA. `GH_DISPATCH_TOKEN` no configurado.
- Layouts gaming/split de dos personas, seguimiento facial, palabras clave en color, emojis, titular, filtros en clips, tipo de vídeo, importación por URL/Drive, 28 estilos y compositor por frames, conectores reales/OAuth, doblaje/traducción, upscale, multipista, NLE.

## Bloqueos externos
1. **Anthropic sin saldo** → selección con IA bloqueada (hay respaldo léxico). Requiere cargar saldo (autorización de coste).
2. **`GH_DISPATCH_TOKEN`** (PAT de GitHub con permiso Actions: write sobre este repo) en Vercel → arranque inmediato del worker. Sin él, depende del cron de GitHub.
3. Supabase Free: 50 MB por archivo → sin fuentes de 30/60 min (Pro con autorización).
4. Auth: confirmación de correo + SMTP gratuito limitado → testers ajenos no reciben el correo.
5. Lyric Studio: falta evaluar modelo de alineación para voz cantada (licencia/coste/runtime).

## Sesión 2 (cont.) — editor de subtítulos
- Usuario decide seguir SIN IA (no carga saldo en Anthropic): selector léxico por defecto.
- Editor `/app/c/[id]`: vídeo real (URL firmada del original) con fondo desenfocado y overlay de subtítulos con las mismas reglas que el export; edición de palabras, dividir/unir, tiempos, desfase, búsqueda, deshacer/rehacer, autosave (versión nueva por guardado, conflicto si otra sesión guardó), presets, estilo, formato, subtítulos on/off, SRT/VTT/TXT, export MP4 por versión y descarga firmada.
- Migración 3 aplicada (jobs.params, request_render, claim_job con render primero). Worker procesa renders.
- Pendiente de verificar con sesión real del usuario: recorrido editor → export → descarga.

## Sesión 2 (cont.) — fuentes y Lyric Studio
- Usuario confirma: generación y edición OK en producción (job ok en worker).
- Fuente Bootzy TM: sin licencia en metadatos → NO se sube al repo público; se añade como fuente propia del workspace (Brand kits → Fuentes). El usuario debe subirla.
- Lyric Studio v1 (migración 5): canciones, letra, tramo, N variantes (estilo × fondo sólido, semilla), lotes y descargas. Autoprueba nube OK con voz recitada; canto real sin validar.

- Incidencia: migraciones 4 y 5 no se habían aplicado (falso «Success» del editor SQL). Aplicadas y VERIFICADAS con to_regclass/pg_proc. Subida previa fallida pudo dejar un WAV huérfano en `originals/<ws>/songs/`.

## Sesión 3 — Bootzy, formato LyricTune, colecciones, rediseño
- Bootzy TM = fuente de los RESULTADOS (subtítulos/letras de clips y sus vistas previas), NO de la interfaz (decisión del usuario, 9-11); la UI usa la fuente del sistema. Alojamiento: bucket público `app-fonts` (migración 6), fuera del repo; web por @font-face, worker la descarga. Verificado en nube: libass `fontselect -> BootzyTM`.
- Presets de letra «Letra» (minúsculas, sin contorno, sombra suave, palabras que aparecen) y «Letra suave» (atenuadas); editor y export comparten modos.
- Ráfaga Collections (catálogo sin medios aún, por decisión del usuario) y Custom Collections (migración 7 aplicada y verificada): vídeo/foto propios; ajustes secuencia/intervalo, oscurecer, barras, filtros Midnight/Super 8/Noir/Vaporwave, tamaño de texto. Autoprueba nube run 42713521614 OK.
- Rediseño (skill frontend-design): dashboard «hola, ¿qué creamos hoy?» con panel de creación (perforaciones), accesos, cifras reales, hoja de contactos; Lyric Studio por pasos con vista previa animada. Revisado 1440/390 sin overflow (sesión simulada local).
- Nueva tarea del usuario: analizar a fondo 10 imágenes + 7 vídeos de funcionamiento de generación automática de clips → requisitos por página.

## Siguiente paso (anterior)
Probar Lyric Studio con una canción real (canto + instrumental). Siguiente: Style Studio (compositor por frames compartido preview/export) y modos Text/LP Cover, fondos de vídeo/foto, ZIP.

## Sesión 5 — fusión Proyectos/Biblioteca y formato LyricTune
- `/app/proyectos` redirige a Biblioteca; pestaña **Proyectos**: cada proyecto despliega sus clips (vídeo, duración, peso), descarga individual y «Descargar todos» (descargas secuenciales; sin ZIP).
- Lyric Studio: nuevo ajuste `frame` (banda 16:9 centrada sobre lienzo negro con la letra encima = formato visto en la landing de LyricTune; por defecto) o pantalla completa; estilos `Tune`, `Palabra`, `Tune mayúsculas`; vista inicial con formatos más usados y vídeos recientes. Cubierto por tests de ffmpeg (`pad` antes de `subtitles`). **No verificado en la nube con una canción real.**

## Sesión 6 — looks de videolyric y primeros hallazgos de auditoría
- Referencias de LyricTune medidas (ver `docs/LYRIC_LOOKS.md`). Tres looks completos (Archivo analógico, Diario urbano, Cine panorámico) con motor de layout común preview/export, tratamiento VHS configurable, montaje por frases, 1080p/720p, 4:3 nativo.
- Sincronización manual por pulsación (teclado y botón táctil) con versión reutilizable; ajustes por canción persistentes (`songs.studio_settings`).
- Migraciones 13 y 14 aplicadas y verificadas en producción (consulta de comprobación).
- Auditoría: `docs/AUDIT_2026-11-10.md` (H07, H08, H10, H11 corregidos; H01 bloqueado por coste).
- Encargos de Dashboard/My projects/Asset library completo y del resto de la auditoría: **no iniciados en esta sesión**.

## Sesión 7 — auditoría: operación y equipos
- H06: programador `pg_cron` cada minuto en producción (`scheduler_runs`), latido del worker, huérfanos cerrados, cola justa entre espacios. Falta el token de GitHub en Vault (`gh_dispatch_token`) para arrancar el worker solo.
- H14: Analítica operativa (periodo, tipo, p50/p95 con n, fallos por causa, reintentos, almacenamiento) con `started_at`/`finished_at`.
- H02: varios espacios, espacio activo en servidor, roles con RLS restrictiva, invitaciones y auditoría (migración 17 aplicada, prueba de humo en producción con rollback).

## Sesión 8 — H03 Brand kits
- Kits versionados con logo, colores, estilo de subtítulos, intro/outro y perfil de export; aplicar/revertir por proyecto; exports con marca (worker + `ffmpegArgs`). Migración 18 aplicada y verificada. Falta: prueba cloud de un export con marca, vocabulario/censura, lower thirds, aplicar a Lyric Studio.

## Sesión 9 — H09 Style Studio
- Compositor de subtítulos por evento (entrada, salida, caja, palabras clave, tracking, cursiva, suavizado) y 21 tratamientos; Style Studio actualizado. Sin migración. Verificado con libass local; pendiente prueba en el worker cloud.

## Sesión 10 — H12 editor y resultados
- Editor de 3 paneles con transcripción por frases, panel plegable/redimensionable y vista previa mayor; resultados de Lyric Studio a todo el ancho. Revisado en 4 anchos con servidor Supabase simulado local (solo QA, no está en el repositorio). Pendiente: timeline visual con miniaturas y recorte.

## Sesión 11 — H13 y endurecimiento de privilegios
- Títulos sugeridos sin IA fieles al contenido y miniaturas reales por clip (worker + relleno de antiguos). Migración 19 (columnas, privilegios) y 20 (anon, clip_versions) aplicadas y verificadas.

## Sesión 12 — Rediseño «estudio editorial»: resultados, revisión, comparación y entregas
- Componentes compartidos (`components/ui`): `StatusLabel` (texto+icono; «Listo»≠«Aprobado»), `ClipCard`, `ClipWall` (filtros con contadores, búsqueda, orden, galería/lista, selección persistente, barra de acciones, un único preview), `pieceStatus` (la aprobación solo vale para la versión actual).
- Rutas nuevas: `/app/r/[id]` (sala de revisión: versiones, comentarios con instante, aprobar/solicitar cambios), `/app/p/[id]/comparar` (A/B, sincronización explícita solo si es el mismo fragmento), `/app/entregas` y `/app/entregas/[id]` (cabecera con marca/proyecto, galería, descarga individual/selección con manifiesto JSON).
- Migración 21 (aplicada y verificada): `review_status`/`approved_version` en clips, `clip_comments`, `deliveries`, `delivery_items`, RPC `set_review`, `add_clip_comment`, `resolve_clip_comment`, `create_delivery`, `delete_delivery`.
- Navegación reorganizada (Crear / Revisar y entregar / Automatizar); Inicio con título editorial, «Pendientes» reales y «Continúa donde lo dejaste» con acción contextual; sin fondos de puntos.
- Verificado: PGlite (104 tests), producción (migración), navegador a 1440/1024/768/390 con un servidor Supabase simulado local (sin desbordes de página, selección, preview único, revisión, comparación con aprobación caducada por versión). NO verificado con datos reales de usuario.
- Pendiente: enlaces de revisión para externos con caducidad/revocación (requiere diseño de acceso por token sin clave de servicio en Vercel), ZIP por job con portadas/SRT/VTT, cambiar portada manualmente, «crear más versiones como esta», estilos reutilizables unificados, montaje al ritmo, brief estructurado, biblioteca única con duplicados.

## Sesión 13 — Enlaces de revisión y paquetes ZIP
- Migración 22 (aplicada y verificada): `share_links` (token solo como SHA-256, caducidad 1–90 días, revocación, permisos comentar/aprobar/ver botón de descarga), RPC anónimas `share_view`/`share_comment`/`share_decide` (únicas con acceso anónimo; `anon` sin acceso a tablas), política de Storage `share_read_anon` limitada a archivos de entregas con enlace activo; `delivery_packages` + RPC `request_package`/`retry_package`/`cancel_package`; trabajo `package` en la cola justa.
- Página pública `/revision/[token]` (sin cuenta): galería, reproducción, comentarios con instante, aprobar/pedir cambios si el enlace lo permite; una decisión sobre una versión obsoleta se rechaza.
- Worker `processPackage`: ZIP en partes de ≤ 40 MB (límite de archivo del plan gratuito), `video/`, `portadas/`, `subtitulos/` (SRT, VTT), `transcripciones/`, manifiesto por parte y manifiesto global; comprobación de integridad con `unzip -t` antes de subir; cancelación y reintento.
- Verificado en producción con una entrega de prueba (ya borrada) sobre un clip real: acceso anónimo con token (vista, firma de URL y descarga del MP4 1080×1920 de 14,4 s), comentar como invitado, aprobar sin permiso denegado, token inválido, tablas cerradas a anon, firma de ruta ajena 404; paquete en el worker cloud: 1 pieza, ZIP 1,95 MB verificado + manifiesto, 5,9 s.
- Limitaciones: el permiso «descargar» solo muestra/oculta el botón (quien reproduce puede guardar el vídeo); un MP4 > 40 MB va solo en su parte y > 50 MB no se puede subir (límite de Supabase Free); los ZIP caducan a los 30 días en BD pero no hay limpieza automática de archivos; `list` anónimo del bucket puede mostrar nombres de carpeta de archivos con enlace activo (uuid de espacio).
