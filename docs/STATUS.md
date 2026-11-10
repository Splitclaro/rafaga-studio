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

## Sesión 14 — Brief estructurado y estilos (parte del encargo «Flowstage»)
- Brief: `projects.brief_data` (migración 23 aplicada y verificada). Campos: objetivo, público, temas, personas/fragmentos, evitar, tono, llamada a la acción, idioma. `composeBrief` (IA + versión guardada en `generations.brief_snapshot`/`params.brief_data`/`brief_version`) y `lexicalBrief` (solo objetivo, temas, personas y exclusiones: público/tono/CTA no ensucian la coincidencia). Cada campo indica en pantalla qué gobierna. Test: misma fuente + dos objetivos → selecciones distintas; la exclusión se respeta.
- Estilos: 8 plantillas propias (Podcast limpio/dinámico, Artista editorial, Lyrics minimal/karaoke, Montaje musical, Campaña de marca, Fotos en movimiento) como punto de partida de un brand kit; «Aplicar estilo» a una selección de clips (versión nueva por clip); Lyric Studio carga el look/preset y formato de un kit.
- NO verificado en la nube con datos reales: el worker con un brief estructurado (no se permitió modificar el proyecto real desde el panel; probar desde la interfaz).
- Pendiente: montaje al ritmo (beats), «Crear más versiones como esta»/bloqueos, brief que elija material de fondo y hooks, biblioteca única con duplicados, alineación parcial de letras.

## Sesión 15 — Montaje al ritmo
- `packages/lyrics/src/beats.ts`: detector sin dependencias (flujo espectral por bandas → autocorrelación con preferencia suave por ~120 BPM → seguimiento por programación dinámica). Informa de su confianza (`BEAT_CONFIDENCE_MIN`); con poca confianza NO se presenta como «al ritmo».
- `planShotsOnBeats`: cortes cada 1/2/4/8 beats (automático por intensidad suave/media/dinámica, o manual), planos nunca < 0,8 s, sin repetir plano consecutivo, reproducible por semilla; fallback a cadencia estable con aviso explícito (`montage.mode = "interval-fallback"`).
- Worker: detecta el ritmo del tramo una vez (caché en `song_alignments` con clave `beats:v1:inicio:fin`) y guarda `params.montage` por vídeo (modo, BPM, confianza, cada N beats, nº de planos, duración media).
- UI (Lyric Studio → ajustes avanzados del look → «Al ritmo (beats)»): intensidad, «cortar cada…», y análisis en el navegador con la misma función: «Ritmo detectado: N BPM» o «No se detecta un pulso claro…». La plantilla «Montaje musical» corta al ritmo.
- Pruebas: 96/120/140 BPM sintéticos (beats a ±70 ms; a 140 puede devolver 70, pulso a la mitad, legítimo), ruido → confianza baja, silencio/corto sin romper, determinismo; e2e real: audio con pulso → beats → render y los cambios de plano del MP4 caen a <90 ms de los golpes. Autoprueba cloud (run 42778452838, sin fallos): 99,6 BPM, detección 37 ms para 16 s, cortes cada 4 beats, 7 cambios de plano con desfase máximo 0 ms respecto a los golpes.
- Límites: solo en looks de referencia (no en los estilos antiguos de letra con fondo continuo); detector validado con pistas sintéticas y NO con música real de varios géneros; sin detección de compás/downbeat (los cortes cada 4 beats parten del primer beat detectado); el montaje al ritmo no alinea cortes con límites de frases cantadas.

## Sesión 16 — Más versiones como esta
- `packages/lyrics/src/more.ts`: `planMore` (bloqueos de estilo / fondo / planos; nunca repite la semilla ni la combinación de la base; todo bloqueado = copia y se rechaza), `restoreShots` (reconstruye planos por identidad de clip y se niega si cambió el tramo o la colección), `swapShots` (cambia solo los planos pedidos, otro clip distinto de los vecinos y otro punto de entrada).
- Worker: `params.more = {from_video, lock, swap?}`; el vídeo base debe ser de la misma canción y workspace. Los planos guardan ahora `src` (ruta del clip). Los clips de la colección se leen ordenados por ruta para que el índice sea estable. Vídeos anteriores sin `src`: no se pueden heredar planos y se avisa (`metrics.shots_note`).
- UI Lyric Studio: botón «Más versiones» por vídeo → panel con audio/tramo/letra siempre fijos y estilo/fondo/planos bloqueables; «Cambiar este plano» y «Probar otro inicio» (solo looks con planos guardados).
- Verificado: 130 pruebas (9 nuevas, incl. render ffmpeg real: al cambiar el plano 2 los planos 1, 3 y 4 quedan idénticos en color). NO verificado: la ruta `more` del worker en la nube con datos reales ni el panel en el navegador desplegado.
- No incluido: bloquear/cambiar fragmento, letra o marca por versión (el tramo y la letra son siempre los de la canción).

