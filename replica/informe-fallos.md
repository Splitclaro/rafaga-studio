# Informe de fallos, formatos y rendimiento · 2026-11-23

Commit de Ráfaga auditado: `7dd21b3` (desplegado en Vercel; el worker de Modal en producción es anterior al 2026-11-16 porque `modal deploy` falló por límite de gasto). Entorno: producción (`https://rafaga-studio.vercel.app`) con la sesión del propietario, solo lectura, más pruebas locales.

Severidad (replica-test): **S1** pérdida de datos, seguridad, núcleo bloqueado · **S2** función rota sin alternativa · **S3** rota con alternativa o visiblemente mal · **S4** cosmético. Solo se listan fallos **reproducidos hoy**. Lo no comprobado va en «Para comprobar».

## Fallos reproducidos

### B-09 · S1 · El procesamiento está parado: Modal sin cuota
- **Pasos:** Modal → Settings → Usage & billing (workspace `splitclaro`); lanzar `modal deploy workers/modal/app.py`.
- **Esperado:** crédito disponible; el despliegue termina.
- **Real:** plan Starter con **1,00 USD** de crédito mensual, 1,00 USD usado (0,99 «Deployed apps»), cargo real 0,00 USD; el despliegue falla con «reaching billing cycle spend limit». Sin cuota Modal no ejecuta etapas hasta el 1 de diciembre.
- **Impacto:** el recorrido central (subir → clips → exportar) no se puede completar; impide verificar casi toda la matriz.
- **Evidencia:** `replica/evidencia/modal-01-facturacion.jpg`; `docs/MODAL_COSTE.md`.
- **Estado:** medidas preparadas en la migración 118 y en `app.py` (sin aplicar/desplegar).

### B-01 · S2 · El medidor interno de cómputo no refleja el gasto real
- **Pasos:** abrir `/app/uso`; comparar con el panel de Modal.
- **Esperado:** el medidor se acerca al 100 % cuando Modal lo hace.
- **Real:** `/app/uso` muestra «0.04 USD de 1 USD (4.4 %)» mientras Modal marca 1,00 USD de 1,00 USD. El medidor solo suma el cómputo de las etapas (`ai_usage`) y no el coste fijo de las funciones programadas (`sweeper` cada 3 min).
- **Impacto:** el usuario no recibe aviso antes del corte, y `compute_meter()` nunca bloquea a tiempo.
- **Arreglo propuesto:** ver entrega E1 del plan.

### B-02 · S3 · La página Conexiones contradice lo que ya existe
- **Pasos:** abrir `/app/conexiones` y luego `/app/tiktok`.
- **Real:** Conexiones dice «Hoy publicas descargando tus clips; la publicación directa llegará…», marca TikTok como «No configurado · Conectar (próximamente)» y «Publicación directa: 0», y Drive/Dropbox como «importación próximamente». En `/app/tiktok` hay 2 cuentas conectadas y el calendario programa borradores.
- **Impacto:** confusión sobre qué funciona; el propietario no puede fiarse de la pantalla.

### B-03 · S3 · Inicio ofrece Drive y a la vez dice «Próximamente»
- **Pasos:** abrir `/app`.
- **Real:** botón «Google Drive» junto a la tarjeta «Importar desde Drive o Dropbox · Próximamente»; igual con Twitch.
- **Impacto:** no queda claro si se puede importar.

### B-04 · S3 · «Descargar» no descarga: abre el MP4 en una pestaña
- **Pasos:** `/app/exports` → «Descargar» en la fila #3 (7,1 MB).
- **Esperado:** se guarda el archivo con nombre legible.
- **Real:** se abre una pestaña con una URL firmada de R2 que reproduce el vídeo; no se guarda nada. Además la fila solo ofrece «Publicar en YouTube»; no hay «Publicar en TikTok».
- **Comprobado en esa pestaña:** 720×1280, 46 s, con audio (metadatos del reproductor).
- **Impacto:** el usuario tiene que guardar manualmente; impide `ffprobe` del archivo descargado (ver EXP-01).

