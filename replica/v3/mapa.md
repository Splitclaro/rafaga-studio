# Ráfaga v3 · mapa de capacidades y rutas

> **Revisión 2026-11-23 (solo fuentes públicas).** La fuente de verdad es `replica/v3/features.csv` (40 filas, cada una con su fuente pública P1–P8 de
> `recon-publico.md`). La tabla de abajo, derivada de la matriz v2 con OpusClip, queda **como histórico**: sus filas «Fuera de referencia» y las que
> no tienen fuente pública se retiran de la interfaz.

## Revisión de la navegación (qué se queda expuesto)
| Entrada actual | Respaldo público | Decisión |
|---|---|---|
| Inicio, Editor de vídeos, Editor avanzado, Autoclip | P1, P3, P6 | Se quedan |
| Calendario de publicaciones, Cuentas de TikTok | P1 (publicar o programar en TikTok) | Se quedan en el menú de cuenta |
| Biblioteca y fondos | P1, P6 (medios propios, fondos) | Se queda |
| Estilos de letra | P1 (plantillas de texto), P6 (estilos) | Se queda |
| Uso y almacenamiento | P8 (plan y cuota) | Se queda |
| Demos y tutoriales | P1 (tutorial integrado) | Se queda |
| Exportados | — | Se queda solo como acceso a los archivos existentes durante la transición |
| Conexiones (Drive/Dropbox) | — | Se retira del menú |
| Kit de marca | — | Se retira |
| Analítica (métricas internas) | — | Se retira |
| Automatizaciones | — | Se retira |
| Compartidos conmigo | — | Se retira |
| «Invitar» y equipo | — | Se retira de la barra superior |


Referencia única: **Escalium** (inventario `replica/inventario/escalium.md`, `replica/escalium/*.md`). Las filas que solo venían de OpusClip quedan marcadas «Fuera de referencia»: no tienen entrada nueva; si su código existe y otra herramienta lo usa, se conserva sin menú.

## Capacidades → destino

