
## 2026-11-09 — Worker
- Se probó Trigger.dev Free (proyecto creado, CLI autenticada, worker `runtime-check` con ffmpeg+fuentes): el despliegue a prod es rechazado por la organización («Deployments are not available for this organization»). No se ha podido ejecutar el spike de runtime en su nube.
- Alternativa dentro de planes gratuitos: GitHub Actions en repo público (minutos gratuitos, ffmpeg por apt) disparado por `repository_dispatch`/poll de jobs en Supabase. Pendiente de implementar; requiere secretos en GitHub (los coloca el usuario).
- Supabase Auth: se mantiene «Confirm email» activo (desactivarlo fue bloqueado por permisos y es una reducción de seguridad). SMTP gratuito solo envía a miembros del equipo.
