# Auditoría de seguridad OWASP Top 10:2025 — Ráfaga Studio

- **Fecha:** 2026-11-14
- **Alcance:** monorepo `rafaga-studio` (commit de trabajo en `main`, árbol limpio). `apps/web` (Next.js 16, Vercel), `apps/web/lib/routes/*`, `supabase/migrations/*` (42+ migraciones, 4 242 líneas), `workers/media/src/**`, `workers/modal/app.py`, `packages/*`, `.github/workflows/worker.yml`, `scripts/modal-secret.sh`.
- **Método:** revisión **estática y de solo lectura** (lectura de código, `grep`, un script de análisis de texto sobre los `.sql` para modelar privilegios de funciones). No se ejecutó nada del proyecto (ni `pnpm`, `node`, pruebas, build ni scripts). No se leyeron archivos `.env*`. No se consultó la base de datos ni los servicios desplegados.
- **Marco:** OWASP Top 10:2025 (A01–A10). Guías de referencia de la skill leídas por categoría antes de aplicarla.
- **Contexto de ejecución clasificado:** `apps/web/app/api/**` y `apps/web/lib/routes/**` = servidor (funciones serverless de Vercel); `apps/web/app/**/page.tsx` (con `"use client"`) y `lib/supabase.ts` = navegador; `workers/media/**` y `workers/modal/app.py` = servidor/worker (Modal, con clave de servicio); `supabase/migrations/**` = base de datos (Postgres + PostgREST, accesible directamente desde el navegador con el JWT del usuario); `.github/workflows` = CI.
- **Resultados:** 4 High, 3 Medium, 7 Low, 1 Informational con hallazgo, 3 pistas/límites. No hay hallazgos Critical.

> Hecho clave de arquitectura que condiciona toda la auditoría: el navegador tiene la URL de Supabase y la clave publicable (pública por diseño), y un JWT de usuario. **Cualquier RPC de `public` con `EXECUTE` para `authenticated` se puede llamar directamente por PostgREST, saltándose las rutas `/api/*`** (límites, comprobaciones del servidor, preflight SSRF, etc.). Por tanto la frontera de seguridad real es el SQL (RLS + privilegios de función + comprobaciones internas), no las rutas Next.js. El registro abierto (`supabase.auth.signUp` en `apps/web/app/login/page.tsx:19`) hace que "usuario autenticado" equivalga prácticamente a "cualquier persona con un correo".

---

## 1. Resumen ejecutivo

| Severidad | Nº | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 4 | A01-001, A01-002, A01-003, A06-001 |
| Medium | 3 | A01-004, A06-002, A06-003 |
| Low | 7 | A01-005, A01-006, A02-001, A02-002, A08-001, A09-001, A10-001 |
| Informational | 1 | A04-001 |
| Pistas de baja confianza `[MANUAL VERIFICATION REQUIRED]` | 3 | A05-001, A07-001, A03-001 |

| Confianza | Nº |
|---|---|
| High | 8 (A01-002, A01-003, A01-004, A01-005, A01-006, A02-001, A06-003, A08-001) |
| Medium | 6 (A01-001, A06-001, A06-002, A02-002, A09-001, A10-001) |
| Low | 3 (A05-001, A07-001, A03-001) + A04-001 informativo |

**Lo más importante:**

1. **Funciones SQL "solo worker" invocables por cualquier usuario autenticado** (A01-001). La convención del propio proyecto (`CLAUDE.md:97`, `.claude/rules/migrations.md:15`: `revoke all … from public, anon`) deja el permiso que Supabase concede por defecto a `authenticated`. En las migraciones 041 y 042 las funciones del worker solo se revocan a `public, anon`, de modo que `oauth_token_for(p_ws, p_provider)` devuelve los **tokens OAuth (acceso + refresco) de YouTube/Drive/Dropbox/TikTok de cualquier workspace** a quien conozca su UUID; `export_job_item` devuelve transcripción completa y composición de cualquier render; `finish_render`/`finish_import`/`set_batch_zip` permiten manipular filas ajenas y falsear los bytes de cuota. El UUID del workspace se filtra a cualquier destinatario de un enlace de revisión (las rutas de miniatura/vídeo de `share_view` empiezan por él).
2. **`grant_units` permite a cualquier propietario acuñarse saldo ilimitado** (A01-002; incluso hay una prueba que fija ese comportamiento) y **`enqueue_job` está expuesto con etapas/parámetros libres** (A01-003): se pueden encolar etapas con `units: 0` (saltándose la reserva) y con IDs de otros workspaces, y el worker (clave de servicio) no verifica que el recurso pertenezca al workspace del trabajo.
3. **Amplificación de coste en `/api/wake` + Modal** (A06-001, A06-002): sin límite por usuario, cada llamada puede lanzar hasta 4 contenedores de 2 CPU/4 GiB durante ≥60 s de inactividad, no medidos por `compute_meter`; y el endpoint `dispatch` de Modal es público (la autenticación está dentro de la función, no en el borde), así que hasta peticiones no autenticadas arrancan contenedores. Para un proyecto que "debe costar 0 €" es el riesgo operativo más directo.

### Qué se verificó y está bien (mitigaciones confirmadas)

