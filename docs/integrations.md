# Integraciones y requisitos externos

Estado real a 2026-11-10. «Implementado» significa código y pruebas en el repositorio; «operativo» exige además credenciales en el entorno desplegado y una prueba real. Nada de lo marcado como pendiente se presenta como funcional en la interfaz.

## Resumen

| Integración | Flujo | Implementado | Operativo | Qué falta |
|---|---|---|---|---|
| Deepgram (ASR) | Transcripción con marcas de tiempo (nova-3) | Sí | **Sí** (`DEEPGRAM_API_KEY` en GitHub Actions; autoprueba 42629711496) | — |
| Anthropic (selección editorial) | Candidatos a partir del transcript | Sí | No (sin saldo) | Saldo en la cuenta, o usar Groq |
| Groq (ASR + editorial + visión) | Whisper large-v3-turbo, llama-3.3-70b, visión | Sí (probado contra servidor falso) | No | `GROQ_API_KEY` en GitHub Actions; `ASR_PROVIDER=groq`, `LLM_PROVIDER=groq` |
| YouTube por enlace | Pegar un enlace y reconocer el vídeo (título, canal, portada) | Sí (oEmbed público, sin clave) | **Sí** | Con `YOUTUBE_API_KEY` añade duración y estado de directo |
| Descargar un vídeo de YouTube por enlace | Cortar clips sin subir el archivo | **No** | No | Probado el 2026-11-11 desde el worker (GitHub Actions): YouTube responde «Sign in to confirm you're not a bot» a las IP de centro de datos. No se elude esa verificación. Hace falta el archivo (YouTube Studio → Descargar si el vídeo es tuyo) |
| Google OAuth (YouTube, Drive) | Importar vídeos propios (solo lectura) | Sí (OAuth 2.0 + PKCE, migración 29) | No | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` en Vercel; pantalla de consentimiento y URI de retorno (abajo) |
| Dropbox OAuth | Importar vídeos (solo lectura) | Sí | No | `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET` en Vercel; URI de retorno |
| Publicar en YouTube / TikTok / Instagram | Subir vídeos | **No** | No | Permisos de escritura y revisión de la app por cada plataforma (Google: `youtube.upload` + verificación; TikTok Content Posting API: revisión; Instagram Graph API: cuenta profesional + revisión) |
| Señal de directo | Lista HLS autorizada | Sí (captura, ventanas con contexto) | Sí para HLS público; **no** para RTMP | Servidor de ingesta RTMP (coste) |
| GitHub (arranque del worker) | `workflow_dispatch` al encolar | Sí | No | `GH_DISPATCH_TOKEN` en Vercel (Actions: write) |
| Supabase | Base de datos, Storage, Auth | Sí | **Sí** | 1 GB total en Free (portadas, renders, canciones; originales si no hay R2) |
| Cloudflare R2 (originales) | Vídeos fuente de hasta 4 GB, 10 GB gratis, sin coste de salida | Sí (SigV4 probado con el vector oficial de AWS, migración 32) | No | Activar R2, crear bucket, CORS y token (abajo); variables `R2_*` en Vercel y GitHub |

## OAuth: cómo está hecho y qué configurar

**Diseño de seguridad**
- Autorización con código + **PKCE (S256)** y `state` aleatorio guardado en `sessionStorage` del navegador (anti-CSRF).
- El navegador pide la URL de autorización a `/api/oauth/start` (solo añade el `client_id`, público, y los permisos mínimos).
- El retorno llega a `/app/conexiones/callback`; la página valida `state` y envía el código a `/api/oauth/exchange`, que canjea el código con el **secreto de cliente (solo en servidor)** y guarda los tokens en Supabase **como el usuario** (`oauth_save`, exige rol owner/admin). El navegador nunca recibe tokens.
- Tabla `oauth_connections`: sin políticas RLS ni privilegios para `anon`/`authenticated`; solo se accede por RPC (`oauth_status` sin tokens; `oauth_token` solo responsables, usada por el servidor) y por el worker con clave de servicio.
- Renovación automática con `refresh_token` cuando faltan <2 min; revocación en el proveedor al desconectar; auditoría (`oauth.connect`, `oauth.disconnect`).
- Pruebas: 7 unitarias (`packages/providers/src/oauth.test.ts`) y RLS (`supabase/tests/rls.test.ts`).

**Permisos solicitados (mínimos)**
- YouTube: `youtube.readonly` (listar vídeos propios). Publicar exigiría `youtube.upload` y la verificación de Google: no se pide.
- Drive: `drive.readonly`.
- Dropbox: `files.metadata.read`, `files.content.read`, `account_info.read` (`token_access_type=offline`).

**Configuración pendiente (la hace la persona responsable)**
1. Google Cloud → Credenciales → ID de cliente OAuth (aplicación web). URI de redirección autorizado: `https://rafaga-studio.vercel.app/app/conexiones/callback`. Pantalla de consentimiento en modo prueba con los usuarios de la beta. Habilitar YouTube Data API v3 y Google Drive API.
2. Dropbox App Console → app con permisos anteriores. Redirect URI igual que arriba.
3. Vercel → variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET` (y `OAUTH_REDIRECT_BASE` si el dominio cambia).
4. Prueba real: Conexiones → Conectar → Probar (identidad) → Ver mis vídeos (acción permitida).

Sin estas variables, el botón «Conectar» explica exactamente qué falta; no se simula ninguna conexión.

## Importar desde una conexión (siguiente paso)
Las acciones «Ver mis vídeos» ya listan contenido real. Falta el botón «Importar» que descargue el archivo al worker (necesita el token en el worker: lo lee con la clave de servicio) y cree la fuente. Pendiente hasta tener credenciales con las que probarlo.

## Cloudflare R2: configuración

**Diseño:** los originales de vídeo se suben del navegador directamente a R2 con una URL PUT firmada (2 h) que emite `/api/storage` tras comprobar con el JWT del usuario que la fuente es suya y está pendiente. El editor lee con una URL GET firmada (1 h, admite saltos). El worker descarga en streaming con URL firmada. La clave secreta vive solo en Vercel y en GitHub Actions. Sin las variables, todo sigue en Supabase (por partes).

**Pasos (persona responsable):**
1. Cloudflare → R2 → «Add R2 subscription to my account» (plan gratuito; acepta las condiciones y la facturación por exceso).
2. Crear el bucket `rafaga-originals` (ubicación automática, clase Standard).
3. Bucket → Settings → CORS policy:
```json
[{"AllowedOrigins":["https://rafaga-studio.vercel.app","http://localhost:3000"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["content-type","range"],"ExposeHeaders":["ETag","Content-Length","Content-Range"],"MaxAgeSeconds":3600}]
```
4. R2 → Manage API tokens → Create **Account API token** con permiso «Object Read & Write» limitado al bucket `rafaga-originals`. Copiar Access Key ID y Secret Access Key (se muestran una vez).
5. Vercel (proyecto `rafaga-studio`) → Environment Variables (Production): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=rafaga-originals`. Redeploy.
6. GitHub → Splitclaro/rafaga-studio → Settings → Secrets and variables → Actions: los mismos cuatro secretos.
7. Prueba: subir un vídeo en Inicio → «Obtener clips» → el proyecto se procesa → el editor reproduce el original.

**Pendiente:** borrar de R2 el original al eliminar definitivamente un proyecto (hoy el borrado es lógico y el objeto se conserva).

## Conectar YouTube (elegir uno de mis vídeos): pasos de Google

Ráfaga usa un proyecto propio de Google Cloud (no el de otras apps). Con YouTube conectado, en Inicio → «Enlace de YouTube» aparece **«Elegir uno de mis vídeos»** (lista de solo lectura de tu canal). YouTube no entrega el archivo: tras elegirlo se pide subir el original (YouTube Studio → Contenido → Descargar).

1. Google Cloud → proyecto nuevo «Rafaga Studio» (formulario preparado en la pestaña).
2. APIs y servicios → Biblioteca → habilitar **YouTube Data API v3**.
3. Google Auth Platform → Branding (nombre «Ráfaga Studio», correo de soporte) → Público: **Externo**, en pruebas, y añadir como usuario de prueba el correo con el que se conecta el canal. Alcance: `youtube.readonly`.
4. Clientes → Crear cliente → **Aplicación web**; URI de redirección autorizado: `https://rafaga-studio.vercel.app/app/conexiones/callback`.
5. Copiar ID de cliente y secreto: pegarlos en Vercel (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, ya creadas con `PEGAR_AQUI_LA_CLAVE`) → Redeploy.
6. Ráfaga → Conexiones → YouTube → Conectar → Probar. Con la app en modo pruebas Google caduca el permiso a los 7 días; para uso continuo hay que publicar la app (para `youtube.readonly` Google exige verificación).
