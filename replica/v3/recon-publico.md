# Ráfaga v3 · recon de Escalium solo con fuentes públicas (2026-11-23)

Decisión del propietario: **solo fuentes públicas** (los términos de Escalium prohíben la ingeniería inversa; ver `terminos-escalium.md`).
Todo lo de este documento sale de páginas públicas de escalium.io leídas a ritmo humano. Las observaciones anteriores hechas con la cuenta
(`replica/inventario/escalium.md`, `replica/escalium/*.md`) **no se usan como especificación**; quedan como histórico.
Lo que las fuentes públicas no describen lo decide Ráfaga con criterio propio y se marca **«diseño Ráfaga»**.
Se describen capacidades y recorridos; no se copian textos, código ni aspecto.

## Fuentes
| ID | Fuente | URL | Qué aporta |
|---|---|---|---|
| P1 | Editor avanzado (producto) | https://escalium.io/advanced-video-editor | Biblioteca de clips integrada, plantillas de texto, «bins» de ajustes reutilizables, efectos, fotogramas clave, formas, medios propios, subtítulos IA (3 modelos, palabra a palabra), vista previa con la interfaz de cada red, tamaños de exportación, publicar en TikTok desde la ventana de exportación |
| P2 | Vídeo desde un enlace (guía) | https://escalium.io/advanced-video-editor/how-to-link-to-clip | Nuevo proyecto → «vídeo desde un enlace»: canción + 1–5 enlaces (≤2 h), reparto de planos, planos al ritmo, resultado = proyecto normal editable |
| P3 | Clips de vídeos largos (guía) | https://escalium.io/advanced-video-editor/gta-6-shorts-tiktok-clips | Autoclip: formatos y 3 h, rangos de duración, número Auto, idioma, motivos por clip, mover inicio/fin, 3 encuadres, subtítulos, descargar MP4 o abrir en el editor; herramientas del editor (capas, dividir, quitar silencios, estilos de subtítulo, color, sonido) |
| P4 | Clip maker (guía) | https://escalium.io/advanced-video-editor/gta-6-clip-maker | Qué muestra cada clip (motivos, frase inicial, puntuación relativa, inicio/fin por frase o tiempo exacto), historial de vídeos analizados, modo rápido |
| P5 | Vídeo de mejores momentos (guía) | https://escalium.io/advanced-video-editor/gta-6-highlights-video-maker | Ordenar clips, mezclar tipos de momento, montarlos en el editor con música y títulos |
| P6 | Generador de vídeos con letra | https://escalium.io/features/music-video-generator/lyric-video-maker | Subir canción (≤50 MB; MP3, WAV, FLAC, AAC, OGG, M4A) → letra automática editable → sincronía palabra a palabra ajustable → fondo (biblioteca o propio) y aspecto (animación, color, posición, fuente, tamaño, capa) → estilo de letra → render y guardar |
| P7 | Requisitos del editor web | https://escalium.io/articles/advanced-video-editor-requirements | Línea de tiempo multicapa, letra palabra a palabra, color, quitar fondo, efectos de texto y audio, exportación Full HD, todo en el navegador |
| P8 | Inicio y precios | https://escalium.io/ · https://escalium.io/pricing | Plan gratis: editor 1080p, 5 vídeos de letra al mes; 4K, efectos Pro, transcripción propia y canción completa en planes de pago |
| P9 | Términos | https://escalium.io/terms | Restricciones de uso (ver `terminos-escalium.md`) |

## Herramientas, pantallas y flujos (según P1–P8)

### Editor de vídeos (vídeo con letra) · P6, P8
- **S-ED1 Audio**: subir la canción (≤50 MB, 6 formatos). Elegir el tramo (P8: la canción completa es de pago → tramo limitado en gratis).
- **S-ED2 Letras**: transcripción automática; cambiar cualquier palabra; sincronía automática palabra a palabra con ajuste fino.
- **S-ED3 Estilo**: fondo de la biblioteca o propio; animación de la letra, color, posición, fuente, tamaño y capa sobre el vídeo; catálogo de estilos de letra.
- **S-ED4 Render**: renderizar y guardar el vídeo para publicarlo.
- **S-ED5 Vídeos creados**: lugar donde quedan los vídeos guardados — **diseño Ráfaga** (P6 dice «save it»; no describe la pantalla).
- Flujo **F-ED**: S-ED1 → S-ED2 → S-ED3 → S-ED4 → descargar/publicar (6 pasos públicos).

