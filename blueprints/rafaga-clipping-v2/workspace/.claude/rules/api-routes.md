---
description: Rutas de API de Next y su lógica de apoyo
paths:
  - "apps/web/app/api/**"
  - "apps/web/lib/**"
---

- Un `route.ts` solo exporta métodos HTTP y `dynamic = "force-dynamic"`; responde con `Response.json`.
- Recursos agrupados en `[[...slug]]` (`uploads`, `generations`, `clips`, `exports`, `jobs`) y `[integration]/[[...rest]]`
  (`import`, `publish`); `params` es una promesa (`await params`).
- Autenticación con `userFrom(req)`; base de datos solo por RPC como el usuario (`rpcAs` de `oauthserver.ts`), nunca con
  la clave de servicio en la web.
- Errores con el sobre `{ error: { code, message } }` + campos extra, vía `mapDbError`/`fail` de `apps/web/lib/api.ts`;
  textos de usuario de `errorFor(code)` en español.
- Todo POST que crea trabajo o sesión exige `Idempotency-Key` (`idempotencyKey(req)`).
- URLs firmadas de R2 solo después de una RPC con el JWT del usuario; si no es suyo, 404 sin firmar.
- Pruebas en `apps/web/lib/*.test.ts`: importan el `route.ts`, fijan `globalThis.fetch = fakeSupabaseFetch(db, other)` y
  llaman a `POST/GET(req, { params: Promise.resolve({ slug: [...] }) })`; ninguna toca la red.
- Interfaz: componentes existentes de `apps/web/components/ui/`; ningún color, fuente ni estilo nuevo.
- Contratos congelados: respuesta de `/api/wake` y `/api/storage`.
