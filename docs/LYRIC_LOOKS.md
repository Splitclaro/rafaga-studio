# Looks de videolyric — medidas de referencia y decisiones (2026-11-10)

Referencias: los tres ejemplos de «Real results from real artists» en lyrictune.app (TikTok). Se reprodujeron en el navegador
sin iniciar sesión (cookies opcionales rechazadas; el diálogo de login se ocultó solo en local). Se midieron los metadatos del
`<video>` (resolución real del archivo, no la tarjeta de la web) y se extrajeron fotogramas en 6 instantes por vídeo
(principio, intermedios, cambios de frase y final) dibujándolos en un lienzo gris para distinguir el negro del propio archivo.
No se descargó ni se reutiliza su metraje, su música ni su letra.

| | A · Archivo analógico | B · Diario urbano | C · Cine panorámico |
|---|---|---|---|
| Archivo original | **966×720 (≈4:3)**, 15,2 s — NO es vertical | 720×1138 (≈0,63), 30,2 s | 720×1280 (9:16), 26,2 s |
| Rectángulo de imagen | lienzo completo | ancho completo, aspecto ≈1,25 (5:4), centro en 0,44 del alto | ancho completo, aspecto ≈2,3:1, centro en 0,38 del alto |
| Espacio negro | ninguno | arriba ≈18 %, abajo ≈31 % | arriba ≈26 %, abajo ≈49 % |
| Tratamiento | VHS: suavidad, grano, línea de cabeza arriba, tracking, color lavado | natural, escenas de metro/ciudad | moderado, cálido/desaturado |
| Texto | blanco, minúsculas, sans neo-grotesca regular; 1 línea | blanco, minúsculas, regular; hasta 2 líneas | blanco, minúsculas, peso medio/negrita; hasta 2 líneas |
| Posición | izquierda ≈0,17 del ancho, cerca del centro vertical (≈0,42) | izquierda ≈0,17, bloque centrado en la imagen | izquierda ≈0,12, en la mitad superior de la banda |
| Tamaño (em / alto de imagen) | ≈0,10–0,11 | ≈0,10 | ≈0,19 |
| Separación entre palabras | amplia y variable: 1,4–2,5 em | ≈1 em | 1–3,4 em |
| Flujo | palabra a palabra acumulativa; la frase se vacía y empieza otra | igual, se completan dos líneas | igual |
| Animación | corte duro observado (sin desplazamiento ni escala visibles en los fotogramas) | idem | idem |

Lo que **no** se pudo medir con certeza: la fuente exacta (parece Helvetica/Arial: se usa Liberation Sans, SIL OFL,
métricamente idéntica a Arial), la regla exacta de los huecos variables entre palabras (se implementa un hueco fijo
configurable: aproximación), fundidos de muy pocos frames (se ofrece «fundido de entrada» configurable, 0 por defecto) y si los
cambios de plano siguen el beat (nuestros cortes siguen cambios de frase de la letra o un intervalo; no se anuncian como «al beat»).

## Implementación (`packages/lyrics/src/looks.ts`)
- `LyricLook` versionado: lienzo, rectángulo de imagen (aspecto, centro, ancho, cover/contain, zoom, offset), texto (x, y, ancho,
  tamaño, peso, tracking, hueco, interlineado, líneas, alineación, caja, color, sombra), flujo (palabra/grupo/frase, retención,
  visibilidad mínima, fundidos), tratamiento (grano, suavidad, desaturación, dominante, aberración, inestabilidad, viñeta, brillo) y montaje.
- `layoutLyrics()` es la única fuente de verdad: páginas que caben en el bloque, posición fija por palabra (la entrada de una palabra
  no mueve las anteriores; el bloque se centra reservando las líneas de la página), tiempos reales de la alineación cuantizados al frame.
- Export: `layoutToAss()` (una línea ASS por palabra con `\an7\pos`, tiempos con floor al centisegundo → mismo frame que la vista previa)
  + `lookFfmpegArgs()` (lienzo de color, imagen contenida sin deformar, tratamiento, audio de la canción con limitador, H.264/AAC).
- Vista previa: `components/LookPreview.tsx` dibuja con el mismo layout y `frameState()`. El grano/aberración se aproximan en el navegador (rotulado).
- Variantes: `varyLook()` (posición/escala/encuadre dentro de límites, semilla) + montaje con semilla → sin copias idénticas.
- Sincronización manual: `components/TapSync.tsx` + RPC `save_manual_alignment` (clave = sha256 de la letra, igual que el worker). Tiene prioridad sobre la automática.

## Pruebas
- `packages/lyrics/src/looks.test.ts`: composición distinta de los tres looks, rectángulos, posiciones fijas, silencio sin letra,
  palabra sostenida, grupo/frase, tiempos ASS por frame (300 frames), montaje, overrides acotados y **render real con FFmpeg/libass**:
  la palabra 1 no aparece en el frame 14 y sí en el 15 (0,5 s), la 2 en el 30 (1,0 s), y no hay texto fuera de la caja prevista.
- `workers/media/src/looks-selftest.ts` (`gh workflow run worker.yml -f mode=looks-selftest`): métricas de Liberation Sans en Ubuntu
  vs. tabla, ASR real (Deepgram) + alineación en es/en con voz **sintética recitada**, render de los tres looks a 1080p (y 720p),
  fidelidad de frame en el worker, lote de 10 variantes con reparto y fotogramas distintos. MP4 como artefacto del workflow.

## Pendiente (no verificado)
- Canto real sobre instrumental en español e inglés: necesita canciones autorizadas del usuario (no hay en el repositorio).
- Comparación con el mismo audio/medios de la referencia: imposible por derechos; la comparación es de composición y movimiento.