### B-05 · S3 · Una etiqueta de sonido del ASR se pinta como subtítulo
- **Pasos:** proyecto `vlog_toledo_small` → Editar el clip → vista previa en 0:00 → pestaña Transcripción.
- **Esperado:** las etiquetas de sonido («Música», «aplausos») no se muestran como texto hablado.
- **Real:** la primera «palabra» es «Música» y se dibuja en el centro de la vista previa.
- **Impacto:** subtítulo basura en el vídeo exportado; afecta a calidad de subtítulos.

### B-07 · S4 · Enlaces duplicados en la lista de proyectos
- **Pasos:** `/app/proyectos`; inspeccionar los enlaces `/app/p/…`.
- **Real:** cada proyecto tiene dos enlaces al mismo destino (estado + título).
- **Impacto:** un lector de pantalla lo anuncia dos veces.

## Para comprobar (no reproducido; no se afirma como fallo)
- **Calidad de selección:** proyecto de 1,5 min → 1 clip de 1:17 (≈85 % de la fuente) con encaje 49/100 («Sin encargo: no se mide la afinidad»). Sin una referencia de lo que debería haber salido no se puede calificar; requiere el corpus (más abajo) y un criterio por momento.
- **Pasada móvil (390×844), solo teclado, lector de pantalla y axe:** no ejecutadas.
- **Sesión caducada, doble clic en acciones con coste, cancelación en mitad de render, subida interrumpida, permisos con un segundo usuario real:** hay pruebas automáticas con bases de datos y red simuladas; no cuentan como recorrido real.
- **Analíticas y Cuenta de Escalium:** no abiertas de forma fiable.
- **Proyectos de prueba duplicados** («01-CRITIKA - CONTANDO DIAS» ×5 «Sin analizar»): datos de pruebas anteriores, no un fallo del producto.

## Formatos y archivos
| Formato | Estado | Evidencia |
|---|---|---|
| Entrada de audio (Lyric): MP3, WAV, M4A, AAC, FLAC, OGG, ≤60 MB y 10 min | Declarado en la UI; subida real no repetida hoy | `/app/lyric-studio` texto de la zona de subida |
| Entrada de vídeo largo | Declarado por la subida; límites no observados hoy | Pendiente |
| Salida MP4 H.264/AAC 9:16 720×1280 | Observado (reproductor): 720×1280, 46 s, audio | Pestaña de la exportación #3 |
| Salida 1:1, 4:5, 16:9, 1080p | Probado con ffmpeg real en pruebas automáticas (12 combinaciones layout×ratio; 4 filtros) | `workers/media/src/*.test.ts` |
| ZIP, SRT/VTT/TXT | Prueba automática de ZIP válido (`unzip -t`) | Sin recorrido real |
| XML para editores (FCP7 xmeml) | Implementado (`lib/nle.ts`); importación en Premiere/DaVinci sin probar | Pendiente |

## Rendimiento (Ráfaga; los referentes no se midieron: exigiría subir archivos y gastar créditos)
| Métrica | p50 | p95 | n | Fuente |
|---|---|---|---|---|
| Espera en cola | 9,7 s | **36,7 min** | 59 | `/app/analitica` (producción, histórico incl. etapa GitHub Actions) |
| Proceso completo | 23,6 s | 2,7 min | 57 | idem |
| Transcripción (ASR) | 0,7 s | 3,3 s | 12 (insuficiente) | idem |
| Selección de momentos | 4,6 s | 1,8 min | 13 (insuficiente) | idem |
| **Tiempo hasta el primer clip** | 25,8 s | 2,8 min | 12 (insuficiente) | idem |
| Lote de clips completo | 28,9 s | 5,0 min | 15 (insuficiente) | idem |
| Tasa de fallo | 3,4 % (2 de 59, «error temporal, agotó reintentos») | | 59 | idem |
| `perf-run --quick` local: análisis | 90,7 s | 105,3 s | 2 | `node scripts/perf-run.ts --quick` |
| `perf-run --quick` local: primer clip | 73,9 s | 73,9 s | 2 | idem |
| `perf-run --quick` local: render | 6,1 s | 9,1 s | 2 | idem |

Con menos de 20 muestras los percentiles no son representativos. Sin medida de variación en Ráfaga.

