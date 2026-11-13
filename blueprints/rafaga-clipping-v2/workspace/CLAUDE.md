# Ráfaga Studio — entrada

<!-- rafaga-v2:merged — este archivo FUSIONA el CLAUDE.md raíz existente (copiado literalmente en la primera parte)
     con las reglas de construcción del bundle blueprints/rafaga-clipping-v2/. El Bootstrap lo copia solo si la raíz
     aún no lleva esta marca. Las reglas de aislamiento y continuidad de la raíz siguen mandando. -->

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

---

# Construcción v2 · Clipping (bundle `blueprints/rafaga-clipping-v2/`)

Encargo de esta construcción: `blueprints/rafaga-clipping-v2/blueprint.md` (diseño y porqués), `tasks.json` (qué toca
ahora) y `epics/*.md` (cómo). Durante la construcción **no** se usa `gh workflow run` (Actions no procesa medios).
Los arreglos de selección `2fbd1a5`, `1d1024f` y `f74e330` ya están desplegados en `run.ts`/`groq.ts`; el paso 12 los
generaliza en `stages/select.ts`, no los reaplica.

## Comandos v2 (siempre desde la raíz)

| Tarea | Comando |
|---|---|
| Entorno (en cada comando) | `export PATH="$HOME/.local/bin:$PATH" && …` |
| Instalar | `pnpm install --frozen-lockfile` |
| Todas las pruebas | `pnpm test` |
| Una prueba | `node --test <ruta>` |
| Typecheck web | `pnpm --filter @rafaga/web typecheck` |
| Build web | `pnpm --filter @rafaga/web build` |
| CLI del worker | `node workers/media/src/stage.ts --list` · `--list-flags` · `<stage> <jobId>` · `--drain [--max-idle-s N]` · `--sweep` · `--keep-alive` · `--plan` · `--purge` |
| Sintaxis de Modal | `python3 -c "import ast; ast.parse(open('workers/modal/app.py').read(), 'workers/modal/app.py')"` |
| SDK de Modal (local) | `~/.cache/rafaga/modal-venv/bin/python` (no se despliega: lo hace el propietario) |
| Sonda R2 | `node scripts/r2-multipart-probe.ts --dry-run` |
| Rendimiento | `node scripts/perf-run.ts --quick` |
| ffmpeg | `ffmpeg -hide_banner -version` (9.0.2) |
| Vuelta atrás de un paso | `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD` (nunca `git reset --hard`) |

**Puerta de cada tarea:** su array `verify` de `tasks.json`, completo, más `pnpm test`. Nunca marques una tarea como
hecha con una puerta roja.

## Bucle de construcción
1. Lee `blueprints/rafaga-clipping-v2/tasks.json` del disco. Resuelve primero cualquier tarea `in_progress` ejecutando su
   `verify`.
2. Elige la primera tarea lista en orden del array; ponla `in_progress` y guarda el archivo.
3. Abre `epics/<epic>.md` y haz solo esa tarea.
4. Ejecuta todo su `verify` desde la raíz. Nunca edites un `verify`.
5. Ponla `done`, guarda, y ejecuta su Checkpoint: `git add -A && git commit -m "rafaga-v2: paso NN — …" && git tag rafaga-v2-step-NN`.
6. Si algo bloquea, detente e informa; no adelantes tareas. Para deshacer un paso, `git revert` (no destructivo).

## Arquitectura
**Petición:** navegador → `apps/web/app/api/<recurso>/[[...slug]]/route.ts` (JWT, `rpcAs` como el usuario, `Response.json`)
→ funciones SQL `security definer` (034–037) → `jobs` + `job_stages` (+ reserva en `credit_ledger`) → `/api/wake` →
Modal `dispatch` → `node workers/media/src/stage.ts --drain` → `claim_stage` → etapa en `workers/media/src/stages/*.ts`
→ R2 → `finish_stage` → Realtime → `apps/web/lib/progress.ts` (`deriveProjectState`).

| Capa | Puede importar | Nunca |
|---|---|---|
| `apps/web/app/api/**` | `apps/web/lib/*`, `@rafaga/*` | exportar algo que no sea método HTTP o `dynamic`; leer tablas sin RLS |
| `workers/media/src/stages/*` | `@rafaga/*` (incl. `@rafaga/selection/modes`), `../fixtures.ts` solo en pruebas | `@supabase/supabase-js` (solo `stage.ts`) |
| `packages/composition` | nada de `apps`, `workers` ni `@rafaga/selection` | dibujar con otra lógica que `planLayout`/`sceneAt` |
| `supabase/migrations` | — | editar una migración aplicada en producción |

| Asunto | Fuente única |
|---|---|
| Esquema | `supabase/migrations/2026111300003{4..7}_*.sql` (SQL de referencia en `blueprint.md` §4) |
| Escritura del libro de unidades | `public._ledger_write` (035); nada más inserta en `credit_ledger` |
| Errores de API | `apps/web/lib/api.ts` (`mapDbError`, `errorFor`) |
| Motor de vista previa y exportación | `packages/composition/src/layouts.ts` (`planLayout`, `sceneAt`, `toLegacyComposition`) |
| Zonas seguras | `packages/composition/src/safezones.ts` (cada valor con su fuente) |
| Opciones de la CLI del worker | `node workers/media/src/stage.ts --list-flags` (`app.py` solo usa esas) |
| Claves de R2 | `blueprint.md` §4 *Claves de objetos* |

