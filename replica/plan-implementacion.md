# Plan de implementación para la paridad con OpusClip y Escalium · 2026-11-23

Este plan **no inicia ninguna reescritura, despliegue ni migración de producción**. Se basa en `replica/matriz-paridad.csv` (63 filas), `replica/informe-fallos.md` y los inventarios. Commit auditado: `7dd21b3`.

## 0. Resultado de la auditoría en una tabla
| Estado | Filas | Qué significa |
|---|---|---|
| Verificada | 2 | Recorrido normal completo y criterio cumplido (almacenamiento y uso; filtros de cámara con ffmpeg real) |
| Parcial | 16 | Existe pero falta una parte, o solo se verificó una parte |
| Falla | 3 | Reproducido roto hoy (procesamiento parado, medidor, transcripción con etiqueta de sonido) |
| Falta | 12 | No existe (o decisión de producto de no construirlo) |
| Pendiente de verificar | 30 | La pantalla o el código existen; no se completó el recorrido real hoy |

**Puntuación de paridad** (`replica-diff`, pesos must 3 / should 2 / could 1):
- **Acreditada (solo lo verificado + mitades de lo parcial): 15,2 / 100; 0 de 26 imprescindibles verificados.**
- **Declarada (si las 30 pendientes funcionaran): 67,7 / 100; 17 de 26 imprescindibles cumplidos.**

La diferencia es la cantidad de trabajo **sin evidencia**, no necesariamente roto. La causa principal es B-09: el procesamiento está parado hasta el 1 de diciembre, así que hoy no se puede completar casi ningún recorrido. Veredicto: **no entregable** (replica-diff: faltan imprescindibles y hay un S1 abierto).