| ID | Requisito | Herramienta | Ruta / lugar | Cómo se presenta | Prueba |
|---|---|---|---|---|---|
| ENT-01 | Subir un vídeo largo desde el equipo con progreso real | Autoclip | `/app/autoclip/nuevo` | Subida con progreso real | V3-ENT-01 |
| ENT-02 | Subida por lotes: varios archivos a la vez, cada uno su proyecto | Editor de vídeos | `/app/editor (paso Audio)` | Soltar varias canciones: un borrador por archivo | V3-ENT-02 |
| ENT-03 | Importar por enlace de YouTube | Editor avanzado | `/app/avanzado/nuevo?tipo=enlace` | «Vídeo desde un enlace» (API pública de YouTube o descarga autorizada; pendiente de decisión) | V3-ENT-03 |
| ENT-04 | Importar desde Google Drive / Dropbox | Autoclip | `/app/autoclip/nuevo (origen)` | Importar de Drive/Dropbox (conexión ya existe; importación pendiente) | V3-ENT-04 |
| ENT-05 | Más fuentes de entrada (Twitch, Rumble, 10+ fuentes en Pro) | Fuera de referencia (Opus) | `—` | Se retira de la navegación | — |
| ENT-06 | Historial de proyectos con ordenar, filtrar y buscar | Cada herramienta | `/app/editor/videos · /app/avanzado · /app/autoclip` | Historial dentro de cada herramienta | V3-ENT-06 |
| ENT-07 | Colecciones/carpetas y favoritos | Editor avanzado | `/app/avanzado (carpetas)` | Carpetas y mover proyectos | V3-ENT-07 |
| ENT-08 | Reanudar subida y recuperarse de una interrupción | Autoclip | `/app/autoclip/nuevo` | Reanudar subida (motor de uploads existente) | V3-ENT-08 |
| ENT-09 | Medidor de almacenamiento, caducidad y papelera | Menú de cuenta | `/app/cuenta/uso` | Almacenamiento, caducidad (14 días en borradores), papelera | V3-ENT-09 |
| CLP-01 | Pedir los momentos en lenguaje natural («Moments to include») y ver cómo se interpretó | Autoclip | `/app/autoclip/nuevo (ajustes)` | Encargo en lenguaje natural | V3-CLP-01 |
| CLP-02 | Elegir el modelo/modo de IA (Auto / ClipAnything / ClipBasic) | Fuera de referencia (Opus) | `—` | Modos editoriales internos; sin selector de modelo | — |
| CLP-03 | Indicar el tipo de contenido (podcast, deportes, educativo…) para guiar la selección | Autoclip | `/app/autoclip/nuevo (ajustes)` | Interruptor «Podcast / multicámara» + tipo | V3-CLP-03 |
| CLP-04 | Duración del clip por rangos (<30 s, 30–59, 60–89, 90 s–3 min, 3–5 min) | Autoclip | `/app/autoclip/nuevo (ajustes)` | Duración 10–30 / 15–60 / 30–90 / 60–180 s y personalizada | V3-CLP-04 |
| CLP-05 | Número de clips pedido y explicación si hay menos | Autoclip | `/app/autoclip/[id]` | Número de clips (Auto) y explicación si hay menos | V3-CLP-05 |
| CLP-06 | Puntuación por clip con desglose (Hook, Flow, Value, Trend) y motivo | Autoclip | `/app/autoclip/[id]` | Puntuación con etiquetas y «Por qué este clip» | V3-CLP-06 |
| CLP-07 | Ordenar, filtrar y buscar clips por palabra | Autoclip | `/app/autoclip/[id]` | Ordenar y seleccionar todos | V3-CLP-07 |
| CLP-08 | Transcripción corregible con tiempos | Editor avanzado | `/app/avanzado/[id] (texto)` | Transcripción corregible | V3-CLP-08 |
| CLP-09 | Traducir subtítulos y doblar con voz | Fuera de referencia (Opus) | `—` | Traducción se conserva si ya existe; doblaje no | — |
| CLP-10 | Reencuadre inteligente a vertical con seguimiento del hablante | Autoclip | `/app/autoclip/[id]` | Encuadre Original / Rellenar / Ajustar con seguimiento | V3-CLP-10 |
| CLP-11 | Regenerar buscando otros momentos conservando lo anterior | Autoclip | `/app/autoclip/[id]` | «Buscar más clips» conservando los anteriores | V3-CLP-11 |
| CLP-12 | Favorito y «no me gusta» que mejoran la siguiente generación | Fuera de referencia (Opus) | `—` | — | — |
| CLP-13 | Recetas para streams de gaming y vídeos hablados («Auto-edit talking videos») | Fuera de referencia (Opus) | `—` | — | — |
| CLP-14 | Recetas propias guardadas («Create new Recipe») | Fuera de referencia (Opus) | `—` | — | — |
| EDI-01 | Ajustar inicio/final con precisión y ampliar con el original | Editor avanzado | `/app/avanzado/[id]` | Recorte preciso y ampliar con el original | V3-EDI-01 |
| EDI-02 | Editar por transcripción: borrar fragmentos y restaurar | Editor avanzado | `/app/avanzado/[id]` | Editar por texto | V3-EDI-02 |
| EDI-03 | Biblioteca de estilos de subtítulos (palabra activa, karaoke, etc.) | Editor de vídeos | `/app/editor/[id] (Estilo)` | Estilos de letra | V3-EDI-03 |
| EDI-04 | Vista previa = exportación (subtítulos y encuadre dentro de 1 fotograma) | Todas | `motor único sceneAt/lyricSceneAt` | Vista previa = exportación ≤1 fotograma | V3-EDI-04 |
| EDI-05 | Titular / título fijo sobre el vídeo | Editor de vídeos | `/app/editor/[id] (Estilo)` | Título fijo | V3-EDI-05 |
| EDI-06 | Llamada a la acción final (botón a Spotify/Apple/YouTube) | Editor de vídeos | `/app/editor/[id] (Estilo)` | Llamada a la acción final | V3-EDI-06 |
| EDI-07 | B-roll con IA e imágenes encima | Fuera de referencia (Opus) | `—` | — | — |
| EDI-08 | Limpieza de voz: quitar pausas y muletillas, mejorar audio | Autoclip | `/app/autoclip/[id]` | «Quitar pausas y ehh» | V3-EDI-08 |
| EDI-09 | Efectos automáticos: zoom, transiciones, corrección de color, SFX, contacto visual | Fuera de referencia (Opus) | `—` | — | — |
| EDI-10 | Editor con línea de tiempo y proyecto guardable | Editor avanzado | `/app/avanzado/[id]` | Línea de tiempo, proyecto guardable | V3-EDI-10 |
| EDI-11 | Kit de marca: logo, fuentes, vocabulario, palabras censuradas | Menú de cuenta | `/app/cuenta/marca` | Kit de marca | V3-EDI-11 |
| EDI-12 | Lyric Studio: canción → letra sincronizada → estilo → vídeo | Editor de vídeos | `/app/editor` | Audio → Letras → Estilo → Render | V3-EDI-12 |
| EDI-13 | Varios fondos → una creación por fondo; fondos propios | Editor de vídeos | `/app/editor/[id] (Estilo → Fondos)` | Varios fondos: un vídeo por fondo; fondo propio ≤60 s | V3-EDI-13 |
| EDI-14 | Efectos de cámara y filtros (VHS, noche, gran angular, cine) | Editor de vídeos | `/app/editor/[id] (Estilo)` | Efectos de cámara y filtros | V3-EDI-14 |
| EDI-15 | Entrada y salida suaves del volumen | Editor de vídeos | `/app/editor/[id] (Audio)` | Entrada y salida suaves | V3-EDI-15 |
| EDI-16 | Zonas seguras TikTok/Reels/Shorts en la vista previa | Editor de vídeos | `/app/editor/[id] (Estilo)` | «Ver en» TikTok/Reels/Shorts | V3-EDI-16 |
| EDI-17 | Vídeo desde un enlace: tu canción + planos de un vídeo de YouTube al ritmo | Editor avanzado | `/app/avanzado/nuevo?tipo=enlace` | Vídeo desde un enlace | V3-EDI-17 |
| EDI-18 | Velocidad de reproducción 0,5×/0,25× en la vista previa | Editor de vídeos | `/app/editor/[id] (Audio)` | Velocidad 1× / 0,5× / 0,25× | V3-EDI-18 |
| EXP-01 | MP4 H.264/AAC vertical con subtítulos incrustados | Resultado (junto al vídeo) | `Render de cada herramienta` | MP4 H.264/AAC | V3-EXP-01 |
| EXP-02 | Varias relaciones de aspecto (9:16, 1:1, 16:9, 4:5) | Editor avanzado | `/app/avanzado/nuevo` | Vertical 9:16 / Horizontal 16:9 | V3-EXP-02 |
| EXP-03 | Descarga en ZIP con SRT/VTT/TXT | Resultado (junto al vídeo) | `Autoclip y avanzado` | ZIP + SRT/VTT/TXT (se conserva) | V3-EXP-03 |
| EXP-04 | Exportar a editores profesionales (XML para Premiere/DaVinci) | Fuera de referencia (Opus) | `—` | XML se conserva en código, sin entrada | — |
| EXP-05 | Calidad HD/4K | Resultado (junto al vídeo) | `Render` | 720p / 1080p / 4K y fps | V3-EXP-05 |
| EXP-06 | Calendario de publicaciones con zona horaria | Resultado (junto al vídeo) | `Publicar → programar` | Programar con zona horaria | V3-EXP-06 |
| EXP-07 | Conectar varias cuentas sociales | Menú de cuenta | `/app/cuenta/conexiones` | Cuentas de TikTok | V3-EXP-07 |
| EXP-08 | Publicar en abierto en TikTok sin pasar por el móvil | Resultado (junto al vídeo) | `Publicar` | Publicar en TikTok al momento o programado, también al terminar el vídeo | V3-EXP-08 |
| EXP-09 | Publicar en YouTube Shorts / Instagram Reels | Fuera de referencia (Opus) | `—` | — | — |
| EXP-10 | Estado, enlace público, reintento y cancelación de cada publicación | Resultado (junto al vídeo) | `Publicar` | Estado, enlace, reintento y cancelación | V3-EXP-10 |
| EXP-11 | Analítica de lo publicado (vistas, likes, comentarios) | Menú de cuenta | `/app/cuenta/analitica` | Vistas, likes, comentarios de lo publicado | V3-EXP-11 |
| EXP-12 | Landing pages / smart links para canciones | Menú de cuenta | `/app/cuenta/landing` | Landing pages de canciones (pendiente: decisión de producto) | V3-EXP-12 |
| CLP-15 | Tiempo hasta el primer clip utilizable | Autoclip | `/app/autoclip/[id]` | Tiempo hasta el primer clip (métrica) | V3-CLP-15 |
| CLP-16 | Podcast / multicámara: elegir a quién seguir y montar el vertical alrededor | Autoclip | `/app/autoclip/nuevo` | Podcast / multicámara | V3-CLP-16 |
| OPE-01 | Pocos pasos desde abrir hasta tener clips | Inicio | `/app` | Tres entradas | V3-OPE-01 |
| OPE-02 | Disponibilidad del procesamiento (el trabajo se completa) | Todas | `worker` | Procesamiento disponible | V3-OPE-02 |
| OPE-03 | Editor en móvil y teclado, accesibilidad | Todas | `e2e` | Móvil, teclado, axe | V3-OPE-03 |
| OPE-04 | Autoguardado con estado visible y versiones | Cada herramienta | `—` | «Guardado en …» visible | V3-OPE-04 |
| OPE-05 | Permisos entre espacios y usuarios | Menú de cuenta | `/app/cuenta/equipo` | Permisos | V3-OPE-05 |
| OPE-06 | Consumo y cuotas visibles | Menú de cuenta | `/app/cuenta/uso` | Cuota visible («Te quedan N vídeos», minutos) | V3-OPE-06 |
| OPE-07 | API y conexión con agentes (API Access, MCP) | Fuera de referencia (Opus) | `—` | — | — |
| OPE-08 | Proyectos de demostración sin subir nada | Inicio | `/app` | Tutorial / muestra | V3-OPE-08 |

