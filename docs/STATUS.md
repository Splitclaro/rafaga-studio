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

## Sesión 1 (cont. 2) — worker GitHub Actions
- Selector (`packages/selection`, 8 tests), proveedores Deepgram/Anthropic (endpoints verificados en docs; **sin probar con claves reales**), composición/FFmpeg (`packages/composition`, 4 tests + `scripts/test-render.ts`: 1080x1920 H.264/AAC 30 fps, 12,00 s, OK; evidencia `docs/evidence/render-blur-9x16-t3.png`).
- Migración 2 aplicada en Supabase (request_detection, claim_job); RLS tests 8/8 (PGlite).
- Web: «Detectar momentos virales»/«Volver a detectar» encolan job real; muestra estado y clips con URL firmada. Sin worker activo el job permanece en cola.

## Sesión 2 — V2 (2026-11-09)
- Encargo V2 en `master/AMPLIACION_V2.md`; `CLAUDE.md` raíz actualizado; matrices `docs/PARITY_MATRIX_V2.md`, `docs/STYLE_PARITY_V2.md`; `docs/COSTS.md`, `docs/RUNBOOK.md`.
- **Velocidad:** causa del «tarda mucho» = el cron de GitHub nunca se ejecutó. Worker ahora queda caliente 10 min (sondeo 3 s), descarga el original una vez, primer clip solo y resto de 2 en 2, x264 superfast. `/api/wake` arranca el worker al pulsar Detectar (requiere `GH_DISPATCH_TOKEN`).
- **Fallo del usuario:** su vídeo «elio 4» dura 2,9 s → ahora se rechaza antes de subir y el worker da un mensaje claro.
- **Autoprueba nube (run 42629711496):** Deepgram ES OK (199 palabras, 0,3–1,1 s); Anthropic sin saldo → selector léxico: ventas 6,9–19,8 s sin patrocinador, historia 48,4–65,9 s, brief sin coincidencias → 0. Render 1080×1920 h264/aac ~14 s.
- **UI monocroma** y navegación V2 (sidebar plegable, menú de workspace, analítica interna real; módulos no hechos marcados «Pronto»).

## Bloqueos externos
1. **Anthropic sin saldo** → selección con IA bloqueada (hay respaldo léxico). Requiere cargar saldo (autorización de coste).
2. **`GH_DISPATCH_TOKEN`** (PAT de GitHub con permiso Actions: write sobre este repo) en Vercel → arranque inmediato del worker. Sin él, depende del cron de GitHub.
3. Supabase Free: 50 MB por archivo → sin fuentes de 30/60 min (Pro con autorización).
4. Auth: confirmación de correo + SMTP gratuito limitado → testers ajenos no reciben el correo.
5. Lyric Studio: falta evaluar modelo de alineación para voz cantada (licencia/coste/runtime).

## Siguiente paso
Editor de subtítulos real sobre clips (split/merge, tiempos, offset, undo/autosave, versiones, re-render, SRT/VTT, 1:1/16:9). Después spike Lyric Studio (audio → letra alineada → MP4) y decisión de compositor por frames para Style Studio.