## Sesión 17 — Biblioteca única
- Migración 24 (aplicada y verificada en producción): RPC `library_assets()` (solo lectura, `security definer`, solo `authenticated`, filtrada por `is_member`) que une vídeos y fotos de packs, fuentes de proyecto, audio, logos de marca, fuentes y exportaciones (Lyric Studio y clips) con huella de contenido: `sha256` si existe, si no la eTag de Storage.
- Verificado en producción: todos los objetos tienen eTag; una misma canción de 25,8 MB subida dos veces comparte eTag (duplicado real).
- `apps/web/lib/library.ts`: duplicados exactos (misma huella y tamaño; sha256 y eTag no se mezclan; la misma ruta referida dos veces no cuenta; exportaciones excluidas) y posibles (mismo nombre normalizado y tamaño sin huella que los distinga). Solo se ofrece quitar copias de archivos sueltos de packs; canciones, fuentes, logos y fuentes de proyecto se abren en su sección porque borrarlos arrastra vídeos o está en uso.
- UI: pestaña «Todo» (por defecto) en Biblioteca con filtros por tipo, búsqueda, miniaturas de la página visible, panel de duplicados con «Quitar N copias» (confirma qué se conserva y qué se borra) y «Subir» (vídeo/foto → pack «Sin clasificar», audio → canciones) con aviso previo si ya existe el mismo nombre y tamaño.
- Pruebas: 143 (11 de lógica de duplicados; RLS PGlite: tipos, huella, aislamiento entre workspaces, anon rechazado). Navegador contra Supabase simulado a 1440 y 390 px: sin desbordes. NO verificado con tu biblioteca real en el navegador desplegado.
- Límites: la eTag de una subida por partes difiere de la simple, así que el mismo archivo subido de dos formas puede no coincidir (saldría como «posible» si coincide nombre y tamaño). No hay detección por parecido visual (miniaturas). Fuentes y logos se siguen subiendo en Marca.

## Sesión 18 — Editor rápido / avanzado y recorte con línea de tiempo
- `packages/composition/src/trim.ts`: `trimClip` (re-relativiza palabras y B-roll al cambiar inicio/fin; una palabra se conserva si al menos la mitad sigue dentro; al ampliar rellena SOLO las zonas nuevas con la transcripción original y no toca lo ya editado; mínimo 3 s, máximo 90 s, límite de la fuente) y `clampEdge`.
- Editor de clip: interruptor Rápido/Avanzado (se recuerda, por defecto Rápido). Rápido: texto, estilo y exportar, y recorte. Avanzado: además encuadre, social, B-roll, ajuste de ±0,1 s, tiempos por palabra, dividir/unir y pistas de palabras y B-roll en la línea de tiempo.
- `components/Timeline.tsx`: miniaturas reales de la fuente (se extraen en el navegador), asas de inicio/fin (arrastre y teclado: flechas 0,1 s, Mays+flechas 1 s), cabezal y clic para ir a un instante. El rango visible se fija al abrir (clip ± margen).
- El recorte se guarda como nueva versión del clip (historial, deshacer, autosave y aprobación por versión siguen igual) y el export usa el tramo nuevo.
- Verificado: 151 pruebas (8 nuevas; render ffmpeg real: tras recortar de 2–12 s a 8–18 s el export dura 10 s, rojo en la fuente 8,5 s y azul en 13 s). Navegador contra Supabase simulado: recorte de 24 s a 14,7 s (28 palabras, 18 fuera), guardado v2, cambio de modo, sin desbordes a 390 px.
- NO verificado: con una fuente larga real (las miniaturas hacen un salto por fotograma sobre la URL firmada), con transcripción real al ampliar, ni el export en la nube de un clip recortado. Sin migración.

