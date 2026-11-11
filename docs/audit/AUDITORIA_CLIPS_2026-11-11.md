# Auditoría de clips, enlace de YouTube y Lyric (2026-11-11)

Producción: https://rafaga-studio.vercel.app. Criterio: solo lo comprobado en el entorno desplegado.

## 1. Clips de contenido real, subtítulos, cortes
| Prueba | Resultado |
|---|---|
| Vídeo sintético (patrón de color + voz sintética, 75,7 MB, subido a R2) | Subida → R2 → procesado → 1 clip de 24,1 s, 88 palabras, subtítulos quemados («CÁMARA CARA.»), MP4 h264 1080×1920 + aac. El editor reproduce el original desde R2. **No es contenido real**: valida la tubería, no la calidad editorial. |
| **Vídeo real del propietario** («Guia-Como-empezar-desde-0-720», 13,4 min, 1280×816, con audio) | **Solo 1 clip de 14,4 s, del inicio del vídeo (0:01–0:15, «Esto va a ser una guía paso a paso»)**, selector `lexical-v1` («coincidencia de palabras, sin IA»), sin encargo, encaje 6,9/10. **Insuficiente**: un vídeo de 13 min debería dar varios momentos y el elegido es el arranque, no un momento fuerte. |
| Archivos de salida | MP4 válidos (cabecera `ftypisom`, se reproducen). La descarga ahora comprueba el archivo y lo guarda siempre como `.mp4` (sin comprobar el fichero guardado en el equipo del propietario). |

**Causa principal:** no hay modelo de IA conectado. Anthropic no tiene saldo y no hay `GROQ_API_KEY`; sin IA el selector solo cruza palabras con el encargo y, sin encargo, escoge un tramo autónomo cualquiera. Es el mayor freno de calidad frente a los referentes.

## 2. Enlace de YouTube `5slz_pYiTE4`
- **Reconocimiento:** funciona (título, canal, portada, sin clave).
- **Clips reales desde el enlace: NO verificable.** YouTube bloquea la descarga desde los servidores del procesador (verificación anti-bots, comprobado). Esquivarla no se construye. Camino válido: el propietario descarga su vídeo (YouTube Studio) y lo sube; o lo elige desde su canal conectado (la conexión está lista y pendiente del consentimiento del propietario). No se ha podido auditar ese vídeo concreto por no disponer del archivo.

## 3. Lyric Studio
- La pantalla carga con la canción real («01-CRÍTIKA – CONTANDO DIAS», WAV 25,8 MB, 28 versos, 2:26) y el flujo completo: tramo (con «Detectar los 3 mejores momentos» por energía y repetición, etiquetado como estimación), letra y sincronización (automática, por pulsación, importar TXT/LRC/SRT/VTT), estilos, fondo, formato, resolución y variación; **un lote de 7 vídeos del 9 nov figura «Listo»**.
- **No revisado en esta sesión:** reproducir los 7 vídeos y juzgar sincronía y acabado; generar un lote nuevo (el procesador estuvo parado por el fallo de `apt` hasta la tarde).

## Acciones derivadas
1. Conectar un modelo de IA para la selección (Groq gratuito o saldo de Anthropic) y repetir esta prueba con el vídeo real y con un encargo.
2. Subir el vídeo de `5slz_pYiTE4` (si es del propietario) y auditar sus clips.
3. Reproducir y valorar el lote de Lyric; generar uno nuevo.
