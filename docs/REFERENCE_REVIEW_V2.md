# Revisión de referencias V2 — generación automática de clips (2026-11-09)

Material: 10 imágenes aportadas por el usuario en el chat y los 7 vídeos de `Downloads/` (16 fotogramas por vídeo, muestreo uniforme). **El audio se transcribió localmente (Whisper `small`, español, en el equipo del usuario; nada se subió a terceros)** y se leyó entero; los textos de pantalla se leyeron cuando eran legibles. Las transcripciones tienen errores propios del modelo; solo se usan para entender funciones. Las marcas, personas y logos de las referencias no se adoptan. Las herramientas de los vídeos 4, 6 y 7 descargan directos/vídeos de YouTube o Kick: **no replicamos esa descarga** (sin método autorizado); sí su flujo funcional con fuentes autorizadas.

Estado: ✅ hecho · 🟡 parcial · ⬜ pendiente.

## A. Nuevo proyecto (importar y configurar)
| Observación (fuente) | Requisito derivado | Estado |
|---|---|---|
| Etiquetas de tipo de fuente: Podcasts, Webinars, Livestreams, Interviews, Tutorials, VODs, Gameplay (img 9) | Selector «Tipo de vídeo» que ajusta layout por defecto y detección (gameplay → facecam+juego; entrevista → split) | ⬜ |
| Tramo «desde 1:30:00 hasta 2:30:00», vacío = vídeo entero (vídeo 4) | Rango de origen hh:mm:ss validado; ASR y selección solo en el tramo | ⬜ (columnas en BD, falta UI/worker) |
| Formatos «Vertical 9:16 (TikTok/Reels/Shorts), Vertical 4:5 (feed Instagram), Horizontal 16:9 (YouTube)» (vídeo 4) | Añadir **4:5 (1080×1350)** a los formatos existentes | 🟡 (9:16, 1:1, 16:9) |
| Duración «1 minuto 25» y clips de 15 s, 32 s, 45 s, 1:20 (vídeo 4, img 9) | Presets de duración 15/30/45/60/85 s y «automática» | ⬜ |
| «Cuántos clips: 10», calidad «1080p Full HD», aviso «4K tarda mucho más» (vídeo 4) | Nº de clips ✅; calidad 720/1080 con aviso de tiempo | 🟡 |
| Botón «Analizar vídeo» / «Make Clips» / «Get Clips» (vídeo 4, img 1–2) | Botón principal «Detectar momentos virales» | ✅ |

## B. Progreso del procesamiento
| Observación | Requisito | Estado |
|---|---|---|
| «Listo: 10 de 10 · 229 s» y «Ver detalle técnico» (vídeo 4) | Contador x de N, tiempo total real y detalle técnico plegable (tiempos por fase) | 🟡 (etapas; falta x de N y detalle) |
| Etapas con cifras: Grabando 30:03, Transcribiendo 29:00, Buscando momentos (13 revisiones), Creando clips (7 listos, 1 en cola) (vídeo 1) | Etapas con contadores reales derivados de eventos | 🟡 |
| Clips visibles mientras se crean los demás (vídeos 1, 4) | Primer clip antes del lote (ya en worker) y refresco en vivo de la galería | 🟡 |

## C. Galería de clips
| Observación | Requisito | Estado |
|---|---|---|
| Orden «Virality (highest first) / Time (earliest first)» (img 4, img 10) | Ordenar por puntuación o por tiempo de origen | ⬜ |
| Puntuación «96/100» y desglose «Hook, Flow, Value, Trend» con notas A-/A (img 9, img 4) | Puntuación 0–100 + desglose con letras desde nuestra rúbrica (gancho, comprensión, cierre, relevancia), rotulada «estimación de IA» | 🟡 (0–10, sin desglose visible) |
| Insignias de duración 15s/45s/32s/1:20 sobre el clip (img 9) | Duración visible en la miniatura | 🟡 (texto, no insignia) |
| Tarjeta: título, «71 % viral», 108,81 s, 75,6 MB, Descargar (vídeo 4) | Título, puntuación, duración, peso del archivo y descarga directa en la tarjeta | 🟡 |
| Acciones: reencuadrar, layout split, subtítulos (CC), descargar, compartir; 👍 👎 y guardar (img 4) | Barra de acciones por clip + valoración y favoritos | 🟡 (editar; faltan atajos, 👍/👎, favoritos en UI) |
| Agrupación «Topic 1, 2, 3» (img 6) | Agrupar clips por tema detectado | ⬜ |
| «Por qué no se eligieron» con puntuación por candidato (vídeo 1) | Lista de descartes con motivo (duplicado, sin cierre, fuera de tema, duración) | 🟡 (se guardan en `generations.params.rejected`, no se muestran) |
| Iconos YouTube Shorts, TikTok, Reels, X, LinkedIn, Snapchat (img 2) | Publicación por destino según conexiones reales; hoy solo descarga | ⬜ |

