"use client";
// Exportaciones v2 (R2): versión, formato, resolución, duración, tamaño, estado, caducidad, descarga, reintento y renovación.
import ClipThumb from "./ui/ClipThumb";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import { fileName } from "../lib/download";

type R = { id: string; clip_id: string; clip_version: number; ratio: string; kind: string; burn_subtitles: boolean; status: string; width: number | null; height: number | null; duration_ms: number | null; bytes: number | null; expires_at: string | null; storage_path: string | null; error_code: string | null; created_at: string; clips: { title: string; project_id: string } | null };
const STATE: Record<string, string> = { queued: "En cola", running: "Exportando", ready: "Disponible", failed: "Falló", cancelled: "Cancelada" };
const mb = (n: number | null) => (n ? `${(n / 1048576).toFixed(1)} MB` : "—");
const dur = (ms: number | null) => { const s = Math.round((ms ?? 0) / 1000); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—"; };
const days = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null);

export default function ExportsV2() {
  const [rows, setRows] = useState<R[] | null>(null), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("renders").select("id,clip_id,clip_version,ratio,kind,burn_subtitles,status,width,height,duration_ms,bytes,expires_at,storage_path,error_code,created_at,clips!inner(title,project_id)").not("settings_hash", "is", null).order("created_at", { ascending: false }).limit(200);
    setRows((data ?? []) as unknown as R[]);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);
  const call = async (path: string, method: "GET" | "POST") => {
    const { data: s } = await supabase.auth.getSession();
    return fetch(`/api/exports${path}`, { method, headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}`, "Idempotency-Key": `ex-${crypto.randomUUID()}` } });
  };
  async function download(r: R) {
    setBusy(r.id); setMsg(null);
    const name = `${r.clips?.title ?? "clip"}_${r.ratio.replace(":", "x")}${r.height ? `_${r.height}p` : ""}`;
    const res = await call(`/${r.id}/url?download=1&name=${encodeURIComponent(name)}`, "GET"), j = await res.json().catch(() => ({}));
    if (res.ok && j.url) { const a = document.createElement("a"); a.href = j.url; a.download = fileName(name); document.body.appendChild(a); a.click(); a.remove(); }   // Content-Disposition: attachment → se guarda, no se abre una pestaña
    else setMsg(res.status === 410 ? "El archivo caducó. Pulsa «Renovar» para prepararlo otra vez sin coste." : (j.error?.message ?? "No se pudo preparar la descarga."));
    setBusy(null); void load();
  }
  async function again(r: R, what: "retry" | "renew") { setBusy(r.id); const res = await call(`/${r.id}/${what}`, "POST"); setMsg(res.ok ? "Preparando de nuevo. No consume unidades." : "No se pudo reintentar."); setBusy(null); void load(); }
  async function publish(r: R, platform: "youtube" | "tiktok") {
    const title = window.prompt("Título de la publicación", r.clips?.title ?? ""); if (!title?.trim()) return;
    setBusy(r.id); const { data: s } = await supabase.auth.getSession();
    const res = await fetch("/api/publish", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}`, "Content-Type": "application/json", "Idempotency-Key": `pub-${crypto.randomUUID()}` }, body: JSON.stringify({ export_id: r.id, platform, title: title.trim() }) });
    const j = await res.json().catch(() => ({})); setMsg(res.ok ? "Publicando en privado. Verás el resultado en Conexiones." : (j?.error?.message ?? "No se pudo publicar.")); setBusy(null);
  }
  if (!rows?.length) return null;
  return (
    <section className="card mt-6 overflow-x-auto" aria-label="Exportaciones recientes">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b hairline text-xs text-[var(--muted)]"><tr><th className="p-3">Clip</th><th className="p-3">Versión</th><th className="p-3">Formato</th><th className="p-3">Resolución</th><th className="p-3">Duración</th><th className="p-3">Tamaño</th><th className="p-3">Estado</th><th className="p-3"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{rows.map((r) => { const d = days(r.expires_at), expired = r.status === "ready" && (!r.storage_path || (d != null && d < 0)); return (
          <tr key={r.id} className="border-b hairline last:border-0">
            <td className="p-3 font-medium"><Link href={`/app/p/${r.clips?.project_id}`} className="flex items-center gap-3 hover:underline"><ClipThumb clipId={r.clip_id} renderId={r.id} className="h-14 w-8 shrink-0 rounded-md" /><span>{r.clips?.title}</span></Link></td>
            <td className="tnum p-3">v{r.clip_version}</td>
            <td className="p-3"><span className="chip !min-h-6 !py-0">{r.kind.toUpperCase()}</span> <span className="text-xs text-[var(--muted)]">{r.kind === "mp4" ? `${r.ratio}${r.burn_subtitles ? " · con subtítulos" : " · sin subtítulos"}` : ""}</span></td>
            <td className="tnum p-3">{r.width ? `${r.width}×${r.height}` : "—"}</td><td className="tnum p-3">{dur(r.duration_ms)}</td><td className="tnum p-3">{mb(r.bytes)}</td>
            <td className="p-3">{expired ? "Caducada" : STATE[r.status] ?? r.status}{r.status === "ready" && d != null && d >= 0 && <span className="ml-1 text-xs text-[var(--muted)]">· caduca en {d} d</span>}{r.error_code && <span className="ml-1 text-xs text-[var(--danger)]">· {r.error_code}</span>}</td>
            <td className="p-3 text-right">
              {r.status === "ready" && !expired && r.kind === "mp4" && <button onClick={() => publish(r, "youtube")} disabled={busy === r.id} className="btn btn-ghost !min-h-9 !py-1">Publicar en YouTube</button>}
              {r.status === "ready" && !expired && <button onClick={() => download(r)} disabled={busy === r.id} className="btn btn-ghost !min-h-9 !py-1"><Icon n="download" className="h-4 w-4" />Descargar</button>}
              {expired && <button onClick={() => again(r, "renew")} disabled={busy === r.id} className="btn btn-ghost !min-h-9 !py-1">Renovar</button>}
              {(r.status === "failed" || r.status === "cancelled") && <button onClick={() => again(r, "retry")} disabled={busy === r.id} className="btn btn-ghost !min-h-9 !py-1">Reintentar</button>}
            </td></tr>); })}</tbody>
      </table>
      {msg && <p role="status" className="p-3 text-sm text-[var(--muted)]">{msg}</p>}
    </section>
  );
}
