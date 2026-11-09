# Referencias revisadas y decisiones del encargo

Fecha: 9 de noviembre de 2026. Resultado: especificación y prompt de ejecución para Claude Code, con nombre propuesto **Ráfaga Studio**. El usuario ha confirmado que la beta debe centrarse en generar, editar y automatizar clips; quedan fuera las campañas remuneradas y la comunidad.

## Revisión real en Chrome

**OpusClip.** El [enlace de proyecto aportado](https://clip.opus.pro/clip/P3110412mmac) devuelve «Project not found». La sesión existente permitió consultar el [dashboard](https://clip.opus.pro/dashboard) y la entrada al editor. En el dashboard se observaron importación por URL, Upload, Google Drive, acción para generar clips, proyectos recientes, acceso a brand kit, calendario, analytics y social accounts. En la entrada al editor se observaron una zona central para importar, controles superiores de undo/redo/save/export, timeline inferior y herramientas laterales de captions, brand kit, texto, audio y mejoras de IA.

Esto verifica la existencia visible de esos controles, no su calidad de procesamiento ni su funcionamiento completo. No se subió contenido, no se consumieron créditos, no se cambió la cuenta y no se probaron exportaciones del servicio. El proyecto concreto no pudo inspeccionarse.

**ClipBoom.** La [aplicación aportada](https://app.clipboom.io/) abrió una sesión existente con listado de campañas activas/finalizadas, tarjetas con presupuesto, remuneración por visualizaciones, plataformas y acceso a materiales. El detalle consultado mostraba aplicación a campaña, conexión/verificación de cuentas para contabilizar views y envío de clips condicionado a esa conexión. La navegación lateral incluye recursos y comunidad.

Estas observaciones no prueban que ClipBoom carezca de generación con IA en otras áreas; en las pantallas revisadas no se verificó un generador equivalente a OpusClip. Por decisión expresa del usuario, el nuevo producto no incluirá el marketplace ni pagos a clippers. No se aplicó a campañas, no se conectaron cuentas y no se enviaron mensajes.

## Vídeos locales

Se leyeron metadatos y se extrajeron seis fotogramas por archivo, al 4 %, 20 %, 38 %, 56 %, 75 % y 94 % de su duración. Los siete son H.264 de 576×1024, aproximadamente 30 fps, con pista AAC. Esta revisión es visual por muestreo; no equivale a escuchar/transcribir cada vídeo completo ni a certificar el producto que aparece en pantalla.

| Archivo | Duración | Instantes de referencia | Observación visual y traducción a requisito |
|---|---:|---|---|
| `v26044gc0000dbmgodvog65sqi2s4vbg.MP4` | 2:02,70 | 24,5 / 46,6 / 68,7 / 115,3 s | Panel con transcripción, búsqueda de momentos, clips listos/en cola, razones de no elección, biblioteca y pestaña En vivo. Exigir estados reales, selección continua, deduplicación, motivos de descarte y acción de resumen. |
| `v26044gc0000dbn6oo7og65kqo6a9qdg.MP4` | 1:23,15 | 3,3 / 31,6 / 62,4 / 78,2 s | Resultado vertical que alterna plano individual y dos personas apiladas; subtítulos blancos con palabras rojas y contorno. Exigir composición editable, split y resaltado con tiempos de palabra. |
| `v26044gc0000dbnnrffog65k14ktgmp0.MP4` | 0:53,73 | 2,1 / 20,4 / 30,1 / 40,3 s | Demostración de trabajo manual sobre tablet, panel con previsualizaciones y selección de planos; portátil auxiliar. Tomar rapidez de revisión y control de encuadre. No inferir una API o integración con hardware a partir de las imágenes. |
| `v26044gc0000dbo0i6nog65p3pqmmqsg.MP4` | 1:04,53 | 12,9 / 24,5 / 36,1 / 48,4 s | Formulario con URL, tramo opcional, cantidad, duración de clip de 1:25 y resultado de lote; galería con reproductores. Exigir rango de origen, preset de 85 s, lote, progreso y descarga. La cifra de tiempo que muestra el vídeo no es un benchmark de nuestra aplicación. |
| `v26044gc0000dboac0nog65l7jano25g.MP4` | 0:30,73 | 1,2 / 6,1 / 11,7 / 17,2 s | Stream de gameplay con facecam y resultados que conservan cámara arriba y acción abajo. Exigir layout Gaming con dos regiones independientes y corrección manual. |
| `v26044gc0000dbohln7og65p10btesng.MP4` | 0:37,27 | 7,5 / 14,2 / 20,9 / 28,0 s | Interfaz con enlace de vídeo/directo, split screen, parámetros de cámara, progreso, lista de clips y visor. Exigir ingestión de directo autorizada y parámetros de layout. No asumir compatibilidad técnica universal con YouTube por la etiqueta. |
| `v26044gc0000dboj1pfog65mcqn2i60g.MP4` | 0:36,01 | 1,4 / 7,2 / 20,2 / 27,0 s | Lista de intervalos/clip, preview vertical dividido y selección de contenidos/canales. Exigir biblioteca, visor, búsqueda interna y acceso al origen. No añadir buscador de cualquier canal sin una fuente/API válida. |

Las marcas y nombres de herramientas visibles en estos vídeos no se adoptan como marca del nuevo SaaS. La apariencia de una función en un vídeo no demuestra que dispongamos de su backend ni de permisos para sus fuentes.

## Imágenes adjuntas

| Referencia | Observación | Requisito adoptado |
|---|---|---|
| Imágenes 1 y 2, livestream | Un vídeo/directo se transforma en varias piezas verticales; aparecen destinos sociales | Flujo fuente → varios clips, modo en vivo autorizado y exports adaptados. Los iconos no prueban permisos de publicación. |
| Imagen 3, TikTok maker | Plano individual y composición de dos hablantes | Recorte facial, split y selección de layout. |
| Imagen 4, creative flexibility | Preview vertical y timeline con tramo seleccionado | Editor con recorte, reproducción y encuadre. |
| Imagen 5, how-to | Transcripción lateral y preview | Corrección de texto sincronizada con el clip. |
| Imagen 6, trending | Tarjetas con puntuaciones y subtítulos resaltados | Rúbrica editorial explicable, rotulada como estimación, sin prometer viralidad. |
| Imagen 7, resumen de flujo | Fuente larga, momentos y resultados de varias duraciones | Selección semántica, intervalos verificables, export por lote. «10x Faster» pertenece al material de referencia y no se traslada como promesa. |
| Imagen 8, templates | Plantillas, dos planos, fondo desenfocado y cabeceras | Presets propios, cabecera opcional y composición consistente en preview/render. |
| Imágenes 9 y 10 | Miniaturas de interfaz de baja resolución | Apoyan la organización general; no permiten deducir controles pequeños o valores exactos. |

## Decisiones de arquitectura

La propuesta es web/API en Vercel, identidad/datos/medios privados en Supabase y procesamiento durable separado con FFmpeg. Las funciones web tienen límites de cuerpo y duración: por eso los vídeos se suben directamente al almacenamiento y el procesamiento no depende de la petición web. Véase [Vercel Functions Limits](https://vercel.com/docs/functions/limitations).

Supabase documenta subidas reanudables mediante TUS y control de acceso de Storage mediante RLS; el prompt exige comprobar tanto las tablas como los objetos con dos cuentas aisladas. Véanse [Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) y [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control).

Trigger.dev documenta una extensión de FFmpeg. Es una opción de implementación que Claude deberá validar en cloud con las fuentes, filtros, modelos y recursos reales; no se ha provisionado ni presupuestado aquí. Véase [FFmpeg en Trigger.dev](https://trigger.dev/docs/config/extensions/ffmpeg). Para ASR se propone un adaptador de Deepgram, verificando timestamps/idiomas en la ejecución: [Pre-recorded audio](https://developers.deepgram.com/docs/pre-recorded-audio).

El modo En vivo forma parte del contrato beta mediante una fuente HLS HTTPS autorizada y controlada; se prueban captura progresiva, generación antes del final, reconexión y parada. Esto no acredita importación de cualquier directo de YouTube, Twitch o Kick. Si se quiere añadir un proveedor de terceros, hay que implementar y validar su vía de acceso permitida.

El trabajo de Claude se organiza en entregas verticales con verificaciones y continuidad en archivos. La documentación oficial recomienda instrucciones de proyecto concisas y comprobaciones que permitan verificar resultados: [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices). El prompt separa CLAUDE.md del documento de especificación extenso.

Publicación social separada de exportación: TikTok exige autorización del usuario, aprobación del scope y revisión del cliente para determinadas condiciones de visibilidad; no se puede resolver todo con un prompt. Véase [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started). YouTube dispone de una operación autorizada de subida, cuya integración también debe verificarse: [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).

La consulta de Stripe Directory no pudo completarse: no había CLI instalada y su página de entrada no fue recuperable por la herramienta de investigación. Por ello, el paquete no afirma haber validado alta, plan, tarifas, disponibilidad o engagement a través de Directory de ningún proveedor. No se ha contratado ningún servicio. Claude debe comprobar accesos y costes actuales al ejecutar.

## Criterio de entrega

Una beta se acepta cuando usuarios de prueba pueden crear cuenta, subir un vídeo, generar clips reales, editar subtítulos/encuadre, descargar archivos reproducibles, ejecutar una regla automática y obtener clips de una emisión HLS controlada. Deben estar desplegados tanto web como worker, con cuotas, permisos y recuperación probados. Un repositorio, una landing o una interfaz con porcentajes simulados no satisfacen el encargo.

No hay garantía de que una única sesión de Claude finalice todo sin intervención: pueden faltar logins, crédito API, correo transaccional o permisos externos. El prompt obliga a continuar lo independiente y a informar los bloqueos con precisión, sin presentar la entrega parcial como producto terminado.

## Refuerzo tras la revisión del usuario

El encargo prioriza ahora de forma expresa el flujo de subtítulos y su fidelidad de exportación, un brief breve que condiciona la selección y los botones «Detectar momentos virales»/«Volver a detectar». Incluye versionado del brief, conservación de clips editados, pruebas con dos enfoques sobre el mismo vídeo y evaluación de proyectos de 30/60 min. El inicio exige generar código ejecutable en la misma ejecución, realizando las comprobaciones externas sin detener el trabajo independiente. Véase `COMPROBACION_DE_TUS_REQUISITOS.md`.
