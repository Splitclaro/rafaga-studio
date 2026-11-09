# STATUS — Ráfaga Studio

Estado: **entrega parcial: beta aún no verificada** (sesión 1, 2026-11-09).

## Hecho
- ZIP localizado, entradas validadas (sin rutas fuera del destino), extraído en carpeta temporal nueva.
- Seis documentos leídos íntegros y copiados a `master/` con SHA-256 verificados (`master/manifest.json`).
- Proyecto creado en `/Users/studio/Documents/Codex/rafaga-studio`, `CLAUDE.md` raíz, manifiesto de recursos.

## Sesión 1 — avance técnico
- Instalados en `~/.local/bin`: pnpm 12.18, ffmpeg/ffprobe 9.0.2 (martin-riedl.de, arm64; libass, drawtext, libx264, aac).
- `packages/composition`: agrupación de palabras, `activeWordAt` única, generador ASS con escape; 6 tests OK.
- Spike `scripts/spike-subs.ts`: fixture sintético ES 9:16, export 1080x1920 H.264/AAC; transiciones de palabra activa export vs. función de preview: **0 frames de diferencia** (6 transiciones). Evidencia: `docs/evidence/subs-impacto-9x16-t1.5.png`. Solo fixture local; falta 1:1, 16:9, otros presets y worker cloud.

## Sesión 1 (cont.)
- `docs/REFERENCE_REVIEW.md`: 7 vídeos revisados por hoja de contactos (sin audio); las 10 imágenes siguen sin revisar.
- `supabase/migrations/20261109000001_core.sql`: perfiles, workspaces, membresías, fuentes, proyectos (brief ≤2000), transcripts, generaciones, candidatos, clips/versiones, jobs, renders, ledger, brand kits, notificaciones, outbox; RLS, FK compuestas por workspace, buckets privados. Pendiente: automatizaciones, live_*, invitaciones, conexiones sociales.
- `supabase/tests/rls.test.ts` (PGlite con auth/storage simulados): 7/7 OK. **No sustituye la prueba A/B contra Supabase real.**
- `apps/web` (Next 16.4.5, React 19.3.1, Tailwind 4): landing mínima y `/editor/demo` con preview que usa `activeWordAt` del paquete compartido; edición de texto conserva intervalos. typecheck y build OK; comprobado en navegador que la palabra activa coincide con los tiempos. Fixture, sin vídeo real, sin guardado, sin auth.

## Preflight
- OK: git 2.39, node 24.18, npm 11, python 3.12, gh 2.100 (cuenta activa **Splitclaro**, scopes repo/read:org).
- Faltan: pnpm, ffmpeg/ffprobe, Vercel CLI/login, Supabase CLI, Docker. Sin claves de Deepgram/Anthropic/Trigger.dev en el entorno.
- Verificado en Chrome: Supabase org Splitclaro (Free), Vercel equipo split-claro-app (Hobby), GitHub Splitclaro. Repo creado: https://github.com/Splitclaro/rafaga-studio.

## Bloqueos externos
1. Supabase: **creado** `rafaga-studio-beta` (ref attrnwbcgascvppncucl, org Splitclaro, Free, UE) y migración core aplicada (16 tablas, RLS on). Contraseña de BD generada por Supabase y no guardada. Pendiente: claves API en Vercel/worker, Auth URLs, SMTP, prueba A/B real. Free limita tamaño por archivo; Pro requiere autorizar coste.
2. Vercel: proyecto nuevo `rafaga-studio` creado y desplegado desde el repo (https://rafaga-studio.vercel.app, landing + /editor/demo, 200 OK). Aún sin variables de entorno, sin Auth ni worker: NO es la beta.
3. Worker: Trigger.dev creado pero **deploy rechazado por la organización (Free)**; plan B GitHub Actions (ver DECISIONS.md). Claves Deepgram/Anthropic: no colocadas; el asistente no puede teclear secretos en campos.
4. Auth: confirmación de correo activa + SMTP gratuito limitado → testers ajenos al equipo no pueden registrarse todavía.

## Siguiente paso
Crear proyecto Supabase (usuario) y aplicar migración; Auth + subida TUS; worker FFmpeg (ingest/ASR/selección con claves); editor con vídeo real; layouts, 1:1 y 16:9; revisar las 10 imágenes.
