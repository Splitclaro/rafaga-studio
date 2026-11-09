# STATUS — Ráfaga Studio

Estado: **entrega parcial: beta aún no verificada** (sesión 1, 2026-11-09).

## Hecho
- ZIP localizado, entradas validadas (sin rutas fuera del destino), extraído en carpeta temporal nueva.
- Seis documentos leídos íntegros y copiados a `master/` con SHA-256 verificados (`master/manifest.json`).
- Proyecto creado en `/Users/studio/Documents/Codex/rafaga-studio`, `CLAUDE.md` raíz, manifiesto de recursos.

## Preflight
- OK: git 2.39, node 24.18, npm 11, python 3.12, gh 2.100 (cuenta activa **Splitclaro**, scopes repo/read:org).
- Faltan: pnpm, ffmpeg/ffprobe, Vercel CLI/login, Supabase CLI, Docker. Sin claves de Deepgram/Anthropic/Trigger.dev en el entorno.
- Supabase (conector): solo organización **Sound Republic** con proyecto `sound-republic-os` (no tocar). No aparece una organización splitclaro → **no se crea proyecto** hasta verificar propietario y coste.

## Bloqueos externos
1. Supabase: confirmar en qué organización crear `rafaga-studio-beta` y autorizar coste.
2. Vercel: login/equipo splitclaro.
3. Claves ASR (Deepgram) y LLM (Anthropic), cuenta Trigger.dev o servicio para worker Docker (coste).
4. Instalar ffmpeg (brew no encontrado).

## Siguiente paso
Instalar pnpm/ffmpeg, `git init`, repo `splitclaro/rafaga-studio`, scaffold monorepo, spike local FFmpeg+ASS de subtítulos por palabra.
Revisión de referencias (`/Users/studio/Downloads/`) pendiente → `docs/REFERENCE_REVIEW.md`.