### Editor de vídeo avanzado · P1, P2, P3, P5, P7
- **S-AV1 Proyectos**: crear proyecto (P2 nombra «New project» y el tipo «Video from a link»; P1 lista tamaños 9:16, 16:9, 4:5, 1:1, 4K). Tipos concretos de la lista: **diseño Ráfaga** (Vertical / Horizontal / Cuadrado / 4:5 a partir de P1).
- **S-AV2 Editor**: línea de tiempo con capas separadas de vídeo, texto y sonido; dividir, quitar silencios, ajustar entre clips (P3); fotogramas clave de zoom, posición, rotación, opacidad y oscurecer con curva (P1); efectos (fundido, flotar, brillo, sombra, zoom, quitar fondo, texto detrás del sujeto) (P1); formas (P1); plantillas de texto reutilizables (P1); color (ruedas, curvas, HSL, LUT) (P3); sonido y sonoridad por plataforma (P3); biblioteca de clips por carpetas + medios propios (P1); subtítulos con «Transcribir» palabra a palabra (P1); vista previa con la interfaz de TikTok/Instagram/Facebook/Shorts (P1).
- **S-AV3 Exportar**: tamaños 1080×1920, 1920×1080, 1080×1350, 1080×1080, 4K; publicar o programar en TikTok al terminar (P1).
- Flujos: **F-AV1** crear → añadir medios → editar → guardar → reabrir → exportar; **F-AV2** vídeo desde un enlace (P2: canción + enlaces → mejores planos al ritmo → proyecto normal); **F-AV3** abrir clips desde Autoclip (P3, P5).

### Autoclip · P3, P4, P5
- **S-AC1 Subir**: MP4, MOV, MKV, WebM (y audio MP3, WAV, M4A) hasta 3 h.
- **S-AC2 Ajustes**: duración 10–30, 15–60, 30–90, 60–180 s o propia; número Auto; idioma o detección; «analizar también la imagen»; modo rápido (solo el sonido sale para transcribir) (P3, P4).
- **S-AC3 Resultados**: lista ordenada del mejor momento hacia abajo; cada clip con motivos (gancho, pregunta y respuesta, risas, pico de energía, palabras fuertes, historia, remate), frase inicial, puntuación relativa al mejor y inicio/fin (una frase antes/después o tiempo exacto); reproducir; encuadre Rellenar / Ajustar / Original con vista previa; subtítulos; descargar MP4 9:16 o abrir en el editor (P3, P4).
- **S-AC4 Historial**: vídeos analizados que se reabren al instante (P4).
- Flujo **F-AC**: subir → ajustes → analizar → revisar y ajustar → descargar o abrir en el editor (4 pasos en P3).

## Componentes
Zona de subida · selector de tramo con onda · editor de palabra · línea de tiempo por palabras · catálogo de estilos · selector de fondos · línea de tiempo multicapa · panel de propiedades con fotogramas clave · biblioteca de medios por carpetas · tarjeta de clip con motivos y puntuación · selector de encuadre · panel de exportación con tamaños y publicación.

## Modelo de datos inferido (confianza media; Ráfaga ya tiene tablas equivalentes)
- Canción (archivo, tramo) → Letra (palabras con inicio/fin y línea) → Vídeo de letra (estilo, fondos, render). Ráfaga: `songs`, revisiones de letra, `LyricComposition`, `lyric_videos`/exportaciones.
- Proyecto avanzado (formato, pistas[ elementos con origen, entrada/salida, propiedades, fotogramas clave ]). Ráfaga: **no existe aún** un proyecto multipista; hay `clip_versions` (un clip). Necesita tabla o documento nuevo (justificar en `blueprint.md` §1).
- Análisis de Autoclip (vídeo, ajustes, clips[ inicio, fin, puntuación, motivos, frase ]). Ráfaga: `analyses`, `generations`, `clip_candidates`, `clips`.

## Lo que no puede clonarse
Biblioteca de 300+ clips de Escalium (contenido propio de Escalium) → Ráfaga usa las colecciones del usuario y las suyas propias. Modelo de transcripción propio de Escalium → Ráfaga usa su ASR. App de escritorio y descarga de YouTube (P2: YouTube bloquea la descarga web) → fuera de alcance en web.

## Tamaño
3 herramientas, ~12 pantallas, 5 flujos. Lo más difícil: (1) editor multipista con fotogramas clave y render fiel (vista previa = exportación), (2) render de vídeo con letra verificable sin crédito de Modal, (3) Autoclip con encuadre por hablante y envío al editor. Tamaño **L** (un trimestre) para paridad completa; el primer recorrido completo de cada herramienta, **M**.
