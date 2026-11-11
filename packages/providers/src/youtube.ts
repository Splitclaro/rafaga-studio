// YouTube Data API v3 (servidor): buscar vídeos y directos, y comprobar el estado de uno concreto.
// Solo devuelve identidad y metadatos. YouTube NO entrega el archivo original: para generar clips Ráfaga necesita un original
// autorizado que el usuario vincule (archivo, enlace propio) o una señal autorizada del directo (HLS / salida del codificador).
export type YtStatus = "live" | "upcoming" | "video";
export type YtFilter = "all" | "live" | "video" | "upcoming";
export interface YtItem {
  id: string; title: string; channel: string; channelId: string; thumb: string; status: YtStatus; url: string;
  durationSec?: number; scheduledAt?: string; startedAt?: string; endedAt?: string; publishedAt?: string;
  /** Un vídeo publicado que antes fue directo (grabación de una emisión anterior). */
  wasLive: boolean; embeddable?: boolean;
}
export type YtErrorCode = "quota" | "not_configured" | "invalid_key" | "not_found" | "service";
export class YtError extends Error { code: YtErrorCode; constructor(code: YtErrorCode, message: string) { super(message); this.code = code; } }

export function parseIsoDuration(s: string | undefined): number | undefined {
  const m = s?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return undefined;
  return Math.round(Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0));
}
/** Identificador de un enlace de YouTube (watch, youtu.be, live, shorts, embed) o de un ID suelto de 11 caracteres. */
export function youtubeIdFrom(input: string): string | null {
  const t = input.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^[\w-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host === "youtube.com" || host === "music.youtube.com") {
      const v = u.searchParams.get("v"); if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:live|shorts|embed|v)\/([\w-]{11})/); if (m) return m[1];
    }
  } catch { /* no es URL */ }
  return null;
}

type Fetch = typeof fetch;
interface ApiErr { error?: { code?: number; message?: string; errors?: { reason?: string }[] } }
async function call(base: string, params: Record<string, string>, key: string, f: Fetch): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, key });
  let r: Response;
  const root = (typeof process !== "undefined" && process.env?.YOUTUBE_API_BASE) || "https://www.googleapis.com/youtube/v3";   // solo para pruebas con un servidor falso
  try { r = await f(`${root}/${base}?${qs}`, { headers: { Accept: "application/json" } }); }
  catch { throw new YtError("service", "No se pudo contactar con YouTube."); }   // sin incluir la URL: lleva la clave
  if (r.ok) return (await r.json()) as Record<string, unknown>;
  const e = ((await r.json().catch(() => ({}))) as ApiErr).error, reason = e?.errors?.[0]?.reason ?? "";
  if (r.status === 403 && /quota|rateLimit|dailyLimit/i.test(reason)) throw new YtError("quota", "Se ha agotado la cuota diaria de búsquedas de YouTube. Vuelve a intentarlo más tarde o pega el enlace del vídeo.");
  if ((r.status === 400 && /keyInvalid/i.test(reason)) || r.status === 401 || (r.status === 403 && /forbidden|accessNotConfigured|ipRefererBlocked/i.test(reason))) throw new YtError("invalid_key", "La clave de YouTube no es válida o no tiene permiso para esta API.");
  throw new YtError("service", `YouTube respondió ${r.status}.`);
}

interface VItem { id: string; snippet?: { title?: string; channelTitle?: string; channelId?: string; publishedAt?: string; liveBroadcastContent?: string; thumbnails?: Record<string, { url?: string }> };
  contentDetails?: { duration?: string }; liveStreamingDetails?: { scheduledStartTime?: string; actualStartTime?: string; actualEndTime?: string }; status?: { embeddable?: boolean; privacyStatus?: string } }
export function mapVideo(v: VItem): YtItem {
  const sn = v.snippet ?? {}, ls = v.liveStreamingDetails ?? {};
  const lbc = sn.liveBroadcastContent;
  // Estado real: una emisión puede haber empezado o terminado desde que apareció en la búsqueda
  const status: YtStatus = lbc === "live" && !ls.actualEndTime ? "live" : lbc === "upcoming" && !ls.actualStartTime ? "upcoming" : "video";
  const th = sn.thumbnails ?? {};
  return { id: v.id, title: sn.title ?? "(sin título)", channel: sn.channelTitle ?? "", channelId: sn.channelId ?? "", thumb: (th.medium ?? th.high ?? th.default)?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    status, url: `https://www.youtube.com/watch?v=${v.id}`, publishedAt: sn.publishedAt, wasLive: !!(ls.actualStartTime || ls.scheduledStartTime) && status === "video",
    ...(status === "video" ? { durationSec: parseIsoDuration(v.contentDetails?.duration) } : {}),
    ...(ls.scheduledStartTime ? { scheduledAt: ls.scheduledStartTime } : {}), ...(ls.actualStartTime ? { startedAt: ls.actualStartTime } : {}), ...(ls.actualEndTime ? { endedAt: ls.actualEndTime } : {}),
    embeddable: v.status?.embeddable };
}

