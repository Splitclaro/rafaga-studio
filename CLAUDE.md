# Ráfaga Studio — entrada

**Lee íntegramente `master/CLAUDE.md` antes de tocar código** y sigue el encargo completo. Especificación: `master/PROMPT_MAESTRO_CLAUDE_CODE.md`.

## Prioridades
1. Subtítulos y su flujo (fidelidad preview = export).
2. Brief → «Detectar momentos virales» / «Volver a detectar» (puntuación = estimación editorial de IA).
3. Recorrido: subir vídeo → brief → detectar → revisar → editar subtítulos/encuadre → exportar MP4 real.
4. UI profesional, sencilla, responsive.
5. Resto de funciones obligatorias. Sin campañas remuneradas ni comunidad.

## Aislamiento (obligatorio)
Recursos NUEVOS bajo el propietario splitclaro (repo, Vercel, Supabase, worker). Nunca modificar ni reutilizar el proyecto existente `splitclaro` (repo, BD, variables, dominios). Registrar todo en `docs/provisioning-manifest.json`. Sin secretos en el repo ni en el chat. Sin force push. Sin gastos sin autorización.

## Continuidad
Lee `docs/STATUS.md`, `docs/IMPLEMENTATION_PLAN.md` y `docs/provisioning-manifest.json`; retoma lo pendiente sin duplicar recursos. Solo declarar «beta operativa verificada» con pruebas en el entorno desplegado; si no, «entrega parcial: beta aún no verificada».

## Comandos reales
- `export PATH=$HOME/.local/bin:$PATH` (pnpm 12.18, ffmpeg/ffprobe 9.0.2 con libass)
- `node --test packages/composition/src/*.test.ts` — tests unitarios de subtítulos
- `node scripts/spike-subs.ts` — render real ASS + comprobación frame a frame
