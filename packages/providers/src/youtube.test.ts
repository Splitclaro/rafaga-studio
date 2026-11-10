import { test } from "node:test";
import assert from "node:assert/strict";
import { ytSearch, ytVideo, parseIsoDuration, youtubeIdFrom, mapVideo, nextStep, YtError } from "./youtube.ts";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const V = (id: string, lbc: string, extra: Record<string, unknown> = {}) => ({ id, snippet: { title: `T ${id}`, channelTitle: "Canal", channelId: "UC1", publishedAt: "2026-11-01T10:00:00Z", liveBroadcastContent: lbc, thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mq.jpg` } } }, contentDetails: { duration: "PT1H2M3S" }, status: { embeddable: true }, ...extra });
function fake(over: { search?: unknown; videos?: unknown; status?: number } = {}) {
  const calls: URL[] = [];
  const f = (async (u: string) => { const url = new URL(u); calls.push(url);
    if (over.status) return json({ error: { code: over.status, errors: [{ reason: over.search as string }] } }, over.status);
    if (url.pathname.endsWith("/search")) return json({ items: [{ id: { videoId: "aaaaaaaaaaa" } }, { id: { videoId: "bbbbbbbbbbb" } }, { id: { videoId: "ccccccccccc" } }], nextPageToken: "NEXT" });
    return json({ items: over.videos ?? [V("aaaaaaaaaaa", "live", { liveStreamingDetails: { actualStartTime: "2026-11-10T09:00:00Z" } }), V("bbbbbbbbbbb", "none"), V("ccccccccccc", "upcoming", { liveStreamingDetails: { scheduledStartTime: "2026-11-12T18:00:00Z" } })] });
  }) as unknown as typeof fetch;
  return { f, calls };
}
test("duración ISO 8601 y extracción de IDs de enlaces", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723); assert.equal(parseIsoDuration("PT45S"), 45); assert.equal(parseIsoDuration("P0D"), 0); assert.equal(parseIsoDuration("xx"), undefined);
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=3", "youtube.com/live/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"]) assert.equal(youtubeIdFrom(u), "dQw4w9WgXcQ", u);
  assert.equal(youtubeIdFrom("https://example.com/watch?v=dQw4w9WgXcQ"), null); assert.equal(youtubeIdFrom("hola"), null);
});
test("búsqueda: filtros oficiales y estados con metadatos", async () => {
  const { f, calls } = fake();
  const r = await ytSearch({ key: "K", q: "producción musical", filter: "live", fetchImpl: f });
  assert.equal(calls[0].searchParams.get("eventType"), "live"); assert.equal(calls[0].searchParams.get("type"), "video"); assert.equal(calls[0].searchParams.get("q"), "producción musical");
  assert.equal(calls[1].searchParams.get("id"), "aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc");
  assert.deepEqual(r.items.map((x) => x.status), ["live", "video", "upcoming"]);
  assert.equal(r.items[1].durationSec, 3723); assert.equal(r.items[0].durationSec, undefined, "un directo en curso no tiene duración");
  assert.equal(r.items[2].scheduledAt, "2026-11-12T18:00:00Z"); assert.equal(r.nextPageToken, "NEXT");
});
test("«publicados» incluye grabaciones de directos anteriores y excluye directos y próximos", async () => {
  const { f } = fake({ videos: [V("aaaaaaaaaaa", "none", { liveStreamingDetails: { actualStartTime: "2026-10-01T09:00:00Z", actualEndTime: "2026-10-01T11:00:00Z" } }), V("bbbbbbbbbbb", "none"), V("ccccccccccc", "live", { liveStreamingDetails: { actualStartTime: "x" } })] });
  const r = await ytSearch({ key: "K", q: "x", filter: "video", fetchImpl: f });
  assert.deepEqual(r.items.map((x) => x.id), ["aaaaaaaaaaa", "bbbbbbbbbbb"]); assert.equal(r.items[0].wasLive, true); assert.equal(r.items[1].wasLive, false);
});
test("un directo que ya terminó se trata como vídeo publicado (estado real, no el de la búsqueda)", () => {
  assert.equal(mapVideo(V("aaaaaaaaaaa", "live", { liveStreamingDetails: { actualStartTime: "a", actualEndTime: "b" } })).status, "video");
  assert.equal(mapVideo(V("aaaaaaaaaaa", "upcoming", { liveStreamingDetails: { scheduledStartTime: "a", actualStartTime: "b" } })).status, "video");
});
test("errores: cuota, clave inválida, sin configurar y fallo de red se distinguen; la clave nunca aparece en el mensaje", async () => {
  await assert.rejects(ytSearch({ key: "K", q: "x", fetchImpl: fake({ status: 403, search: "quotaExceeded" }).f }), (e: YtError) => e.code === "quota");
  await assert.rejects(ytSearch({ key: "K", q: "x", fetchImpl: fake({ status: 400, search: "keyInvalid" }).f }), (e: YtError) => e.code === "invalid_key");
  await assert.rejects(ytSearch({ key: "", q: "x" }), (e: YtError) => e.code === "not_configured");
  await assert.rejects(ytSearch({ key: "SECRETKEY", q: "x", fetchImpl: (async () => { throw new Error("https://x?key=SECRETKEY"); }) as unknown as typeof fetch }), (e: YtError) => e.code === "service" && !/SECRETKEY/.test(e.message));
  await assert.rejects(ytSearch({ key: "K", q: "x", fetchImpl: fake({ status: 500, search: "backendError" }).f }), (e: YtError) => e.code === "service");
});
test("sin resultados no es un error", async () => {
  const f = (async () => json({ items: [] })) as unknown as typeof fetch;
  assert.deepEqual(await ytSearch({ key: "K", q: "zzz", fetchImpl: f }), { items: [], nextPageToken: null });
});
test("ytVideo: reconsulta el estado y distingue vídeo no disponible", async () => {
  const live = await ytVideo({ key: "K", id: "aaaaaaaaaaa", fetchImpl: fake().f }); assert.equal(live.status, "live");
  await assert.rejects(ytVideo({ key: "K", id: "aaaaaaaaaaa", fetchImpl: (async () => json({ items: [] })) as unknown as typeof fetch }), (e: YtError) => e.code === "not_found");
  await assert.rejects(ytVideo({ key: "K", id: "mal", fetchImpl: fake().f }), (e: YtError) => e.code === "not_found");
});
test("siguiente paso según estado y fuente vinculada (los cuatro casos del encargo)", () => {
  assert.equal(nextStep({ status: "video" }, { original: true, signal: false }).action, "generate");
  assert.equal(nextStep({ status: "video" }, { original: false, signal: false }).action, "link_original");
  assert.equal(nextStep({ status: "live" }, { original: false, signal: true }).action, "activate_live");
  assert.equal(nextStep({ status: "live" }, { original: true, signal: false }).action, "connect_signal");
  assert.equal(nextStep({ status: "upcoming" }, { original: false, signal: true }).action, "prepare_scheduled");
  assert.equal(nextStep({ status: "upcoming" }, { original: false, signal: false }).action, "connect_signal");
});