export interface YtSearchOpts { key: string; q: string; filter?: YtFilter; pageToken?: string; max?: number; fetchImpl?: Fetch }
/** search.list (100 unidades de cuota) + videos.list (1 unidad) para completar duración y estado. */
export async function ytSearch(o: YtSearchOpts): Promise<{ items: YtItem[]; nextPageToken: string | null }> {
  if (!o.key) throw new YtError("not_configured", "La búsqueda de YouTube no está configurada todavía.");
  const f = o.fetchImpl ?? fetch, filter = o.filter ?? "all";
  const p: Record<string, string> = { part: "snippet", type: "video", q: o.q.slice(0, 200), maxResults: String(Math.min(25, o.max ?? 12)), safeSearch: "none", order: filter === "upcoming" ? "date" : "relevance" };
  if (filter === "live") p.eventType = "live"; else if (filter === "upcoming") p.eventType = "upcoming";
  if (o.pageToken) p.pageToken = o.pageToken.slice(0, 100);
  const s = await call("search", p, o.key, f);
  const ids = ((s.items as { id?: { videoId?: string } }[] | undefined) ?? []).map((x) => x.id?.videoId).filter((x): x is string => !!x);
  if (!ids.length) return { items: [], nextPageToken: (s.nextPageToken as string | undefined) ?? null };
  const v = await call("videos", { part: "snippet,contentDetails,liveStreamingDetails,status", id: ids.join(","), maxResults: String(ids.length) }, o.key, f);
  const byId = new Map(((v.items as VItem[] | undefined) ?? []).map((x) => [x.id, mapVideo(x)]));
  let items = ids.map((id) => byId.get(id)).filter((x): x is YtItem => !!x);
  if (filter === "video") items = items.filter((x) => x.status === "video");   // «publicados»: incluye grabaciones de directos anteriores
  return { items, nextPageToken: (s.nextPageToken as string | undefined) ?? null };
}
/** Estado actual de un vídeo/directo concreto (se vuelve a comprobar al seleccionarlo). 1 unidad de cuota. */
export async function ytVideo(o: { key: string; id: string; fetchImpl?: Fetch }): Promise<YtItem> {
  if (!o.key) throw new YtError("not_configured", "La búsqueda de YouTube no está configurada todavía.");
  if (!/^[\w-]{11}$/.test(o.id)) throw new YtError("not_found", "Identificador de vídeo no válido.");
  const v = await call("videos", { part: "snippet,contentDetails,liveStreamingDetails,status", id: o.id }, o.key, o.fetchImpl ?? fetch);
  const it = (v.items as VItem[] | undefined)?.[0];
  if (!it) throw new YtError("not_found", "Este vídeo ya no está disponible o es privado.");
  return mapVideo(it);
}

/** Qué puede hacer Ráfaga con un resultado, según el estado y si hay fuente autorizada vinculada. */
export type SourceAction = "generate" | "activate_live" | "link_original" | "connect_signal" | "prepare_scheduled";
export function nextStep(item: Pick<YtItem, "status">, linked: { original: boolean; signal: boolean }): { action: SourceAction; label: string; why: string } {
  if (item.status === "video") return linked.original
    ? { action: "generate", label: "Generar clips", why: "Hay un original autorizado vinculado." }
    : { action: "link_original", label: "Vincular original", why: "YouTube no permite descargar el vídeo: sube tu archivo original o pega un enlace propio para cortarlo." };
  if (item.status === "live") return linked.signal
    ? { action: "activate_live", label: "Activar clips en directo", why: "Hay una señal autorizada vinculada." }
    : { action: "connect_signal", label: "Conectar señal del directo", why: "Para cortar un directo hace falta su señal: pega la URL HLS de tu emisión o usa la segunda salida del codificador." };
  return { action: linked.signal ? "prepare_scheduled" : "connect_signal", label: linked.signal ? "Preparar directo" : "Conectar señal del directo", why: "El directo aún no ha empezado: prepara el proyecto y el clipping arrancará cuando llegue la señal." };
}

/** Reconocer un vídeo por enlace sin clave de API: oEmbed público de YouTube (título, canal y portada; sin estado de directo ni duración). */
export async function ytOembed(id: string, fetchImpl?: Fetch): Promise<YtItem> {
  const url = `https://www.youtube.com/watch?v=${id}`;
  let r: Response;
  try { r = await (fetchImpl ?? fetch)(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: { Accept: "application/json" } }); }
  catch { throw new YtError("service", "No se pudo contactar con YouTube."); }
  if (r.status === 401 || r.status === 403) throw new YtError("not_found", "El vídeo es privado o no permite insertarse: YouTube no da sus datos.");
  if (r.status === 404 || r.status === 400) throw new YtError("not_found", "YouTube no encuentra ese vídeo. Revisa el enlace.");
  if (!r.ok) throw new YtError("service", `YouTube respondió ${r.status}.`);
  const j = (await r.json()) as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
  return { id, title: j.title ?? "(sin título)", channel: j.author_name ?? "", channelId: "", thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, status: "video", url, wasLive: false };
}