## Reglas de código
1. TypeScript ejecutado por Node: imports relativos con `.ts`; solo sintaxis borrable (sin `enum`, `namespace`,
   propiedades de parámetro, `import x = require`).
2. Pruebas con `node:test` + `node:assert/strict`, `*.test.ts` junto al código; BD en PGlite (`freshDb()` de
   `supabase/tests/migrate.ts`); HTTP con `fakeSupabaseFetch`; medios con fixtures `ffmpeg -f lavfi` en `.fixtures/`.
3. Ninguna prueba toca la red. Ninguna prueba de medios se omite si falta ffmpeg: falla.
4. Toda función `security definer`: `set search_path = public`, `revoke all … from public, anon` y `grant execute` explícito.
5. Todo POST que crea trabajo o sesión exige `Idempotency-Key`.
6. URLs de R2 firmadas solo tras una RPC con el JWT del usuario.
7. Sin dependencias nuevas ni actualizaciones; sin linter ni formateador nuevos.
8. Rutas con `[` entre comillas simples en el shell.
9. Entre paquetes solo por su `exports` (`@rafaga/<pkg>` o una subruta declarada), nunca por ruta relativa.

## Reglas de la ampliación (propietario, 2026-11-13)
- Antes de modificar una parte, identifica su implementación y dependencias; reutiliza componentes, servicios, colas,
  almacenamiento y motores. **Sin sistemas paralelos.**
- Conserva las modificaciones pendientes del usuario o de otros agentes; si el árbol tiene cambios ajenos fuera de
  `blueprints/` al empezar, detente e informa (precondición de `E1-T1`).
- Nada de refactorizaciones, reorganizaciones ni actualizaciones de dependencias ajenas al cambio.
- **Nunca reproceses proyectos históricos**; nunca reinicies workers, purgues colas ni toques trabajos activos.
- Ninguna migración destructiva ni cambio incompatible sin declarar su impacto.
- Ninguna tabla nueva si existe una equivalente (`generations`, `clip_candidates`, `clips`, `clip_versions`, `renders`,
  `deliveries`, `share_links`, `media_collections`, `text_styles`, `brand_kits`, `project_folders`, `jobs`,
  `usage_ledger`, `ai_usage`); cada tabla nueva está justificada en `blueprint.md` §1 *Ampliaciones: reutilización*.
- La vista v1 de `/app/p/[id]` (`BriefFields`, «Volver a detectar», «Ajustar enfoque») queda intacta para proyectos v1;
  lo nuevo solo aparece si el proyecto tiene un trabajo `engine = 'v2'`.
- Estas instrucciones no autorizan despliegues, cambios en producción ni ejecuciones de pago.

## Coste 0 € y worker
- Solo capas gratuitas: Modal Starter, Groq free, Supabase Free, R2 Free (10 GB), Vercel Hobby.
- **GitHub Actions no procesa medios de usuario** (términos de GitHub): solo CI y el worker heredado hasta D1.
- El medidor de Modal (`compute_meter`) rechaza trabajos nuevos al 90 % de 30 USD; sin tarifa, falla cerrado.

## Diseño visual
Fuera de alcance: se conserva el sistema existente (interfaz clara `#FAFAFC`, tinta `#0B0F1A`, acento `#2A55F5`;
Plus Jakarta Sans / Inter / JetBrains Mono; tema `.theme-dark` del editor). Ningún paso cambia colores, fuentes ni
estilo; las pantallas nuevas reutilizan `apps/web/components/ui/`. Los estilos de subtítulos son contenido del vídeo.

## Entorno
Sin validador global: cada ruta/etapa lee sus variables y responde `not_configured` si faltan. Tabla completa con el
paso que las requiere en `blueprint.md` §10. Los secretos los pega el propietario en Vercel y en el secreto de Modal
`rafaga-worker`. Nunca leas `.env*`.

## Reglas diferidas
| Archivo | Se aplica a |
|---|---|
| `.claude/rules/migrations.md` | `supabase/migrations/**`, `supabase/tests/**` |
| `.claude/rules/composition-parity.md` | `packages/composition/**`, `apps/web/components/PreviewPlayer.tsx` |
| `.claude/rules/worker-stages.md` | `workers/**` |
| `.claude/rules/api-routes.md` | `apps/web/app/api/**`, `apps/web/lib/**` |

## No negociable
1. Nunca tocar el proyecto Supabase `splitclaro`; nunca `git push` ni force push; nunca desplegar.
2. Nunca secretos en repo, chat, logs ni navegador.
3. Nunca editar una migración aplicada en producción ni escribir en `credit_ledger` fuera de 035.
4. Nunca procesar medios en GitHub Actions ni reprocesar proyectos históricos.
5. Vista previa = exportación con ≤1 fotograma: un solo motor (`sceneAt`/`planLayout`).
6. Nunca 0 clips en silencio: toda diferencia con lo pedido va explicada en `generations.warnings`.
7. Nunca marcar una tarea como hecha con su `verify` en rojo, ni editar un `verify`.
8. Nunca `git reset --hard`: la vuelta atrás es `git revert --no-edit rafaga-v2-step-<NN-1>..HEAD`.
