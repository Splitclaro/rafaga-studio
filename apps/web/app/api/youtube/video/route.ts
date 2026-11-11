import { NextResponse } from "next/server";
import { ytVideo, ytOembed, youtubeIdFrom, YtError } from "@rafaga/providers/youtube";
import { userFrom, allow } from "../../../../lib/ytserver";

export const dynamic = "force-dynamic";

/** GET /api/youtube/video?id=… (ID o enlace) — reconoce el vídeo. Con YOUTUBE_API_KEY usa la Data API (1 unidad); sin ella, oEmbed. */
export async function GET(req: Request) {
  const user = await userFrom(req);
  if (!user) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const id = youtubeIdFrom(new URL(req.url).searchParams.get("id") ?? "");
  if (!id) return NextResponse.json({ error: "not_found", message: "No reconozco ese enlace o identificador de YouTube." }, { status: 400 });
  const key = process.env.YOUTUBE_API_KEY ?? "";
  if (!allow(user, 200)) return NextResponse.json({ error: "rate", message: "Demasiadas consultas seguidas." }, { status: 429 });
  // Con clave: datos completos (estado de directo, duración). Sin clave: oEmbed público (título, canal y portada).
  try { return NextResponse.json({ item: key ? await ytVideo({ key, id }) : await ytOembed(id), source: key ? "api" : "oembed" }); }
  catch (e) { const err = e as YtError; return NextResponse.json({ error: err.code ?? "service", message: err.message }, { status: err.code === "not_found" ? 404 : err.code === "quota" ? 429 : 502 }); }
}
