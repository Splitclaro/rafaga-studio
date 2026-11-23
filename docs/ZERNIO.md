# Publicación pública en TikTok con Zernio

Estado: **implementado y probado en local (pruebas con Zernio y Supabase simulados). No desplegado ni verificado con cuentas reales** hasta completar los pasos de abajo.

## Qué hace
Calendario → **Programar en TikTok** ahora ofrece dos grupos de destino: «Borrador en tu bandeja de TikTok» (flujo nativo anterior, sin cambios) y **«Publicar en abierto (Zernio)»** con exactamente las dos cuentas autorizadas.

- Al elegir una cuenta de Zernio se consulta `GET /v1/accounts/{id}/tiktok/creator-info?mediaType=video` y se muestra el `@usuario`, la vista previa y el texto editable. Se bloquea si la cuenta no puede publicar, no admite `PUBLIC_TO_EVERYONE` o el vídeo supera su duración máxima (el worker vuelve a comprobarlo con la duración real del MP4).
- Comentarios, dúo y stitch empiezan desactivados y se respetan los que TikTok tenga desactivados para la cuenta; contenido comercial (tu marca / colaboración de pago) y declaración de música (obligatoria). Antes de publicar hay que marcar dos casillas: revisión de la vista previa y consentimiento explícito; ambos quedan guardados en `publications.consent` junto al usuario y la hora.
- **Programar**: al confirmar la fecha se crea la publicación y se encola el envío al instante. El worker toma el MP4 de R2, pide `POST /v1/media/presign`, lo sube por `PUT` al `uploadUrl` **sin la clave de API**, y crea el post con `POST /v1/posts` (`scheduledFor` en UTC, `privacy_level: PUBLIC_TO_EVERYONE`, `draft: false`, consentimientos). **Zernio ejecuta el horario**; `enqueue_due_publications` ya no reenvía las de Zernio.
- **Publicar ahora** es una acción aparte y explícita (`publishNow: true`). Una fecha que ya venció o está a menos de 30 s **no se envía** (Zernio publicaría al instante).
- **Idempotencia**: la clave `Idempotency-Key` es el id local de la publicación (que también va como `externalId`). Un resultado dudoso (red/5xx) se reintenta a los 5 min con la misma clave; pasadas 23 h no se reenvía y se pide conciliar en el panel de Zernio.
- **Límites**: 429 → la publicación sigue «En cola» con `retry_at` (respeta `Retry-After`) y la reintenta el barrido del worker; 402 → se detiene el envío y se explica (no se añade tarjeta); tope de 15 vídeos por cuenta en 24 h móviles validado en base de datos.
- **Estado y enlace** por webhook firmado: «Publicada · enlace pendiente» hasta `post.tiktok.url_resolved`, después enlace «Ver el vídeo en TikTok».
- **Cancelar** propaga a Zernio (`DELETE /v1/posts/{id}`); si ya se había publicado, se muestra el resultado real.

## Garantías de aislamiento (servidor)
- Solo se aceptan los destinos de `ZERNIO_TARGETS` (máximo 2; una tercera cuenta se rechaza en la API y el worker).
- Solo el espacio `ZERNIO_WORKSPACE_ID`: la función SQL `request_zernio_publication` exige que el render pertenezca a ese espacio y que el usuario pueda editar (`can_edit`).
- La clave de Zernio y el secreto del webhook nunca llegan al navegador. El webhook lo recibe Modal, no Vercel (la clave de servicio de Supabase no entra en la web).

## Pasos del propietario (en este orden)
1. **Zernio (panel)**: un solo equipo, **dos perfiles, una cuenta de TikTok por perfil**. Antes de autorizar cada una, comprueba el `@usuario`. Sin tarjeta. Comprueba que el equipo tiene **solo esas dos conexiones** (el plan gratuito cuenta todas).
2. **Clave**: genera una clave de API en Zernio. Pégala tú (no en el chat) como `ZERNIO_API_KEY` en **Vercel** y en el **secreto `rafaga-worker` de Modal**.
3. **IDs y usuarios**: con la clave, abre `https://zernio.com/api/v1/accounts` (cabecera `Authorization: Bearer …`) o mira el panel y anota el `accountId` de cada cuenta. Define `ZERNIO_TARGETS` (Vercel y Modal), p. ej. `[{"accountId":"<id1>","username":"@usuario1"},{"accountId":"<id2>","username":"@usuario2"}]`. Si una cuenta se reconecta y cambia de ID, el panel de Calendario marcará «revisar»: verifica el `@usuario` y solo entonces actualiza el ID aquí.
4. **Espacio**: `ZERNIO_WORKSPACE_ID` = id (UUID) de tu espacio de trabajo, en Vercel y Modal. Obténlo en Supabase (SQL): `select id, name from workspaces;`.
5. **Migración 117** (`supabase/migrations/20261201000117_zernio_publishing.sql`): aplícala en el editor SQL de Supabase (proyecto `rafaga-studio-beta`). Es aditiva. Requiere la 116 aplicada antes. Después comprueba permisos: `select proname, has_function_privilege('authenticated', oid, 'execute') from pg_proc where proname in ('finish_zernio','zernio_event','publication_job');` → las tres deben dar `false`.
6. **Secreto del webhook**: elige un valor largo y aleatorio. Pégalo como `ZERNIO_WEBHOOK_SECRET` en el secreto `rafaga-worker` de Modal.
7. **Despliegue**: push a `main` (Vercel) y `modal deploy workers/modal/app.py`. Modal imprimirá la URL de `zernio_webhook`.
8. **Registrar el webhook** en Zernio: `POST /v1/webhooks/settings` (o el panel) con `url` = la URL de Modal, `secret` = el mismo `ZERNIO_WEBHOOK_SECRET` y eventos `post.scheduled`, `post.published`, `post.platform.published`, `post.platform.failed`, `post.failed`, `post.partial`, `post.tiktok.url_resolved`. Prueba con `POST /v1/webhooks/test`.
9. **Orden seguro**: migración → secretos (Vercel y Modal) → despliegue → webhook. Hasta el paso 7 la función queda inactiva (`not_configured`).

## Verificación con cuentas reales (pendiente)
Con un clip aprobado por cuenta: programar ambos desde Calendario → esperar la hora → abrir cada enlace de TikTok sin iniciar sesión → comprobar que pertenece al `@usuario` previsto y que no pidió confirmación desde el móvil → revisar en Zernio que hay dos conexiones y ningún cargo. Hasta hacerlo, **no se marca como verificado**.

## Notas y límites honestos
- El contrato de `GET /v1/accounts` no se pudo leer en la documentación (la página devolvió 404): por eso el cruce de identidad usa `GET /v1/accounts/health` (que trae `accountId`, `username`, `canPost`, `needsReconnect`).
- No se encontraron en la documentación los campos de **consentimiento de música ni de contenido generado por IA** de `tiktokSettings`: solo se envían los documentados (`content_preview_confirmed`, `express_consent_given`, comentarios/dúo/stitch, contenido comercial). La declaración de música se registra en Ráfaga.
- No hay conciliación por consulta a Zernio tras una respuesta dudosa pasadas 24 h (no se verificó un endpoint de consulta); en ese caso el envío se detiene y se pide revisar el panel.
- Los reintentos por límite dependen del barrido del worker (cada 3 min) y de `retry_at`.
- Con el plan gratuito, TikTok for Business admite 15 vídeos por cuenta y 24 h; Zernio retiene los envíos que excedan 25 posts/hora por cuenta.
