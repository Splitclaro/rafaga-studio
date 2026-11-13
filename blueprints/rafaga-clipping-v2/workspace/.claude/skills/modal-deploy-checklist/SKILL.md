---
name: modal-deploy-checklist
description: Lista de acciones del propietario para Modal (cuenta, presupuesto, token, secreto rafaga-worker, despliegue y URL de dispatch). Úsala cuando digas «desplegar en Modal», «secretos de Modal», «presupuesto de Modal» o edites workers/modal/.
---

# Modal: lo que hace el propietario y lo que comprueba el agente

## Cuándo usarla
- Al terminar el paso 6 o al preparar la lista de lanzamiento (LC-1 … LC-5, LC-11).

## Pasos (los ejecuta el PROPIETARIO; el agente nunca despliega ni crea secretos)
1. LC-1: crear la cuenta de Modal (exige método de pago) y fijar el **presupuesto del Workspace = 30 USD**.
2. LC-2: `~/.cache/rafaga/modal-venv/bin/modal token new`; luego
   `~/.cache/rafaga/modal-venv/bin/modal secret create rafaga-worker SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… R2_ACCOUNT_ID=… R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… GROQ_API_KEY=… DEEPGRAM_API_KEY=… GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… DROPBOX_CLIENT_ID=… DROPBOX_CLIENT_SECRET=… TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… WAKE_SECRET=…`
   (valores pegados por el propietario, nunca en el chat).
3. LC-3: `~/.cache/rafaga/modal-venv/bin/modal deploy workers/modal/app.py` y copiar la URL de `dispatch` a
   `MODAL_DISPATCH_URL` en Vercel (junto con `WAKE_SECRET` y `WORKER_BACKEND=actions` al principio).
4. LC-5: copiar las tarifas de CPU y memoria de https://modal.com/pricing a `platform_settings.modal_rate_card`.
5. LC-11: ejecutar las autopruebas en Modal antes de poner `WORKER_BACKEND=modal`.
6. Registrar app, secreto y cuenta en `docs/provisioning-manifest.json` (LC-13).

## Verificar (el agente, sin secretos)
```bash
export PATH="$HOME/.local/bin:$PATH" && python3 -c "import ast; ast.parse(open('workers/modal/app.py').read(), 'workers/modal/app.py')"   # exit 0
export PATH="$HOME/.local/bin:$PATH" && node --test apps/web/lib/wake.test.ts   # exit 0
```

## No hacer
- Ejecutar `modal deploy`, `modal secret` o `modal token` desde el agente (denegados en `.claude/settings.json`).
- Inventar nombres de la API de Modal: leerlos de `modal==1.6.4` instalado en `~/.cache/rafaga/modal-venv`.
- Procesar medios en GitHub Actions como alternativa.
