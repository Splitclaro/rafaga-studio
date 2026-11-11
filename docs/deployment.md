# Despliegue y operación

## Piezas
| Pieza | Dónde | Cómo se despliega |
|---|---|---|
| Web (Next.js 16, React 19, Tailwind 4) | Vercel, proyecto `rafaga-studio` | Automático en cada push a `main` (`apps/web`) |
| Base de datos, Auth, Storage | Supabase `rafaga-studio-beta` (`attrnwbcgascvppncucl`, Free) | Migraciones SQL en `supabase/migrations/` aplicadas a mano en el editor SQL (sin CLI en este entorno); registro en `docs/STATUS.md` |
| Worker de medios (ffmpeg, OpenCV, ASR, IA) | GitHub Actions `.github/workflows/worker.yml` (ubuntu-24.04, 4 vCPU) | Cron cada 5 min + `workflow_dispatch`; se mantiene caliente 10 min tras el último trabajo |
| Programador en la base de datos | pg_cron + pg_net (`scheduler_tick`) | Migración 15; arranca el worker si existe el secreto `gh_dispatch_token` en Vault |

## Variables de entorno

**Vercel (web)**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (públicas; en código hay valores por defecto).
- `GH_DISPATCH_TOKEN` — token de GitHub (Actions: write) para arrancar el worker al instante. **Pendiente.**
- `YOUTUBE_API_KEY` — YouTube Data API v3. **Pendiente.**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE` (opcional). **Pendientes.**
- No hay clave de servicio de Supabase en Vercel: todo acceso a datos desde la web va con el JWT del usuario y pasa por RLS.

**GitHub Actions (worker)**
- `SUPABASE_SECRET_KEY`, `DEEPGRAM_API_KEY` (configurados), `ANTHROPIC_API_KEY` (configurado, sin saldo), `GROQ_API_KEY` (pendiente).
- Variables opcionales: `ASR_PROVIDER` (`deepgram`|`groq`), `LLM_PROVIDER` (`anthropic`|`groq`), `GROQ_*_MODEL`, `AI_TARIFFS` (JSON), `GLOBAL_DAILY_STT_MINUTES`.
- La compuerta del workflow exige Supabase y al menos un proveedor de transcripción.

## Procedimiento de release
1. `pnpm test` en la raíz (213+ pruebas; las de OpenCV se omiten sin `opencv-python-headless==4.10.0.84`).
2. `cd apps/web && pnpm typecheck && pnpm build`.
3. Si hay migración nueva: aplicarla en el editor SQL de Supabase **antes** del push (la web desplegada puede llamar a RPC nuevas), verificar privilegios con una consulta (`information_schema.role_table_grants`, `has_function_privilege`) y anotarla en `docs/STATUS.md`.
4. Push a `main` → Vercel despliega. Comprobar con `curl -I https://rafaga-studio.vercel.app/login` y, para rutas nuevas, que respondan `401` sin sesión (`/api/youtube/search`, `/api/oauth/start`).
5. Autopruebas en la nube cuando toque: `gh workflow run worker.yml -f mode=selftest|lyrics-selftest|looks-selftest|reframe-selftest|perf-selftest`.

## Vuelta atrás
- Web: en Vercel, «Promote» del despliegue anterior (los despliegues son inmutables).
- Base de datos: las migraciones son aditivas (columnas, tablas, funciones `create or replace`); no hay migraciones destructivas. Para revertir una función, aplicar la versión anterior del archivo. Copias de seguridad: las diarias del plan de Supabase (Free: 7 días).
- Worker: el workflow usa el commit de `main`; revertir el commit y volver a lanzar.

## Pruebas de humo tras desplegar
- Entrar, crear un proyecto con un vídeo corto (≥15 s, <50 MB), «Detectar momentos», esperar el primer clip, abrirlo en el editor y exportar MP4; comprobar que el archivo descargado reproduce con audio y subtítulos.
- Lyric Studio: subir una canción, generar 1 vídeo con un look de referencia.
- Conexiones: con las variables OAuth configuradas, Conectar → Probar → Ver mis vídeos.

## Límites conocidos del entorno actual
- Supabase Free: 50 MB por archivo (vídeos largos requieren Pro o subida por partes).
- Worker en Actions: no puede recibir conexiones entrantes (sin ingesta RTMP) y el primer clip de un lote tarda ~15 s solo en render con 4 vCPU.
- Correo de confirmación con el SMTP gratuito de Supabase: limitado para testers externos.
