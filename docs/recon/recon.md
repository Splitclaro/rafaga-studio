# Reconocimiento de referentes de AI Clipping (2026-11-11)

**Alcance:** el bucle principal de las cinco herramientas: *traer un vídeo largo → obtener clips verticales puntuados → revisar/editar → publicar/programar*. Web. Para el negocio de Ráfaga (herramienta de clipping).
**Método:** solo páginas públicas y las cuentas del propietario abiertas en Chrome, a ritmo humano, solo lectura, sin crear proyectos ni gastar créditos, sin leer su código ni sus llamadas internas. Capturas solo como referencia (no se incluyen en el producto). Se copian **funciones y patrones de uso**, nunca código, marcas, imágenes ni textos.
**Cubierto de verdad:** Ssemble (inicio, automatizaciones), Vizard (inicio, resultados del proyecto de demostración), NexusClips (inicio, resultados de la demo de podcast), Klap (inicio vacío). **No cubierto:** Opus Clip (no estaba abierto), WayinVideo (solo la pantalla de Brand Kit vacía), calendarios y analíticas de todos ellos, editores a pantalla completa, precios.

## Fuentes
| fuente | qué aporta |
|---|---|
| Panel de cada app con la cuenta del propietario | pantallas y estados reales |
| Proyectos de demostración (Vizard, NexusClips) | pantalla de resultados con datos reales |
| Pie de página de Klap | integraciones declaradas: API, MCP server, Zapier, Make, n8n |

## Inventario de pantallas observadas
| ID | Pantalla | App | Propósito | Componentes clave | Estados vistos |
|---|---|---|---|---|---|
| S01 | Inicio con entrada única | Klap, Ssemble, Nexus, Vizard | Empezar | Un campo «pega enlace / suelta archivo» + botón (Generate / Get Shorts / Continue / Get Clips); zona de arrastre con límites (Ssemble: 1–30 min, 1 GB, 1080p) | vacío |
| S02 | Inicio con cuentas conectadas | NexusClips | Elegir de tus vídeos | Tarjetas «Conectar YouTube» y «Conectar Twitch» junto al campo de enlace; «Importar archivo» | sin conexión |
| S03 | Demos | NexusClips (4: podcast, directo, gaming, YouTube), Vizard («Demo Project») | Ver el resultado sin subir nada | Tarjetas con duración y tipo; botón final «Usar mi vídeo» | demo |
| S04 | Lista de proyectos | Ssemble («My Projects», caducan a 60 días), Vizard (Home → recientes; Projects con vista lista/rejilla y carpetas) | Retomar | Miniatura, duración, rango, etiqueta DEMO, estado, orden y filtro, buscador | con datos |
| S05 | **Resultados del proyecto** | Vizard | Revisar clips | Lista lateral numerada de clips con miniatura y título; barra superior: Seleccionar todo, Publicar, Descargar, Editar clips, Borrar, Filtro; orden «Mayor puntuación»; por clip: n.º, título, **puntuación de viralidad 0–10 destacada**, Publicar, Descargar, «AI Enhance», compartir, traducir, recortar; **transcripción del clip inline**; calidad (720p); 👍/👎 y ⭐ para favoritos; aviso «tu vídeo no incluye tus últimas ediciones → Actualizar cambios»; recorrido guiado de 4 pasos | con datos |
| S05b | Resultados | NexusClips | Ver y decidir | Tarjetas verticales con subtítulos puestos, **puntuación 92/88/87/82** y título; a la derecha: ficha de la fuente (canal, duración, miniatura, «clipping permitido») y «Cómo funciona» en 3 pasos: *traer el vídeo → decir qué buscar (momentos graciosos, consejos, polémicas, estilo de subtítulos) → recibir clips ordenados por probabilidad de retener* | con datos |
| S06 | Automatización de canal | Ssemble | Clipear cada vídeo nuevo | Pegar la URL del canal; ajustes recomendados: umbral de viralidad 70+, duración 60 s, frecuencia 5–7/semana; «1 crédito = 20 min de fuente»; pasos: conectar canal → detectar subidas → auto-clip → publicar en cuentas conectadas | vacío |
| S07 | Campañas de pago por visualizaciones | Ssemble («Clip Rewards», «Get paid to clip») | Monetizar | Tarjetas de campaña con tarifa por 1K vistas y presupuesto | con datos |
| S08 | Calendario, Analítica | Ssemble, Vizard, Klap | Programar y medir | existen en las tres (no inspeccionadas) | no vistas |
| S09 | Marca | Vizard, WayinVideo | Aplicar marca | «Brand kit» / «Crear brand kit» | vacío |
| S10 | Navegación | Vizard (lateral: Home, Projects, Exported, Calendar, Analytics, Brand kit, Shared with me), Nexus (lateral: Home, Calendar, Pricing, demos), Klap (superior: Videos, Calendar, Analytics), Ssemble (superior: AI Clipping, Clip Rewards, Automations, Calendar, Pricing) | Orientar | Créditos visibles; «Upgrade» siempre presente | — |