### Pantallas de Escalium sin fila en la matriz

| ESC | Pantalla | Destino en Ráfaga |
|---|---|---|
| ESC-S01/S02 | Editor de vídeos, pasos 1–4 | `/app/editor/[id]?paso=audio|letras|estilo|render` |
| ESC-S03 | Vídeos creados (básico / avanzado / en progreso; 14 días) | `/app/editor/videos` (historial dentro del editor) y lista de proyectos en `/app/avanzado` |
| ESC-S04 | Autoclip (3 pasos; lista de vídeos analizados) | `/app/autoclip` (historial) · `/app/autoclip/nuevo` · `/app/autoclip/[id]` |
| ESC-S05 | Editor avanzado: proyectos, carpetas, 4 tipos de proyecto, abrir archivo | `/app/avanzado` · `/app/avanzado/[id]` |
| ESC-S06 | Campañas → Publicar (TikTok) | Panel «Publicar» junto a cada resultado; cuentas en `/app/cuenta/conexiones`; calendario en `/app/cuenta/calendario` |
| ESC-S07 | Landing pages | `/app/cuenta/landing` (decisión de producto pendiente) |
| ESC-S08 | Analíticas | `/app/cuenta/analitica` |
| ESC-S09 | Cuenta | Menú de cuenta |
| ESC-S10 | Barra lateral, tema claro/oscuro, idioma | Navegación nueva: 3 entradas + menú de cuenta |

