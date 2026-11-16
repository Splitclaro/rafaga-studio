# Plan: cuentas de TikTok con videolyrics automatizados (2026-11-16)

Objetivo: conectar **3 cuentas de TikTok** desde Ráfaga y publicar de forma masiva o calendarizada los videolyrics que genera la propia app, sin salir de ella.
Perfiles dados: **Punto de Perreo 🔥** («Tu próximo tema en repeat») y **Te Lo Dedico ⭐** («Lo que no sabes decir, aquí suena»); falta el nombre/estilo de la tercera. Referentes: @rolas_life1, @rolitas.bnjz, @rolitasviejas__, @cancion.escrita (cifras públicas de terceros, sin verificar por nosotros).

## 1. Lo que ya existe (no se rehace)
- Conexión OAuth de TikTok con PKCE y tokens guardados en servidor (`packages/providers/src/oauth.ts`, migración 29). Endpoints de Login Kit **no verificados contra una app real**.
- Publicación desde una exportación MP4 (`publishTikTok` en `workers/media/src/stages/integrations.ts`), tabla `publications`, programación (`scheduled_at`), cancelación, reintentos e idempotencia (migración 42).
- Calendario (`/app/calendario`) y generación de **N variantes + ZIP** en Lyric Studio, ya sincronizada de forma automática.
- La app dice hoy, con razón: «Publicación directa no disponible todavía».

## 2. Lo que decide si esto es viable (verificar antes de construir)
1. **App de TikTok for Developers.** Hace falta crear una app con *Login Kit* y *Content Posting API* y pedir el permiso `video.publish`. Mientras la app **no esté auditada**, la API publica **solo en privado** (`unaudited_client_can_only_post_to_private_accounts`, ya recogido en el código). La auditoría exige URLs públicas de política de privacidad y condiciones, un vídeo de demostración y la verificación de la propiedad del dominio o prefijo de URL. Los plazos y requisitos exactos los fija TikTok y hay que confirmarlos en su portal.
2. **Dominio.** Verificar un dominio `*.vercel.app` puede no ser posible; si TikTok lo rechaza hará falta un dominio propio (coste anual pequeño). Choca con la regla de 0 €: lo decide el propietario.
3. **Derechos de la música (el riesgo principal).** La API sube el MP4 tal cual, con el audio dentro. Una canción comercial publicada así puede quedar silenciada, retirada o dar avisos a la cuenta; con 3 cuentas dedicadas, el riesgo es perderlas. La vía realista: música propia o con licencia (p. ej. el catálogo de Sound Republic y sus artistas), canciones libres, o aceptar el riesgo conscientemente. No se puede «adjuntar un sonido de TikTok» por API.
4. **Políticas de plataforma.** TikTok limita el contenido repetitivo o no original y la automatización masiva. Mitigación técnica: variantes distintas por cuenta, cadencia razonable, pausas y topes diarios. No se garantiza que evite sanciones.
5. **Límites de la API** (por usuario/día y por minuto): consultarlos en la documentación vigente y reflejarlos como topes configurables.

## 3. Construcción por fases (cada una verificable)
**F0 · Preparación del propietario (sin código).** Crear la app de TikTok for Developers, política de privacidad y condiciones (Ráfaga puede servir las páginas), URIs de retorno, y pegar `TIKTOK_CLIENT_KEY/SECRET` en Vercel y Modal. Probar con cuentas de prueba del modo *sandbox*.
**F1 · Varias cuentas.** Hoy hay una conexión por proveedor y espacio. Cambio: N conexiones de TikTok con **alias** («Punto de Perreo», «Te Lo Dedico», …), estado (activa, caducada, en pausa) y renovación de tokens por cuenta. Pantalla «Cuentas de TikTok» en Conexiones.
**F2 · Perfil de contenido por cuenta.** Por cuenta: plantilla de descripción y hashtags, idioma, estilos de texto y paquetes de fondo preferidos, cadencia (publicaciones por día y franjas), topes diarios y privacidad por defecto.
**F3 · Cola de campañas.** «Campaña» = lista de canciones + cuenta(s) destino. Para cada canción: generar variantes → elegir/distribuir → programar. La app propone huecos de calendario respetando cadencia y topes; el usuario aprueba o la deja en automático. Vista de cola en Calendario (programadas, publicadas, fallidas, pausadas) con botón de pausa global.
**F4 · Publicación masiva.** «Programar lote»: N exportaciones → cuentas → huecos, con separación y variación de horas; reintentos con retroceso, avisos si falla, y registro de cada intento.
**F5 · Medición.** Lectura de métricas públicas del propio vídeo por la API (vistas, me gusta) para ver qué estilo, canción y hora funcionan y priorizar variantes. Solo lo que la API devuelve para cuentas conectadas; no se hace scraping de TikTok.
**F6 · Salvaguardas.** Simulación («dry-run») antes de publicar, deduplicación entre cuentas, detección de música sin licencia declarada (campo «origen de la música» obligatorio por canción), y bloqueo si la app sigue sin auditar (todo saldría privado).

## 4. Estrategia de uso diaria propuesta
1. Elegir 10–20 canciones a la semana (selección propia o referentes públicos, sin extraer datos de TikTok).
2. Subir la canción; la letra se sincroniza sola; el estudio genera 3–5 variantes por cuenta (cada cuenta con su identidad visual y su tono: Punto de Perreo = energía, Te Lo Dedico = emoción y dedicatorias).
3. La cola programa sola; el usuario revisa 1–2 veces al día y pausa lo que no convenza.
4. Cada semana, métricas → ajustar estilos, horas y canciones.

## 5. Orden recomendado
F0 (propietario) → F1 → F2 → F3 → F4 → F5 → F6. Sin F0 no se puede probar nada real; F1–F3 se pueden construir y probar con servidores simulados antes de tener la auditoría. Hasta que TikTok audite la app, el resultado será publicar en **privado** y revisar a mano.

## 6. Lo que necesito del propietario
- Nombre y descripción de la **tercera cuenta** (el mensaje se cortó).
- Si puedes crear la **app de TikTok for Developers** (o quieres que te guíe paso a paso) y aceptas un **dominio propio** si TikTok no admite `vercel.app`.
- **Música:** qué catálogo tienes licenciado (¿Sound Republic?) o si asumes el riesgo con canciones comerciales.
