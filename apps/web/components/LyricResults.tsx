"use client";
// Resultados de un lote de variantes: estado de cada una, avisos de casi duplicadas, descarga y «Reintentar» solo de la fallida.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type R = { id: string; status: string; ratio: string; kind: string; clip_id: string; error_code: string | null; clips?: { title: string } | null };
const STATE: Record<string, string> = { queued: "En cola", running: "Renderizando", ready: "Lista", failed: "Falló", cancelled: "Cancelada" };

const FORMATS = [["srt", "SRT"], ["vtt", "VTT"], ["lrc", "LRC"], ["lrc_word", "LRC por palabra"], ["ass", "ASS karaoke"], ["txt", "Texto"]] as const;
export default function LyricResults({ exportIds, generationId, projectId }: { exportIds: string[]; generationId?: string; projectId?: string }) {
  const [fmt, setFmt] = useState<(typeof FORMATS)[number][0]>("srt"), [pubOpen, setPubOpen] = useState<string | null>(null), [pf, setPf] = useState({ platform: "youtube", title: "", privacy: "private", at: "" });
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
  /** Pide el formato de letra elegido para todas las variantes (misma versión, sin coste). */
  async function exportText() {
    const items = rows.map((r) => ({ clip_id: r.clip_id, version: 1, aspect: r.ratio, burn_subtitles: false, kind: fmt }));
    const res = await fetch("/api/exports", { method: "POST", headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`, "Content-Type": "application/json", "Idempotency-Key": `lf-${crypto.randomUUID()}` }, body: JSON.stringify({ items, zip: false }) });
    setMsg(res.ok ? "Preparando el archivo de letra en Exportados." : "No se pudo preparar el archivo.");
  }
  /** Publicar o programar un MP4 (YouTube o TikTok): POST /api/publish con las mismas reglas y estados que clipping. */
  async function publish(r: R) {
    const body: Record<string, unknown> = { export_id: r.id, platform: pf.platform, title: pf.title.trim() || r.clips?.title || "Letra", privacy: pf.platform === "tiktok" ? (pf.privacy === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE") : pf.privacy };
    if (pf.at) body.scheduled_at = new Date(pf.at).toISOString();
    const res = await fetch("/api/publish", { method: "POST", headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`, "Content-Type": "application/json", "Idempotency-Key": `pub-${crypto.randomUUID()}` }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({})); setMsg(res.ok ? (j.state === "scheduled" ? "Programada. No se llama a la plataforma hasta la hora elegida." : "Publicando. Verás el estado en Conexiones.") : (j?.error?.message ?? "No se pudo publicar.")); setPubOpen(null);
  }
  /** Compartir: crea una entrega con clip y versión fijados; el enlace se gestiona en Entregas. */
  async function share() {
    if (!projectId) return setMsg("Falta el proyecto para crear la entrega.");
    const { error } = await supabase.rpc("create_delivery", { p_project: projectId, p_name: "Variantes de letra", p_description: null, p_items: rows.filter((r) => r.status === "ready").map((r) => ({ clip_id: r.clip_id, version: 1 })) });
    setMsg(error ? "No se pudo crear la entrega." : "Entrega creada con estas versiones. Crea el enlace desde Entregas.");
  }
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
            {r.status === "ready" && r.kind === "mp4" && <button className="btn btn-ghost !min-h-8" onClick={() => setPubOpen(pubOpen === r.id ? null : r.id)}>Publicar</button>}
            {(r.status === "failed" || r.status === "cancelled") && <button className="btn btn-ghost !min-h-8" disabled={busy === r.id} onClick={() => void retry(r)}>Reintentar</button>}
          </span>
          {pubOpen === r.id && <div className="flex w-full flex-wrap items-center gap-2 text-xs">
            <select aria-label="Plataforma" className="rounded border hairline px-1 py-1" value={pf.platform} onChange={(e) => setPf({ ...pf, platform: e.target.value })}><option value="youtube">YouTube</option><option value="tiktok">TikTok</option></select>
            <input aria-label="Título" className="rounded border hairline px-2 py-1" placeholder="Título" maxLength={100} value={pf.title} onChange={(e) => setPf({ ...pf, title: e.target.value })} />
            <select aria-label="Privacidad" className="rounded border hairline px-1 py-1" value={pf.privacy} onChange={(e) => setPf({ ...pf, privacy: e.target.value })}><option value="private">Privado</option><option value="public">Público</option></select>
            <input aria-label="Programar para" type="datetime-local" className="rounded border hairline px-1 py-1" value={pf.at} onChange={(e) => setPf({ ...pf, at: e.target.value })} />
            <button className="btn btn-primary !min-h-8" onClick={() => void publish(r)}>{pf.at ? "Programar" : "Publicar"}</button></div>}
        </li>))}</ul>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Formato de letra" className="rounded border hairline px-2 py-1" value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button className="btn btn-ghost !min-h-8" onClick={() => void exportText()}>Exportar letra</button>
        <button className="btn btn-ghost !min-h-8" onClick={() => void share()}>Compartir</button></div>
      <p className="text-xs text-[var(--muted)]">Si una variante falla, las demás siguen disponibles. El ZIP del lote se prepara en Exportados.</p>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
