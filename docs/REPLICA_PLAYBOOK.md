# Pack Replica aplicado a Ráfaga Studio

Fecha: 2026-11-11. Fuente de las instrucciones: guía «Clona la app que pagas cada mes» (artifact público de un tercero) y las instrucciones del propietario del proyecto. Lo que sigue adapta esa guía a lo que Ráfaga ya es: una herramienta de AI Clipping (vídeo largo → clips verticales 9:16 con subtítulos y puntuación de encaje).

## 1. Estado de la instalación

Los 11 skills están en `~/.claude/skills/` (copiados tal cual del zip `replica-11-skills.zip`, release v12; revisados antes: los 7 scripts no hacen red, no ejecutan comandos y no leen variables de entorno; los `SKILL.md` no contienen instrucciones ocultas). No se tocó nada más de esa carpeta.

| Orden | Skill | Para qué en Ráfaga |
|---|---|---|
| 1 | `replica-recon` | Mapa de pantallas, flujos y matriz de funciones de cada referente (solo con páginas públicas y las cuentas propias abiertas en Chrome) |
| 2 | `replica-architect` | Contrastar la arquitectura de Ráfaga (Next + Supabase + R2 + worker) con lo que cada referente necesita |
| 3 | `replica-design` | Tokens y componentes: ya existen (azul eléctrico, Space Grotesk + DM Sans); se usa `contrast.py` para el chequeo WCAG |
| 4 | `replica-build` | Construir pantallas por estados (vacío, carga, error) a partir de la matriz |
| 5 | `replica-backend` | Auth, RLS, OAuth (YouTube/Drive/Dropbox hechos), publicación (pendiente) |
| 6 | `replica-test` | Plan de pruebas de flujos + Playwright donde se pueda |
| 7 | `replica-diff` | `parity.py`: porcentaje de paridad ponderado (must/should/could) con la lista de huecos en orden de construcción |
| 8 | `replica-entrepreneur` | Reseñas públicas de los referentes: qué odian sus usuarios → plan de mejora y posicionamiento |
| 9 | `replica-brand` | Barrido de restos del original (`sweep.py`); marca ya propia (Ráfaga) |
| 10 | `replica-launch` | Landing, precios frente a los referentes, fichas |
| 11 | `replica-deploy` | Compuerta previa a producción (Ráfaga ya despliega en Vercel) |

**Cómo activarlos:** se cargan al iniciar una sesión de Claude Code (ya aparecen disponibles en esta). En una sesión nueva basta con escribir, por ejemplo, `/replica-recon Opus Clip, Klap, Vizard, Ssemble y NexusClips: solo lo principal`. Un skill por paso, en el orden de la tabla; cada uno deja un archivo que lee el siguiente. Para Ráfaga, trabajar desde la carpeta del repo para que los resultados queden en `docs/`.

**Límites que impone la guía y que Ráfaga respeta:** se copian funciones y estructuras, nunca código, logos, imágenes ni textos; solo fuentes públicas o cuentas propias; nada de saltarse muros de pago; antes de monetizar, revisar marcas y condiciones (no es asesoramiento legal).

## 2. Qué hace cada referente (observado en su panel, 2026-11-11)

| Referente | Estructura de su panel | Función clave que aporta |
|---|---|---|
| **Ssemble** (modelo de Ráfaga) | Barra superior: AI Clipping, Clip Rewards, Automations, Calendar, Pricing. Portada: un campo «YouTube URL» + «Get Shorts» y una zona de arrastre (1–30 min, hasta 1 GB, MP4/MOV/WEBM hasta 1080p) | Coste bajo por clip, programación y autopublicación |
| **Vizard** | Barra lateral: Home, Projects, Exported, Calendar, Analytics, Brand kit, Shared with me. Portada: subir archivo, importar de Zoom, grabar; proyectos recientes; créditos visibles | Editar el vídeo editando la transcripción; hasta ~40 clips |
| **Klap** | Barra superior mínima: Videos, Calendar, Analytics. Un único campo «suelta un archivo o pega un enlace de cualquier vídeo» + «Generate»; estado vacío con una frase | Reencuadre que sigue a quien habla, variaciones de subtítulos |
| **NexusClips** | Barra lateral: Home, Calendar, Pricing, demos (podcast, directo, gaming, YouTube). Pregunta central «¿Qué vídeo cortamos?»: pegar enlace, **Conectar YouTube**, **Conectar Twitch**, subir archivo; demos para comparar | Cortes sin límite desde cuentas conectadas, títulos y hashtags automáticos |
| **Opus Clip** | No estaba abierto en el grupo: solo se conoce por la descripción del propietario | Puntuación de viralidad, ganchos visuales, 20+ clips por vídeo |

