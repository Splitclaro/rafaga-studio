# Cambio: procesamiento fiable y rápido (brownfield)

Resumen del diseño aplicado con el método de The Architect (mapa del repositorio → delta → verificación). Es una versión condensada: no es el paquete completo de 20 secciones validado por `blueprint-validator`.

## Mapa del repositorio (lo relevante)
- Web: Next.js 16 en Vercel (`apps/web`). Encola jobs en Supabase y llama a `/api/wake`.
- Worker: Node 24 en GitHub Actions (`workers/media`, `.github/workflows/worker.yml`), ffmpeg 9.0.2 fijado, OpenCV, Groq/Deepgram.
- Datos: Supabase (`jobs`, `generations`, `clip_candidates`, `clips`, `renders`). R2 para originales.
- Pruebas: `pnpm test` (raíz). Build web: `cd apps/web && pnpm typecheck && pnpm build`.

## Estado actual (medido el 2026-11-13)
- Latencia: el job tarda ~1 min con el worker en marcha, pero esperó 224 y 382 min en cola. Pese a `cron: */5`, GitHub lanzó el worker solo cada ~6–7 h (03:08, 11:12, 18:59, 00:10, 06:51). Sin `GH_DISPATCH_TOKEN`, `/api/wake` no puede despertarlo.
- Arranque en frío: ~2,5–4 min (apt con hasta 60 s de espera, descarga de ffmpeg, pip, pnpm).
- Rendimiento: pedidos 6, 10 y 5 clips → salieron 1, 0 y 0. La IA proponía 1–3 candidatos y la validación rechazaba por «duración» o «cierre» sin completar.

## Delta
1. `packages/selection/src/index.ts`: `validateCandidates` ajusta (amplía a final de frase, acorta, retrocede al último cierre) antes de rechazar.
2. `packages/providers/src/{groq,index}.ts`: el prompt pide N candidatos distintos (`want`).
3. `workers/media/src/run.ts`: pide `ceil(count×1,6)` por ventana y completa con candidatos por reglas (`lexicalCandidates`) hasta el número pedido; métrica `topup`.
4. `.github/workflows/worker.yml`: caché de ffmpeg, pip y pnpm; sin `apt` en el modo worker.
5. `apps/web/app/app/p/[id]/page.tsx`: aviso honesto en cola cuando el despertador no está configurado.

## Interfaces que no cambian
Tablas y columnas, RPCs (`request_detection`, `claim_job`…), rutas `/api/*`, variables de entorno existentes.

## Verificación (hecha)
- `pnpm test`: 242 de 244 (2 omitidos).
- Arranque en frío medido: 25 s (antes > 2,5 min).
- Producción: demo de 1:40 → 53 s hasta 2 clips con gancho y desglose (antes 1 clip tras esperar horas).

## Pendiente y reversión
- **Bloqueo del usuario:** crear `GH_DISPATCH_TOKEN` (ver `docs/OPERACION_WORKER.md`). Sin él el arranque depende de GitHub.
- Reversión: revertir el commit; no hay migraciones ni cambios de datos.
