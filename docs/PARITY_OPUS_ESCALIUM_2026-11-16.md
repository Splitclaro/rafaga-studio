# Paridad con OpusClip y Escalium · 2026-11-16

Método: se cotejan los estudios de `replica/escalium/recon.md`, `docs/recon/opus-clip.md`, `docs/recon/lyrictune.md` y `docs/recon/tiktok-referentes.md` (solo lectura, cuentas del propietario) con el código actual (búsqueda en `apps/`, `packages/`, `workers/`). **Límites:** el cotejo es contra los estudios ya hechos, no contra una nueva pasada de las dos apps; los estados «Tenemos» significan «existe en el código y en la pantalla», no «probado con vídeo real» salvo donde se indica. Las cuotas, los planes de pago y los medios de terceros no se replican.

## Escalium (editor de vídeos de letra)
| Función observada | Estado | Dónde / nota |
|---|---|---|
| Varias canciones a la vez, cada una su vídeo | Tenemos | Cola de canciones (`LyricStudioV2`), verificada en producción |
| Elegir tramo con forma de onda, bordes arrastrables, Inicio/Fin | Tenemos | `RangePicker` |
| Entrada y salida suaves del volumen | **Hecho hoy** | `settings.fadeIn/fadeOut` → `afade` en el render (test con ffmpeg real) |
| Transcripción automática, palabras editables, ajuste palabra a palabra | Tenemos | auto-sync + `LyricSyncEditor` |
| Modelo de transcripción alternativo (ElevenLabs, de pago) | No se hace | Coste (> 0 €) |
| Selector de idioma de la transcripción | Tenemos | idioma de la canción en el estudio |
| Varios fondos → una creación por fondo | Tenemos (hasta 10 variantes) | colecciones propias; verificado en producción |
| Biblioteca de 322 vídeos de fondo | No clonable | contenido de terceros; se suben fondos propios |
| «Ver en» TikTok/Reels/Shorts (zonas seguras) | Tenemos | `LyricPreview` |
| Mover texto en la vista previa | Tenemos | arrastre y flechas (la letra queda centrada por regla del propietario) |
| ~40 estilos de letra | Tenemos (44) | `trendingstyles.ts` |
| Cómo aparecen las palabras (1, 2, 3, frase) | Tenemos | presets del motor |
| Texto: fuente, tamaño exacto, espaciado | Tenemos | Style Studio |
| Movimiento (flotar, latir, temblar) | Tenemos | idle/ease del estilo |
| Efectos de texto (borde, sombra, brillo, caja) | Tenemos | Style Studio |
| Efectos de cámara (VHS, noche, gran angular) | Tenemos | filtros del motor |
| Oscurecer el fondo | Tenemos | `settings.dim` |
| **Llamada a la acción final** (botón a Spotify/Apple/YouTube) | **Falta** | no existe en el motor; trabajo medio (capa final + render) |
| **Título fijo** (p. ej. nombre de la canción) | Parcial | existe el «gancho»; título fijo permanente no |
| Velocidad de reproducción 0,5×/0,25× en la vista previa | Por verificar | hay `playbackRate` en un componente; no se comprobó que cubra la vista previa de letra |
| Indicador de 4 pasos | Parcial | estudio a dos columnas, sin barra de pasos |
| Editor de vídeo avanzado, Autoclip, Transferir | Parcial | editor de clips y clipping existen; «Transferir» no |
| Campañas por marca, publicar en TikTok, programar | Tenemos (5 cuentas) | Calendario + `/app/tiktok`; borrador verificado; **Direct Post pendiente de auditoría** |
| Ver visualizaciones, likes y comentarios de lo publicado | **Falta** | requiere scopes de lectura de TikTok (`video.list`) aprobados |
| Landing pages | No se hace | fuera de alcance |
| Render en el dispositivo | Distinto a propósito | render en servidor |

## OpusClip (clipping)
| Función observada | Estado | Nota |
|---|---|---|
| Entradas: clipear vídeo largo, subir, Drive | Tenemos | Inicio con subida y Drive/Dropbox |
| Recetas (Captions, Reframe, Social edits, B-roll) | Tenemos | worker `processWhole` |
| Recetas Upscale, Translate & dub | **Faltan** | requieren proveedores de pago |
| Encargo en lenguaje natural, «lo que he entendido» | Tenemos | brief + «Volver a detectar» + «Ajustar enfoque» |
| Puntuación por clip | Tenemos (estimación de IA, no garantía) | encaje 0–10 con desglose |
| Cuadrícula/lista, buscar, filtrar, ordenar | Tenemos | página del proyecto |
| Favorito y «no me gusta» (mejora la siguiente generación) | Tenemos | migración 112 |
| Editor: subtítulos, encuadre, plantillas | Tenemos | editor de clip |
| Programar y descargar | Tenemos | Calendario, ZIP |
| Brand kit, biblioteca de recursos | Tenemos | Brand kit con fuentes y vocabulario |
| AI Producer (editor conversacional) | No se hace | propietario y de pago |
| Marca de agua, créditos, planes | No aplica | |
| Vídeos de demostración de terceros | No clonable | |

## Qué queda y por qué
1. **Llamada a la acción final** y **título fijo** en Lyric Studio (Escalium): diseño y render nuevos; siguiente paso recomendado.
2. **Métricas de TikTok** en Analítica: necesita scopes adicionales aprobados por TikTok.
3. **Upscale y doblaje**: requieren servicios de pago (regla de 0 €).
4. **Direct Post**: lo decide TikTok (ver `docs/STATUS.md`).