## Sesión 19 — Reencuadre automático
- Detección: `workers/media/py/faces.py` (OpenCV 4.10 Haar frontal + perfil con reflejo, muestreo a 3 fps, CLAHE). `opencv-python-headless==4.10.0.84` se instala en el workflow del worker (OpenCV 5 retiró `CascadeClassifier`, por eso se fija la serie 4.x).
- Planificador puro `packages/composition/src/reframe.ts`: cara principal con memoria (no salta por cambios pequeños de tamaño) o grupo, huecos mantenidos, mediana de 3 contra falsos positivos, banda muerta, velocidad de paneo limitada, salto directo en cortes de plano, simplificación a keyframes. Sin caras suficientes (<20 %) o vídeo que ya cabe: encuadre fijo y se explica. `xAt` (vista previa) y `cropXExpr` (expresión de ffmpeg) salen de los mismos keyframes: preview = export.
- Composición: `reframe?: {kf}` manda sobre `crop.x` en layout `fill`.
- Migración 25 (aplicada y verificada en producción): tipo de trabajo `reframe`, tabla `reframe_tracks` (RLS; solo SELECT para `authenticated`, nada para `anon`), RPC `request_reframe` (valida rango 3–90 s, ratio y modo; reutiliza peticiones idénticas; exige poder editar), `claim_job` sirve el tipo nuevo.
- Editor: pestaña Encuadre (también en modo Rápido) con «Analizar caras» (seguir a la cara principal o al grupo), estado, cobertura, «Aplicar» y «Quitar seguimiento»; la vista previa se mueve con los keyframes. Recortar o cambiar de formato quita el seguimiento (los tiempos ya no valdrían) y lo avisa.
- Verificado: 166 pruebas locales, ninguna omitida. 12 de planificador; RLS PGlite (validación, reutilización, aislamiento, escritura solo del worker, cola); e2e real con una cara real (foto de dominio público de la NASA, fixture 22 KB) que cruza un 16:9: con reencuadre la cara aparece en el 100 % de las muestras del 9:16 resultante, con encuadre central fijo en el 42 %; también con un clip que empieza en el segundo 4 (tiempos relativos). Navegador contra Supabase simulado: análisis → aplicar → la vista previa sigue los keyframes (47,5 % en t=8 s entre 10 % y 85 %).
- Límites: Haar detecta bien caras frontales o casi; con la cabeza muy girada, gafas oscuras, caras pequeñas o mucha luz contraluz puede perderlas (se mantiene la última posición hasta 6 s). No hay seguimiento por voz/quién habla ni reencuadre vertical (solo horizontal). Validado con una sola cara real sintética, no con vídeos de entrevistas reales.
- Autoprueba en la nube (`gh workflow run worker.yml -f mode=reframe-selftest`, run 42803309892, sin fallos): OpenCV 4.10 instalado en Actions, 36 muestras analizadas en 1,1 s, cara visible en el 100 % del 9:16 con reencuadre frente al 39 % con encuadre central fijo. NO probado todavía: un trabajo `reframe` real desde el editor con un clip de usuario (descarga de la fuente completa + análisis).

## Sesión 20 — Rendimiento 1/10/50, criterio editorial, YouTube, capa de IA, directos (migraciones 26–28)
**Medido (local, 10 núcleos, fuente 1080p de 30 min, clips de 40 s con subtítulos, miniatura y sonda; sin ASR, IA, descarga ni subida):**

| Clips | Paralelo | Total | Primer clip | s/clip | clips/min |
|---|---|---|---|---|---|
| 1 | 1–4 | 4,3–4,5 s | 4,3–4,5 s | 4,4 | ~13,7 |
| 10 | 2 (mejor) | 37,5 s | 7,2 s | 3,75 | 16,0 |
| 50 | 2 (mejor) | 185,9 s | 6,6 s | 3,72 | 16,1 |
| 50 | 1 / 4 | 218,6 s / 192,1 s | 4,4 s / 14,1 s | 4,37 / 3,84 | 13,7 / 15,6 |

- Antes de optimizar, cada clip tardaba ~25 s (fondo desenfocado a 1080×1920). Ahora el fondo se desenfoca a 1/6 y se reescala: **5,6× más rápido**, mismo tamaño de archivo (≈21 MB por clip de 40 s). Con 4 en paralelo no mejora y retrasa el primer clip: se mantiene «primer clip solo y el resto de 2 en 2», y ahora el primero en renderizarse es el **mejor puntuado**, no el primero en el tiempo.
- NO medido (necesita datos reales): ASR, IA, descarga del original y subida a Storage. La fuente de 30 min pesa 2,1 GB, muy por encima del límite de 50 MB de Supabase Free (F-01).
- Reproducible: `node workers/media/src/perf-selftest.ts` (env `PERF_NS`, `PERF_CONC`, `PERF_SRC_MIN`) o `gh workflow run worker.yml -f mode=perf-selftest`.

