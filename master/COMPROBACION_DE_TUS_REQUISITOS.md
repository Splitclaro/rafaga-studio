# Revisión de cumplimiento del encargo — versión reforzada

Esta comprobación evalúa las **instrucciones entregadas a Claude Code**. La plataforma todavía debe construirse; sus funciones, velocidad y calidad se aceptan mediante las pruebas exigidas, no por esta revisión documental.

| Tu requisito | Instrucción incorporada | Cómo deberá acreditarlo Claude |
|---|---|---|
| Ir directo a generar la plataforma | Arranque directo: crear carpeta e inicializar código en la misma ejecución, plan breve y trabajo independiente mientras verifica accesos. No esperar una segunda orden. | Código ejecutable y primera ruta vídeo → brief → clip subtitulado → MP4; continuar hasta completar la beta. |
| Carpeta master con el encargo | Claude crea `master/` dentro del proyecto nuevo, copia los seis documentos completos y crea un CLAUDE.md de entrada en la raíz. | Nombres y hashes de origen/destino comprobados en `master/manifest.json`, sin mover originales ni copiar medios/secretos. |
| Proyecto nuevo bajo splitclaro | Carpeta nueva, repo público y proyectos nuevos en Vercel/Supabase; comprobar propietario y conservar manifiesto. Prohibido reutilizar el proyecto existente. | URLs, IDs, propietario y commit desplegado, sin secretos. |
| Resultado profesional, sencillo y dinámico | Diseño definido, una acción principal por pantalla, ajustes avanzados plegables, responsive y estados reales. | Revisión en cuatro tamaños, teclado, capturas reales y recorrido completo sin controles vacíos. |
| Funciones completas y persistencia | Importación, detección, editor, brand kit, versiones, exports, cuotas, automatizaciones, modo en vivo HLS y recuperación. | Pruebas de extremo a extremo desplegadas; guardar, cerrar y reabrir conserva el trabajo. |
| Proyectos completos | Fuentes de 30/60 min, diez clips, varias revisiones y prueba de tamaño acorde al límite declarado. | Archivos reales procesados, versiones correctas y descargas reproducibles; límites no probados señalados expresamente. |
| Tiempos rápidos y manejo de errores | Métricas por fase, primer clip antes del lote, caché por operación, objetivos de feedback/aceptación y benchmark. | Tiempos medidos; reintentos, cancelación y recuperación. Ningún fallo crítico/alto conocido abierto en el recorrido principal. |
| Subtítulos como máxima prioridad | Sección central con formato, agrupación, palabra activa, tiempos, correcciones, presets y flujo completo. | Comparación preview/export a un frame en fixture conocido, revisión audiovisual ES/EN, acentos y safe areas en tres ratios. |
| Detección de momentos y botón visible | «Detectar momentos virales» y «Volver a detectar», selección con gancho/cierre y explicación. Puntuación rotulada como estimación de IA. | Botones conectados a jobs reales; selección pertinente, sin duplicados ni fragmentos inventados. |
| Breve descripción del proyecto | Campo destacado de hasta 2.000 caracteres; objetivo, audiencia, tono y exclusiones derivados del texto. Brief versionado en cada generación. | Mismo vídeo con dos briefs produce selecciones pertinentes diferentes; exclusiones respetadas; brief sin coincidencias no genera relleno. |
| Cambiar enfoque sin repetir todo | Editar el brief y volver a detectar reutiliza transcript, mantiene clips editados/favoritos y crea otra generación. | Evidencias de nueva versión, ausencia de llamada ASR innecesaria y preservación del trabajo previo. |
| Beta enfocada en clips | Campañas remuneradas y comunidad excluidas por decisión del usuario. | La primera beta concentra diseño y recursos en creación/edición/automatización. |

## Recorrido principal que debe recibir el tester

1. Crear cuenta y abrir un proyecto.
2. Subir o importar una fuente autorizada.
3. Escribir brevemente qué trata el proyecto y qué quiere obtener, o elegir detección automática.
4. Pulsar **Detectar momentos virales**.
5. Revisar clips y la explicación de cómo encajan con su objetivo.
6. Elegir preset de subtítulos, corregir texto/tiempos y ajustar encuadre.
7. Guardar y exportar el mismo resultado mostrado en el editor.
8. Si cambia el objetivo, editar el brief y **Volver a detectar** sin volver a subir el vídeo.

## Límites de lo que puede asegurarse

El prompt exige ejecución y evidencias, pero no puede garantizar por sí solo la conducta de otra herramienta, permisos de cuentas, disponibilidad de proveedores o cero fallos. La velocidad se mide y los errores se corrigen y recuperan. La selección identifica oportunidades editoriales; no garantiza que un clip se haga viral. La publicación en redes depende de sus accesos y permisos, y se distingue de la descarga de archivos listos para publicar.
