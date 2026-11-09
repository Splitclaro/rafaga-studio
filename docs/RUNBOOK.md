# Runbook
- **Trabajo atascado en cola:** comprobar Actions → `media-worker`. Lanzar: `gh workflow run worker.yml`. El cron de GitHub no es fiable (no se ejecutó en >1 h el 9-11). Con `GH_DISPATCH_TOKEN` en Vercel, la web lo arranca sola.
- **Autoprueba con claves reales:** `gh workflow run worker.yml -f mode=selftest` → resumen JSON en el run.
- **LLM sin saldo:** el worker usa el selector léxico (`lexical-v1`) y lo registra en `generations.model` y `params.fallbackReason`.
- **Reintentos:** `claim_job` reintenta hasta 3 veces; errores permanentes (sin audio, <15 s, sin voz) no se reintentan.
- **Rotación de claves:** actualizar secretos en GitHub (Settings → Secrets → Actions) y Supabase API Keys.