**Patrón común:** una sola entrada («pega un enlace o suelta un archivo») + un botón + lista de proyectos + Calendario + Analítica + Marca. Nadie pide elegir «herramienta» antes de empezar.

## 3. Paridad de Ráfaga con ese patrón

Criterio: **Hecho** (probado en producción), **Parcial**, **Falta**, **Bloqueado** (depende de algo externo).

| Función | Referente | Ráfaga hoy | Estado |
|---|---|---|---|
| Campo único enlace/archivo + botón | todos | Pestañas «Subir archivo» / «Enlace de YouTube» y un selector de herramienta antes de empezar | **Parcial**: unificar en un solo campo |
| Subir archivos grandes | Ssemble (1 GB) | Hasta 4 GB (partes en Supabase o directo a R2); probado 75,7 MB | **Hecho** |
| Pegar enlace y obtener clips sin subir el archivo | Opus, Klap, Nexus, Ssemble | Se reconoce el vídeo (título, canal, portada); **no se puede descargar**: YouTube bloquea a los servidores de GitHub (probado, autoprueba 42998307479) | **Bloqueado** (necesita infraestructura propia; ver §4) |
| Conectar YouTube / Twitch para elegir vídeos | Nexus | OAuth de YouTube/Drive/Dropbox hecho y verificado en pruebas; sin credenciales de Google no opera. Twitch no existe | **Bloqueado / Falta** |
| Puntuación de viralidad por clip | Opus | «Encaje estimado» 0–100 con motivo, etiquetado como estimación | **Hecho** |
| Reencuadre 9:16 con seguimiento de cara | Klap | Reencuadre por caras (OpenCV) probado con una cara real; no distingue quién habla | **Parcial** |
| Subtítulos dinámicos y variaciones | Klap | Estilos (presets), editor y vista previa = exportación (≤1 fotograma) | **Hecho** (variaciones automáticas: Falta) |
| Editar cortando la transcripción | Vizard | Recorte con línea de tiempo y edición de palabras; cortar borrando texto no verificado | **Falta/No verificado** |
| Marca (logo, intro, outro, fuentes) | Vizard | Brand kit con versiones | **Hecho** |
| Calendario y analítica | Ssemble, Vizard, Klap | Páginas existen; publicar en redes no está implementado (necesita revisión de cada plataforma) | **Parcial / Bloqueado** |
| Créditos/consumo visibles | Vizard | Minutos semanales en la barra lateral | **Hecho** |
| Títulos, hashtags y descripción automáticos | Nexus | Título por clip; hashtags/descripción: no | **Parcial** |
| Demos para probar sin subir nada | Nexus, Vizard | No hay proyecto de ejemplo | **Falta** (rápido de añadir) |
| Procesado fiable y rápido | todos | El worker en GitHub Actions se colgó hoy durante >1 h instalando `ffmpeg` (apt); la cola quedó parada | **Bloqueado** (ver §4) |

## 4. Lo que impide la paridad real y no es de diseño

1. **Procesador (worker):** corre en GitHub Actions y hoy el paso `apt-get update` no responde (probados el espejo de Azure y el oficial de Ubuntu; sin incidencia declarada por GitHub). Mientras no arranque no se generan clips nuevos. Salida estable: ejecutar el worker en una máquina propia (VPS pequeña, o contenedor con `ffmpeg` ya instalado) en lugar de instalar en cada arranque. Requiere decisión y coste.
2. **Descargar de enlaces:** los referentes descargan desde su propia infraestructura. YouTube bloquea las IP de centros de datos y sus condiciones no permiten descargar vídeos ajenos. Rutas legítimas: (a) vídeos propios descargados desde YouTube Studio; (b) cuentas conectadas por OAuth con permisos de la API; (c) acuerdos o proveedores con licencia. No se esquiva la verificación anti-bots.
3. **Publicación automática:** cada plataforma exige revisión de la app.
4. **Almacenamiento:** R2 activo (10 GB gratis); Supabase Free queda para portadas y renders (1 GB).

## 5. Siguiente orden de trabajo propuesto

1. Estabilizar el procesador (punto 4.1) — condiciona todo lo demás.
2. Auditoría real con material propio: un vídeo hablado de >10 min, clips revisados fotograma a fotograma (duración, resolución, audio, subtítulos), y el flujo de Lyric Studio con una canción.
3. Unificar la portada en un solo campo «enlace o archivo» + proyecto de demostración.
4. `replica-recon` sobre los referentes con sus cuentas abiertas → `replica-diff` para medir la paridad con números.