## Flujos
- **F01 Empezar (el que hay que ganar):** S01 → pegar enlace o soltar archivo → un botón → proyecto. **Camino feliz: 2 acciones** (pegar + botón) en Klap/Nexus/Ssemble. En Ráfaga hoy son 4–5 (elegir herramienta/pestaña, elegir origen, subir, escribir encargo opcional, «Obtener clips»).
- **F02 Dirigir la búsqueda:** Nexus pregunta *qué buscar* (momentos graciosos, consejos, polémicas) y el estilo de subtítulos *antes* de generar. Ráfaga ya tiene el encargo en lenguaje natural (más rico), con su «Lo que he entendido».
- **F03 Revisar:** S05/S05b → ordenar por puntuación → ver transcripción → favorito/descartar → editar → descargar/publicar.
- **F04 Automatizar canal:** S06 (Ssemble). Ráfaga: parcial (reglas de automatización existen).
- **F05 Probar sin subir:** S03 demo → «Usar mi vídeo».

## Componentes recurrentes
Entrada única de enlace/archivo · tarjeta de clip con puntuación · lista lateral numerada · barra de acciones masivas · selector de orden/filtro · chip de estado · visor vertical 9:16 · tarjeta de demo · «Cómo funciona» en 3 pasos · medidor de créditos · recorrido guiado.

## Modelo de datos inferido
- **Project** (fuente, duración, rango, expira en N días [Ssemble]) → **Clip** (n.º, título, puntuación 0–10 o 0–100, transcripción, calidad, favorito/descartado, estado de ediciones pendientes) → **Export/Publicación** (plataforma, fecha). Confianza alta (se ve en pantalla).
- **ChannelAutomation** (URL de canal, umbral de viralidad, duración, frecuencia, cuentas destino). Confianza media.

## No se puede ni se debe copiar
Catálogo de campañas de pago y su red de creadores (Whop), modelo de recompensas, demos con contenido de terceros (Lex Fridman, MrBeast, Mel Robbins), los textos y la marca de cada app, y **la descarga de vídeos de YouTube con proxies o cuentas** (esquiva la verificación anti-bots de YouTube; no se construye).

## Tamaño
Rediseño de Inicio + Resultados + navegación: **S–M**. Automatización de canal con publicación real: **L** (revisión de cada plataforma). Reencuadre «active speaker» y traducción/doblaje: **L**.

## Resumen
- Bucle: *una entrada → clips puntuados → revisar → publicar*.
- Observadas 10 pantallas y 5 flujos; no cubiertas calendario, analítica, editor completo y Opus Clip.
- Lo más difícil: obtener el vídeo desde un enlace (infra y condiciones de YouTube), reencuadre por hablante, publicación automática.
- Fuera de alcance: campañas de pago, descarga con proxies, contenido de terceros.
- Siguiente: `/replica-architect`, o aplicar ya lo observado al diseño (S01, S05, S10).