**Criterio editorial** (`packages/selection/src/editorial.ts`, `lexicalCandidates` lo usa como respaldo sin IA y `refineBounds` se aplica también a lo que propone un modelo):
- Entiende el encargo en lenguaje natural: cantidad, duración, público, tono, prioridades, **exclusiones obligatorias** («evita/excluye») frente a **preferencias** («prioriza/menos»), «debe incluir», remate, aclaración solo ante contradicciones. Las exclusiones terminan donde empieza la siguiente indicación.
- Puntúa con señales observables (tipo de contenido, gancho, autonomía, cierre) y exige que un corte no abra ni cierre con una frase ajena al encargo.
- Decide entrada y salida: recupera la frase que da contexto, incluye la pregunta, extiende hasta la respuesta, deja oír el remate (solo hacia un cierre real). Holgura de 0,25 s / 0,4 s sin invadir palabras vecinas.
- Diversidad por similitud de contenido y solape; explicación con citas del inicio y del final que existen en el transcript; sin promesas de viralidad.
- Instrucciones: `parseDirective` interpreta «incluye la pregunta», «busca solo reacciones», «más como este», «menos polémica», «haz cinco variantes» y distingue alcance de clip o de búsqueda. **Solo el motor: aún no hay caja de texto en el proyecto.**
- Música / DJ casi sin voz: `audioMoments` (subidas de energía tras una pausa con su preparación). Estimación por volumen; probado con audio sintético, no con música real.
- Evidencia: `docs/audit/EDITORIAL_DEMO.md` (misma fuente, tres encargos, cortes exportados a 9:16 con subtítulos; `node workers/media/src/editorial-demo.ts`).
- La tarjeta de cada clip muestra ahora el intervalo de origen y la razón.

**YouTube** (`packages/providers/src/youtube.ts`, `/api/youtube/search`, `/api/youtube/video`, componente `YouTubeSearch`, migración 26 `youtube_picks` + `projects.youtube_id`):
- Búsqueda desde el servidor con `YOUTUBE_API_KEY` (la clave nunca llega al navegador), filtros oficiales (`eventType`), miniatura, canal, duración, hora de próximos directos, grabaciones de directos anteriores, espera al escribir, descarte de respuestas antiguas, «Cargar más», caché de 60 s y límite de 40 búsquedas/hora/usuario (la búsqueda cuesta 100 de las 10 000 unidades diarias). «Sin resultados», cuota, clave inválida y fallo de red se distinguen. Al seleccionar se vuelve a consultar el estado.
- Selección conservada con su brief; siguiente paso según el caso: **Generar clips** (original vinculado), **Vincular original**, **Conectar señal del directo**, **Preparar directo**. YouTube no entrega el original: ver F-02.
- Verificado: 8 pruebas del proveedor, 4 casos y estados de error en navegador contra una API de YouTube simulada (`YOUTUBE_API_BASE`), rutas desplegadas en producción respondiendo 401 sin sesión. **NO verificado con la API real (falta `YOUTUBE_API_KEY`).**

**Capa de IA** (`groq.ts`, `cost.ts`, `workers/media/src/{asr,ledger}.ts`, migración 27):
- Groq: transcripción (whisper-large-v3-turbo; large-v3 para fragmentos difíciles y respaldo en Deepgram), selección editorial en JSON con el mismo prompt y la misma validación contra el transcript real, y visión (`groqDescribeFrames`, no conectada a la selección). Modelos configurables por entorno. Probado contra un servidor falso con la forma documentada de la API. **NO verificado contra Groq real.**
- Coste por trabajo: STT por hora de audio, tokens, fotogramas, render (estimado), almacenamiento y descarga (estimados); lo medido y lo estimado se distinguen; coste a tarifa de pago aunque se use el nivel gratuito; coste por clip y **por clip aprobado**. Tarifas anotadas de memoria: **verificar en la cuenta**.
- Cuotas por espacio (120 min/semana, 10 clips/lote, 60 min/directo, presupuesto mensual 20 USD, variantes e idiomas adicionales), editables en Ajustes por responsables con topes duros (`set_ai_limits`); consulta previa y avisos; el directo reserva por tramos de 2 min y se detiene conservando lo entregado. Límite global diario de transcripción compatible con la cuota gratuita (~480 min/día de whisper-turbo; verificar). El paso a facturación de pago es decisión explícita (`billed_usd` = 0 mientras no se active).
- Transcribir una vez por fuente: el transcript guardado se reutiliza al cambiar brief, estilo o pedir traducciones. **Traducción y glosario por proyecto: NO implementados** (la corrección de un nombre no llega aún a una traducción porque no hay pista traducida).