- Todas las rutas `apps/web/app/api/**` exigen JWT (`sessionUser`/`userFrom` validan contra `/auth/v1/user`, es decir, con revocación), usan **solo la clave publicable + el JWT del usuario** (no hay clave de servicio en Vercel; `lib/oauthserver.ts:1`, `lib/api.ts:5-7`), validan UUID con regex antes de interpolar en rutas PostgREST y delegan la autorización en RPC con RLS. No hay IDOR en las rutas por sí mismas: las URLs firmadas de R2 se emiten solo tras una RPC con el JWT del usuario (`export_object`, `source_object`, `clip_thumb_key`, `song_object`, `media_item_object`, `batch_zip_object`), y las claves de objeto se construyen en el servidor/SQL a partir de UUID (`<ws>/<id>/original`, etc.), sin entrada de usuario → no hay path traversal en claves R2.
- Todas las tablas creadas tienen RLS (incluidas las habilitadas en bucle en 034/100); `anon` no tiene acceso a tablas (`020_privilege_hardening.sql:4-5`); las escrituras directas están acotadas con `grant update (columnas)` + políticas restrictivas por rol (017). Sin `using (true)` salvo lectura de latidos del scheduler (no sensible). No se encontró asignación masiva (mass assignment).
- Todas las funciones `security definer` revisadas (≈150) llevan `set search_path = public` (comprobado con análisis de texto de las 42 migraciones).
- Enlaces de revisión (`share_links`): token de ~244 bits (2×`gen_random_uuid()`), solo se guarda su SHA-256, caducidad ≤90 días, revocación, máx. 20 activos por entrega, límites de comentarios, acceso anónimo solo vía RPC que re-validan token/estado/permisos (`022_share_links_packages.sql:61-132`); la página `revision/[token]/page.tsx` renderiza texto con React (sin `dangerouslySetInnerHTML`). Invitaciones: mismo patrón + ligadas al correo + un solo uso.
- OAuth del navegador: PKCE S256 + `state` aleatorio guardado en `sessionStorage`, comparado y consumido en el callback (`conexiones/callback/page.tsx:15-18`); el secreto de cliente solo vive en el servidor; el intercambio y las acciones usan RPC con el JWT del usuario y `can_admin`; mensajes de error con redacción de tokens. (TikTok no usa PKCE en su flujo documentado: limitación del proveedor.)
- SSRF en importación por enlace: el **worker** (`openStream`/`safeGet` en `packages/providers/src/net.ts`) fuerza https:443, rechaza credenciales y hosts internos, valida **en el momento de conectar** (lookup protegido contra DNS rebinding) y revalida cada redirección, con límites de tamaño/tiempo y sin shell. Aunque la RPC `request_import` se llame directamente (saltándose `preflightLink`), la defensa real del worker se mantiene. ffmpeg se invoca con `spawnSync` y arrays de argumentos (sin shell) sobre ficheros locales; los segmentos HLS se descargan con `safeGet`.
- Libro de unidades: `_ledger_write` (`035:23-38`) bloquea la cuenta con `for update`, aplica idempotencia por `(workspace_id, idempotency_key)` única, y `settle/refund` son idempotentes; no hay doble gasto por carrera. (El problema está en *quién puede llamar* a `grant_units`/`enqueue_job`, no en la contabilidad.)
- Modal `dispatch`: usa `hmac.compare_digest` (tiempo constante) para `X-Rafaga-Wake` (`app.py:81`). FFmpeg/Node fijados por SHA-256 en la imagen (`app.py:14,25-30`).
- Workflow `worker.yml`: `permissions: contents: read, actions: read`; solo `workflow_dispatch`; la entrada `inputs.mode` solo se usa en una expresión con lista cerrada (`worker.yml:93`) → sin inyección de expresión; secretos solo en el paso que los necesita.
- Redirección tras login (`login/page.tsx:25`): lista blanca `^/app(...)` y rechazo de `//` → sin open redirect.

---

## 2. Hallazgos por categoría

### A01:2025 — Broken Access Control