## 1. Cómo se leyeron los referentes
- **OpusClip** (plan Free): recorrido de solo lectura de Inicio, Mis proyectos, resultados de un proyecto de demostración, ventana de clip, ajustes de receta (modelo, duración, tipo, encargo, subtítulos, hook, titular, B-roll, limpieza de voz, efectos, traducción), calendario, analítica, cuentas, kit de marca/biblioteca y planes. Bloqueado por plan: editor, kit de marca, 4K. Ejecutado con autorización (2026-11-23): subida de un archivo propio de 100 s y procesamiento (1 crédito). Bloqueado por autorización: conectar cuentas, crear recetas, descargar o publicar.
- **Escalium** (plan Gratis): editor (paso 1), vídeos creados, Autoclip, editor avanzado, Publicar, Landing Pages. Ejecutado con autorización: paso 1–3 con una canción propia y Autoclip con un vídeo propio. Render (paso 4): bloqueado por autorización específica (gasta uno de los 5 vídeos gratis de un solo uso). Analíticas y Cuenta: no abiertas de forma fiable.
- **Condiciones de uso:** se actuó como usuario normal, a ritmo humano, sin automatización masiva, sin cargas, sin leer código ni llamadas internas, y solo se describe el comportamiento (no se copian textos, recursos ni estilos).
- **Lo que piden y critican los usuarios** (`replica-entrepreneur`, **muestra pequeña**): para OpusClip, en [Trustpilot](https://www.trustpilot.com/review/opus.pro) y en un [resumen de un competidor](https://ssemble.com/blog/opus-clip-review-2026) aparecen quejas de fallos de procesamiento, clips mal elegidos, errores en subtítulos, mecánica de créditos y cancelaciones; se elogia el soporte y el ahorro de tiempo. En [Product Hunt](https://www.producthunt.com/posts/916352) se pide más control sobre subtítulos y plantillas. Se leyeron resúmenes de búsqueda, no 100 reseñas con cita literal: **todos los temas son «delgados»** y no se citan textualmente. Para Escalium **no se encontraron reseñas**. Conclusión usable: la fiabilidad, la exactitud de la selección, los subtítulos y la transparencia de créditos son los puntos donde un competidor puede diferenciarse; coincide con las brechas de Ráfaga.

## 2. Dónde vive hoy la lógica (y qué se puede unificar)
| Capa | Qué hay | Propuesta |
|---|---|---|
| **Interfaz y API** | Next.js App Router + TypeScript en `apps/web` (rutas `app/api/**`, `lib/routes/*`) | Se mantiene. Es lo pedido. |
| **Lógica de producto** | Paquetes TypeScript: `composition` (motor único vista previa=exportación), `selection`, `lyrics`, `providers` | Se mantiene. Un solo motor. |
| **Procesamiento pesado** | Worker Node/TypeScript (`workers/media/src/stages/*`) que llama a FFmpeg fuera de la petición | Ya es Node/TS. Se mantiene. |
| **Python** | `workers/modal/app.py` (envoltorio de Modal: despertar, barrido, purga) y `workers/media/py/faces.py` (detección de caras con OpenCV) | `app.py` desaparece si se cambia de alojamiento del worker; `faces.py` es el único Python con lógica: se sustituye solo si se mide que un detector en Node (p. ej. ONNX) iguala la precisión en el corpus C3. Mientras tanto se aísla. |
| **SQL** | 118 migraciones: RLS, libro de unidades (`_ledger_write`), `request_*`, `claim_stage`, `zernio_event`, `compute_meter` | Se mantiene en SQL lo que necesita atomicidad y seguridad (permisos, cobros, colas). No se traslada a TypeScript. |
| **Adaptadores externos** | Supabase, R2, Modal, Vercel, Groq, ASR, TikTok (OAuth y Zernio), Google/Dropbox | Cada uno detrás de `packages/providers`; añadir sondas de salud por proveedor. |

### Servicios que podrían retirarse (decisión con medidas, no ahora)
| Servicio | Estado | Criterio para retirarlo | Medida necesaria |
|---|---|---|---|
| Modal (procesamiento) | Crédito de 1 USD/mes agotado por el coste fijo del barrido (0,99 USD «Deployed apps») | Si tras la migración 118 (barrido por `pg_cron`, espera de 15 s) el coste por vídeo cabe en el crédito, se queda; si no, probar el mismo worker en un contenedor gratuito o de bajo coste | Coste por vídeo y por minuto de fuente (`ai_usage`) durante 7 días con corpus C2/C3; tiempo hasta el primer clip; tasa de fallo |
| Cron de Modal (`sweeper`, `keep_alive`) | 14.400 arranques/mes estimados | Retirar el barrido de 3 min (hecho en código, sin desplegar) | Contar arranques tras el despliegue |
| GitHub Actions (worker heredado v1) | Prohibido procesar medios de usuarios por sus términos | Retirar `worker.yml` cuando no queden tipos v1 | Cero trabajos `engine = 'v1'` durante 30 días |
| ASR externo (Deepgram según `docs/STATUS.md`) | En uso para transcripción | Sustituir por una opción gratuita solo si la precisión en C2/C4/C6 es equivalente | WER en el corpus, palabras mal sincronizadas |
| Zernio | Implementado, sin desplegar | Solo se mantiene si Direct Post sigue sin aprobarse | Resultado de la revisión de TikTok |

## 3. Entregas (cada una completa, con prueba y vuelta atrás)
Todas usan Next.js App Router + TypeScript y los componentes de `apps/web/components/ui/`. Ninguna añade dependencias salvo E8 (requiere aprobación del propietario: la regla del repositorio prohíbe dependencias nuevas).

### E0 · Desbloquear y medir (prerrequisito)
- **Qué:** reiniciar el crédito de Modal (1 de diciembre) o decidir otro alojamiento; construir el corpus C1–C7 en `.fixtures/corpus/` con ficha de cada archivo; ejecutar los recorridos imprescindibles de la matriz.
- **Rutas/componentes:** ninguno nuevo; guion `scripts/parity-run.ts` (nuevo) que registra tiempos y resultados en `replica/resultados/*.json`.
- **Aceptación:** los 25 imprescindibles pasan de «pendiente» a «verificada» o «falla», con evidencia; tiempo hasta el primer clip y del lote con n ≥ 20.
- **Revertir:** solo añade archivos de prueba.

### E1 · Medidor de coste real y aviso temprano (B-01, B-09)
- **Qué:** aplicar la migración 118; que `compute_meter()` incluya el coste fijo de las funciones programadas (estimación por arranques × tarifa) o lea el uso real; aviso en `/app/uso` y en Analítica al 70 % y al 90 %; corregir `CLAUDE.md` («30 USD» → «1 USD»).
- **Rutas:** `supabase/migrations/…118`, `app/app/uso/page.tsx`, `lib/*meter*`.
- **Aceptación:** tras 7 días, la cifra de `/app/uso` difiere ≤10 % de la de Modal; el aviso se muestra en una prueba con presupuesto simulado; ningún corte sin aviso.
- **Revertir:** `git revert` del commit; la migración es aditiva (la configuración puede volver a su valor anterior).

### E2 · Pantallas que dicen la verdad y descarga real (B-02, B-03, B-04)
- **Qué:** Conexiones y Inicio leen el estado real (TikTok conectado, importación de Drive habilitada o no); «Descargar» fuerza descarga (`response-content-disposition: attachment; filename=…` en la URL firmada); «Publicar en redes» también en Exportados.
- **Rutas/componentes:** `app/app/conexiones/page.tsx`, `app/app/page.tsx`, `app/app/exports/page.tsx`, `lib/r2url.ts`, `api/exports/[...slug]`.
- **Aceptación:** prueba e2e: pulsar «Descargar» dispara una descarga `.mp4`; `ffprobe` del archivo = H.264/AAC, 720×1280, duración ± 1 fotograma; Conexiones y `/app/tiktok` muestran el mismo número de cuentas.
- **Revertir:** `git revert`; sin cambios de datos.

### E3 · Subtítulos limpios (B-05, CLP-08)
- **Qué:** filtrar etiquetas de sonido del ASR («Música», «[aplausos]») en la etapa de transcripción y marcarlas como «no hablado» (visibles en la transcripción, nunca en subtítulos); prueba con el corpus C6.
- **Rutas:** `workers/media/src/stages/analysis.ts`, `packages/composition` (subtítulos).
- **Aceptación:** exportación de C6 sin ninguna etiqueta de sonido en pantalla (revisión de 3 fotogramas + búsqueda en el `.ass`); sincronía ≤1 fotograma frente a la vista previa.
- **Revertir:** `git revert`; los proyectos antiguos se reprocesan solo si el usuario lo pide (regla: no reprocesar históricos).

### E4 · Control de la selección (CLP-03/04/05/06)
- **Qué:** selector de rangos de duración (<30, 30–59, 60–89, 90 s–3 min); chips de tipo de contenido; desglose de puntuación en 4 criterios (gancho, fluidez, valor, tendencia) con motivo; número solicitado y explicación en `generations.warnings`.
- **Rutas:** `packages/selection`, `app/app/director`, `app/app/p/[id]`, `app/app/c/[id]`, migración aditiva si hace falta guardar el desglose.
- **Aceptación:** con C2 pidiendo 30–59 s ×5, ≥90 % de los clips caen en el rango; el desglose es visible en tarjeta y editor; revisión ciega con un corpus de 10 clips por herramienta y rúbrica 0–2 (se entiende solo, arranca bien, termina completo).
- **Revertir:** `git revert`; campos nuevos opcionales.

### E5 · Limpieza de voz y efectos automáticos (EDI-08/09)
- **Qué:** quitar pausas y muletillas (detección de silencio + palabras de relleno), mejora de audio (reducción de ruido + normalización), zoom y transiciones automáticos y corrección de color básica, con interruptores en `CreationPanel` (hoy «próximamente»).
- **Rutas:** `workers/media/src/stages/compose.ts`, `packages/composition/cuts.ts`, `components/CreationPanel.tsx`.
- **Aceptación:** en C6 las muletillas bajan ≥80 % (conteo en la transcripción antes/después); duración y sincronía correctas (`ffprobe`); sin saltos de audio audibles en 3 puntos de corte.
- **Revertir:** interruptores desactivables por defecto.

### E6 · Publicación pública en TikTok (EXP-08/10)
- **Qué:** desplegar la ruta de Zernio (ya implementada) o esperar Direct Post; prueba real con un clip aprobado por cuenta.
- **Aceptación y revertir:** ver `docs/ZERNIO.md`; el enlace abre sin sesión y pertenece al `@usuario` previsto; Zernio muestra dos conexiones y ningún cargo.

### E7 · Lyric Studio: lo que Escalium tiene y Ráfaga no (EDI-05/06/15/18)
- **Qué:** llamada a la acción final, título fijo y velocidad de vista previa; (opcional) «vídeo desde enlace» solo si se decide descargar de fuentes permitidas.
- **Rutas:** `packages/composition/lyricscene.ts`, `components/LyricSettings.tsx`, `LyricPreview.tsx`.
- **Aceptación:** exportación con CTA/título comprobada por fotograma (≤1 fotograma entre vista previa y exportación) y `ffprobe`.
- **Revertir:** valores por defecto desactivados.

### E8 · Pruebas de extremo a extremo y accesibilidad
- **Qué:** suite `e2e/` con Playwright (`replica-test`): un guion por flujo, fallo ante errores de consola y respuestas 5xx, escaneo axe por pantalla, pasada móvil 390×844.
- **Dependencias nuevas (requiere aprobación):** `@playwright/test`, `@axe-core/playwright` como devDependencies.
- **Aceptación:** 0 violaciones graves/críticas de axe en Inicio, Proyectos, Proyecto, Editor, Lyric Studio, Calendario, Exportados, Uso; todos los flujos pasan en local con datos de siembra.
- **Revertir:** carpeta `e2e/` y devDependencies independientes.

## 4. Criterio de cierre
La paridad se da por alcanzada solo cuando: (1) los **26 imprescindibles** de la matriz están **verificados** por su recorrido normal; (2) **cero fallos S1/S2 abiertos**; (3) cada capacidad pendiente tiene identificada la evidencia que le falta; (4) `pnpm test`, typecheck y build están en verde; (5) se repitió una muestra para medir variación; (6) el informe se actualiza con el commit probado.

## 5. Las cinco mejoras de mayor impacto (en orden) y cómo se demostrarán
1. **Procesamiento fiable y coste visible (E0 + E1).** Hoy no se puede crear ningún clip nuevo (B-09) y el medidor no avisa (B-01). *Prueba:* tras 7 días el medidor difiere ≤10 % del panel de Modal, el aviso del 70 % se dispara en prueba, y se publican tiempo hasta el primer clip y del lote con n ≥ 20.
2. **Publicar en abierto en TikTok sin pasar por el móvil (E6).** Es lo que el usuario pidió y lo que Escalium ya ofrece. *Prueba:* dos clips programados desde Ráfaga, dos enlaces públicos que se abren sin sesión en el `@usuario` previsto, sin confirmación en el móvil y sin cargos en Zernio.
3. **Control y explicación de la selección de clips (E4).** Es el núcleo de OpusClip (rangos de duración, tipo, desglose de puntuación). *Prueba:* ≥90 % de los clips pedidos en el rango, desglose visible, y revisión ciega frente al referente con la rúbrica «se entiende solo / arranca bien / termina completo».
4. **Subtítulos sin errores y voz limpia (E3 + E5).** Los subtítulos y la limpieza son lo que más se critica de los referentes. *Prueba:* C6 sin etiquetas de sonido, muletillas −80 %, sincronía ≤1 fotograma entre vista previa y exportación comprobada con `ffprobe` y fotogramas.
5. **Pantallas honestas, descarga real y pruebas e2e (E2 + E8).** Quita la confusión (Conexiones, Inicio, Descargar) y evita regresiones. *Prueba:* e2e verde con descarga `.mp4` verificada por `ffprobe`, 0 violaciones graves de axe y una pasada móvil.

## 6. Qué necesito del propietario para cerrar la verificación
- Autorización por acción concreta para: subir los archivos del corpus a OpusClip y Escalium (gasta créditos y cuota), conectar una cuenta social de prueba en cada referente, y crear una receta de prueba en OpusClip.
- Una decisión sobre las dependencias de E8.
- Crédito de Modal disponible (1 de diciembre) o alojamiento alternativo para ejecutar E0.
