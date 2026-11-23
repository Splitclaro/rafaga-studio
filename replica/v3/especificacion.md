# Ráfaga v3 · especificación verificable de las tres herramientas

Fuente: lo **observado en Escalium** (cuenta del propietario, 2026-11-16 y 2026-11-23) en `replica/inventario/escalium.md`, `replica/escalium/recon.md` y `replica/escalium/lyrics-edit-audit.md` (LE-01…LE-30). Ráfaga implementa el mismo trabajo con su propia interfaz, textos y componentes (`apps/web/components/ui/`). No se copia código, textos ni aspecto del referente.

**Columnas:** valor inicial · opciones · habilitado si · acción · guardado · tras recargar · efecto en el resultado. Estados comunes a toda pantalla: **cargando** (esqueleto, sin saltos), **vacío** (qué hacer a continuación), **error** (qué pasó, qué se conservó, botón para reintentar), **recuperación** (al volver se abre el estado real), **confirmación** (acciones destructivas o con coste piden confirmar). Cada fila tiene un ID de prueba `V3-…`; «Evidencia del referente» remite al documento donde se observó.

Lo marcado **(no observado)** no se ha visto en el referente y necesita autorización para observarlo (ver final).

---

## 1. Editor de vídeos (videolyrics) · `/app/editor`

Recorrido: **Audio → Letras → Estilo → Render**, con historial «Vídeos creados» dentro de la herramienta. Motor: `@rafaga/composition` (`lyricSceneAt` para la vista previa, `lyricAss` + `lyricRenderArgs` para el render). Datos: `songs`, revisiones de letra, `LyricComposition`.

### 1.1 Entrada y historial
| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-ED-01 | Zona «Suelta tu canción» | vacía | MP3, WAV, FLAC, M4A, OGG ≤50 MB; vídeo MP4/MOV/WEBM | siempre | sube y crea un borrador por archivo | borrador en cuenta | el borrador aparece en el historial | — | ESC-S01 |
| V3-ED-02 | Varios archivos a la vez | — | N archivos | siempre | un borrador por archivo, en cola | sí | todos visibles | — | ESC-S01 |
| V3-ED-03 | Cuota visible | «Te quedan N de M vídeos» | — | siempre | — | — | igual | bloquea Render al llegar a 0 con explicación | inventario (5 de 5) |
| V3-ED-04 | Historial «Vídeos creados» | lista por fecha | pestañas: borradores · renderizados · en progreso | siempre | abrir, renombrar, borrar (confirmación), «Exportar de nuevo» | sí | igual | — | ESC-S03, LE-20 |
| V3-ED-05 | Aviso de conservación | «Se guarda N días» | — | siempre | — | — | — | caducidad visible por fila | ESC-S03 |

### 1.2 Paso Audio
| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-ED-10 | Forma de onda con tramo seleccionable | primeros 30 s | arrastrar tramo y bordes | audio cargado | mueve inicio/fin | autoguardado | mismo tramo | el vídeo dura el tramo | LE-01..03 |
| V3-ED-11 | Campos Inicio / Fin / Duración | 0:00.0 / 0:30.0 / 30.0 | escribir `m:ss.d` | audio cargado | ajusta el tramo; el fin se conserva al cambiar el inicio | sí | igual | igual | LE-01, LE-02 |
| V3-ED-12 | Límite del plan | — | aviso si se supera | siempre | recorta al máximo y lo explica | — | — | — | inventario («limitada a 30 s») |
| V3-ED-13 | Velocidad de escucha | 1× | 1×, 0,5×, 0,25× | audio cargado | cambia solo la reproducción | no | 1× | ninguno en el render | LE-19 |
| V3-ED-14 | Volumen | 100 % | 0–100 | audio cargado | escucha | sí | igual | ninguno | inventario |
| V3-ED-15 | Entrada / salida suaves | apagadas | al empezar · al terminar (segundos) | audio cargado | fundido de audio | sí | igual | `afade` en el render | inventario, EDI-15 |
| V3-ED-16 | Modelo de transcripción | rápido incluido | rápido · preciso (cuota) | audio cargado | elige ASR | sí | igual | calidad de letra | inventario |
| V3-ED-17 | Idioma | detección automática | lista | audio cargado | fija idioma | sí | igual | ASR | inventario |
| V3-ED-18 | «Continuar a letras» | — | — | tramo válido | transcribe solo si el tramo cambió | sí | abre en Letras | — | LE-04, LE-22, LE-23 |

