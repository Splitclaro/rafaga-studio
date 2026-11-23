# Inventario Escalium · 2026-11-23

Cuenta del propietario, plan **Gratis**, recorrido manual de solo lectura. Sin subir archivos, sin renderizar (gasta cuota), sin conectar cuentas de TikTok. Ver también `replica/escalium/recon.md` (estudio del 2026-11-16, con el vídeo tutorial).

**Códigos:** **V** visto hoy · **D** documentación o texto público · **B** bloqueado por plan o permiso · **P** estudio previo no repetido hoy.

## Pantallas

| ID | Pantalla (ruta) | Qué hay | Ev. |
|---|---|---|---|
| ESC-S01 | Editor de vídeos `/dashboard/create/video-editor` | Barra de 4 pasos (Audio · Letras · Estilo · Renderizar); aviso «Exportación en tu dispositivo»; contador de cuota (0:05); «Vídeos creados» y «Tutorial». Paso 1: zona de arrastre — canción MP3/WAV/FLAC/M4A/OGG **máx. 50 MB** o vídeo MP4/MOV/WEBM **máx. 2 GB**; «Puedes soltar varios a la vez: cada uno será su propio vídeo». | V |
| ESC-S02 | Pasos 2–4 del editor (letras, estilo, render) | Waveform y recorte (máx. 30 s en Gratis), transcripción con palabras editables, ~40 estilos, fondos (biblioteca de 322 vídeos + propios), ajustes avanzados, «Crear vídeo», cuota 5 vídeos/mes. | P |
| ESC-S03 | Vídeos creados `/create/video-editor/videos` | Pestañas: Editor de vídeo básico / Editor de vídeo avanzado / En progreso; «Vídeos renderizados»; aviso **«Todo lo que ves aquí se guarda 14 días»**; «Nuevo vídeo». | V |
| ESC-S04 | Autoclip `/dashboard/autoclip` | «De largo a corto»; 3 pasos (Subir · Analizar · Elegir tus clips); **MP4, MOV, MKV o WebM hasta 3 horas**; ganchos, preguntas y respuestas, historias, risas y picos de energía **ordenados y con sus motivos**; 9:16 alrededor de quien habla, subtítulos, sin pausas ni «ehh»; **el vídeo no se sube** (se lee en el equipo), sin créditos; el modo rápido solo envía el audio para transcribir. | V |
| ESC-S05 | Editor de vídeo avanzado `creators.escalium.io/dashboard/video-editor-advanced` | «Tus proyectos»; nuevo proyecto: Vertical 9:16 · Horizontal 16:9 · **De largo a corto** · **Vídeo desde un enlace** (tu canción + un enlace de YouTube: los mejores planos al ritmo); «Nueva carpeta»; «Abrir archivo de proyecto»; clic derecho para crear proyectos y carpetas; arrastrar a carpetas; guardado en el dispositivo y en la cuenta. | V |
| ESC-S06 | Campañas → Publicar `/campaigns/publish` | «Programa tus vídeos y mira cómo funcionan»; «Añadir marca», «Añadir cuenta»; modal «Conecta tu primera cuenta» (solo **TikTok**, con «Conectar en una ventana privada»); promete seguir visualizaciones, likes y comentarios. Aviso «Ya puedes publicar en TikTok» (al momento o programado, también al terminar el vídeo). | V / B (conectar no ejecutado) |
| ESC-S07 | Campañas → Landing Pages | «Páginas alojadas para tus canciones», «Nueva Landing Page»; dominio propio desde el plan Artista. | V |
| ESC-S08 | Analíticas `/dashboard/analytics` | La URL redirige al editor; la sección existe en el menú pero no se pudo abrir de forma fiable. | Pendiente de verificar |
| ESC-S09 | Cuenta | Sección en el menú; no abierta. | Pendiente de verificar |
| ESC-S10 | Barra lateral | Crear (Editor de vídeos → Crear vídeo / Vídeos creados; Editor de vídeo avanzado; Autoclip; Transferir) · Campañas · Analíticas · Cuenta · Mejorar plan · Ayuda · modo claro/oscuro · idioma ES/EN. | V |

