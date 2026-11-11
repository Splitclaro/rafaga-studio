import { NextResponse } from "next/server";
import { r2FromEnv, r2Url, originalKey } from "@rafaga/providers/r2";
import { userFrom, allow } from "../../../lib/ytserver";

export const dynamic = "force-dynamic";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";

/** GET /api/storage — ¿está conectado Cloudflare R2? (la web decide dónde subir los originales). */
export async function GET(req: Request) {
  if (!(await userFrom(req))) return NextResponse.json({ error: "no_session" }, { status: 401 });
  // Diagnóstico sin revelar valores: qué variables llegan y si alguna sigue siendo un marcador.
  const st = (k: string) => { const v = process.env[k]; return !v ? "falta" : v.trim().toUpperCase().startsWith("PEGAR") ? "marcador" : "ok"; };
  return NextResponse.json({ r2: !!r2FromEnv(), vars: Object.fromEntries(["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].map((k) => [k, st(k)])) });
}

/** POST /api/storage {op: "put"|"get", source} — URL firmada de vida corta para el original de UNA fuente.
 *  La fuente se lee con el JWT del usuario: RLS garantiza que pertenece a su espacio. Subir solo lo puede quien la creó y mientras está pendiente. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const user = await userFrom(req);
  if (!user) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const cfg = r2FromEnv();
  if (!cfg) return NextResponse.json({ error: "not_configured", message: "El almacenamiento en Cloudflare R2 no está configurado en el servidor." }, { status: 503 });
  if (!allow(`storage:${user}`, 600)) return NextResponse.json({ error: "rate", message: "Demasiadas peticiones seguidas." }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { op?: string; source?: string };
  if ((b.op !== "put" && b.op !== "get") || !/^[0-9a-f-]{36}$/.test(b.source ?? "")) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const r = await fetch(`${SB}/rest/v1/sources?id=eq.${b.source}&select=id,workspace_id,created_by,status,storage_backend`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  const src = r.ok ? ((await r.json()) as { id: string; workspace_id: string; created_by: string; status: string; storage_backend: string }[])[0] : undefined;
  if (!src) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (src.storage_backend !== "r2") return NextResponse.json({ error: "wrong_backend" }, { status: 409 });
  if (b.op === "put" && (src.created_by !== user || src.status !== "pending")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = await r2Url(cfg, b.op === "put" ? "PUT" : "GET", originalKey(src.workspace_id, src.id), b.op === "put" ? 7200 : 3600);
  return NextResponse.json({ url });
}
