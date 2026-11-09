import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";
const REPO = "Splitclaro/rafaga-studio";

/** Despierta al worker (GitHub Actions) justo después de encolar un job. Requiere sesión válida. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

  const gh = process.env.GH_DISPATCH_TOKEN;
  if (!gh) return NextResponse.json({ woken: false, reason: "not_configured" });
  const h = { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  // Si ya hay un worker ejecutándose o en cola, no se lanza otro (el caliente recogerá el job en segundos).
  for (const st of ["in_progress", "queued"]) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/worker.yml/runs?status=${st}&per_page=1`, { headers: h });
    if (r.ok && ((await r.json()) as { total_count: number }).total_count > 0) return NextResponse.json({ woken: false, reason: "already_running" });
  }
  const d = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/worker.yml/dispatches`, { method: "POST", headers: h, body: JSON.stringify({ ref: "main" }) });
  return NextResponse.json(d.status === 204 ? { woken: true } : { woken: false, reason: `github_${d.status}` });
}
