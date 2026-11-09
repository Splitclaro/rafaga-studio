
## 2026-11-09 — Worker
- Se probó Trigger.dev Free (proyecto creado, CLI autenticada, worker `runtime-check` con ffmpeg+fuentes): el despliegue a prod es rechazado por la organización («Deployments are not available for this organization»). No se ha podido ejecutar el spike de runtime en su nube.
- Alternativa dentro de planes gratuitos: GitHub Actions en repo público (minutos gratuitos, ffmpeg por apt) disparado por `repository_dispatch`/poll de jobs en Supabase. Pendiente de implementar; requiere secretos en GitHub (los coloca el usuario).
- Supabase Auth: se mantiene «Confirm email» activo (desactivarlo fue bloqueado por permisos y es una reducción de seguridad). SMTP gratuito solo envía a miembros del equipo.

## 2026-11-09 — Worker en GitHub Actions (decisión)
- Pipeline en `workers/media/src/run.ts`: claim_job (SQL, skip locked) → ffprobe → audio opus → Deepgram nova-3 (transcript reutilizado si existe) → Anthropic (tool_choice forzado, ventanas 600 s/45 s) → validación (tiempos derivados del transcript, solape, cierre de frase, duración) → generación/candidatos/clips/clip_versions → render FFmpeg (fondo desenfocado 9:16 + ASS) → Storage `renders`.
- El web NO necesita tokens de GitHub: `request_detection` (RPC) encola y el cron de 5 min recoge. Latencia = hasta ~5 min + render; no cumple el objetivo de «primer clip ≤3 min». Se medirá.
- Sin los 3 secretos, el workflow termina con aviso y no procesa (puerta `gate`).
