"use client";
// Importar un vídeo por enlace https (también Drive y Dropbox si la cuenta está conectada). El servidor valida el enlace antes de crear trabajo.
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function ImportLink({ onDone }: { onDone?: (d: { project_id: string; job_id: string }) => void }) {
  const [url, setUrl] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setMsg(null);
    const t = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    const r = await fetch("/api/import/link", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", "Idempotency-Key": `imp-${crypto.randomUUID()}` }, body: JSON.stringify({ url: url.trim() }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) return setMsg(j?.error?.message ?? "No se pudo importar el enlace.");
    setMsg("Importando. Seguirá en el servidor aunque cierres la pestaña."); onDone?.({ project_id: j.project_id, job_id: j.job_id });
  }
  return (
    <section className="card space-y-2 p-4" aria-label="Importar por enlace">
      <label className="block text-sm font-medium" htmlFor="imp-url">O importa por enlace</label>
      <p className="text-xs text-[var(--muted)]">Un enlace directo https a un vídeo (hasta 4 GB). No se aceptan direcciones internas.</p>
      <div className="flex gap-2"><input id="imp-url" className="w-full rounded-lg border hairline px-2 py-1.5 text-sm" placeholder="https://…/video.mp4" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn btn-primary !min-h-9" disabled={busy || !url.trim()} onClick={() => void go()}>{busy ? "Comprobando…" : "Importar"}</button></div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
