# Worker de Ráfaga en Modal

Envoltorio fino en Python: toda la lógica vive en `node workers/media/src/stage.ts`. Modal arranca contenedores con
Node 24.22.3, ffmpeg 9.0.2 (BtbN, verificado por SHA-256) y OpenCV, y copia el repositorio en `/repo`.

## Funciones

| Función | Cuándo corre | Qué hace |
|---|---|---|
| `dispatch` | La llama la web (`POST /api/wake`) con la cabecera `X-Rafaga-Wake` | Consulta `stage.ts --plan` y lanza hasta 4 `drain` y, si hay trabajos v1, un `run_legacy` |
| `drain` | Bajo demanda | `stage.ts --drain --max-idle-s 60`: procesa etapas v2 hasta quedarse 60 s sin trabajo |
| `run_legacy` | Bajo demanda (solo durante la coexistencia) | El worker v1 (`run.ts`), igual que en GitHub Actions |
| `sweeper` | Cada minuto | `stage.ts --sweep` (reencola etapas paradas, programa publicaciones) y vuelve a planificar |
| `keep_alive` | Una vez al día | `stage.ts --keep-alive` (evita la pausa de Supabase Free) y `stage.ts --purge` (retención) |

## Secreto `rafaga-worker` (claves; los valores los pone el propietario)

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GROQ_API_KEY`, `DEEPGRAM_API_KEY` (opcional), `R2_ACCOUNT_ID`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WAKE_SECRET` (el mismo valor que en Vercel).

## Comandos del propietario (una vez)

```bash
python3 -m venv ~/.cache/rafaga/modal-venv
```
```bash
~/.cache/rafaga/modal-venv/bin/pip install -r workers/modal/requirements.txt
```
```bash
~/.cache/rafaga/modal-venv/bin/modal token new
```
```bash
~/.cache/rafaga/modal-venv/bin/modal secret create rafaga-worker SUPABASE_URL=… SUPABASE_SECRET_KEY=… GROQ_API_KEY=… R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… WAKE_SECRET=…
```
```bash
~/.cache/rafaga/modal-venv/bin/modal deploy workers/modal/app.py
```

Después, en Vercel (Production): `WORKER_BACKEND=modal`, `MODAL_DISPATCH_URL` (la URL de `dispatch` que imprime el
despliegue) y `WAKE_SECRET`. En Modal → Settings → **Workspace budget**: fija el presupuesto en el crédito gratuito
mensual para que nunca haya cargos. En Supabase, el propietario guarda la tarifa real de Modal:
`update platform_settings set value = '{"usd_per_core_s": …, "usd_per_gib_s": …}' where key = 'modal_rate_card';`
(sin tarifa, la app no encola trabajos con coste).
