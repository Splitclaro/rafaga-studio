# Coste de Modal (plan Starter)

**Dato real (panel de Modal, 2026-11-23):** plan Starter con **1,00 USD de crédito al mes**, límite de uso de 1 USD «fijado por Modal» (solo se sube añadiendo un método de pago). El ciclo va del 1 al 30 de noviembre. El crédito se agotó (0,99 USD en «Deployed apps», 0,00 USD de cargo). Hasta el siguiente ciclo Modal no ejecuta nada nuevo. El medidor interno asumía 30 USD; no frenaba antes del corte.

## Qué cambia (código y migración 118; efectivo al desplegar)
1. **Medidor**: `compute_budget_usd` pasa a 1 (solo si el valor guardado era mayor). `compute_meter()` bloquea al 90 %.
2. **Barrido**: el `sweeper` de Modal pasa de cada 3 minutos (≈14.400 arranques al mes) a cada 6 horas (purgas y respaldo). El barrido frecuente (`sweep_stale`, `enqueue_due_publications`) lo hace **pg_cron** de Supabase (SQL puro, gratis) cada minuto: `cron_sweep()`.
3. **Despertar a Modal solo con trabajo**: `modal_wake()` llama al `dispatch` de Modal cuando hay etapas listas (máximo cada 90 s). Necesita dos secretos en Vault (no se pegan en el chat):
   `select vault.create_secret('<URL de dispatch de Modal>', 'modal_dispatch_url');` y `select vault.create_secret('<WAKE_SECRET>', 'modal_wake_secret');`. Sin ellos no hace nada: `/api/wake` sigue despertando a Modal tras cada acción del usuario.
4. **Espera tras vaciar la cola**: `--max-idle-s` de 60 a 15 segundos (Modal cobra el contenedor mientras está activo).

## Pasos
- Aplicar la migración 118 (editor SQL de Supabase) y crear los dos secretos de Vault.
- Cuando Modal vuelva a tener crédito: `modal deploy workers/modal/app.py`.
- Medir antes de tocar calidad o concurrencia: coste por vídeo (`ai_usage`) y tiempo hasta el primer clip.
- Si algún día quieres quitar Modal: probar el mismo worker (Node + ffmpeg) en Cloudflare Containers (desde 5 USD/mes), solo si una prueba con tus vídeos cumple en coste, calidad y tiempo. No se migra sin esa prueba.

## Medidor con coste fijo y avisos (migración 119, E1/B-01)
`compute_meter()` suma ahora al gasto de etapas la clave `compute_fixed_usd` (cifra de «Deployed apps» del panel de Modal) y devuelve `level`: `ok`, `warn` al 70 % y `blocked` al 90 %. Tras aplicar la 119, el propietario fija la cifra real una vez al mes:
`update platform_settings set value = '0.99' where key = 'compute_fixed_usd';`
`/app/uso` muestra el desglose y el aviso al 70 %.
