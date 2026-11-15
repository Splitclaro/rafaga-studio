# LyricTune — estudio del proceso de creación (2026-11-15, solo lectura)

Hecho con la cuenta del usuario (plan Free, 3 exportaciones). Se subió su canción (copia MP3 de «01-CRÍTIKA – CONTANDO DIAS», 1:00) y se recorrió todo el flujo **hasta antes de exportar** (la exportación gasta una de las 3 gratuitas y necesita la letra real, que no está en el repositorio). Letra de prueba neutra «prueba uno de la letra…» solo para ver el flujo de sincronización.

## F01 · Flujo principal (Video Studio, una sola pantalla con 3 zonas)
1. **Subir canción** (menú «Select Song» → «Add New Song»): arrastrar o elegir MP3/WAV → **Trim Audio** (forma de onda con caja azul de **60 s máx.**, bordes verde/rojo arrastrables, −/+ 0,5 s en inicio y final, «Play clip» y «Hear ending», «Use first 60 seconds») → título, artista, letra opcional → **Trim & Upload**. Aviso «Song uploaded».
2. **Letra**: «Add your lyrics» (pegar; cada línea se muestra por separado) → «Save Lyrics» → **la letra debe sincronizarse antes de exportar** (banner «Lyrics must be synced before exporting»). Dos vías: **Auto-sync (de pago)** o **Hold-to-Sync gratis**: suena la canción, se mantiene la barra espaciadora mientras se dice cada palabra y se suelta al acabar; teclas 1–4 cambian la velocidad, Retroceso deshace la última palabra. Después: «Edit», «Fine-tune timing», «Re-sync».
3. **Elegir estilo de vídeo**: pestañas **Video / Photo**; **LyricTune Collections** (Solid Color + 19 paquetes: VHS Bay Area, New York on Tape, Dreamy, Vintage Life, Tokyo Drive, Sunset, Headphones in Film, Witchy Scenes, Summer Scenes, Trippy Liquid, Anime Motivation, Minecraft, CSGO Surfin', San Andreas, Cats, Shanghai Nights, Halloween, M64, Nature in the UK, Rainy Window) y **Custom Collections** (los propios). Cada paquete trae una descripción y puede **bloquear el ajuste del fondo** («Preserve Original Ratio — locked by this video pack»).
4. **Modo**: Lyrics · Text · LP Cover.
5. **Customize lyrics**: ~35 «Trending styles» (brat, REACTIVE, type, PHANTOM, FLIP, glitchdrop, muse, error, refract, ARCADE, handtorn, texts, daydream, doodle, afterglow, meter, sunny, DAZE, title card, stretch, HOLLOW, Drift, lofi, pop, Stylish, emo, cutout…; algunos «Creator», «Create» = Pro), «None», **color del texto** (hex).
6. **Settings**: Background Video Mode (Sequence) + Switch Interval (5 s); Slight Variations; **Cinematic Crop** 0–100 % (barras negras); **Background Dim** (30 % por defecto); Text Shake; Blend text with video; **Filters** (Midnight, Super 8, Noir, Vaporwave); **Text Size** 1.00× (Small · Default · Large); **Hook Text** (off); Background Video Fit (por paquete).
7. **Vista previa** (derecha, 9:16): «Drag the lyrics to reposition», aviso «Live preview is approximate — your export will be pixel-perfect», reproducir/volumen/barra/bucle/reiniciar/barajar, **deslizador vertical CROP**, tiempo 00:00 / 01:00.
8. **Barra de exportación**: nombre de archivo (editable), «Free exports include a watermark», **Export Video**, **720p** (gratis) / **1080p** (de pago), **Batch** (de pago), contador «0 / 3 (3 left)».

## F02 · Resultado que quiere el usuario (captura)
Fotograma vertical con **banda de vídeo cálida a media altura** y **texto blanco grande, minúsculas, sans regular, con huecos anchos entre palabras, 2 líneas, alineado a la izquierda**, que cruza la banda («om night to / ay makes me»). Es el look «New York on Tape / Archivo analógico» ya medido en `docs/LYRIC_LOOKS.md`.

## F03 · Resto de pantallas
- **Library** (`/library`): pestañas My Videos · My Songs · Hook Packs · Media Packs · Text Styles · Artwork; buscador y «New Video»; vacío: «No videos yet · Generate Video».
- **Hooks**: «Create Hook Pack» (textos de gancho).
- **Schedule**: programar a TikTok (de pago: Creator 2 cuentas, Pro 5, Studio 15).
- **Style Studio** (`/style-studio`): Surprise me; Tipografía (fuente, peso, caja, espaciado, cursiva); Color (texto, palabra activa); Efectos (sombra, neón, trazo); **Degradado**; **Caja detrás del texto**; **Eco**; **Entrada** (tipo, dirección, curva, duración, **rotación**, animar por palabra/línea, **orden y hueco de escalonado**, **capas de animación 2/6** con opacidad/mover desde-hasta/duración/retardo/curva); **Salida**; **Reposo/activa** (pulso de palabra activa, transición de color activa 200 ms, tratamiento, flotar, **capas de bucle 0/4**); **Caos** (rotación aleatoria ±°, **vibración de línea base ±px**, **ciclo de paleta**); Layout (posición); «Save this style» (**0/20**); fondos de prueba (Blanco, Negro, Degradado oscuro, Bosque, Cascada, Atardecer).
- **Cuota y planes**: Free = 3 exportaciones, marca de agua, 720p; de pago = auto-sync, 1080p, Batch, Schedule, estilos «Creator/Pro». Una canción admite varias generaciones (variantes/Batch) mientras queden exportaciones.
- **Descarga**: tras exportar el vídeo aparece en My Videos (descarga MP4).

## Diferencias frente a Ráfaga (a cerrar)
| LyricTune | Ráfaga hoy | Acción |
|---|---|---|
| Recorte de la canción a 60 s con onda, ±0,5 s, «Hear ending» | `RangePicker` con onda | Añadir ±0,5 s y «Hear ending» si faltan |
| Hold-to-Sync + auto-sync de pago | Auto-sync + `TapSync` (pulsar/mantener) | Teclas 1–4 (velocidad) y Retroceso (deshacer) en `TapSync` |
| Exportar con 720p/1080p y nombre de archivo | Sin selector de resolución en la pantalla | Selector 720p/1080p + nombre |
| «Fine-tune timing», «Edit», «Re-sync» en el panel de letra | `LyricSyncEditor` | Revisar accesos |
| Style Studio: rotación, escalonado, capas de animación/bucle, vibración, ciclo de paleta, transición de color activa | Parcial (degradado, eco, dirección, curva, salida, reposo, caos) | Añadir rotación, escalonado y vibración de línea base |
| Pestañas Video/Photo y paquetes con descripción | Colecciones + packs de medios | Mostrar descripción del paquete |
| Cuotas y marca de agua | No aplica (app privada, sin marca de agua) | No se replica |
| 19 paquetes de vídeo (derechos de terceros) | Colecciones propias | No clonable |

## Cerrado en esta pasada (2026-11-15)
- Motor y editor de estilo: rotación de entrada, escalonado (hueco y orden), vibración de línea base y ciclo de paleta (con prueba de escena ↔ ASS).
- Recorte de la canción: «Escuchar el final» y ajuste fino ±0,5 s en inicio y final.
- Ya existían: Hold-to-Sync con Retroceso y velocidad, auto-sync gratis, 720p/1080p, variantes por canción, descarga/ZIP, colecciones.
- Pendiente de prueba real: sincronizar y exportar con la **letra real** de la canción cargada (no está en el repositorio).
