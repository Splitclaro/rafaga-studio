# Ráfaga Studio — instrucciones para agentes

Herramienta privada que convierte vídeos largos en clips cortos (Next.js en Vercel, Supabase, R2, worker por etapas en
Modal). Construcción en curso: `blueprints/rafaga-clipping-v2/` (`tasks.json` decide la siguiente tarea).

## Comandos (desde la raíz; anteponer `export PATH="$HOME/.local/bin:$PATH" && `)
| Tarea | Comando |
|---|---|
| Instalar | `pnpm install --frozen-lockfile` |
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Typecheck / build web | `pnpm --filter @rafaga/web typecheck` · `pnpm --filter @rafaga/web build` |
| CLI del worker | `node workers/media/src/stage.ts --list` · `--list-flags` |
| Rendimiento | `node scripts/perf-run.ts --quick` |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` |

## No negociable
1. Nunca tocar el proyecto Supabase `splitclaro`; nunca `git push`, force push, `git reset --hard` ni despliegues.
2. Nunca secretos en repo, chat, logs ni navegador; nunca leer `.env*`.
3. Nunca editar una migración aplicada en producción; nunca escribir en `credit_ledger` fuera de la migración 035.
4. Nunca procesar medios en GitHub Actions ni reprocesar proyectos históricos; sin sistemas paralelos.
5. Vista previa = exportación con ≤1 fotograma (un solo motor en `packages/composition/src/layouts.ts`).
6. Nunca 0 clips en silencio: toda diferencia va en `generations.warnings`.
7. Nunca marcar una tarea como hecha con su `verify` en rojo, ni editar un `verify`.
8. La vista v1 de `/app/p/[id]` queda intacta para proyectos v1; lo nuevo solo aparece con un trabajo `engine = 'v2'`.

Arquitectura, fronteras, reglas de la ampliación y reglas por zona: `CLAUDE.md` en este directorio.
