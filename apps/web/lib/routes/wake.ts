// Despierta al procesador justo después de encolar. Requiere sesión válida.
//  · WORKER_BACKEND=modal → POST a MODAL_DISPATCH_URL con X-Rafaga-Wake = WAKE_SECRET (Modal decide cuántos contenedores).
//  · cualquier otro valor → GitHub Actions (worker.yml), solo si no hay otra ejecución en curso o en cola (comportamiento v1).
const REPO = "Splitclaro/rafaga-studio";
type Fetch = typeof fetch;
const SB = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const KEY = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";
const real = (v: string | undefined) => (v && v.trim() && !v.trim().toUpperCase().startsWith("PEGAR") ? v.trim() : "");

export async function handleWake(req: Request, f: Fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<Response> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return Response.json({ error: "no_session" }, { status: 401 });
  const u = await f(`${SB()}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${token}` } });
  if (!u.ok) return Response.json({ error: "invalid_session" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { job_id?: unknown };
  const jobId = typeof body.job_id === "string" && /^[0-9a-f-]{36}$/.test(body.job_id) ? body.job_id : null;

  if ((env.WORKER_BACKEND ?? "").trim() === "modal") {
    const url = real(env.MODAL_DISPATCH_URL), secret = real(env.WAKE_SECRET);
    if (!url || !secret) return Response.json({ woken: false, reason: "not_configured" });
    const r = await f(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Rafaga-Wake": secret }, body: JSON.stringify({ job_id: jobId }) });
    return Response.json(r.ok ? { woken: true, backend: "modal" } : { woken: false, reason: `modal_${r.status}` });
  }

  const gh = real(env.GH_DISPATCH_TOKEN);
  if (!gh) return Response.json({ woken: false, reason: "not_configured" });
  const h = { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  // Si ya hay un worker ejecutándose o en cola, no se lanza otro (el caliente recogerá el trabajo en segundos).
  for (const st of ["in_progress", "queued"]) {
    const r = await f(`https://api.github.com/repos/${REPO}/actions/workflows/worker.yml/runs?status=${st}&per_page=1`, { headers: h });
    if (r.ok && ((await r.json()) as { total_count: number }).total_count > 0) return Response.json({ woken: false, reason: "already_running" });
  }
  const d = await f(`https://api.github.com/repos/${REPO}/actions/workflows/worker.yml/dispatches`, { method: "POST", headers: h, body: JSON.stringify({ ref: "main" }) });
  return Response.json(d.status === 204 ? { woken: true } : { woken: false, reason: `github_${d.status}` });
}
