# Auditoría de migración: Artifact → aplicación pública (v1)

Fecha: 2026-11-11 · Fuente: Artifact «RÁFAGA STUDIO — MASTER PRODUCT DESIGN» (versión 31) · Código: `apps/web`, `workers/media`, `supabase/migrations` (hasta la 32).

Lectura rápida: el diseño **no se puede migrar «al 100 % operativo» en una sola entrega**. El bucle principal sí (subir → detectar → clips → editar → exportar). Hay piezas que dependen de claves, aprobaciones de plataformas o trabajo de worker que aún no existe. Cada fila dice cuál es cuál. Nada de esto está «beta verificada»: eso exige pruebas en el entorno desplegado.

Leyenda: **Hecho** = existe y se verificó en producción · **Parcial** = existe, falta algo concreto · **Nuevo** = hay que construirlo · **Bloqueado** = depende de un tercero.

## 1. Pantalla por pantalla

| Tablero | Ruta real | Datos (tablas) | Estado | Qué falta |
|---|---|---|---|---|
| 03 Acceso | `/login` | Supabase Auth, `profiles` | Parcial | Rediseño visual. Sin OAuth de Google para entrar (solo correo + contraseña). |
| 04 Inicio | `/app` | `projects`, `sources`, `usage_ledger` | Parcial | Entrada única (enlace/subir/canal) ya existe. Faltan: chips «Di qué buscar» persistidos como brief, selector de estilo de subtítulos, franja de Demos, tarjetas Conectar YouTube/Twitch, medidor de créditos real. |
| 05 Importar | `/app` (creador) | `sources` (`parts`, `storage_backend`) | Hecho | Subida por partes de 45 MB y R2 verificadas (76 MB). Falta el asistente de 4 pasos (Origen/Objetivo/Parámetros/Confirmar): hoy es un solo formulario. |
| 06 Procesamiento | `/app/p/[id]` (estado) | `jobs`, `worker_heartbeats` | Parcial | Las 10 fases de la maqueta no existen como fases reales; hoy hay estados del job. Hay que emitir fase real desde el worker o mostrar solo las que existen. |
| 07 Resultados | `/app/p/[id]` | `clips`, `clip_candidates` | Parcial | Lista, favoritos y selección: sí. Faltan: desglose de 7 factores (columna `factors jsonb` en `clip_candidates`, la rellena el selector), gancho y recomendación (campos del selector), ordenar, Comparar (`/p/[id]/comparar` existe: enlazar). |
| 08 Editor | `/app/c/[id]` | `clips`, `clip_versions`, `transcripts`, `reframe_tracks`, `text_styles` | Parcial | Editor de subtítulos y línea de tiempo: sí. Faltan: edición de transcripción que recorta vídeo, «Quitar silencios y muletillas» (operación nueva de worker), layouts fill/split/fit/pantalla+cámara, pista de hablantes (no hay diarización), 6 presets de subtítulos como `text_styles` del sistema. |
| 09 Lyric Studio | `/app/lyric-studio` | `songs`, `song_alignments`, `lyric_videos` | Hecho/Parcial | Verificado de extremo a extremo antes del rediseño. Falta aplicar el nuevo layout y probar con una canción real tras Groq. |
| 10 Proyectos | `/app/proyectos`, `/app/biblioteca` | `projects`, `media_collections` | Parcial | Rejilla/lista, carpetas y menú (renombrar/duplicar/archivar/eliminar) no tienen acciones reales de carpetas. Ciclo de vida de proyecto sí (migración 30). |
| Exportados | `/app/exports` | `renders`, `delivery_packages` | Parcial | Descarga validada como MP4 (`ftyp`) implementada, **no verificada en tu equipo**. Lote en .zip: `zip.ts` existe; falta el panel de exportación. |
| Compartidos conmigo | `/app/invitacion`, `/revision/[token]` | `share_links`, `workspace_invites`, `clip_comments` | Parcial | Revisión por enlace existe. La vista «Compartidos conmigo» como lista no. |
| 12 Brand kit | `/app/brand-kits`, `/app/style-studio`, `/app/ajustes`, `/app/equipo` | `brand_kits`, `brand_kit_versions`, `text_styles`, `workspace_fonts`, `workspace_members` | Parcial | Piezas existen separadas; la maqueta las une en pestañas. Subida de logo y fuentes: confirmar. |
| 13 Publicaciones | `/app/calendario` | `scheduled_posts`, `scheduler_runs` | Parcial | Calendario y estados: sí. **Publicación directa: no** (flujo manual honesto). El cajón «Preparar publicación» y «Sugerir con IA» son Nuevos. |
| 14 Conexiones | `/app/conexiones` | `oauth_connections`, `youtube_picks` | Parcial | OAuth con PKCE y «elegir uno de mis vídeos» escritos. Falta que **tú** pulses Conectar y aceptes el consentimiento de Google. Drive y Dropbox: código listo, sin credenciales. |
| 15 Automatización | `/app/automatizaciones` | `automation_rules`, `automation_runs` | Parcial | Tablas y página existen. Vigilar un canal de YouTube solo avisa (no entrega archivo). Drive/Dropbox sí pueden procesarse. |
| 16 Analítica | `/app/analitica` | — | Parcial | Estado vacío honesto. Sin métricas sociales hasta que haya una API oficial conectada. |
| Demos | — | — | Nuevo | Requiere 4 proyectos de ejemplo **propios**, renderizados con la propia plataforma. No se usan vídeos de terceros. |
| Director IA | `/app/director` | `generations`, `ai_usage` | Parcial | Interpreta instrucciones; la aprobación antes de ejecutar es obligatoria. Depende de Groq. |