### 1.3 Paso Letras
| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-ED-20 | Palabra editable | texto del ASR | escribir, Intro | siempre | cambia el texto conservando su bloque y su línea | autoguardado | igual | texto del render | LE-05, LE-06 |
| V3-ED-21 | «Nueva línea» en la palabra elegida | — | — | palabra elegida | parte la línea | sí | igual | agrupación del render | LE-07 |
| V3-ED-22 | Dividir / Unir / Borrar / Añadir texto | — | — | palabra elegida | edita sin perder texto; deshacible | sí | igual | igual | LE-25 (no observado) |
| V3-ED-23 | Línea de tiempo palabra a palabra | cerrada | abrir/cerrar | siempre | muestra bloques, onda, marcas de línea, play, −5/+5 s | — | — | — | LE-08 |
| V3-ED-24 | Mover palabra con ← → | — | paso fijo | palabra elegida | desplaza; la vecina se ajusta sin solaparse | sí | igual | tiempos del render | LE-09, LE-12 |
| V3-ED-25 | Arrastrar bloque y bordes | — | — | palabra elegida | mueve o cambia inicio/fin | sí | igual | igual | LE-10, LE-11 |
| V3-ED-26 | Deshacer / Rehacer (Cmd+Z / Cmd+Shift+Z y botones) | deshabilitados | — | hay historial | revierte en orden inverso | sí | historial vacío, texto conservado | — | LE-13 |
| V3-ED-27 | Clic en bloque → salto de reproducción | — | — | siempre | coloca el cursor en el inicio de la palabra; la vista previa la muestra | — | — | — | LE-14, LE-18 |
| V3-ED-28 | Volver a Audio | — | — | siempre | sin cambios: no re-transcribe; con tramo nuevo: re-transcribe y avisa de que se pierde la letra | sí | — | — | LE-22, LE-23 |

### 1.4 Paso Estilo
| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-ED-30 | Fondos de la biblioteca | ninguno | categorías, favoritos, páginas | siempre | elegir 1..N; **un vídeo por fondo** | sí | igual | N renders | ESC-S02, EDI-13 |
| V3-ED-31 | Fondo propio | — | vídeo ≤60 s o imagen | siempre | se añade a la selección | sí | igual | igual | inventario |
| V3-ED-32 | Estilo de letra | «palabra resaltada» | catálogo propio de Ráfaga | siempre | cambia aspecto, conserva texto y tiempos | sí | igual | render | LE-15 |
| V3-ED-33 | Cómo aparecen las palabras | Automático | automático, palabra a palabra, 2 o 3 a la vez, frase, oración | siempre | agrupa | sí | igual | render | LE-16 |
| V3-ED-34 | Posición | centro | arriba, centro, abajo | siempre | mueve | sí | igual | render | LE-17 |
| V3-ED-35 | Tamaño | mediano | pequeño, mediano, grande | siempre | escala | sí | igual | render | LE-17 |
| V3-ED-36 | Tipo de letra, movimiento, efectos de texto, efectos de cámara | ninguno | catálogo propio | siempre | aplica | sí | igual | render | ESC-S02 |
| V3-ED-37 | Oscurecer fondo | 40 % | 0–80 % | fondo elegido | aplica | sí | igual | render | ESC-S02 |
| V3-ED-38 | Título fijo | vacío | texto | siempre | se ve todo el vídeo | sí | igual | render | EDI-05 |
| V3-ED-39 | Llamada a la acción final | vacía | texto + segundos finales | siempre | aparece al final | sí | igual | render | EDI-06 |
| V3-ED-40 | «Ver en» zonas seguras | ninguna | TikTok, Reels, Shorts | siempre | superpone guía solo en vista previa | sí | igual | ninguno | EDI-16 |
| V3-ED-41 | Vista previa = render | — | — | siempre | misma escena | — | — | ≤1 fotograma | LE-28, LE-30 |

### 1.5 Paso Render y resultado
| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-ED-50 | Calidad | 720p | 720p, 1080p, 4K | cuota > 0 | fija resolución | sí | igual | `ffprobe` | LE-27 |
| V3-ED-51 | Fotogramas por segundo | 30 | 24, 30, 60 | — | fija fps | sí | igual | `ffprobe` | LE-27 |
| V3-ED-52 | Crear vídeo | — | — | fondo y letra listos | renderiza N vídeos con progreso; cancelar | sí | en progreso visible | MP4 H.264/AAC | LE-24, LE-26 |
| V3-ED-53 | Resultado | — | descargar · publicar · exportar de nuevo | render listo | descarga archivo / abre panel Publicar | — | en historial | — | LE-29, ESC-S06 |
| V3-ED-54 | Panel Publicar junto al resultado | cerrado | cuenta, texto, al momento / programado | cuenta conectada | publica o programa | sí | estado visible | — | ESC-S06 |

---

## 2. Editor de vídeo avanzado · `/app/avanzado`