#### OWASP-A01-001 — Funciones SQL del worker invocables por cualquier usuario autenticado (OAuth tokens, transcripciones, manipulación entre workspaces)
- **CWE:** [CWE-862 Missing Authorization](https://cwe.mitre.org/data/definitions/862.html) (ver también CWE-639 para el acceso por UUID).
- **Severidad: High** — cualquier usuario con cuenta (registro abierto) puede leer credenciales OAuth y datos de otros workspaces si conoce un UUID, y alterar renders/importaciones/publicaciones ajenas.
- **Confianza: Medium** — el código y las sentencias `revoke/grant` están verificados y son concluyentes sobre lo que la migración pide; falta confirmar el ACL **desplegado** (las migraciones las aplica el propietario a mano, `.claude/rules/migrations.md:21`) y la premisa de que Supabase concede `EXECUTE` por defecto a `authenticated` en funciones nuevas de `public` (comportamiento estándar de Supabase). `[MANUAL VERIFICATION REQUIRED]` con la consulta de abajo.
- **Ubicación:**
  - `supabase/migrations/20261113000042_import_publish.sql:140-145` — `revoke … from public, anon` y `grant … to service_role` para `import_job`, `finish_import`, `publication_job`, `finish_publication`, `oauth_token_for` (l.124), `oauth_touch_for` (l.132). **No se revoca a `authenticated`.**
  - `supabase/migrations/20261113000041_exports.sql:142-145` — `revoke … from public, anon`, y la línea 145 **concede explícitamente a `authenticated`**: `_render_hash`, `export_job_item` (l.94), `finish_render` (l.107), `batch_renders` (l.120), `finish_batch`, `set_batch_zip` (l.132).
  - Causa raíz documentada como regla: `CLAUDE.md:97` y `.claude/rules/migrations.md:15` ("`revoke all … from public, anon`"). Las migraciones 035, 036, 038, 039, 040, 101–103 sí revocan también a `authenticated`; 041 y 042 no.
- **Evidencia:**
  ```sql
  -- 042:124-131 (sin comprobación de pertenencia ni de auth.uid())
  create or replace function public.oauth_token_for(p_ws uuid, p_provider text) returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare c public.oauth_connections;
  begin
    select * into c from public.oauth_connections where workspace_id = p_ws and provider = p_provider;
    ...
    return jsonb_build_object('access_token', c.access_token, 'refresh_token', c.refresh_token, ...);
  -- 042:140-144
  revoke all on function ..., public.oauth_token_for(uuid,text), ... from public, anon;
  grant execute on function public.import_job(uuid), ..., public.oauth_token_for(uuid,text), ... to service_role;
  ```
  (valores de tokens: [SECRET MASKED]; no se reproduce ninguno.)
- **Entrada y ruta de ataque:** el atacante se registra (`signUp`), obtiene un JWT y llama `POST {SUPABASE_URL}/rest/v1/rpc/oauth_token_for` con `{"p_ws":"<uuid víctima>","p_provider":"google"}`. La función es `security definer` y no consulta `auth.uid()` → devuelve `access_token` y `refresh_token`. Cómo conseguir el UUID del workspace: `share_view` (anónimo) devuelve `thumb_path`/`render_path` con prefijo `<workspace_id>/…` (`022:72-83`); cualquier destinatario de un enlace de revisión lo obtiene. Análogo para `export_job_item(p_render)` (devuelve `words` completas de la transcripción, `composition`, `title`), `import_job`/`publication_job` (claves de objeto), y las funciones `finish_*`/`set_batch_zip` (escriben estado, `storage_path` bajo el prefijo del workspace víctima y filas en `storage_objects`).
- **Mitigaciones comprobadas que no bloquean:** RLS no aplica (funciones `security definer`); no hay chequeo interno; `anon` sí está revocado (por eso hace falta cuenta); los tests PGlite no lo detectan porque el arnés concede `all on all functions` a `authenticated` (`supabase/tests/migrate.ts:41`, hook de `core.sql`) y `FINAL_GRANTS`.
- **Impacto:** robo de credenciales OAuth de terceros (publicar/leer en sus canales y Drive), lectura de transcripciones privadas, sabotaje (marcar renders fallidos, falsear `storage_path`), y **evasión de cuota**: `finish_import(p_state='done', p_bytes=1)` y `finish_render(..., p_bytes=1)` sobrescriben `storage_objects.bytes` con `on conflict (key) do update` (`042:102-104`, `041:115-117`) dejando el objeto real en R2 y la cuota a ~0. Además `set_batch_zip`/`finish_render` registran claves con caducidad que `purge_candidates` borrará de R2 pasados 30 días.
- **Arreglo (migración aditiva nueva, p. ej. `20261201000108_revoke_worker_functions.sql`):**
  ```sql
  revoke all on function
    public.import_job(uuid), public.finish_import(uuid,text,bigint,text,int,text),
    public.publication_job(uuid), public.finish_publication(uuid,text,text,text,text),
    public.oauth_token_for(uuid,text), public.oauth_touch_for(uuid,text,text,timestamptz,text,text),
    public._render_hash(text,text,boolean,jsonb), public.export_job_item(uuid),
    public.finish_render(uuid,text,text,jsonb,bigint,bigint,int,int,text),
    public.batch_renders(uuid), public.finish_batch(uuid), public.set_batch_zip(uuid,text,bigint)
  from public, anon, authenticated;
  grant execute on function <las mismas> to service_role;
  ```
  Verificar antes que ningún código de usuario las llama (comprobado: `grep` solo las encuentra en `workers/media/src/stages/{integrations,export,lyric}.ts` y pruebas; `apps/web` no las usa). Corregir la regla en `CLAUDE.md:97` y `.claude/rules/migrations.md:15` a "`revoke all … from public, anon, authenticated`" para funciones de worker, y añadir al arnés de pruebas una comprobación `has_function_privilege('authenticated', …)` para esa lista (sin conceder `all on all functions`). **Si el ACL desplegado ya estuviera corregido a mano, igualmente conviene versionar la migración.**
- **Verificación manual (propietario, en el SQL editor de Supabase):**
  `select proname, has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and prosecdef;` — y listar todas las `true` que deban ser solo del worker. Rotar los tokens OAuth de workspaces reales si hubo usuarios no confiables con cuenta.
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-862](https://cwe.mitre.org/data/definitions/862.html) · [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). → See also A06 (evasión de cuota).

#### OWASP-A01-002 — `grant_units`: cualquier propietario se concede saldo ilimitado
- **CWE:** [CWE-863 Incorrect Authorization](https://cwe.mitre.org/data/definitions/863.html)
- **Severidad: High** — rompe el modelo de unidades (control de coste y de abuso) para cualquier usuario: cada cuenta nueva es propietaria de su espacio personal (`handle_new_user`, 017:16-22).
- **Confianza: High** — lógica de la función y prueba que la fija; la única incógnita es si el ACL desplegado coincide (misma salvedad que A01-001).
- **Ubicación:** `supabase/migrations/20261113000035_credit_ledger.sql:39-46` (función) y `:79-80` (`grant execute … grant_units … to authenticated`). La prueba `supabase/tests/ledger.test.ts:21-26` verifica que el propietario "concede saldo".
- **Evidencia:**
  ```sql
  if auth.uid() is not null and not exists (select 1 from public.workspace_members
       where workspace_id = p_ws and user_id = auth.uid() and role = 'owner') then raise exception 'forbidden' ...
  if p_units <= 0 then raise exception 'invalid_units' ...
  return public._ledger_write(p_ws, 'grant', p_units, null, null, p_key, p_note);
  ```
  No hay tope, ni frecuencia, ni rol de plataforma; el cliente web no la llama (`grep` solo en pruebas/scripts), es decir, no hace falta exponerla.
- **Ruta de ataque:** usuario registrado → `rpc/grant_units {p_ws:<su espacio>, p_units:1000000, p_note:null, p_key:"x-0000001"}` → saldo ilimitado para reservar unidades en `enqueue_job`/`request_generation`.
- **Impacto:** neutraliza el límite de unidades; el único freno restante es el medidor global de Modal (`compute_meter`, 90 % de 30 USD) que bloquea a *todos* los usuarios (DoS por agotamiento), y el límite por workspace de 10 GiB de R2.
- **Arreglo:** `revoke all on function public.grant_units(uuid,numeric,text,text) from public, anon, authenticated;` y dejar solo `service_role` (el propietario concede saldo con service role / SQL editor). Si se quiere "plan de bienvenida", crear una función distinta, idempotente por usuario (una vez) y con importe fijo. Actualizar `ledger.test.ts` para llamar con rol de servicio.
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-863](https://cwe.mitre.org/data/definitions/863.html) → See also A06.

#### OWASP-A01-003 — `enqueue_job` expuesto a `authenticated` con etapas/parámetros libres; el worker confía en ellos
- **CWE:** [CWE-863 Incorrect Authorization](https://cwe.mitre.org/data/definitions/863.html)
- **Severidad: High** — salta la reserva de unidades (coste en Groq/Modal gratis) y permite que el worker (clave de servicio) opere sobre recursos de otros workspaces cuyo UUID se conozca.
- **Confianza: High** en la exposición y en la falta de validación (SQL + worker leídos); Medium en el alcance cross-tenant exacto (depende de qué etapas devuelven datos legibles por el atacante).
- **Ubicación:** `supabase/migrations/20261113000036_job_stages.sql:143-169` (`enqueue_job`), `:362-368` (`grant … enqueue_job … to authenticated`); uso legítimo único desde el cliente: `apps/web/lib/routes/clips.ts:56` (traducción). Worker: `workers/media/src/stages/analysis.ts:38,53,76-80,115-138`, `validate.ts:93-118`, `export.ts:69`, `integrations.ts:73,167` toman `row.params.*` (source_id, analysis_id, render_id, import_id, publication_id…) tal cual.
- **Evidencia:**
  ```sql
  select coalesce(sum((x->>'units')::numeric), 0) into total from jsonb_array_elements(p_stages) x;   -- units lo fija el llamante
  if total > 0 then perform public.reserve_units(...) end if;
  ...insert into public.job_stages(workspace_id, job_id, stage, seq, units, params) values (p_ws, jid, s->>'stage', ..., coalesce(s->'params','{}'))
  ```
  La única comprobación es `can_edit(p_ws)` y que `stage` esté en la lista cerrada de la tabla; `p_project`/`p_generation` no se validan contra `p_ws`; los `params` (≤8 KiB) son libres.
- **Ruta de ataque:** (a) coste: `rpc/enqueue_job` con `p_stages=[{"stage":"transcribe","seq":1,"units":0,"params":{"source_id":"<propia>"}}]` repetido → transcripción/Groq/Modal sin reservar unidades. (b) cross-tenant: stage `transcribe` con `source_id` propio y `analysis_id` de una víctima → `save_transcript(p_analysis,…)` (solo-servicio, sin comprobar tenant) escribe en el análisis ajeno; `render`/`publish`/`validate` con IDs ajenos disparan trabajo del worker sobre datos ajenos. (c) `transcribe.inputs()` (`analysis.ts:75-77`) evalúa `join(tmpDir, source_id)` y `mkdirSync(recursive)` + `readFileSync` **antes** de cualquier validación en BD, con `source_id` controlado por el atacante (p. ej. `../…`): creación de directorios fuera del tmp y huella sha-256 de ficheros arbitrarios que acaban en `input_hash` (legible por RLS).
- **Impacto:** evasión del límite de coste por unidades, manipulación de datos de otros tenants (necesita sus UUID), posible path traversal limitado en el worker.
- **Arreglo:** `revoke … enqueue_job … from authenticated` (las funciones `security definer` que la llaman internamente siguen funcionando como propietario) y exponer wrappers con etapas fijas (p. ej. `request_translate(p_clip, p_groups, p_lang, p_idem)` que calcule `units` en SQL). En el worker: validar `UUID` de `row.params.*` antes de usarlo en rutas, y comprobar en cada etapa `resource.workspace_id === row.workspace_id` (p. ej. en `source_info`, `export_job_item`, `import_job` recibir también `p_ws` y filtrar).
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-863](https://cwe.mitre.org/data/definitions/863.html).

#### OWASP-A01-004 — Rutas de subida: se firma/aborta/completa por pertenencia al espacio, no por autor ni por rol
- **CWE:** [CWE-863 Incorrect Authorization](https://cwe.mitre.org/data/definitions/863.html)
- **Severidad: Medium** — un miembro con rol `viewer`/`reviewer` puede interferir con la subida de un compañero (corromper o abortar), pero solo dentro de su propio workspace.
- **Confianza: High** (lectura directa del flujo).
- **Ubicación:** `apps/web/lib/routes/uploads.ts:96-98` (`upload_session` solo comprueba `is_member`, `037:70-76`), `:117-125` (firma de partes), `:131-135` (`mp.complete` de R2 **antes** de la RPC `complete_upload`), `:149-152` (`mp.abort` de R2 **antes** de la RPC `abort_upload`, que silenciosamente no hace nada si no eres el creador, `037:117-122`).
- **Ruta de ataque:** miembro `viewer` del espacio conoce el `upload_id` (visible por RLS en `upload_sessions`, `037:32-33`) → `DELETE /api/uploads/:id` → el servidor aborta el multipart en R2 (sin comprobar `created_by`/`can_edit`) → la subida de otro miembro falla; `POST …/parts` le da URLs firmadas de PUT sobre el objeto/partes del compañero.
- **Arreglo:** en la ruta, tras `upload_session`, exigir `s.created_by === user` (añadir `created_by` y comprobar `can_edit` en la RPC `upload_session`/o devolver 404) antes de firmar, completar o abortar en R2; mover la llamada de R2 detrás de la RPC que valida.
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-863](https://cwe.mitre.org/data/definitions/863.html).

#### OWASP-A01-005 — `oauth_token` entrega tokens crudos al navegador de cualquier admin (contradice el diseño declarado)
- **CWE:** [CWE-200 Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- **Severidad: Low** — solo `owner/admin` del propio workspace, pero cualquier XSS o admin malicioso podría extraer el refresh token.
- **Confianza: High.**
- **Ubicación:** `supabase/migrations/20261110000029_oauth_connections.sql:44-53` y `:73-74` (`grant … oauth_token … to authenticated`); el comentario de cabecera dice que "los tokens NUNCA se leen desde el navegador" (l.1) y `apps/web/app/api/oauth/action/route.ts:7` que "nunca sale al navegador".
- **Ruta:** admin → `rpc/oauth_token {p_provider:'google'}` devuelve `access_token`/`refresh_token` (`[SECRET MASKED]`).
- **Arreglo:** que la ruta `/api/oauth/action` use un único RPC solo-servicio, o que la clave de servicio viva solo en el worker (ya diseñado así) y la acción de listar/probar se haga mediante un trabajo; mínimo: `revoke … oauth_token, oauth_touch from authenticated` y mover "listar/probar/desconectar" a un RPC que no devuelva el token.
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-200](https://cwe.mitre.org/data/definitions/200.html).

#### OWASP-A01-006 — Filtro SSRF: IPv6 mapeada a IPv4 en forma hexadecimal no se reconoce como privada
- **CWE:** [CWE-918 Server-Side Request Forgery](https://cwe.mitre.org/data/definitions/918.html)
- **Severidad: Low** — el sumidero solo permite https:443 con verificación de certificado, por lo que un servicio interno sin certificado válido para el host del atacante no completa el TLS; el impacto real es muy limitado.
- **Confianza: High** en el defecto del filtro; **Low** en su explotabilidad.
- **Ubicación:** `packages/providers/src/net.ts:20-26` — `isPublicIp` solo reconoce `::ffff:a.b.c.d` con notación decimal (regex en l.22); `new URL("https://[::ffff:127.0.0.1]/")` se serializa como `[::ffff:7f00:1]` y pasaría `checkUrl` (l.36-38). También quedan fuera `64:ff9b::/96` (NAT64), `::a.b.c.d` y `fec0::/10`. Además `preflightLink` (l.119-135) resuelve el DNS con `dns.lookup` y luego hace un `fetch` separado (TOCTOU/DNS rebinding en el preflight de Vercel; el worker sí está protegido con `guardedLookup`).
- **Mitigaciones:** guardia de conexión en el worker (l.42-51), puerto fijo 443, certificados validados por defecto en `https.get`; el preflight de Vercel solo hace `HEAD` ciego sin leer cuerpo.
- **Arreglo:** normalizar IPv6 (expandir/parsear con `net.BlockList` de Node: `new net.BlockList()` con subredes `::ffff:0:0/96`, `64:ff9b::/96`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `::/128`, `::1/128`, y comprobar con `check(ip, 'ipv6')`) y usar el mismo guardia en el preflight (agente `https` con `lookup` protegido en lugar de `fetch`).
- **Refs:** [A01:2025](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/) · [CWE-918](https://cwe.mitre.org/data/definitions/918.html) · [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

---

### A02:2025 — Security Misconfiguration

#### OWASP-A02-001 — Sin CSP ni cabeceras de seguridad (clickjacking de la página de aprobación, defensa en profundidad ante XSS)
- **CWE:** sin CWE específico (observación de endurecimiento).
- **Severidad: Low** — no se ha encontrado XSS ni `dangerouslySetInnerHTML`; la ausencia amplifica cualquier fallo futuro (el JWT vive en `localStorage` por `supabase-js`, `lib/supabase.ts:8`) y permite enmarcar `/revision/[token]` (botón "aprobar").
- **Confianza: High** de que el repositorio no define cabeceras; `[MANUAL VERIFICATION REQUIRED]` para lo desplegado (Vercel añade HSTS; no hay `vercel.json` versionado).
- **Ubicación:** `apps/web/next.config.ts:1-3` (solo `transpilePackages`), no existe `middleware.ts`/`proxy.ts`.
- **Arreglo:** añadir `headers()` en `next.config.ts` con `Content-Security-Policy` (`frame-ancestors 'none'` salvo para el editor si procede; `connect-src` a Supabase/R2; `img-src`/`media-src` para blob y R2), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`. Probar primero en `Content-Security-Policy-Report-Only`.
- **Refs:** [A02:2025](https://owasp.org/Top10/2025/A02_2025-Security_Misconfiguration/) · [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).

#### OWASP-A02-002 — Imagen de Modal: copia el repo sin excluir `.env*`/docs y expone todos los secretos al endpoint público
- **CWE:** sin CWE específico (endurecimiento; relacionado con CWE-547/CWE-260 si algún día hubiese un `.env` en el árbol).
- **Severidad: Low** — hoy no hay `.env*` en el árbol (comprobado por nombre de fichero), pero la imagen se construye con `copy=True` y un filtro de exclusión incompleto.
- **Confianza: Medium.**
- **Ubicación:** `workers/modal/app.py:35-36` (`ignore` no incluye `.env*`, `docs`, `evidence`, `.spike`); `:70,74,78` (la función pública `dispatch` y las de cómputo comparten el secreto `rafaga-worker`, que contiene la clave de servicio de Supabase, claves de R2 y de Groq).
- **Arreglo:** añadir `**/.env*`, `docs`, `evidence`, `.spike`, `scripts` al `ignore`; dar a `dispatch` un secreto mínimo (solo lo necesario para `--plan`/spawn: URL y clave de servicio) separado de R2/Groq/OAuth.
- **Refs:** [A02:2025](https://owasp.org/Top10/2025/A02_2025-Security_Misconfiguration/) · CWE-547/CWE-260 (condicional).

---

### A03:2025 — Software Supply Chain Failures

#### OWASP-A03-001 — Vulnerabilidades de dependencias no evaluables `[MANUAL VERIFICATION REQUIRED]`
- **Severidad:** no determinable. **Confianza: Low.**
- Versiones declaradas: `next 16.4.5`, `react 19.3.1`, `@supabase/supabase-js ^2.119.0`, `tailwindcss 4.3.5`, `@electric-sql/pglite 0.5.15`; Modal: `opencv-python-headless==4.10.0.84`, `numpy<2.1`, `fastapi[standard]` sin fijar. Son posteriores al conocimiento disponible de este revisor y no se ejecutó ningún escáner (reglas de la auditoría: sin `pnpm audit`/red). **No se afirma que estén limpias.**
- Positivo: `pnpm-lock.yaml` (v9) presente con 125 entradas `integrity`, sin dependencias `git+`/tarball, `pnpm install --frozen-lockfile` en la imagen de Modal y en el workflow.
- **Siguiente paso:** ejecutar (con aprobación) `pnpm audit --prod` y/o OSV-scanner sobre `pnpm-lock.yaml` y `pip-audit` sobre las dependencias de Modal; habilitar Dependabot/Renovate (no hay `.github/dependabot.yml`) y secret scanning de GitHub.
- **Refs:** [A03:2025](https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/) · CWE-1395.

---

### A04:2025 — Cryptographic Failures

#### OWASP-A04-001 — Tokens OAuth en claro en la base de datos (Informational)
- **Ubicación:** `supabase/migrations/20261110000029_oauth_connections.sql:9-10` (`access_token text`, `refresh_token text`).
- **Observación:** cifrado en reposo solo a nivel de disco del proveedor; un volcado/SQL injection futuro o el fallo A01-001 expone credenciales utilizables. Considerar Supabase Vault/pgsodium o cifrado de aplicación con clave solo en el worker (el worker es el único que debería descifrar).
- **Severidad: Informational; Confianza: High.** Sin CWE específico en el mapeo de A04 de la guía.

Positivo: PKCE con `crypto.getRandomValues` (`oauth.ts:21-27`), URLs prefirmadas SigV4 correctas (`r2.ts:27-39`, vida corta 900–7200 s), tokens de enlace/invitación de ~244 bits con hash SHA-256 en BD, `hmac.compare_digest` en Modal.

---

### A05:2025 — Injection

No se confirmó ninguna inyección. SQL: funciones plpgsql con parámetros tipados; `format()` de migraciones solo con nombres de tabla constantes; PostgREST desde rutas con UUID validado por regex o enteros ya validados (`generations.ts:38`). Comandos: `spawnSync` con arrays, sin shell. XSS: React escapa; sin `dangerouslySetInnerHTML`/`innerHTML`/`eval`.

#### OWASP-A05-001 — Composición de clip sin esquema en servidor llega a `ffmpeg -filter_complex` `[MANUAL VERIFICATION REQUIRED]`
- **Severidad:** Low (si se confirma, impacto limitado a fallo del trabajo propio). **Confianza: Low.**
- **Ubicación:** `supabase/migrations/20261113000034_clipping_v2_core.sql:166-180` (`save_clip_version` guarda `p_spec` sin validar forma/tamaño; la ruta solo exige `c.v === 2`, `routes/clips.ts:28`) → `packages/composition/src/layouts.ts:80-87` (`cuts`, `kf`, `cam`, `splitTop` pasan tal cual) → `composition.ts:61-130` y `cuts.ts:61-63` (`c.s.toFixed(3)`, `cropXExpr` con `r4(...)`).
- **Análisis:** los valores numéricos se formatean con `toFixed`/`r4`, y si llegan cadenas el código lanza `TypeError` (el trabajo falla) en lugar de interpolar texto; no se halló una ruta de inyección real en el filtergraph. Falta confirmar `mergeCuts`/`sanitizeCam` con valores no numéricos y el tamaño máximo del jsonb.
- **Arreglo preventivo:** validar la composición con un esquema (tipos numéricos finitos, longitudes máximas, `pg_column_size(p_spec) <= N`) en `save_clip_version` y de nuevo en el worker antes de construir argumentos.

---

### A06:2025 — Insecure Design

#### OWASP-A06-001 — `/api/wake` + `dispatch` amplifican coste: sin límite por usuario y contenedores no medidos
- **CWE:** [CWE-799 Improper Control of Interaction Frequency](https://cwe.mitre.org/data/definitions/799.html)
- **Severidad: High** — para un proyecto con requisito explícito de coste 0 € ("Modal Starter"), un usuario con cuenta puede agotar el crédito gratuito mensual con un bucle trivial, y el freno `compute_meter` no lo ve.
- **Confianza: Medium** — el flujo está leído de extremo a extremo; faltan precios/límites reales de Modal y la configuración de concurrencia desplegada.
- **Ubicación:** `apps/web/lib/routes/wake.ts:10-23` (solo comprueba que el JWT sea válido; sin límite; `job_id` no se comprueba contra el usuario); `workers/modal/app.py:61-68` (`_plan_and_spawn` lanza `min(plan.ready, 4)` `drain.spawn()` **por cada llamada**), `:70-72` (`drain`: 2 CPU, 4 GiB, `--max-idle-s 60`, sin `max_containers`/`concurrency_limit`), `:85-88` (`sweeper` cada 3 min también la invoca). `plan.ready` es global (`036:277-282`): basta que *cualquier* etapa esté en cola.
- **Ruta de ataque:** usuario registrado con una etapa en cola (propia, incluso de coste 0 por A01-003) → bucle `POST /api/wake` → cada petición ejecuta `node stage.ts --plan` (hasta 60 s) y lanza hasta 4 `drain`, cada uno vivo ≥60 s de espera. `compute_meter` solo suma `cost_usd` de `finish_stage` (`036:115-127`, `204-216`), por lo que el tiempo de contenedores inactivos y de `--plan` no cuenta y el disyuntor del 90 % no salta.
- **Impacto:** agotamiento del crédito gratuito o gasto de pago; denegación de servicio por saturación.
- **Arreglo:** (1) limitador **persistente** por usuario en BD (la memoria de instancia de `ytserver.allow` no sirve en serverless) y *coalescing*: no despertar si ya se despertó hace <N s o si `running_drains >= plan.ready`; (2) `max_containers=MAX_PARALLEL` (y `concurrency_limit`) en `drain` y `run_legacy`; (3) que `/api/wake` ignore el cuerpo y lea el estado de la cola desde la BD; (4) registrar y medir también el tiempo inactivo de los `drain` en `ai_usage` para que el medidor global lo vea.
- **Refs:** [A06:2025](https://owasp.org/Top10/2025/A06_2025-Insecure_Design/) · [CWE-799](https://cwe.mitre.org/data/definitions/799.html).

#### OWASP-A06-002 — El endpoint `dispatch` de Modal es público: cualquier petición arranca el contenedor antes de comprobar el secreto
- **CWE:** [CWE-799 Improper Control of Interaction Frequency](https://cwe.mitre.org/data/definitions/799.html)
- **Severidad: Medium** — coste/DoS anónimo, aunque cada invocación inválida es breve.
- **Confianza: Medium** — depende de cómo Modal factura invocaciones rechazadas y de si el endpoint tiene URL descubrible (la URL se envía solo desde Vercel; si se filtra o se adivina, es anónimo).
- **Ubicación:** `workers/modal/app.py:78-83`. La comprobación `hmac.compare_digest` está **dentro** de la función; `@modal.fastapi_endpoint(method="POST")` sin `requires_proxy_auth=True`. Cada petición (incluso con cuerpo inválido → 422) crea/usa un contenedor de la imagen completa con todos los secretos montados (`secrets=[secret, wake_secret]`).
- **Arreglo:** `@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)` con token de proxy de Modal guardado en Vercel (autenticación en el borde, antes de arrancar código), conservar el HMAC como segunda capa, y fijar `max_containers`/`concurrency_limit` bajos en `dispatch`.
- **Refs:** [A06:2025](https://owasp.org/Top10/2025/A06_2025-Insecure_Design/) · [CWE-799](https://cwe.mitre.org/data/definitions/799.html).

#### OWASP-A06-003 — Los tamaños/cuotas se basan en lo declarado por el cliente; las URLs prefirmadas no limitan bytes; la cuota es por workspace
- **CWE:** [CWE-841 Improper Enforcement of Behavioral Workflow](https://cwe.mitre.org/data/definitions/841.html)
- **Severidad: Medium** — evasión de cuota y de límite de 4 GiB → coste de R2 (el plan Free son 10 GB en total, igual que la cuota de *un* workspace).
- **Confianza: High** (lectura del flujo y del esquema de firma `UNSIGNED-PAYLOAD`).
- **Ubicación:** `packages/providers/src/r2.ts:33` (`UNSIGNED-PAYLOAD`, solo se firma `host`: no se acota `Content-Length`); `apps/web/lib/routes/uploads.ts:49-51,117-125` (tamaño declarado `bytes`; partes de PUT firmadas sin límite); `supabase/migrations/20261113000037_upload_storage.sql:47-52,99-104` (`used + p_bytes` y `storage_objects.bytes = u.bytes` salen del valor declarado); `workers/media/src/stages/validate.ts:118` (`validateProbe(…, Number(s.bytes), …)` valida el tamaño declarado, no el real); `lyrics.ts:~120` (`media items`, 200 MiB declarados, PUT sin límite). `017:138-143` permite hasta 20 espacios + 1 personal por usuario, cada uno con 10 GiB (`create_workspace`). Sin CAPTCHA ni verificación de correo evidente en el repo. Las subidas multipart abandonadas no se purgan (sin `abort` por inactividad).
- **Ruta de ataque:** declarar `bytes=1`, subir partes arbitrariamente grandes por las URLs firmadas, completar; la cuota registra 1 byte (y A01-001 permite además reescribirla). Repetir en 21 espacios.
- **Arreglo:** tras `complete`, hacer `HEAD` del objeto en R2 y comparar con el tamaño declarado (rechazar/borrar si difiere) y registrar el tamaño **real** en `storage_objects`; regla de ciclo de vida en el bucket para abortar multipart incompletos a las 24 h; cuota **por usuario/plataforma** (suma de todos sus espacios) y un tope global de almacenamiento antes de firmar; considerar firmar la cabecera `content-length` en PUT de un solo objeto.
- **Refs:** [A06:2025](https://owasp.org/Top10/2025/A06_2025-Insecure_Design/) · [CWE-841](https://cwe.mitre.org/data/definitions/841.html).

---

### A07:2025 — Authentication Failures

#### OWASP-A07-001 — Configuración de Auth no versionada `[MANUAL VERIFICATION REQUIRED]`
- **Confianza: Low; Severidad:** no determinable.
- No hay `supabase/config.toml` ni ajustes de Auth en el repo: no se puede comprobar si la confirmación de correo está activa, la longitud mínima de contraseña en el servidor (la web exige 8 solo en el cliente, `login/page.tsx:46`), protección contra contraseñas filtradas, límites de tasa de `signInWithPassword`/`signUp`, MFA ni caducidad/rotación de sesión. El registro abierto sin verificación convierte A01-001/002/003/A06-* en explotables por cualquiera. El JWT se guarda en `localStorage` (diseño de `supabase-js`; sin cookie `HttpOnly`) → motiva A02-001.
- **Comprobar en el panel de Supabase:** Auth → Providers → Email (Confirm email = on, min password ≥ 10/12, leaked-password protection si el plan lo permite), Rate Limits, CAPTCHA (Turnstile/hCaptcha) en `signUp`, y redirect URLs permitidas.
- Positivo: validación del JWT en cada ruta contra `/auth/v1/user`; OAuth con `state`+PKCE (ver resumen).

---

### A08:2025 — Software or Data Integrity Failures

#### OWASP-A08-001 — Referencias mutables y descargas sin firma en CI/imagen
- **CWE:** [CWE-494 Download of Code Without Integrity Check](https://cwe.mitre.org/data/definitions/494.html)
- **Severidad: Low; Confianza: High.**
- **Ubicación:** `.github/workflows/worker.yml:14,23,56,63,95` (`actions/checkout@v4`, `cache@v4`, `setup-node@v4`, `upload-artifact@v4` por etiqueta, no por SHA de commit); `workers/modal/app.py:33` (`fastapi[standard]` y `numpy<2.1` sin fijar); `:24-26` (el SHA-256 de Node se descarga del mismo origen que el tarball, sin verificar firma); `:28` (`npm install -g pnpm@12.18.0` fijado: correcto).
- **Mitigaciones:** FFmpeg fijado por SHA-256 (`app.py:14,30`, `worker.yml:32,39`); `--frozen-lockfile`; permisos mínimos del `GITHUB_TOKEN`.
- **Arreglo:** fijar acciones por SHA, fijar versiones exactas con hash en el `pip_install` (p. ej. `pip install --require-hashes` con un `requirements.lock`), verificar la firma GPG de `SHASUMS256.txt` de Node.
- **Refs:** [A08:2025](https://owasp.org/Top10/2025/A08_2025-Software_or_Data_Integrity_Failures/) · [CWE-494](https://cwe.mitre.org/data/definitions/494.html).

---

### A09:2025 — Security Logging and Alerting Failures

#### OWASP-A09-001 — Sin registro ni alerta de eventos de seguridad/abuso en la ruta crítica
- **CWE:** [CWE-778 Insufficient Logging](https://cwe.mitre.org/data/definitions/778.html)
- **Severidad: Low; Confianza: Medium** (el registro de plataforma de Vercel/Modal/Supabase no está en el alcance).
- **Observaciones:** `audit_events` cubre acciones de equipo/marca/OAuth/enlaces (017, 018, 022, 029) pero no: llamadas denegadas a RPC, `wake` (ni su origen), rechazos de `dispatch` (`app.py:81-82` solo lanza `HTTPException`), accesos anónimos a `share_view` (solo un contador `views`), concesiones de unidades (`grant_units` no escribe `audit_events`; solo el libro), uso inusual de cuota. `apps/web/lib/after.ts:5` traga todos los errores del despertar sin registrar. No hay alerta de presupuesto de cómputo (solo bloqueo al 90 %).
- **Arreglo:** registrar en `audit_events` (o tabla de eventos de seguridad) `grant_units`, rechazos de `can_edit` repetidos y tokens de enlace inválidos reiterados; log estructurado en `wake`/`dispatch` (sin secretos); alerta al 50/80 % del presupuesto Modal.
- **Positivo:** la redacción de secretos en errores (`scrub` en `integrations.ts:17`, `oauth/action:40`) evita fugas en logs.

---

### A10:2025 — Mishandling of Exceptional Conditions

#### OWASP-A10-001 — Cierres parciales y detalles de error menores
- **CWE:** [CWE-460 Improper Cleanup on Thrown Exception](https://cwe.mitre.org/data/definitions/460.html)
- **Severidad: Low; Confianza: Medium.**
- **Ubicación y observaciones:**
  - `apps/web/lib/routes/uploads.ts:68-73`: si `r2Multipart.create` tiene éxito y `set_upload_r2_id` falla, queda un multipart huérfano en R2 sin limpieza; `:131-135` completa en R2 y luego llama a la RPC (si falla, estado inconsistente pero reintentable).
  - `apps/web/lib/routes/uploads.ts:135`: devuelve `detail: (e as Error).message.slice(0,120)` con códigos/mensaje del error de R2 al cliente (divulgación menor).
  - `apps/web/app/api/storage/route.ts:13-15`: `GET /api/storage` revela a cualquier usuario autenticado qué variables de R2 están `falta/marcador/ok` (reconocimiento de configuración).
  - `lib/ytserver.ts:5-10`, `lib/api.ts:21-26`: si `fetch` a `/auth/v1/user` lanza (red), la ruta responde 500 genérico (falla cerrada: correcto).
- **Arreglo:** abortar el multipart si falla `set_upload_r2_id`; no devolver `detail` de R2; restringir `GET /api/storage` a admins o eliminar `vars`.

---

## 3. Cobertura por categoría

| Categoría | Estado | Nota |
|---|---|---|
| A01 Broken Access Control | Evaluada (parcial en BD desplegada) | RPC/SQL/rutas completas; ACL desplegado y datos reales no verificables estáticamente |
| A02 Security Misconfiguration | Parcial | `next.config.ts`, Modal, workflow revisados; cabeceras desplegadas, ajustes de Vercel/Supabase/R2 (CORS del bucket, políticas, claves) no evaluables |
| A03 Supply Chain | Parcial | Lockfile y fijaciones revisados; **CVEs no evaluados** (sin escáner) |
| A04 Cryptographic Failures | Evaluada | Sin hallazgos más allá del informativo |
| A05 Injection | Evaluada | Sin inyección confirmada; una pista de baja confianza |
| A06 Insecure Design | Evaluada | Coste/cuotas/abuso; reglas de negocio finas no verificables |
| A07 Authentication Failures | **No evaluable** en lo esencial | Auth gestionada por Supabase; sin configuración en el repo |
| A08 Integrity Failures | Evaluada | |
| A09 Logging/Alerting | Parcial | Solo lo visible en código; logs/alertas de plataforma no accesibles |
| A10 Exceptional Conditions | Evaluada | |

## 4. Plan de arreglos (orden de riesgo y dependencias)

**Seguros de aplicar de inmediato (bajo riesgo de regresión, pequeñas, aditivos):**
1. Migración aditiva que **revoque a `authenticated`** las funciones del worker de 041/042 (lista en A01-001) y `grant_units` (A01-002). La web no las usa (verificado por `grep`); solo `workers/media` (service role) y pruebas. Tras ello ejecutar `pnpm test` (hay que ajustar `ledger.test.ts` que llama `grant_units` como usuario, y el arnés si reemplaza el grant amplio por uno acotado).
2. Corregir la regla de `CLAUDE.md:97` y `.claude/rules/migrations.md:15` (revocar también a `authenticated` en funciones de worker) y añadir una prueba de privilegios (`has_function_privilege`).
3. `requires_proxy_auth=True` + `max_containers` en `dispatch`/`drain`/`run_legacy` (A06-001/002) y ampliar `ignore` de la imagen (A02-002) — el despliegue lo hace el propietario.
4. Cabeceras de seguridad en `next.config.ts` (primero en Report-Only) (A02-001).
5. En `uploads.ts`: comprobar `created_by` antes de firmar/abortar/completar (A01-004).

**Requieren diseño o más pruebas:** envolver `enqueue_job` en funciones con etapas fijas (A01-003, afecta a `routes/clips.ts:56`); verificación de tamaño real con `HEAD` y cuota por usuario (A06-003); limitador persistente + coalescing de `wake` (A06-001); nuevo guardia IPv6 (`net.BlockList`) (A01-006); esquema de composición (A05-001); cifrado de tokens OAuth (A04-001).

**Acciones del propietario (fuera del repo):** ejecutar la consulta de `has_function_privilege` (A01-001); **rotar los tokens OAuth/Modal/Wake** si existieron usuarios no confiables con cuenta; revisar la configuración de Auth de Supabase (A07-001); ejecutar `pnpm audit`/OSV y Dependabot (A03-001); comprobar CORS/políticas del bucket R2 y el límite de gasto en Modal.

## 5. Limitaciones

- Auditoría **estática**: no se ejecutó código, pruebas ni escáneres; no se consultó la base de datos ni los despliegues. Las migraciones las aplica el propietario a mano, por lo que el estado real de privilegios puede diferir del repositorio.
- No evaluados: configuración de Auth de Supabase, políticas/CORS/ciclo de vida del bucket R2, variables de entorno de Vercel/Modal, cabeceras HTTP efectivas, límites de gasto y de concurrencia de Modal, alcance del token `GH_DISPATCH_TOKEN`, vulnerabilidades conocidas de las dependencias (versiones recientes no verificables aquí).
- Se asume el comportamiento estándar de Supabase para privilegios por defecto de funciones (`EXECUTE` a `anon`, `authenticated`, `service_role`); está respaldado por el hecho de que otras migraciones del proyecto revocan explícitamente a `authenticated`, pero debe confirmarse en el entorno real.
- No se reprodujo ningún valor de secreto: la clave publicable de Supabase (pública por diseño) y los identificadores de cuenta de R2 aparecen en el código/scripts y se omiten aquí (`[SECRET MASKED]`); no se encontraron claves privadas en el repositorio.
- Las pistas marcadas `[MANUAL VERIFICATION REQUIRED]` no son hallazgos confirmados.
