# Publicación pública en TikTok con Zernio

Estado: **implementado y probado en local** (Zernio y Supabase simulados). **No desplegado ni verificado con cuentas reales** hasta completar los pasos de abajo.

## Decisión de arquitectura: publicar no depende de Modal
Modal (plan Starter: 1 USD de crédito al mes) puede quedarse sin cuota de render. Por eso el envío a Zernio **no pasa por el worker de Modal**: lo hace el servidor web (Vercel) al pulsar Programar, y el estado lo recibe una **Edge Function de Supabase**. Con Modal parado, los clips ya exportados siguen pudiendo programarse; solo las exportaciones nuevas esperan.

## Qué hace
Calendario → **Programar en TikTok** ofrece «Borrador en tu bandeja de TikTok» (flujo nativo, sin cambios) y **«Publicar en abierto (Zernio)»** con exactamente las dos cuentas autorizadas.

- Al elegir una cuenta de Zernio se consulta `GET /v1/accounts/{id}/tiktok/creator-info?mediaType=video`: se muestra el `@usuario`, la vista previa y el texto editable; se bloquea si la cuenta no puede publicar, no admite `PUBLIC_TO_EVERYONE` o el vídeo supera su duración máxima.
- Comentarios, dúo y stitch empiezan desactivados y respetan lo que TikTok tenga desactivado; contenido comercial y declaración de música (obligatoria). Hay que marcar la revisión de la vista previa y el consentimiento explícito; se guardan en `publications.consent` con usuario y hora.
- **Programar**: `POST /api/publish` con `provider: "zernio"` crea la publicación (RPC `request_zernio_publication`) y la envía en la misma petición: lee el MP4 de R2 con una URL firmada, `POST /v1/media/presign`, `PUT` al `uploadUrl` **sin la clave de API**, `POST /v1/posts` con `scheduledFor` en UTC, `PUBLIC_TO_EVERYONE`, `draft: false` y los consentimientos. **Zernio ejecuta el horario**; `enqueue_due_publications` ya no reenvía las de Zernio.
- **Publicar ahora** es una acción explícita (`publishNow`). Una fecha vencida o a menos de 30 s **no se envía**.
- **Idempotencia**: `Idempotency-Key` = id local de la publicación (también `externalId`). 429 → queda «En cola» con `retry_at` y botón **Reintentar el envío** (`POST /api/publish/:id/retry`); resultado dudoso (red/5xx) → igual, con la misma clave; pasadas 23 h no se reenvía sin conciliación manual. 402 → se detiene sin añadir tarjeta. Tope de 15 vídeos por cuenta y 24 h móviles validado en la base de datos.
- **Estado y enlace** por webhook firmado: «Publicada · enlace pendiente» hasta `post.tiktok.url_resolved`, después «Ver el vídeo en TikTok».
- **Cancelar** propaga a Zernio (`DELETE /v1/posts/{id}`); si ya se había publicado, se muestra el resultado real.

## Aislamiento
- Solo los destinos de `ZERNIO_TARGETS` (máximo 2) y solo el espacio `ZERNIO_WORKSPACE_ID` (la función SQL exige que el render sea de ese espacio y que el usuario pueda editar).
- La clave de Zernio vive solo en Vercel. El secreto del webhook solo en Supabase. La clave de servicio la inyecta Supabase en la Edge Function; la web no la tiene.
- `record_zernio_send` (la usa el servidor web con el JWT del usuario) solo acepta estados de envío; `published` solo al reflejar la realidad tras una cancelación tardía. Un usuario solo toca publicaciones de Zernio de su espacio.

## Pasos del propietario (en este orden)
1. **Zernio (panel)**: un equipo, **dos perfiles, una cuenta de TikTok por perfil**; comprueba el `@usuario` antes de autorizar cada una. Sin tarjeta. El equipo debe tener **solo esas dos conexiones**.
2. **Vercel** (variables, pégalas tú): `ZERNIO_API_KEY`; `ZERNIO_WORKSPACE_ID` (`select id, name from workspaces;` en el SQL de Supabase); `ZERNIO_TARGETS`, p. ej. `[{"accountId":"<id1>","username":"@usuario1"},{"accountId":"<id2>","username":"@usuario2"}]` (los `accountId` salen del panel de Zernio o de `GET /v1/accounts`). Si una cuenta se reconecta y cambia de ID, el calendario la marcará «revisar»: verifica el `@usuario` y solo entonces actualiza el ID. Las variables de R2 ya existen.
3. **Migraciones** en el editor SQL de Supabase (proyecto `rafaga-studio-beta`): `20261201000116`, `…117` y `…118`, en ese orden (si la 116 ya está aplicada, solo 117 y 118). Después: `select proname, has_function_privilege('authenticated', oid, 'execute') from pg_proc where proname in ('zernio_event','enqueue_due_publications','modal_wake','cron_sweep');` → las cuatro deben dar `false`.
4. **Edge Function del webhook**: `supabase functions deploy zernio-webhook --no-verify-jwt --project-ref attrnwbcgascvppncucl` y `supabase secrets set ZERNIO_WEBHOOK_SECRET=<valor largo y aleatorio> --project-ref attrnwbcgascvppncucl` (o desde el panel de Supabase → Edge Functions → Secrets). La URL será `https://attrnwbcgascvppncucl.supabase.co/functions/v1/zernio-webhook`.
5. **Registrar el webhook** en Zernio: `POST /v1/webhooks/settings` (o el panel) con esa URL, el mismo secreto y los eventos `post.scheduled`, `post.published`, `post.platform.published`, `post.platform.failed`, `post.failed`, `post.partial`, `post.tiktok.url_resolved`. Prueba con `POST /v1/webhooks/test`.
6. **Despliegue**: push a `main` (Vercel). Hasta tener las variables, la función responde «no configurado» y el calendario no muestra el grupo de Zernio.

## Verificación con cuentas reales (pendiente)
Un clip aprobado por cuenta: programar ambos desde Calendario (idealmente con Modal parado) → esperar la hora → abrir cada enlace de TikTok sin iniciar sesión → comprobar que pertenece al `@usuario` previsto y que no pidió confirmación desde el móvil → revisar en Zernio que hay dos conexiones y ningún cargo. Hasta hacerlo, **no se marca como verificado**.

## Límites honestos
- `GET /v1/accounts` no se pudo leer en la documentación (404): el cruce de identidad usa `GET /v1/accounts/health`.
- No se encontraron en la documentación los campos de consentimiento de música ni de contenido generado por IA de `tiktokSettings`: solo se envían los documentados. La declaración de música se registra en Ráfaga.
- No hay conciliación por consulta a Zernio tras una respuesta dudosa pasadas 24 h (no se verificó un endpoint): el envío se detiene y se pide revisar el panel.
- El envío ocurre dentro de la petición web (`maxDuration` 60 s): un MP4 muy grande o una subida lenta puede agotar el tiempo; en ese caso queda reintentable.
- La lectura del MP4 usa memoria de la función: vídeos de pocas decenas de MB, como los clips.
