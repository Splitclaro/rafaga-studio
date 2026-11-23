// Publicación pública en TikTok vía Zernio desde el worker (la clave vive solo aquí y en el servidor web; nunca en el navegador).
// Zernio ejecuta el horario: se le envía la publicación con `scheduledFor` (UTC) en cuanto se confirma la fecha. Un envío
// retenido por cuota o límite sigue «en cola» con un reintento programado; un resultado indeterminado se reintenta con la
// MISMA Idempotency-Key (válida 24 h) y, pasado ese plazo, no se reenvía sin conciliación manual.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { zernioConfig, findTarget, creatorInfo, publicBlocker, uploadMedia, buildPostBody, postIdOf, zernioFetch, ZernioError, type PostOptions } from "@rafaga/providers/zernio";
import { StageError, type StageCtx, type StageResult } from "./registry.ts";

export interface ZJob {
  publication_id: string; workspace_id: string; title: string; description: string | null; state: string; object_key: string | null;
  scheduled_at: string | null; zernio_account_id: string | null; zernio_post_id: string | null; post_options: PostOptions | null; consent: Record<string, unknown> | null;
  attempts: number; created_at: string; error_code: string | null;
}
const MIN_LEAD_MS = 30_000, IDEM_SAFE_MS = 23 * 3600_000;
const durationOf = (file: string) => { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }); const n = Number(r.stdout.trim()); return Number.isFinite(n) && n > 0 ? n : null; };

/** Estado en la base de datos. `override` refleja la realidad aunque el usuario ya cancelara. */
const finish = (ctx: StageCtx, id: string, state: string, post: string | null, code: string | null, message: string | null, retryAt: Date | null = null, override = false) =>
  ctx.rpc("finish_zernio", { p_publication: id, p_state: state, p_zernio_post: post, p_code: code, p_message: message, p_retry_at: retryAt ? retryAt.toISOString() : null, p_override: override });

async function cancel(ctx: StageCtx, job: ZJob, key: string, f: typeof fetch): Promise<StageResult> {
  if (!job.zernio_post_id) return { output: { skipped: "never_sent" } };
  try {
    await zernioFetch(f, key, `/posts/${encodeURIComponent(job.zernio_post_id)}`, { method: "DELETE" });
    await finish(ctx, job.publication_id, "cancelled", null, null, null, null, true);
    return { output: { cancelled: true } };
  } catch (e) {
    const z = e as ZernioError;
    if (z.kind === "invalid" && z.status === 400) {   // ya publicada: se refleja el resultado real, no la cancelación
      await finish(ctx, job.publication_id, "published", null, "cancel_too_late", "Zernio ya había publicado el vídeo: no se pudo cancelar.", null, true);
      return { output: { cancelled: false, reason: "already_published" } };
    }
    if (z.kind === "rate") { await finish(ctx, job.publication_id, "cancelled", null, "cancel_pending", "La cancelación en Zernio quedó pendiente por el límite de peticiones.", null, true); throw new StageError("rate_limited", "Zernio limitó la petición; se reintentará."); }
    throw new StageError("cancel_failed", `No se pudo cancelar en Zernio: ${z.message}`);
  }
}

