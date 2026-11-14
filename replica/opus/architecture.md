# Arquitectura de la réplica de Opus — sobre lo que ya existe

Decisión: **no se crea un sistema paralelo**. La réplica es una capa de estructura y funciones sobre el stack actual (Next.js en Vercel · Supabase · R2 · Modal · Groq), con el diseño actual de Ráfaga (monocromo, sin cambios).

| Pieza de Opus | Dónde vive en Ráfaga | Cambio de esta ronda |
|---|---|---|
| Menú Crear / Publicar | `apps/web/app/app/layout.tsx` | Agrupado como Opus: **Crear** (Inicio, Proyectos, Brand kit, Style Studio), **Lyric Studio**, **Publicar** (Calendario, Analítica, Conexiones, Exportados, Automatizaciones), **Cuenta** |
| Ficha de clip (nota, subnotas, transcripción, descarga) | `components/ui/ClipRow.tsx` | Nota **/100**, subnotas en letra (`lib/grades.ts`) y **Exportar XML** (`lib/nle.ts`) |
| Selección «cualquier momento» | `packages/selection` + `workers/media/src/stages/select.ts` | Hecho en la ronda anterior (5 de 5 clips en un videoclip) |
| Subtítulos precisos | `workers/media/src/stages/analysis.ts`, `transcriptfix.ts` | Hecho (Whisper large-v3, audio normalizado, corrección sin tocar tiempos) |
| Esquema | Tablas existentes (`clips`, `clip_candidates`, `generations`, `brand_kits`…) | Sin tablas nuevas; migraciones 106 y 107 aditivas |

Riesgos: (1) «no me gusta» como señal requiere guardar feedback y usarlo en la siguiente selección; (2) vocabulario de marca necesita vincular `brand_kits` con la etapa `transcribe`; (3) el XML apunta al original por nombre, el editor debe tener el archivo local.

Orden de construcción restante: vocabulario de marca → lista de censura → señal «no me gusta» → duplicar clip.
