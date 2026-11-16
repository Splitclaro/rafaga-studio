# Escalium (escalium.io) — estudio del proceso (2026-11-16, solo lectura)

Fuentes: la app abierta con la cuenta del usuario (plan Gratis) y su vídeo tutorial (114 s; se revisaron 19 fotogramas; el audio no se pudo transcribir en local, por lo que se usaron los rótulos del vídeo: «Creative Studio», «subtítulos manualmente», «renderiza estos»). Se subió «Contando días» (MP3 de 2:26). **No se renderizó** (gasta 1 de 5 vídeos/mes) y no se conectó ninguna cuenta de TikTok.

## Flujo «Editor de vídeos» en 4 pasos (con autoguardado en «Vídeos creados»)
1. **Audio**: suelta canción (MP3, WAV, FLAC, M4A, OGG ≤ 50 MB) o vídeo (MP4, MOV, WEBM ≤ 2 GB); se puede soltar **varios a la vez: cada uno es su propio vídeo**. Elegir el tramo con forma de onda (zoom 1×/+/−/«Ver todo»), ajuste fino con bordes arrastrables y campos Inicio/Fin/Duración (**Gratis: máx. 30 s**), reproductor con velocidad 1×/0,5×/0,25× y volumen, **entrada y salida suaves** (fundido de volumen), **modelo de transcripción** (Large V3 rápido incluido · ElevenLabs más preciso: 5 al mes) e **idioma** (detección automática).
2. **Letras**: transcripción automática (sin pegar letra); vista previa con «cómo ver tus letras» (sincronización simple); **cada palabra es una caja editable** (tocar para corregir; el tiempo se mantiene), líneas numeradas, «Ajustar palabra por palabra» (línea de tiempo), «Volver a la canción», «Continuar a Estilo».
3. **Estilo**: pestañas **Vídeos de fondo** y **Editar estilo**.
   - Fondos: «Añade tu vídeo» (máx. 60 s, se queda en el dispositivo); biblioteca de **322 vídeos** en 16 categorías (juegos 71, paisajes 67, motos 49, coches derrapando 33, coches 30, galaxia 17, anime y bailes 15, dron 10, blanco y negro 7, motos de agua 7, dibujos 4, gatos 3, gaming 3, fiesta 3, lluvia 2, películas 1) + favoritos, paginación 1–10 de 322. **Se pueden elegir varios fondos: cada uno genera su propia creación** (en el tutorial: «renderizar 2 creaciones»).
   - Vista previa con **«Ver en»: Sin app / TikTok / Reels / Shorts** (zonas seguras) y herramientas **Mover texto, Recortar, Encuadre**; «Abrir en el editor de vídeo avanzado».
   - Editar estilo: **~40 estilos de letra** (Sin letra, Sin efecto, Justificado, Palabra neón, Palabra gruesa, Hueco, Matriz de puntos, Elegante, Glitch, A mano, Cursiva, Estilo TikTok, **Palabra resaltada** (por defecto), Palabra a palabra, Zoom, Destello, Línea curva, Relleno karaoke, Contorno grueso, Fundido suave, Golpe, Palabras a dos colores, Mayúsculas apiladas, Tubo de neón, Minúsculas suaves, Palabra que cae, Mini páginas, Cascada de letras, Máquina de escribir, Enfoque, Zoom de entrada, Deslizar, Sacudida, Letra en arco, Letra en onda, Arco sonrisa, Insignia circular, Golpe al ritmo, Subtítulo amarillo, Brillo suave, Cromo retro, Emojis en explosión); **cómo aparecen las palabras** (Automático, palabra por palabra, 2 o 3 a la vez, frase por frase, oración por oración); mantener el texto entre líneas + duración del desvanecimiento (0,5 s); color de la letra y de la palabra que suena; **dónde va** (arriba/centro/abajo); **tamaño** (pequeño/mediano/grande); «Más ajustes» desplegables: **Texto** (tipo de letra, tamaño exacto, visibilidad, posición, espacios), **Movimiento** (flotar, latir, temblar, balancear), **Efectos de texto** (borde, sombra, brillo, caja), **Efectos** de cámara (VHS, cámara digital de noche, nightshot, gran angular), **Llamada a la acción** (botón animado final a Spotify/Apple Music/YouTube), **Título** fijo (p. ej. nombre de la canción), **Vídeo** (nombre, oscurecido 40 %, qué parte del clip se usa).
4. **Renderizar** («Crear vídeo»): render **en el dispositivo del usuario**; cuota Gratis **5 vídeos/mes**; «Publicar en TikTok» al terminar.

## Otras secciones
- **Vídeos creados**, **Editor de vídeo avanzado**, **Autoclip**, **Transferir**, **Campañas → Publicar** (por **marca**, «Añadir cuenta» de TikTok, programar y ver visualizaciones, likes y comentarios) y **Landing pages**; **Analíticas**; **Cuenta**; modo claro/oscuro; idioma ES/EN; «Mejorar plan».

## Qué se replica en Ráfaga y qué no
| Escalium | Ráfaga | Decisión |
|---|---|---|
| Varios audios a la vez, cada uno su vídeo | Una canción cada vez | **Hacer** (cola de canciones) |
| Transcripción automática + palabras editables | Auto-sync + editor de palabras | Ya existe; unificar pasos |
| 4 pasos con barra de progreso | Estudio a dos columnas | Añadir indicador de pasos (parcial) |
| Elegir varios fondos → una creación por fondo | **Hasta 10 variantes con fondo distinto** | **Hecho en esta pasada** |
| 322 vídeos de fondo propios | Colecciones del usuario | No clonable (contenido de terceros); se sube lo propio o de Flow |
| ~40 estilos de letra | 28 estilos populares + extras del motor | Ampliar catálogo (pendiente) |
| «Ver en» TikTok/Reels/Shorts (zonas seguras) | Zonas seguras en la vista previa | Ya existe |
| Render en el dispositivo | Render en el servidor (Modal) | Distinto a propósito (sin consumir el equipo) |
| Publicar en TikTok por marca/cuenta | Plan en `docs/PLAN_TIKTOK_AUTOMATION.md` | En construcción |
| Cuotas y planes | No aplica (uso privado) | No se replica |