Referente observado: lista «Tus proyectos», **Nuevo proyecto** (Vertical 9:16 · Horizontal 16:9 · De largo a corto · Vídeo desde un enlace), **Proyectos (N)**, «Nueva carpeta», «Abrir archivo de proyecto», orden por «Última edición», estado vacío, clic derecho para crear, arrastrar a carpetas; guardado en el dispositivo y en la cuenta (ESC-S05, re-verificado 2026-11-23). **El interior del editor (línea de tiempo y sus controles) no se ha observado**: hace falta crear un proyecto en Escalium (cambio de datos) y no está autorizado.

| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-AV-01 | Nuevo proyecto · Vertical | — | — | siempre | crea proyecto 9:16 vacío y lo abre | cuenta | en la lista | 1080×1920 | ESC-S05 |
| V3-AV-02 | Nuevo proyecto · Horizontal | — | — | siempre | crea 16:9 | cuenta | en la lista | 1920×1080 | ESC-S05 |
| V3-AV-03 | Nuevo proyecto · De largo a corto | — | — | siempre | abre Autoclip; los clips elegidos vuelven como proyecto | cuenta | — | — | ESC-S05 |
| V3-AV-04 | Nuevo proyecto · Desde un enlace | — | — | decisión de producto (descarga solo de fuentes permitidas) | — | — | — | — | ESC-S05 (bloqueado) |
| V3-AV-05 | Lista de proyectos | orden «Última edición» | ordenar, buscar | siempre | abrir, renombrar, duplicar, borrar (confirmación) | cuenta | igual | — | ESC-S05 |
| V3-AV-06 | Carpetas | ninguna | crear, renombrar, mover (arrastrar o menú) | siempre | organiza | cuenta | igual | — | ESC-S05 |
| V3-AV-07 | Exportar / abrir archivo de proyecto | — | `.rafaga.json` | proyecto abierto | descarga/carga la descripción del proyecto (sin medios) | — | — | — | ESC-S05 |
| V3-AV-08 | Estado vacío | «Aún no hay proyectos…» | — | 0 proyectos | invita a crear | — | — | — | ESC-S05 |
| V3-AV-10 | Línea de tiempo: pistas de vídeo, audio y texto | vacía | añadir medios de la biblioteca o subir | proyecto abierto | colocar, mover, recortar, dividir, borrar | autoguardado visible | igual | orden de planos del render | (no observado) |
| V3-AV-11 | Cursor y reproducción | 0:00 | play/pausa, saltar, zoom de la línea | proyecto abierto | — | — | — | — | (no observado) |
| V3-AV-12 | Propiedades del elemento | — | posición, escala, volumen, opacidad, texto y estilo | elemento elegido | edita | sí | igual | render | (no observado) |
| V3-AV-13 | Subtítulos automáticos del vídeo | apagados | estilo | hay voz | transcribe y crea pista de texto editable | sí | igual | render | (no observado) |
| V3-AV-14 | Deshacer / rehacer | — | — | hay historial | — | — | — | — | (no observado) |
| V3-AV-15 | Exportar | 1080p · 30 fps | calidad, fps | timeline no vacía | render en el worker | sí | en historial | MP4 con orden, cortes, audio y superposiciones | (no observado) |

---

## 3. Autoclip · `/app/autoclip`

Referente observado: «De largo a corto»; 3 pasos (Subir · Analizar · Elegir tus clips); MP4/MOV/MKV/WebM hasta 3 h; ajustes de duración, número, idioma, transcripción, «Analizar también la imagen», «Podcast / multicámara»; resultados con puntuación, cita, etiquetas, inicio/fin con ±, «Por qué este clip», gráfico de interés, encuadre, subtítulos, quitar pausas, «Seleccionar todos», «Abrir en el editor»; lista de vídeos analizados (ESC-S04, dos ejecuciones). Motor de Ráfaga: subida reanudable, worker v2 (`analysis`, `select`, `compose`), `generations`, `clip_candidates`, `clips`, `clip_versions`.