## Ajustes del editor (resumen del estudio previo, ESC-S02)
Estilos de letra (~40: Palabra resaltada por defecto, Palabra neón, Karaoke…), «cómo aparecen las palabras» (Automático, palabra a palabra, 2 o 3 a la vez, frase, oración), posición (arriba/centro/abajo), tamaño, tipo de letra, movimiento (flotar, latir, temblar, balancear), efectos de texto (borde, sombra, brillo, caja), efectos de cámara (VHS, cámara de noche, gran angular), llamada a la acción final (botón animado), título fijo, oscurecido del fondo (40 %), parte del clip usada, entrada/salida suaves del volumen, modelo de transcripción (Large V3 / ElevenLabs, 5 al mes) e idioma, «Ver en» TikTok/Reels/Shorts. **No re-verificado hoy.**

## Ejecución con archivos propios (autorizada el 2026-11-23)
**Editor de vídeos** con `01-CRITIKA - CONTANDO DIAS.mp3` (2:26, 2,9 MB):
- Paso 1 (visto): forma de onda con selección, ajuste fino (Inicio/Fin/Duración), **«Selección de canción limitada a 30 segundos según tu plan»**, velocidades **1× / 0,5× / 0,25×**, volumen, «Entrada y salida suaves» (al empezar / al terminar), modelo de transcripción (**Large V3 rápido incluido · ElevenLabs más preciso con canciones**), idioma (detección automática). **«Te quedan 5 de 5 vídeos gratis (de un solo uso, no se renuevan)»**: corrige el estudio previo, que decía 5 al mes.
- Paso 2: al pulsar «Continuar a letras» aparecieron las 3 líneas del tramo (30 s) en unos 15 s, sin errores visibles: «Estoy contando días para volver a verte y solo tengo miedo a que esa fecha no llegue. / Y dolerá ver que no estás. / Te esperaré en nuestro lugar a ver si algún día vuelvas.» Cada palabra editable; «Ajustar palabra por palabra»; vista de letra «Sincronización (simple)».
- **Guardado y reanudación:** aparece «Guardado en Vídeos creados» y al recargar la URL del proyecto se restauró en el paso 2 con la letra.
- Paso 3 (visto): pestañas «Vídeos de fondo» / «Editar estilo»; «Añade tu vídeo (máx 60 s, se queda en tu dispositivo)»; **biblioteca de 322 vídeos en 16 categorías** (re-verificado) con favoritos y paginación 1–10.
- **No se renderizó** (consume uno de los 5 vídeos de un solo uso): el paso 4 y la calidad de salida quedan sin evaluar.

**Autoclip** con `.fixtures/podcast-prueba.mp4` (100 s, modo rápido):
- Ajustes: duración 10–30 s / **15–60 s (defecto)** / 30–90 s / 60–180 s + rango personalizado; número de clips (Auto); idioma; modelo de transcripción («Modo rápido · servidores de Escalium»: solo el audio sale del equipo; desactivable para hacerlo todo en el equipo); «Analizar también la imagen»; interruptor «Podcast / multicámara».
- **Tiempo:** análisis **0:08** para 1:40 de vídeo; resultados visibles ~20 s tras pulsar «Buscar clips».
- **Resultado:** 3 clips (#1 0:04–0:30 puntuación 100; #2 0:55–1:39 puntuación 71 «Pico de energía»; #3 0:34–0:58 puntuación 58); duración total 1:34 de 1:40 (~94 % de la fuente); cada clip con cita, etiquetas («Palabras fuertes», «Lista / pasos»), inicio/final editables con ± y «Por qué este clip»; gráfico «Interés a lo largo del vídeo»; encuadre Original / Rellenar / Ajustar; interruptores Subtítulos y «Quitar pausas y ehh»; «Seleccionar todos» y «Abrir en el editor». Las citas contienen errores de transcripción en este audio (p. ej. «Que ando entiens el problema»). Plan gratis: los clips descargados llevan marca de agua.
- **No se descargó ni se publicó nada.**

## Lo que queda sin ver
- Paso 4 y calidad de salida: renderizar gasta uno de los 5 vídeos gratis de un solo uso; pendiente de una autorización específica.
- Publicar en TikTok: conectar la cuenta (autorización de terceros).
- Transferir, Analíticas, Cuenta: sin abrir de forma fiable hoy.