export async function runZernio(ctx: StageCtx, row: { params: Record<string, unknown> }, job: ZJob, tmpFile: () => Promise<string>, f: typeof fetch): Promise<StageResult> {
  const id = job.publication_id, fail = async (code: string, msg: string): Promise<StageResult> => { await finish(ctx, id, "failed", null, code, msg); return { output: { state: "failed", code } }; };
  const cfg = zernioConfig(ctx.env ?? {});
  if (!cfg.ok) return fail("not_configured", `Zernio no está configurado en el worker: ${cfg.reason}.`);
  if (job.workspace_id !== cfg.workspaceId) return fail("workspace_not_authorized", "Este espacio no está autorizado para publicar con Zernio.");
  if (!job.zernio_account_id || !findTarget(cfg, job.zernio_account_id)) return fail("account_not_authorized", "La cuenta de destino no está en la lista autorizada.");
  if (row.params.action === "cancel") return cancel(ctx, job, cfg.key, f);
  if (job.state === "cancelled") return { output: { skipped: "cancelled" } };
  if (job.zernio_post_id && ["scheduled", "processing", "published"].includes(job.state)) return { output: { skipped: "already_sent" } };
  if (!job.object_key) return fail("render_not_ready", "La exportación ya no está disponible. Renuévala y vuelve a programar.");
  if (!ctx.r2) return fail("not_configured", "R2 no está configurado en el worker.");
  if (!job.consent || job.consent.preview_confirmed !== true || job.consent.express_consent !== true) return fail("consent_required", "Falta la revisión y el consentimiento explícito de la publicación.");
  // Un reintento tras un resultado indeterminado solo es seguro dentro de la ventana de idempotencia de 24 h.
  if (job.error_code === "zernio_indeterminate" && Date.now() - Date.parse(job.created_at) > IDEM_SAFE_MS) return fail("zernio_reconcile", "No se pudo confirmar si Zernio recibió el envío y ya venció la ventana segura de reintento. Comprueba el panel de Zernio antes de volver a programarlo.");
  const when = job.scheduled_at ? Date.parse(job.scheduled_at) : null;
  if (when !== null && when < Date.now() + MIN_LEAD_MS) return fail("schedule_in_past", "La fecha programada ya pasó o es inminente: no se envía para evitar una publicación inmediata no deseada. Reprograma el vídeo.");
  try {
    await finish(ctx, id, "uploading", null, null, null);
    const file = await tmpFile();
    const blocker = publicBlocker(await creatorInfo(f, cfg.key, job.zernio_account_id), durationOf(file));
    if (blocker) return fail("account_cannot_post", blocker);
    const mediaUrl = await uploadMedia(f, cfg.key, `${id}.mp4`, readFileSync(file));   // la clave de API no se envía al uploadUrl firmado
    const now = when === null;
    const body = buildPostBody({ content: (job.description || job.title), mediaUrl, accountId: job.zernio_account_id, scheduledForIso: when === null ? null : new Date(when).toISOString(), publishNow: now, options: job.post_options ?? {}, externalId: id });
    const r = await zernioFetch<{ post?: { _id?: string; id?: string; status?: string } }>(f, cfg.key, "/posts", { method: "POST", body, headers: { "Idempotency-Key": id } });
    const post = postIdOf(r.data), st = r.data.post?.status;
    if (!post) return fail("zernio_bad_response", "Zernio aceptó el envío pero no devolvió su identificador; comprueba el panel de Zernio.");
    const state = st === "published" ? "published" : now || st === "publishing" ? "processing" : "scheduled";
    await finish(ctx, id, state, post, null, null);
    return { output: { state, zernio_post: post } };
  } catch (e) {
    if (e instanceof StageError) return fail(e.code, e.message);
    if (!(e instanceof ZernioError)) return fail("publish_failed", (e as Error).message.slice(0, 300));
    const retry = (s: number, code: string, msg: string) => finish(ctx, id, "queued", null, code, msg, new Date(Date.now() + Math.max(60, s) * 1000)).then(() => ({ output: { state: "queued", code } }) as StageResult);
    if (e.kind === "rate") return retry(e.retryAfterS ?? 60, "zernio_hold", "Retenida por el límite de peticiones de Zernio; se reintentará sola.");
    if (e.kind === "payment") return fail("zernio_payment", "Zernio exige un plan de pago para esta operación (por ejemplo, más de 2 cuentas conectadas). Envío detenido: no se añadió tarjeta.");
    if (e.kind === "auth") return fail("zernio_auth", "Zernio rechazó la clave o la cuenta (reconéctala en Zernio y revisa ZERNIO_API_KEY).");
    if (e.kind === "conflict") return retry(e.retryAfterS ?? 60, "zernio_conflict", "Zernio todavía procesa este envío; se comprobará de nuevo.");
    if (e.kind === "network" || e.kind === "server") return retry(300, "zernio_indeterminate", "No se pudo confirmar el envío a Zernio; se reintentará con la misma clave para no duplicar.");
    return fail("zernio_rejected", e.message);
  }
}