### Referentes con el mismo archivo propio (`podcast-prueba.mp4`, 100 s) · 2026-11-23, una muestra cada uno
| Herramienta | Tiempo hasta clips | Clips | Cobertura de la fuente | Notas |
|---|---|---|---|---|
| OpusClip (Free, 1 crédito) | **10 min 26 s – 11 min 31 s** (96 % a los 10 min 26 s; «ready» observado a los 11 min 31 s) | 2 (0:44 y 0:55) | ~98 % | Títulos en inglés con audio en español; errores de transcripción en el texto |
| Escalium Autoclip (modo rápido) | análisis **0:08**; resultados a ~20 s del clic | 3 (0:26, 0:44, 0:24) | ~94 % | Puntuaciones 100/71/58 con motivos; errores en alguna cita |
| Ráfaga | **no medido hoy** (Modal sin cuota); histórico de producción p50 25,8 s, p95 2,8 min (n=12) | — | — | Debe repetirse sobre el mismo archivo (CLP-15) |

### Referentes con «cap 1.mp4» (Serie Export, Flow Nene EP) · 2026-11-23, una muestra cada uno
Archivo del propietario: 199 MB, 1920×1080, 24 fps, 2:16, dos pistas de audio mono; vídeo animado con rap. Se usó una **copia de prueba de 8 MB (360p, 24 fps, audio de las dos pistas mezclado)** `.fixtures/cap1-proxy360.mp4`, porque la herramienta de subida del navegador no admite más de 10 MB. El original no se tocó.
| Herramienta | Tiempo hasta clips | Clips | Notas |
|---|---|---|---|
| OpusClip (Free, 2 créditos: 55→53) | **10 min 0 s – 11 min 8 s** (creado 14:08:09; «ready» observado 14:19:17) | 6 (0:22, 0:17, 1:23, 0:23, 0:18, 0:51) | Títulos y rótulo superpuesto **en español**; suman 3:34 sobre una fuente de 2:16: **los clips se solapan** (p. ej. uno de 1:23). Cuadro «Remove watermark» (plan de pago) |
| Escalium Autoclip (modo rápido) | análisis **0:21**; resultados a ~30 s del clic | 3 (0:29, 0:32, 0:30; total 1:32 = 68 %) | Puntuaciones 100/72/62 con etiquetas («Gancho fuerte: el secreto», «Pico de energía», «Termina en remate»); citas con errores típicos de letra rapeada («popa», «Activa») |
| Ráfaga | no medido (Modal sin cuota) | — | Pendiente de repetir con este archivo (CLP-15) |

Lectura prudente: con una sola muestra y un archivo corto de dos temas, ambos referentes devuelven casi toda la fuente (como Ráfaga con su proyecto de 1,5 min); no permite concluir sobre calidad de selección. Sí muestra que la diferencia de tiempo entre un análisis en el equipo (segundos) y uno en cola gratuita (minutos) es de dos órdenes de magnitud.

## Pruebas automáticas (HEAD `7dd21b3`)
`pnpm test`: 565 pruebas, 563 pasan, 0 fallan, 2 omitidas · `pnpm --filter @rafaga/web typecheck`: sin errores · `pnpm --filter @rafaga/web build`: sin errores. Las pruebas usan bases de datos y red simuladas: **no acreditan** recorridos reales.

## Corpus de pruebas reutilizable (por construir; ninguno se ha generado hoy)
| ID | Contenido | Para qué |
|---|---|---|
| C1 | Vídeo vertical de 45 s, una voz, ES | Subida, transcripción, exportación 9:16 |
| C2 | Horizontal de 5 min, una voz, ES, audio limpio | Tiempo al primer clip, calidad de selección |
| C3 | Horizontal de 30 min, dos voces, ES | Reencuadre por hablante, lote |
| C4 | Horizontal de 5 min, una voz, EN | Idiomas, traducción |
| C5 | Canción de 2–3 min con letra conocida (propia) | Lyric Studio y sincronía palabra a palabra |
| C6 | Vídeo de 5 min con ruido, música de fondo y muletillas | Etiquetas de sonido (B-05), limpieza de voz |
| C7 | Archivos inválidos (.txt renombrado a .mp4, MP4 truncado) | Casos negativos |
Los vídeos deben ser propios o autorizados. Para cada prueba se registrará archivo, versión de Ráfaga, configuración y pasos.
