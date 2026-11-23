# Registro de entregas de paridad · fase de ejecución

Cada entrega: requisito (fila de la matriz), implementación, caso de prueba, entorno, resultado y evidencia. **«Local» no es «producción»**: nada se ha desplegado ni empujado.

| Entrega | Fila(s) | Implementación | Caso de prueba | Entorno | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| E2a · «Descargar» guarda el archivo (B-04) | EXP-01 | `attachmentQuery` y parámetro `query` en `r2Url` (`packages/providers/src/r2.ts`); `GET /api/exports/:id/url?download=1&name=…` firma con `response-content-disposition=attachment`; `ExportsV2.tsx` descarga con ancla en lugar de `window.open` | `apps/web/lib/exports.test.ts` (sin `?download=1` no fuerza descarga; con él, nombre sin comillas ni barras y `.mp4`; ajeno 404, caducado 410) | Local (PGlite + R2 simulado) | Prueba verde. **Falta**: recorrido real en producción con `ffprobe` del archivo descargado | Salida de `node --test` |
| E3 · Etiquetas de sonido fuera de los subtítulos (B-05) | CLP-08 | `dropSoundLabels` en `workers/media/src/stages/analysis.ts`, aplicado tras `mergeChunks`; el recuento va en `sound_labels_dropped` | `workers/media/src/soundlabels.test.ts` (4 casos: suelta al inicio, entre corchetes/♪, «música» dentro de frase, conserva tiempos) | Local | Prueba verde. **Falta**: corpus C6 real (Modal sin cuota) | Salida de `node --test` |
| E2b · Conexiones e Inicio leen el estado real (B-02/B-03) | CON-*, INI-* | `lib/connstate.ts` (`tiktokState`, `storageConnected`); Conexiones muestra cuentas TikTok conectadas y entregas reales y enlaza a `/app/tiktok`; Inicio dice «Conectar Drive» y que elegir vídeos llegará próximamente | `apps/web/lib/connstate.test.ts` (4 casos) | Local (typecheck verde) | Prueba verde. **Falta**: recorrido en producción con la sesión del propietario y paso a 390 px | Salida de `node --test` |

## Bloqueos registrados
- **B-09 (S1):** Modal sin crédito hasta el 1 de diciembre; impide verificar en producción los recorridos de procesamiento, selección y render.
- **Escalium:** el render a 1080p (LE-30) no dejó archivo en Descargas; repetirlo exige autorización (gasta cuota).
- **E8 (Playwright/axe):** requiere aprobar dependencias nuevas (regla 7 del repositorio).
