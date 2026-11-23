// Envío de un vídeo a Zernio y cancelación. Lógica pura (fetch, lectura del MP4 y registro de estado inyectados): la ejecuta el servidor web
// al pulsar Programar, SIN depender del worker de Modal, de modo que publicar en TikTok sigue funcionando aunque se agote la cuota de render.
// Zernio ejecuta el horario (`scheduledFor`). Un envío retenido por cuota queda «en cola» con `retryAt`; un resultado indeterminado se reintenta con
// la MISMA Idempotency-Key (válida 24 h) y, pasado ese plazo, no se reenvía sin conciliación manual.
import { findTarget, creatorInfo, publicBlocker, uploadMedia, buildPostBody, postIdOf, zernioFetch, ZernioError, type PostOptions, type ZernioConfig } from "./zernio.ts";

export interface SendJob {
  publication_id: string; workspace_id: string; title: string; description: string | null; state: string; scheduled_at: string | null;
  zernio_account_id: string | null; zernio_post_id: string | null; post_options: PostOptions | null; consent: Record<string, unknown> | null;
  created_at: string; error_code: string | null; duration_ms?: number | null;
}
export interface StateUpdate { state: string; post?: string | null; code?: string | null; message?: string | null; retryAt?: Date | null; override?: boolean }
export type Recorder = (r: StateUpdate) => Promise<void>;
export interface SendResult { state: string; code?: string; message?: string; post?: string; retryAt?: Date }
type Cfg = Extract<ZernioConfig, { ok: true }>;
const MIN_LEAD_MS = 30_000, IDEM_SAFE_MS = 23 * 3600_000;

export async function sendToZernio(d: { f: typeof fetch; cfg: Cfg; job: SendJob; getBytes: () => Promise<Uint8Array>; record: Recorder; now?: () => number }): Promise<SendResult> {
  const { f, cfg, job, record } = d, now = d.now ?? Date.now, id = job.publication_id;
  const fail = async (code: string, message: string): Promise<SendResult> => { await record({ state: "failed", code, message }); return { state: "failed", code, message }; };
  if (job.workspace_id !== cfg.workspaceId) return fail("workspace_not_authorized", "Este espacio no está autorizado para publicar con Zernio.");
  if (!job.zernio_account_id || !findTarget(cfg, job.zernio_account_id)) return fail("account_not_authorized", "La cuenta de destino no está en la lista autorizada.");
  if (job.state === "cancelled") return { state: "cancelled" };
  if (job.zernio_post_id && ["scheduled", "processing", "published"].includes(job.state)) return { state: job.state, post: job.zernio_post_id };   // ya enviado: no se repite
  if (!job.consent || job.consent.preview_confirmed !== true || job.consent.express_consent !== true) return fail("consent_required", "Falta la revisión y el consentimiento explícito de la publicación.");
  if (job.error_code === "zernio_indeterminate" && now() - Date.parse(job.created_at) > IDEM_SAFE_MS)
    return fail("zernio_reconcile", "No se pudo confirmar si Zernio recibió el envío y ya venció la ventana segura de reintento. Comprueba el panel de Zernio antes de volver a programarlo.");
  const when = job.scheduled_at ? Date.parse(job.scheduled_at) : null;
  if (when !== null && when < now() + MIN_LEAD_MS) return fail("schedule_in_past", "La fecha programada ya pasó o es inminente: no se envía para evitar una publicación inmediata no deseada. Reprograma el vídeo.");
  try {
    await record({ state: "uploading" });
    const blocker = publicBlocker(await creatorInfo(f, cfg.key, job.zernio_account_id), job.duration_ms ? job.duration_ms / 1000 : null);
    if (blocker) return fail("account_cannot_post", blocker);
    const mediaUrl = await uploadMedia(f, cfg.key, `${id}.mp4`, await d.getBytes());   // la clave de API no se envía al uploadUrl firmado
    const publishNow = when === null;
    const body = buildPostBody({ content: job.description || job.title, mediaUrl, accountId: job.zernio_account_id, scheduledForIso: when === null ? null : new Date(when).toISOString(), publishNow, options: job.post_options ?? {}, externalId: id });
    const r = await zernioFetch<{ post?: { _id?: string; id?: string; status?: string } }>(f, cfg.key, "/posts", { method: "POST", body, headers: { "Idempotency-Key": id } });
    const post = postIdOf(r.data), st = r.data.post?.status;
    if (!post) return fail("zernio_bad_response", "Zernio aceptó el envío pero no devolvió su identificador; comprueba el panel de Zernio.");
    const state = st === "published" ? "published" : publishNow || st === "publishing" ? "processing" : "scheduled";
    await record({ state, post }); return { state, post };
  } catch (e) {
    if (!(e instanceof ZernioError)) return fail("publish_failed", (e as Error).message.slice(0, 300));
    const hold = async (s: number, code: string, message: string): Promise<SendResult> => { const retryAt = new Date(now() + Math.max(60, s) * 1000); await record({ state: "queued", code, message, retryAt }); return { state: "queued", code, message, retryAt }; };
    if (e.kind === "rate") return hold(e.retryAfterS ?? 60, "zernio_hold", "Retenida por el límite de peticiones de Zernio. Reintenta en unos minutos.");
    if (e.kind === "payment") return fail("zernio_payment", "Zernio exige un plan de pago para esta operación (por ejemplo, más de 2 cuentas conectadas). Envío detenido: no se añadió tarjeta.");
    if (e.kind === "auth") return fail("zernio_auth", "Zernio rechazó la clave o la cuenta (reconéctala en Zernio y revisa ZERNIO_API_KEY).");
    if (e.kind === "conflict") return hold(e.retryAfterS ?? 60, "zernio_conflict", "Zernio todavía procesa este envío. Comprueba de nuevo en un momento.");
    if (e.kind === "network" || e.kind === "server") return hold(300, "zernio_indeterminate", "No se pudo confirmar el envío a Zernio. Pulsa Reintentar: se usa la misma clave y no se duplica.");
    return fail("zernio_rejected", e.message);
  }
}

/** Cancelación en Zernio. Si el vídeo ya estaba publicado se refleja el resultado real, no la cancelación. */
export async function cancelAtZernio(d: { f: typeof fetch; cfg: Cfg; job: Pick<SendJob, "zernio_post_id">; record: Recorder }): Promise<{ cancelled: boolean; reason?: string }> {
  if (!d.job.zernio_post_id) return { cancelled: true, reason: "never_sent" };
  try {
    await zernioFetch(d.f, d.cfg.key, `/posts/${encodeURIComponent(d.job.zernio_post_id)}`, { method: "DELETE" });
    await d.record({ state: "cancelled", override: true }); return { cancelled: true };
  } catch (e) {
    const z = e as ZernioError;
    if (z instanceof ZernioError && z.kind === "invalid" && z.status === 400) { await d.record({ state: "published", code: "cancel_too_late", message: "Zernio ya había publicado el vídeo: no se pudo cancelar.", override: true }); return { cancelled: false, reason: "already_published" }; }
    await d.record({ state: "cancelled", code: "cancel_pending", message: "La cancelación en Zernio no se pudo confirmar; comprueba el panel de Zernio.", override: true });
    return { cancelled: false, reason: z instanceof ZernioError ? z.kind : "error" };
  }
}
