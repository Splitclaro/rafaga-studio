---
description: Worker por etapas y app de Modal
paths:
  - "workers/**"
---

- Las etapas (`workers/media/src/stages/*.ts`) reciben `StageCtx` (`rpc`, `db`, `r2`, `fetch`, `ffmpeg`, `ffprobe`,
  `tmpDir`, `env`, `log`) y nunca importan `@supabase/supabase-js`; solo `stage.ts` crea el cliente.
- `inputs()` devuelve todo lo que determina la salida (incluidas versiones de componentes); el runner usa `inputHash`
  para la caché. Salidas en `job_stages.output` ≤8192 bytes; lo grande a R2 (`<ws>/stages/<stage_id>.json`) con
  `record_object`.
- CLI `node workers/media/src/stage.ts`: salidas 0 bien, 1 etapa fallida, 64 uso (se comprueba antes), 78 configuración.
  `--list-flags` imprime las opciones admitidas (`--list`, `--list-flags`, `--drain`, `--max-idle-s`, `--sweep`,
  `--keep-alive`, `--plan`, `--purge`); `app.py` solo pasa opciones de esa lista. Una opción nueva se añade primero a
  `--list-flags`.
- `stage.ts` exporta `main(argv, deps?)`; las pruebas inyectan un `rpc` simulado. `--purge` carga `./stages/purge.ts`
  con `import()` dinámico (módulo ausente → `not_implemented`, salida 1): el paso 18 no edita `stage.ts`.
- Latido cada 15 s; si `heartbeat_stage` devuelve `false`, abortar con `cancelled`.
- Llamadas a Groq siempre bajo `GroqLimiter`; cada ventana de selección con su propio `try/catch`; segunda pasada con
  rangos excluidos y pasada relajada anotada; nunca 0 clips sin aviso en `generations.warnings`.
- Lo nuevo de selección se importa como `@rafaga/selection/modes`, nunca por ruta relativa entre paquetes.
- La mezzanine solo borra el original tras comprobar duración a ≤1 fotograma y pistas presentes.
- `workers/media/src/run.ts` es el bucle heredado (con los arreglos desplegados `2fbd1a5`, `1d1024f`, `f74e330`): no se
  modifica.
- `workers/modal/app.py` es un envoltorio fino; nombres de API leídos de `modal==1.6.4` instalado; FastAPI solo dentro
  de `try/except ImportError`; sin secretos en el archivo. GitHub Actions nunca procesa medios.
- Pruebas de medios con fixtures `ffmpeg -f lavfi` de `fixtures.ts` en `.fixtures/`; si falta ffmpeg, fallan. La
  llamada real a `faces.py` solo se prueba si `python3` importa `cv2` (si no, `t.skip`); el resto usa un detector simulado.