## Rutas actuales → destino nuevo

| Ruta actual | Destino | Qué se conserva |
|---|---|---|
| `/app` | `/app (3 entradas)` | Recientes por herramienta |
| `/app/nuevo` | `/app/autoclip/nuevo` | Subida y ajustes de generación (NuevoV2/CreationPanel) |
| `/app/proyectos` | `/app/autoclip (historial) y /app/avanzado` | Todos los proyectos existentes, abribles |
| `/app/p/[id]` | `/app/autoclip/[id]` | Generaciones, clips y avisos (ResultsGrid) |
| `/app/p/[id]/comparar` | `/app/autoclip/[id]?comparar` | — |
| `/app/c/[id]` | `/app/avanzado/[id]?clip=…` | Versiones de clip (clip_versions) |
| `/app/lyric-studio` | `/app/editor` | Canciones, letras corregidas (lyric revisions), borradores |
| `/app/style-studio` | `/app/editor/[id] (Estilo) · /app/cuenta/estilos` | Estilos propios (text_styles) |
| `/app/biblioteca` | `/app/editor/videos · /app/cuenta/medios` | Vídeos creados, colecciones de fondos |
| `/app/exports` | `Resultado de cada herramienta · /app/cuenta/exportados` | Exportaciones y renovaciones |
| `/app/calendario` | `/app/cuenta/calendario + panel Publicar` | Publicaciones programadas |
| `/app/tiktok` | `/app/cuenta/conexiones (cuentas) + panel Publicar` | Cuentas y cola |
| `/app/conexiones` | `/app/cuenta/conexiones` | — |
| `/app/analitica` | `/app/cuenta/analitica` | — |
| `/app/uso` | `/app/cuenta/uso` | — |
| `/app/ajustes` | `/app/cuenta` | — |
| `/app/equipo` | `/app/cuenta/equipo` | — |
| `/app/brand-kits` | `/app/cuenta/marca` | — |
| `/app/entregas` | `/app/cuenta/compartidos` | Entregas y enlaces |
| `/app/automatizaciones` | `/app/cuenta/automatizaciones` | — |
| `/app/demos` | `/app (muestra)` | — |
| `/app/director` | `Se retira (encargo en lenguaje natural vive en Autoclip)` | Sin datos propios |
| `/app/r/[id]` | `/app/autoclip/[id]?resultado` | — |
| `/revision/[token], /login, /privacidad, /condiciones` | `Sin cambio` | — |

Durante la transición cada ruta actual redirige a su destino (sin borrar datos). Las pantallas sustituidas se retiran del código solo cuando su destino pasa su prueba e2e y nada más las importa. Vuelta atrás: la rama `main` anterior queda etiquetada `rafaga-v2-final` y Vercel conserva el despliegue previo (Promote).
