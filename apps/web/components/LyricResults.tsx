"use client";
// Resultados de un lote de variantes: estado de cada una, avisos de casi duplicadas, descarga y «Reintentar» solo de la fallida.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type R = { id: string; status: string; ratio: string; kind: string; clip_id: string; error_code: string | null; clips?: { title: string } | null };
const STATE: Record<string, string> = { queued: "En cola", running: "Renderizando", ready: "Lista", failed: "Falló", cancelled: "Cancelada" };

export default function LyricResults({ exportIds, generationId }: { exportIds: string[]; generationId?: string }) {
  const [rows, setRows] = useState<R[]>([]), [warn, setWarn] = useState<{ code: string; variants: number[] }[]>([]), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!exportIds.length) return;
    const { data } = await supabase.from("renders").select("id,status,ratio,kind,clip_id,error_code,clips(title)").in("id", exportIds); setRows((data ?? []) as unknown as R[]);
    if (generationId) { const { data: g } = await supabase.from("generations").select("warnings").eq("id", generationId).limit(1); setWarn(((g?.[0]?.warnings ?? []) as { code: string; variants: number[] }[]).filter((w) => w.code === "near_duplicate")); }
  }, [exportIds, generationId]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [load]);
  const call = async (path: string, method: "GET" | "POST") => fetch(`/api/exports${path}`, { method, headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`, "Idempotency-Key": `lr-${crypto.randomUUID()}` } });
  async function download(r: R) { setBusy(r.id); const res = await call(`/${r.id}/url`, "GET"), j = await res.json().catch(() => ({})); if (res.ok && j.url) window.open(j.url, "_blank", "noopener"); else setMsg(j?.error?.message ?? "No se pudo preparar la descarga."); setBusy(null); }
  async function retry(r: R) { setBusy(r.id); const res = await call(`/${r.id}/retry`, "POST"); setMsg(res.ok ? "Reintentando solo esta variante. No consume unidades." : "No se pudo reintentar."); setBusy(null); void load(); }
  if (!rows.length) return null;
  const ready = rows.filter((r) => r.status === "ready").length;
  return (
    <section className="card space-y-3 p-4" aria-label="Variantes">
      <p className="text-sm font-medium">{ready} de {rows.length} variantes listas</p>
      {warn.map((w, i) => <p key={i} role="status" className="text-xs text-[var(--muted)]">Las variantes {w.variants.join(" y ")} son casi iguales. Cambia el estilo o el fondo para diferenciarlas.</p>)}
      <ul className="divide-y hairline text-sm">{rows.map((r, i) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>{r.clips?.title ?? `Variante ${i + 1}`} · {r.ratio} · <span className="text-[var(--muted)]">{STATE[r.status] ?? r.status}</span></span>
          <span className="flex gap-2">
            {r.status === "ready" && <button className="btn btn-ghost !min-h-8" disabled={busy === r.id} onClick={() => void download(r)}>Descargar</button>}
            {(r.status === "failed" || r.status === "cancelled") && <button className="btn btn-ghost !min-h-8" disabled={busy === r.id} onClick={() => void retry(r)}>Reintentar</button>}
          </span></li>))}</ul>
      <p className="text-xs text-[var(--muted)]">Si una variante falla, las demás siguen disponibles. El ZIP del lote se prepara en Exportados.</p>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
