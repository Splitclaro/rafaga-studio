// Importación (enlace / Drive / Dropbox → R2 por partes → validate/mezzanine/proxy) y publicación (YouTube / TikTok) desde una exportación MP4.
// Sin SDKs: `fetch` inyectado (ctx.fetch) y `openUrl` inyectable (ctx.deps.openUrl) para que las pruebas no toquen la red.
// Los tokens OAuth se leen con `oauth_token_for` (solo servicio) y nunca se escriben en `output`, en logs ni en errores.
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openStream, type OpenResult } from "@rafaga/providers/net";
import { needsRefresh, refreshTokens, type OAuthProvider } from "@rafaga/providers/oauth";
import { StageError, type StageCtx, type StageImpl } from "./registry.ts";

export const MAX_IMPORT_BYTES = 4294967296;
export const PART_BYTES = 512 * 1024 * 1024;
const partKey = (key: string, i: number) => `${key}.part${String(i).padStart(3, "0")}`;
type OpenUrl = (url: string) => Promise<OpenResult>;
const dir = (ctx: StageCtx, id: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", `int-${id}`); mkdirSync(d, { recursive: true }); return d; };
const scrub = (s: string) => s.replace(/(access_token|refresh_token|client_secret|Bearer)[=\s:"]+[A-Za-z0-9._~+/-]{8,}/gi, "$1 …").replace(/[A-Za-z0-9_-]{40,}/g, "…").slice(0, 300);

// ───────── Tokens ─────────
const CFG: Record<OAuthProvider, [string, string]> = { google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], dropbox: ["DROPBOX_CLIENT_ID", "DROPBOX_CLIENT_SECRET"], tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] };
interface Conn { access_token: string; refresh_token: string | null; expires_at: string | null; scopes: string[]; status: string }
async function accessToken(ctx: StageCtx, ws: string, provider: OAuthProvider, conn?: string | null): Promise<string> {
  let c: Conn;
  try { c = await ctx.rpc<Conn>("oauth_token_for", { p_ws: ws, p_provider: provider, ...(conn ? { p_conn: conn } : {}) }); } catch { throw new StageError("not_connected", "Conecta la cuenta en Conexiones antes de continuar."); }
  if (!c || c.status === "revoked") throw new StageError("not_connected", "La conexión está revocada. Vuelve a conectarla.");
  if (!needsRefresh(c.expires_at)) return c.access_token;
  const [idk, sk] = CFG[provider], id = ctx.env?.[idk], secret = ctx.env?.[sk];
  if (!c.refresh_token || !id || !secret) throw new StageError("not_connected", "La conexión caducó. Vuelve a conectarla.");
  try {
    const t = await refreshTokens(provider, { clientId: id, clientSecret: secret }, c.refresh_token, c.scopes, ctx.fetch);
    await ctx.rpc("oauth_touch_for", { p_ws: ws, p_provider: provider, p_access: t.accessToken, p_expires_at: t.expiresAt, p_status: "connected", p_error: null, ...(conn ? { p_conn: conn } : {}) });
    return t.accessToken;
  } catch (e) {
    await ctx.rpc("oauth_touch_for", { p_ws: ws, p_provider: provider, p_access: null, p_expires_at: null, p_status: "expired", p_error: scrub((e as Error).message), ...(conn ? { p_conn: conn } : {}) });
    throw new StageError("not_connected", "La conexión caducó. Vuelve a conectarla.");
  }
}

// ───────── Importación ─────────
interface ImportJob { import_id: string; workspace_id: string; kind: "link" | "drive" | "dropbox"; ref: string; source_id: string; object_key: string }
const isVideo = (ct: string) => /^video\//i.test(ct.trim());
interface Remote { stream: NodeJS.ReadableStream; length: number | null; type: string }

async function openRemote(ctx: StageCtx, job: ImportJob, f: typeof fetch): Promise<Remote> {
  if (job.kind === "link") {
    const open = (ctx.deps?.openUrl as OpenUrl | undefined) ?? openStream;
    const r = await open(job.ref);
    if (r.status !== 200) { r.stream.destroy(); throw new StageError("unsupported_file", `El servidor respondió ${r.status}.`); }
    return { stream: r.stream, length: r.headers["content-length"] ? Number(r.headers["content-length"]) : null, type: r.headers["content-type"] ?? "" };
  }
  const provider: OAuthProvider = job.kind === "drive" ? "google" : "dropbox", token = await accessToken(ctx, job.workspace_id, provider);
  if (job.kind === "drive") {
    const id = encodeURIComponent(job.ref);
    const m = await f(`https://www.googleapis.com/drive/v3/files/${id}?fields=size,mimeType,name`, { headers: { Authorization: `Bearer ${token}` } });
    if (!m.ok) throw new StageError(m.status === 404 ? "not_found" : "unsupported_file", `Drive respondió ${m.status}.`);
    const meta = (await m.json()) as { size?: string; mimeType?: string };
    const r = await f(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok || !r.body) throw new StageError("unsupported_file", `Drive respondió ${r.status}.`);
    return { stream: Readable.fromWeb(r.body as never), length: meta.size ? Number(meta.size) : null, type: meta.mimeType ?? r.headers.get("content-type") ?? "" };
  }
  const r = await f("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: job.ref }) } });
  if (!r.ok || !r.body) throw new StageError(r.status === 409 ? "not_found" : "unsupported_file", `Dropbox respondió ${r.status}.`);
  let size: number | null = null; try { size = (JSON.parse(r.headers.get("dropbox-api-result") ?? "{}") as { size?: number }).size ?? null; } catch { /* sin metadatos */ }
  const name = (() => { try { return String((JSON.parse(r.headers.get("dropbox-api-result") ?? "{}") as { name?: string }).name ?? ""); } catch { return ""; } })();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = r.headers.get("content-type") && isVideo(r.headers.get("content-type")!) ? r.headers.get("content-type")! : ({ mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo", m4v: "video/x-m4v" } as Record<string, string>)[ext] ?? "";
  return { stream: Readable.fromWeb(r.body as never), length: size ?? (r.headers.get("content-length") ? Number(r.headers.get("content-length")) : null), type };
}

const importStage: StageImpl = {
  inputs: (_c, row) => ({ stage: "import", import: row.params.import_id, v: 1 }),
  async run(ctx, row) {
    const id = String(row.params.import_id), f = ctx.fetch ?? fetch;
    const job = await ctx.rpc<ImportJob>("import_job", { p_import: id });
    if (!job) throw new StageError("not_found", "La importación no existe");
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const fail = async (code: string, msg: string): Promise<never> => { await ctx.rpc("finish_import", { p_import: id, p_state: "failed", p_bytes: null, p_mime: null, p_parts: null, p_error: code }); throw new StageError(code, msg); };
    await ctx.rpc("finish_import", { p_import: id, p_state: "downloading", p_bytes: null, p_mime: null, p_parts: null, p_error: null });
    let remote: Remote;
    try { remote = await openRemote(ctx, job, f); } catch (e) {
      if (e instanceof StageError) return fail(e.code, e.message);
      return fail("unsupported_file", scrub((e as Error).message));
    }
    // Se decide con las cabeceras, antes de escribir nada en disco ni en R2.
    if (remote.length !== null && remote.length > MAX_IMPORT_BYTES) { (remote.stream as unknown as { destroy?: () => void }).destroy?.(); return fail("too_large", "El archivo supera los 4 GiB."); }
    if (!isVideo(remote.type)) { (remote.stream as unknown as { destroy?: () => void }).destroy?.(); return fail("unsupported_file", "El enlace no es un vídeo."); }
    const d = dir(ctx, id), file = join(d, "original");
    let bytes = 0;
    try {
      const out = createWriteStream(file);
      remote.stream.on("data", (c: Buffer) => { bytes += c.length; if (bytes > MAX_IMPORT_BYTES) (remote.stream as unknown as { destroy: (e?: Error) => void }).destroy(new StageError("too_large", "El archivo supera los 4 GiB.")); });
      await pipeline(remote.stream, out);
    } catch (e) { rmSync(file, { force: true }); return fail(e instanceof StageError ? e.code : "upload_interrupted", scrub((e as Error).message)); }
    // Subida a R2: un solo objeto o partes de 512 MiB (las que lee `validate`).
    let parts = 0;
    try {
      if (bytes <= PART_BYTES) await ctx.r2.upload(job.object_key, file, remote.type || "video/mp4");
      else {
        parts = Math.ceil(bytes / PART_BYTES);
        for (let i = 0; i < parts; i++) {
          const p = join(d, `p${i}`), end = Math.min(bytes, (i + 1) * PART_BYTES) - 1;
          await pipeline(createReadStream(file, { start: i * PART_BYTES, end }), createWriteStream(p));
          await ctx.r2.upload(partKey(job.object_key, i), p, "application/octet-stream"); rmSync(p, { force: true });
        }
      }
    } catch (e) { return fail("upload_interrupted", scrub((e as Error).message)); }
    finally { rmSync(file, { force: true }); }
    await ctx.rpc("finish_import", { p_import: id, p_state: "done", p_bytes: bytes, p_mime: remote.type || null, p_parts: parts, p_error: null });
    return { output: { source_id: job.source_id, bytes, parts } };
  },
};

// ───────── Publicación ─────────
interface PubJob { publication_id: string; workspace_id: string; platform: "youtube" | "tiktok"; title: string; description: string | null; privacy: string; state: string; object_key: string | null; bytes: number | null; connection_id?: string | null; post_options?: { comment?: boolean; duet?: boolean; stitch?: boolean; commercial?: boolean; own_brand?: boolean; paid_partner?: boolean } }
type Done = { state: "published" | "private_pending_review" | "requiere_auditoria" | "processing"; external?: string | null; code?: string; message?: string };
export const TIKTOK_UNAUDITED = "unaudited_client_can_only_post_to_private_accounts";

async function publishYouTube(ctx: StageCtx, job: PubJob, file: string, f: typeof fetch): Promise<Done> {
  const token = await accessToken(ctx, job.workspace_id, "google"), size = statSync(file).size;
  const init = await f("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ snippet: { title: job.title, description: job.description ?? "" }, status: { privacyStatus: job.privacy, selfDeclaredMadeForKids: false } }) });
  const loc = init.headers.get("location");
  if (!init.ok || !loc) throw new StageError(init.status === 403 ? "forbidden" : "publish_failed", `YouTube rechazó la subida (${init.status}).`);
  const put = await f(loc, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: readFileSync(file) });
  if (!put.ok) throw new StageError("publish_failed", `YouTube respondió ${put.status} al recibir el vídeo.`);
  const j = (await put.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string } };
  if (!j.id) throw new StageError("publish_failed", "YouTube no devolvió el identificador del vídeo.");
  // Un proyecto de API sin verificar fuerza `private`: se avisa en lugar de afirmar que está publicado.
  if (job.privacy !== "private" && j.status?.privacyStatus === "private")
    return { state: "private_pending_review", external: j.id, code: "private_pending_review", message: "YouTube dejó el vídeo en privado hasta que la app de Google pase su revisión." };
  return { state: "published", external: j.id };
}

const TT = "https://open.tiktokapis.com/v2/post/publish";
type TtEnv = { data?: { publish_id?: string; upload_url?: string; status?: string; fail_reason?: string }; error?: { code?: string; message?: string } };
/** Sube el MP4 a la URL que dio TikTok y espera el estado. «SEND_TO_USER_INBOX» = borrador entregado en la bandeja del creador. */
async function sendTikTokFile(ctx: StageCtx, f: typeof fetch, H: Record<string, string>, file: string, size: number, nj: TtEnv): Promise<Done> {
  const put = await f(nj.data!.upload_url!, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: readFileSync(file) });
  if (!put.ok) throw new StageError("publish_failed", `TikTok respondió ${put.status} al recibir el vídeo.`);
  const pid = nj.data!.publish_id!;
  for (let i = 0; i < 30; i++) {   // hasta ~60 s: TikTok tarda en procesar el vídeo subido
    const st = await f(`${TT}/status/fetch/`, { method: "POST", headers: H, body: JSON.stringify({ publish_id: pid }) });
    const sj = (await st.json().catch(() => ({}))) as TtEnv;
    if (sj.data?.status === "PUBLISH_COMPLETE") return { state: "published", external: pid };
    if (sj.data?.status === "SEND_TO_USER_INBOX") return { state: "private_pending_review", external: pid, message: "Enviado como borrador a tu bandeja de TikTok: ábrelo en la app de TikTok (Bandeja → Notificaciones del sistema) y pulsa Publicar con la privacidad que quieras." };
    if (sj.data?.status === "FAILED") throw new StageError("publish_failed", `TikTok falló: ${sj.data.fail_reason ?? "sin motivo"}.`);
    await (ctx.deps?.sleep as ((ms: number) => Promise<void>) | undefined)?.(2000) ?? await new Promise((r) => setTimeout(r, 2000));
  }
  return { state: "processing", external: pid };
}
/** Opciones de interacción y contenido comercial de TikTok; lo que la cuenta tiene desactivado en TikTok no se puede activar desde fuera. Contenido de marca no puede ser privado (lo comprueba el diálogo). */
export function tikTokFlags(o: PubJob["post_options"], c?: { comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }) {
  const x = o ?? {};
  return { disable_comment: !x.comment || !!c?.comment_disabled, disable_duet: !x.duet || !!c?.duet_disabled, disable_stitch: !x.stitch || !!c?.stitch_disabled,
    ...(x.commercial ? { brand_content_toggle: !!x.paid_partner, brand_organic_toggle: !!x.own_brand } : {}) };
}
async function publishTikTok(ctx: StageCtx, job: PubJob, file: string, f: typeof fetch): Promise<Done> {
  const token = await accessToken(ctx, job.workspace_id, "tiktok", job.connection_id), size = statSync(file).size;
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" };
  const src = { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
  const unaudited = (e: { code?: string } | undefined) => e?.code === TIKTOK_UNAUDITED;
  /** Respaldo sin auditoría: TikTok no permite la publicación directa pública, pero sí enviar el vídeo como borrador a la bandeja del creador (permiso video.upload). */
  const toInbox = async (): Promise<Done> => {
    const r = await f(`${TT}/inbox/video/init/`, { method: "POST", headers: H, body: JSON.stringify({ source_info: src }) });
    const nj = (await r.json().catch(() => ({}))) as TtEnv;
    if (unaudited(nj.error)) return { state: "requiere_auditoria", code: "requiere_auditoria", message: "TikTok no deja publicar ni enviar borradores desde una app sin auditar a esta cuenta. Añádela como usuario de prueba del sandbox o envía la app a auditoría." };
    if (!r.ok || (nj.error?.code && nj.error.code !== "ok") || !nj.data?.upload_url || !nj.data.publish_id) throw new StageError("publish_failed", `TikTok rechazó el borrador (${nj.error?.code ?? r.status}).`);
    return sendTikTokFile(ctx, f, H, file, size, nj);
  };
  const info = await f(`${TT}/creator_info/query/`, { method: "POST", headers: H, body: "{}" });
  const ij = (await info.json().catch(() => ({}))) as { data?: { privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }; error?: { code?: string; message?: string } };
  if (unaudited(ij.error)) return toInbox();
  if (!info.ok || (ij.error?.code && ij.error.code !== "ok")) throw new StageError("publish_failed", `TikTok no devolvió los datos del creador (${info.status}).`);
  const options = ij.data?.privacy_level_options ?? [];
  const level = options.includes(job.privacy) ? job.privacy : options.includes("SELF_ONLY") ? "SELF_ONLY" : undefined;   // si la privacidad pedida no está disponible, nunca se amplía: se usa la más restrictiva o se falla
  if (!level) throw new StageError("publish_failed", "TikTok no ofrece ninguna privacidad para esta cuenta.");
  const init = await f(`${TT}/video/init/`, { method: "POST", headers: H, body: JSON.stringify({ post_info: { title: (job.description || job.title).slice(0, 2200), privacy_level: level, ...tikTokFlags(job.post_options, ij.data) }, source_info: src }) });   // el «título» de TikTok es la descripción completa con hashtags
  const nj = (await init.json().catch(() => ({}))) as TtEnv;
  if (unaudited(nj.error)) return toInbox();
  if (!init.ok || (nj.error?.code && nj.error.code !== "ok") || !nj.data?.upload_url || !nj.data.publish_id) throw new StageError("publish_failed", `TikTok rechazó la publicación (${nj.error?.code ?? init.status}).`);
  return sendTikTokFile(ctx, f, H, file, size, nj);
}

const publish: StageImpl = {
  inputs: (_c, row) => ({ stage: "publish", publication: row.params.publication_id, v: 1 }),
  async run(ctx, row) {
    const id = String(row.params.publication_id), f = ctx.fetch ?? fetch;
    const job = await ctx.rpc<PubJob>("publication_job", { p_publication: id });
    if (!job) throw new StageError("not_found", "La publicación no existe");
    if (job.state === "cancelled") return { output: { skipped: "cancelled" } };
    if (!job.object_key) throw new StageError("render_not_ready", "La exportación ya no está disponible. Renuévala y vuelve a publicar.");
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const d = dir(ctx, id), file = join(d, "video.mp4");
    const fail = async (code: string, msg: string): Promise<never> => { await ctx.rpc("finish_publication", { p_publication: id, p_state: "failed", p_external: null, p_code: code, p_message: msg }); throw new StageError(code, msg); };
    try {
      await ctx.rpc("finish_publication", { p_publication: id, p_state: "uploading", p_external: null, p_code: null, p_message: null });
      await ctx.r2.download(job.object_key, file);
      const done = job.platform === "youtube" ? await publishYouTube(ctx, job, file, f) : await publishTikTok(ctx, job, file, f);
      await ctx.rpc("finish_publication", { p_publication: id, p_state: done.state, p_external: done.external ?? null, p_code: done.code ?? null, p_message: done.message ?? null });
      return { output: { state: done.state, platform: job.platform, external_id: done.external ?? null } };
    } catch (e) {
      if (e instanceof StageError) return fail(e.code, scrub(e.message));
      return fail("publish_failed", scrub((e as Error).message));
    } finally { rmSync(file, { force: true }); writeFileSync(join(d, ".done"), ""); }
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { import: importStage, publish };
