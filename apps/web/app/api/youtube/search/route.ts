import { NextResponse } from "next/server";
import { ytSearch, YtError, type YtFilter } from "@rafaga/providers/youtube";
import { userFrom, cached, remember, allow } from "../../../../lib/ytserver";

export const dynamic = "force-dynamic";
const FILTERS = new Set(["all", "live", "video", "upcoming"]);

/** GET /api/youtube/search?q=…&filter=all|live|video|upcoming&pageToken=… — YouTube Data API desde el servidor (la clave nunca llega al navegador). */
export async function GET(req: Request) {
  const user = await userFrom(req);
  if (!user) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const u = new URL(req.url), q = (u.searchParams.get("q") ?? "").trim(), filter = u.searchParams.get("filter") ?? "all", pageToken = u.searchParams.get("pageToken") ?? undefined;
  if (q.length < 2) return NextResponse.json({ items: [], nextPageToken: null });
  if (!FILTERS.has(filter)) return NextResponse.json({ error: "bad_filter" }, { status: 400 });
  const key = process.env.YOUTUBE_API_KEY ?? "";
  if (!key) return NextResponse.json({ error: "not_configured", message: "La búsqueda de YouTube no está configurada todavía. Pega el enlace del vídeo mientras tanto." }, { status: 503 });
  const ck = `s:${filter}:${pageToken ?? ""}:${q.toLowerCase()}`, hit = cached<unknown>(ck, 60_000);
  if (hit) return NextResponse.json(hit);
  if (!allow(user)) return NextResponse.json({ error: "rate", message: "Has hecho muchas búsquedas seguidas. Espera unos minutos o pega el enlace del vídeo." }, { status: 429 });
  try {
    const r = await ytSearch({ key, q, filter: filter as YtFilter, pageToken });
    remember(ck, r); return NextResponse.json(r);
  } catch (e) {
    const err = e as YtError;
    return NextResponse.json({ error: err.code ?? "service", message: err.message }, { status: err.code === "quota" ? 429 : err.code === "invalid_key" ? 503 : 502 });
  }
}
