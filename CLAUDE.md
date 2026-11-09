# Ráfaga Studio — entrada

**Encargo vigente:** `master/AMPLIACION_V2.md` (prevalece) + `master/CLAUDE.md` (encargo original). Léelos antes de tocar código.

## Prioridades
1. Subtítulos y su flujo (preview = export, ≤1 frame).
2. Brief → «Detectar momentos virales» / «Volver a detectar» / «Ajustar enfoque» (estimación de IA, no garantía).
3. Velocidad real del recorrido (worker caliente, primer clip antes del lote).
4. Lyric Studio + Style Studio + N variantes.
5. Paridad OpusClip, conexiones (Restream), calendario. Interfaz monocroma.

## Aislamiento
Recursos de ESTA plataforma: repo `Splitclaro/rafaga-studio`, Supabase `rafaga-studio-beta` (attrnwbcgascvppncucl), Vercel `rafaga-studio`, worker GitHub Actions `worker.yml`. Nunca tocar el proyecto `splitclaro`. Sin secretos en repo/chat, sin force push, sin gastos sin autorización. Registro en `docs/provisioning-manifest.json`.

## Continuidad
`docs/STATUS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/PARITY_MATRIX_V2.md`. Solo «beta verificada» con pruebas en el entorno desplegado.

## Comandos reales
- `export PATH=$HOME/.local/bin:$PATH` (pnpm 12.18, ffmpeg 9.0.2)
- `pnpm test` (raíz): subtítulos, composición, selección, RLS (PGlite)
- `cd apps/web && pnpm typecheck && pnpm build`
- `node scripts/spike-subs.ts` · `node scripts/test-render.ts`
- `gh workflow run worker.yml` (worker) · `gh workflow run worker.yml -f mode=selftest` (autoprueba nube con claves reales)
