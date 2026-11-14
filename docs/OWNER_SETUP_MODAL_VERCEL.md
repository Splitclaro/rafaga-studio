# Puesta en marcha: Modal y Vercel (pasos del propietario)

Estado a 2026-11-14. **Hecho por Claude (sin secretos):** migraciones 034–042 y 100–105 aplicadas; `platform_settings.modal_rate_card` fijada con los precios de https://modal.com/pricing (0,0000131 USD por núcleo·s y 0,00000222 USD por GiB·s); presupuesto de cómputo en 30 USD. `compute_meter()` responde `rate_card_set = true` y `blocked = false`.

**Lo que NO hace Claude:** pegar credenciales en Modal o Vercel, ni desplegar. Hazlo tú, en este orden.

## 1. Modal (LC-1 a LC-3)
1. Cuenta con método de pago y presupuesto del Workspace = **30 USD** (panel de Modal).
2. Entorno local (ya instalado): `~/.cache/rafaga/modal-venv/bin/modal token new`
3. Secreto `rafaga-worker` (los valores los pones tú; no los pegues en el chat):
   ```bash
   ~/.cache/rafaga/modal-venv/bin/modal secret create rafaga-worker \
     SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     R2_ACCOUNT_ID=… R2_BUCKET=rafaga-originals R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
     GROQ_API_KEY=… DEEPGRAM_API_KEY=… \
     GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… DROPBOX_CLIENT_ID=… DROPBOX_CLIENT_SECRET=… \
     TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… WAKE_SECRET=…
   ```
   Genera `WAKE_SECRET` con `openssl rand -hex 32` y usa **el mismo valor** en Vercel.
4. Despliegue: `~/.cache/rafaga/modal-venv/bin/modal deploy workers/modal/app.py` y copia la URL de `dispatch`. Comprobación: un POST sin secreto debe responder `401`.

## 2. Vercel (LC-9)
Valores iniciales **seguros** (no cambian el comportamiento actual):

| Variable | Valor inicial | Nota |
|---|---|---|
| `WORKER_BACKEND` | `actions` | pasa a `modal` solo tras la autoprueba (LC-11) |
| `NEXT_PUBLIC_PIPELINE_VERSION` | `v1` | `v2` solo en Preview para probar clipping v2 |
| `NEXT_PUBLIC_LYRIC_VERSION` | `v1` | `v2` solo en Preview para probar Lyric v2 |
| `MODAL_DISPATCH_URL` | URL de `dispatch` del paso 1.4 | no es secreto |
| `WAKE_SECRET` | el mismo del secreto de Modal | **secreto** |
| `UPLOAD_STRATEGY` | `multipart` (o `parts` si falla la sonda de R2) | |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | de TikTok for Developers | **secretos** |
| `GROQ_LIMITS` | opcional | |

Después redespliega. Activa v2 solo en Preview y mueve a Producción cuando las pruebas de aceptación (LC-11, LC-16) pasen.

## 3. Resto de la lista
- **Unidades iniciales (LC-6):** `select public.grant_units('<workspace_id>', <unidades>, 'inicial', 'grant-inicial-0001');` (decide la cantidad).
- **CORS de R2 (LC-7) y sonda (LC-8):** origen de producción, `PUT`/`GET`/`HEAD`, `ExposeHeaders: ["ETag"]`; luego `node --env-file=.env.local scripts/r2-multipart-probe.ts`.
- **YouTube/TikTok (LC-10):** crear las apps y confirmar los endpoints OAuth de TikTok (están sin verificar).
- **Registro (LC-13):** anota Modal, la app, el secreto y TikTok en `docs/provisioning-manifest.json`.