**Directos** (`livectx.ts`, migración 28): cada ventana arranca con la cola (≤30 s) de la anterior; los momentos que caen en el contexto o ya entregados se descartan (tiempo absoluto, también tras reconexiones); lógica y concatenación con ffmpeg real probadas. NO medida la latencia real (necesita una señal HLS autorizada): fórmula `liveLatency` lista; con ventanas de 120 s la latencia mínima esperable es ~2 min + análisis + render. «Marcar este momento» y límite de clips por directo: no implementados.

**Seguridad:** RLS verificada en 29 pruebas PGlite y en producción tras las migraciones 26, 27 y 28 (tablas nuevas: `anon` sin acceso; `authenticated` con SELECT; consumo solo lo escribe el worker).

**Hallazgos corregidos de paso:** exclusión que se tragaba el resto de la frase y remate que se extendía hacia otra pregunta (demo editorial); el build de producción habría fallado por importar módulos de Node en el cliente (subruta `@rafaga/providers/youtube`).

**Para dejarlo operativo, exactamente qué falta (credenciales/infra):**
1. `YOUTUBE_API_KEY` en Vercel (YouTube Data API v3 habilitada) → búsqueda real.
2. `GROQ_API_KEY` en GitHub Actions (+ variables `ASR_PROVIDER=groq`, `LLM_PROVIDER=groq` si se quiere usarlo) → verificar modelos, cuota gratuita y tarifas; sin ella todo sigue con Deepgram + selección editorial.
3. Supabase Pro (o subida por partes) para fuentes >50 MB.
4. Un servidor de ingesta RTMP/HLS para la segunda salida del codificador (hoy solo se acepta una lista HLS ya publicada).
5. `GH_DISPATCH_TOKEN` en Vercel para arrancar el worker al instante.

**Benchmark de render en la nube (run 42808923078, GitHub Actions 4 vCPU, misma fuente 1080p de 30 min):** 1 clip 15,2 s · 10 clips 129 s (paralelo 2, 4,6 clips/min) · 50 clips 641 s (10,7 min, paralelo 2, 4,7 clips/min; en serie 774 s). Es ~3,4× más lento que en local (10 núcleos): con ese runner, un lote de 10 clips tarda ~2 min de render y el primer clip ~15 s después de empezar a renderizar. Sigue sin medirse ASR, IA, descarga ni subida.

## Sesión 21 — Rediseño sobrio (azul eléctrico) llevado a la app
- Aprobado el prototipo (Artifact «Ráfaga Studio Rediseño», 10 pantallas). En código: tokens (texto #0F172A, apoyo #55607A, borde #E3E8F4, superficie #F7F8FC, acento #1D4FFF), tipografías Space Grotesk (títulos) y DM Sans (interfaz) con `next/font`, botón principal azul sólido, foco azul, sin sombras de color ni perforaciones de película. Bootzy TM sigue siendo solo para resultados.
- Navegación clara con el apartado activo en azul y nueva entrada **Director IA**.
- Página `/app/director`: el encargo en tus palabras y «Lo que he entendido» en vivo (cantidad, duración, público, tipo, prioridades, obligatorio frente a preferencia, final) con `interpretBrief` en el navegador (módulo puro `@rafaga/selection/intent`), cuota semanal y «Usar este encargo», que rellena el creador de Inicio (`/app?brief=`).
- Verificado en navegador contra servidor simulado (Director e Inicio a 1440 px). NO revisadas una a una el resto de pantallas con el nuevo tema (se hereda por tokens); pendiente la pasada visual de Biblioteca, Entregas, En vivo, Lyric Studio, Marca, Ajustes y Editor.
- Repaso visual del tema nuevo (sesión 21, parte 2) en navegador contra servidor simulado: Inicio, Director IA, Biblioteca, Entregas (cargando), En vivo, Lyric Studio, Brand kit, Style Studio, Ajustes, Proyecto, Revisión, Editor y Calendario; sin desbordes a 390 px en Inicio, Director, Biblioteca y Lyric Studio. Corregido: botones principales sueltos en negro (Lyric Studio, editor «Exportar MP4», crear colección) pasan a azul; aprobaciones, avatares y progreso en azul; selecciones en tinta única `--ink`; teselas oscuras de relleno de Biblioteca y Entregas pasan a gris claro. Conexiones, Automatizaciones y Analítica: la captura no llegó a verse (panel oculto), heredan el tema. Sin datos reales de usuario.