## D. Formato de subtítulos de clips (prioridad máxima)
| Observación | Requisito | Estado |
|---|---|---|
| Mayúsculas, negrita, contorno, 1–2 líneas cortas (img 1, 3, 5, 7; vídeo 2) | Preset por defecto de clips con esas características | ✅ (Impacto) |
| **Palabras clave** en color (rojo, verde, amarillo, azul, rosa), distinto de la palabra activa (img 1, 3, 5, 7; vídeo 2) | Resaltado de palabras clave: automático (sustantivos/cifras/énfasis) y editable por palabra, con color de marca | ⬜ |
| Emoji contextual bajo la frase (💚, 🤞, 👊) (img 3, 5) | Emojis opcionales por bloque, elegibles/editables; solo si la fuente los renderiza | ⬜ |
| En layout de dos personas, subtítulo en la unión de las dos mitades (vídeo 2, img 3) | Posición automática «unión» para split | ⬜ |
| Opciones «color del contorno», «caja de color detrás del texto», «respetar minúsculas» (vídeo 4) | Caja/barra de fondo y modo minúsculas en el editor | 🟡 (minúsculas ✅ en letra; caja ⬜) |
| Plantillas con titular arriba y subtítulos abajo; amarillo itálico; caja negra (img plantillas) | Titular/cabecera opcional por clip y presets adicionales | ⬜ |
| Panel de captions por bloques con timestamp y palabras resaltadas; Undo/Redo; «Save & Compile» (img 6) | Editor por bloques (además de por palabra) | 🟡 (por palabra, undo/redo y export ✅) |

## E. Encuadre y layouts
| Observación | Requisito | Estado |
|---|---|---|
| Reencuadre vertical centrado en quien habla (img 1, 3) | Seguimiento facial automático con suavizado | ⬜ (hoy fondo desenfocado) |
| Alterna plano individual y **dos personas apiladas** (vídeo 2, img 3) | Layout split automático con dos regiones y cambio por hablante | ⬜ |
| **Facecam arriba + gameplay abajo**, cámara en esquina elegible (vídeos 5, 6) | Layout Gaming con dos regiones seleccionables a mano y guardadas por fuente | ⬜ |
| Ponente + imagen de apoyo (B-roll) abajo (img 7) | Layout ponente + B-roll | ⬜ |
| Fondo desenfocado (plantillas) | ✅ | ✅ |
| Timeline con tira de miniaturas, tramo seleccionado, herramienta de reencuadre y timecode (img 5) | Timeline visual en el editor con recorte de inicio/fin | ⬜ |

## F. Filtros y acabado
| Observación | Requisito | Estado |
|---|---|---|
| Filtros: Sin filtro, Cine, Frío, Cálido, B/N, Vintage, HDR, Verano, Pastel, Drama, Noche (vídeo 4) | Filtros de imagen también en clips (hoy solo en Lyric Studio: Midnight, Super 8, Noir, Vaporwave) | 🟡 |

## G. En vivo (vídeos 1 y 6)
| Observación | Requisito | Estado |
|---|---|---|
| Pestañas Crear clips / En vivo / Biblioteca / Ajustes de IA / Almacenamiento / Ayuda (vídeo 1) | Estructura equivalente en nuestra navegación | 🟡 |
| Reloj circular «en vivo», «Puedes dejar esta pantalla abierta», etapas con tiempos | Vista En vivo con estado real y captura durable sin depender del navegador | ⬜ |
| «Pasar a narrado» en cada clip (vídeo 1) | Función no inferible solo con la imagen: **pendiente de aclarar** (posible voz en off). No se inventa | ⬜ |

## H. Biblioteca (vídeo 7)
| Observación | Requisito | Estado |
|---|---|---|
| Lista de intervalos por clip con visor vertical y canal/fuente | Biblioteca con todos los clips y vídeos con letra, buscador, filtros y origen | ⬜ |

## Orden de implementación propuesto (por impacto en «generación automática de clips»)
1. Galería: puntuación 0–100 con desglose, orden por puntuación/tiempo, insignias de duración, descartes visibles, 👍/👎/favorito.
2. Subtítulos de clip: palabras clave en color, caja de fondo, titular opcional, emojis (si el renderer los soporta).
3. Configuración: tipo de vídeo, tramo, duración objetivo, formato 4:5.
4. Layouts: split dos personas, gaming (regiones manuales), seguimiento facial.
5. Progreso con contadores y detalle técnico; En vivo; Biblioteca.

## I. Lo que EXPLICAN los vídeos (audio transcrito localmente)
| Vídeo | Qué explica | Requisito derivado | Estado |
|---|---|---|---|
| 1 (en vivo) | Monitoreo en tiempo real: grabando, transcribiendo, buscando momentos, creando clips; «rechaza los que no van a funcionar»; clips listos para descargar y publicar; sigue generando mientras dure la emisión | Página En vivo con etapas, contadores reales y clips según llegan; descartes visibles | ✅ En vivo (captura HLS autorizada); 🟡 sin desglose por etapa en tiempo real |
| 2 | (Clip de ejemplo con subtítulos; el audio es contenido, no explica funciones) | — | — |
| 3 | Clase en directo: la herramienta «busca la risa y el grito» para localizar momentos | Señales de audio (energía/reacciones) como criterio de selección | 🟡 energía en Lyric Studio; ⬜ en clips de vídeo |
| 4 | Flujo: copiar enlace → analizar → elegir cantidad → configurar → clips listos en minutos con % de viralidad → descargar y ajustar a cada red | Nuevo proyecto, galería con puntuación, Social edits | ✅ (carga por archivo; ⬜ por enlace) |
| 5 (gaming) | Detecta la facecam, hace la división de pantalla (cámara arriba, juego abajo); recomienda grabar gameplay y revisar manualmente los mejores momentos | Layout Gaming con dos regiones y detección | ⬜ |
| 6 | Pegar URL, desmarcar «directo», generar; ver el primer vídeo cuando termina de cargar | Primer clip antes del lote; proceso cancelable/regenerable | ✅ primer clip antes del lote; ⬜ cancelar proceso de clips |
| 7 | No hace falta pegar URL ni clave: buscador de canales integrado, «usar vídeo» y se generan los clips | Buscador de canales | ⛔ requiere una API de plataforma autorizada; no se replica |