| ID | Control | Inicial | Opciones | Habilitado si | Acción | Guardado | Tras recargar | Efecto | Evidencia |
|---|---|---|---|---|---|---|---|---|---|
| V3-AC-01 | Subir vídeo largo | — | MP4, MOV, MKV, WebM; hasta 3 h | siempre | subida reanudable con progreso, velocidad y tiempo restante; cancelar | cuenta | reanuda | — | ESC-S04, ENT-01/08 |
| V3-AC-02 | Duración de los clips | 15–60 s | 10–30, 15–60, 30–90, 60–180, personalizada | archivo elegido | rango de selección | sí | igual | duración de clips | inventario |
| V3-AC-03 | Número de clips | Auto | Auto o número | archivo elegido | objetivo; si hay menos, se explica | sí | igual | nº de clips + aviso | inventario, CLP-05 |
| V3-AC-04 | Idioma | automático | lista | archivo elegido | ASR | sí | igual | — | inventario |
| V3-AC-05 | Analizar también la imagen | apagado | on/off | archivo elegido | añade señales visuales | sí | igual | selección | inventario |
| V3-AC-06 | Podcast / multicámara | apagado | on/off | archivo elegido | encuadre alrededor de quien habla | sí | igual | encuadre | inventario, CLP-16 |
| V3-AC-07 | Qué buscar (texto libre) | vacío | texto | archivo elegido | guía la selección | sí | igual | selección | CLP-01 |
| V3-AC-08 | Buscar clips | — | — | archivo subido, cuota | encola; el trabajo sigue en el servidor aunque se cierre la pestaña | sí | etapa real | — | ESC-S04 |
| V3-AC-10 | Progreso del análisis | — | etapas reales | en curso | — | — | igual | — | ESC-S04 |
| V3-AC-11 | Fallo de procesamiento | — | — | etapa fallida | explica qué falló, qué se conserva y «Reintentar» (sin cobrar dos veces) | sí | igual | — | encargo §4 |
| V3-AC-20 | Tarjeta de clip | — | — | resultados | reproducir, cita, etiquetas, puntuación, «Por qué este clip» | — | igual | — | ESC-S04 |
| V3-AC-21 | Inicio / fin con ± | del clip | pasos de 0,5 s y escribir | clip elegido | ajusta el corte | sí | igual | corte del render | ESC-S04 |
| V3-AC-22 | Interés a lo largo del vídeo | — | — | resultados | gráfico; clic salta al momento | — | — | — | ESC-S04 |
| V3-AC-23 | Encuadre | Rellenar (9:16) | Original, Rellenar, Ajustar | resultados | cambia encuadre de los elegidos | sí | igual | render | ESC-S04 |
| V3-AC-24 | Subtítulos | encendidos | on/off + estilo | resultados | — | sí | igual | render | ESC-S04 |
| V3-AC-25 | Quitar pausas y «ehh» | apagado | on/off | resultados | cortes internos | sí | igual | render | ESC-S04, EDI-08 |
| V3-AC-26 | Seleccionar todos / varios | ninguno | — | resultados | marca | — | — | — | ESC-S04 |
| V3-AC-27 | Exportar elegidos | — | MP4 o ZIP (+SRT/VTT/TXT) | ≥1 elegido | render; si uno falla, los demás siguen disponibles | sí | en historial | archivos | EXP-01/03 |
| V3-AC-28 | Abrir en el editor avanzado | — | — | ≥1 elegido | crea un proyecto con un plano por clip | cuenta | abre en `/app/avanzado/[id]` | ver §4 | ESC-S04 |
| V3-AC-29 | Buscar más clips | — | — | resultados | nueva generación que conserva las anteriores y no toca lo editado | sí | igual | — | CLP-11 |
| V3-AC-30 | Historial de vídeos analizados | por fecha | — | siempre | abrir, borrar (confirmación) | cuenta | igual | — | inventario («podcast-prueba.mp4 · 23 nov · 1:40 · 3 clips») |

---

## 4. Transición Autoclip → Editor avanzado (V3-TR)
| ID | Dato | Debe llegar | Prueba |
|---|---|---|---|
| V3-TR-01 | Origen | el mismo `source` (sin re-subir) | el plano referencia el source del clip |
| V3-TR-02 | Intervalo | inicio y fin del clip, en ms | plano.in/out = clip.start/end |
| V3-TR-03 | Encuadre | modo y fotogramas clave de seguimiento | mismos `kf` |
| V3-TR-04 | Subtítulos | palabras del intervalo, estilo y cortes internos | pista de texto con las mismas palabras retemporizadas |
| V3-TR-05 | Audio | pista del original, volumen | pista de audio enlazada |
| V3-TR-06 | Ajustes aplicados | quitar pausas, titular | conservados |
| V3-TR-07 | Estado útil | abre reproducible y guardable; autoguardado visible | reabrir muestra lo mismo |

---

## Bloqueos de evidencia
- **Interior del editor avanzado de Escalium** (V3-AV-10…15): crear un proyecto en Escalium cambia datos de la cuenta → **requiere autorización** para observar la línea de tiempo y sus controles.
- **Vídeo desde un enlace** (V3-AV-04, EDI-17): descargar de YouTube exige una fuente permitida → **decisión de producto**.
- **Publicar en TikTok desde el referente** (ESC-S06): conectar una cuenta es autorizar a un tercero → no se hará.
- **Recorridos reales de Ráfaga** (render, análisis): Modal sin crédito hasta el 1 de diciembre.