## 2. Bloqueos reales (no son de diseño)

1. **Groq**: sin `GROQ_API_KEY` en GitHub Actions no hay selector editorial real. Hoy un vídeo de 13 min dio un solo clip de 14 s. Es el mayor riesgo de calidad.
2. **YouTube por enlace**: YouTube bloquea la descarga desde servidores. No se elude. Camino soportado: subir el archivo o conectar el canal para elegir un vídeo propio (solo lectura).
3. **Google OAuth**: pantalla de consentimiento y aceptación de políticas son del usuario.
4. **TikTok / Instagram / Twitch**: requieren aprobación de la plataforma. En la UI figuran como «Próximamente» o «sin conectar».
5. **Almacenamiento huérfano**: archivos antiguos en Supabase Storage y un objeto de prueba en R2, pendientes de borrar por ti.

## 3. Conflicto de dirección visual (decisión pendiente)

`CLAUDE.md` del repo dice «Interfaz monocroma». El diseño del Artifact usa fondo claro con **acento azul #2A55F5** (réplica de Vizard), y producción aún tiene «noche eléctrica» (oscuro). Son tres direcciones distintas. Antes de tocar `globals.css` hay que elegir una.

## 4. Orden de migración recomendado

1. **Cimientos**: tokens de diseño, shell (barra lateral de 9 entradas, barra superior), arreglo del Director (contenedor que no capture clics).
2. **Bucle principal con datos reales**: Inicio → Procesamiento → Resultados → Editor → Exportados.
3. **Calidad**: Groq, `factors`/gancho/recomendación en `clip_candidates` (migración 33), Comparar, ordenar.
4. **Valor diferencial**: quitar silencios (worker), layouts y presets de subtítulos.
5. **Superficie**: Proyectos con carpetas, Brand kit en pestañas, Compartidos.
6. **Salida**: Publicaciones (flujo manual), Conexiones, Automatización.
7. **Demos** con contenido propio.

## 5. Lo que el prototipo simula y no debe copiarse tal cual

Cifras de ejemplo (60 créditos, puntuaciones, duraciones), los botones que muestran «acción de ejemplo», las fases de procesamiento no existentes, la analítica y cualquier conexión «conectada». En producción cada uno debe leer datos reales o mostrar su estado vacío.

## 6. Criterio de «hecho» para la v1

Un usuario nuevo puede: entrar, subir un MP4 grande, recibir clips ordenados con puntuación estimada, editar subtítulos, descargar un MP4 válido y ver el proyecto en Proyectos. Eso debe probarse en `rafaga-studio.vercel.app` con un vídeo real, y solo entonces se marca «beta verificada».
