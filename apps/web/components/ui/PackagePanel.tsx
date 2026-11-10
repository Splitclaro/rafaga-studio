"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Icon from "../Icon";

type Pkg = { id: string; options: { only_approved: boolean; include: string[] }; status: string; progress: { phase?: string; done?: number; total?: number; current?: string }; parts: { path: string; name: string; bytes: number; files: number; kind: string }[]; error: string | null; created_at: string; expires_at: string };
const LABEL: Record<string, string> = { mp4: "MP4", thumbs: "Portadas", srt: "SRT", vtt: "VTT", transcript: "Transcripción" };
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const STATUS: Record<string, string> = { queued: "En cola", building: "Preparando", ready: "Listo", failed: "Fallido", cancelled: "Cancelado" };

/** Paquete ZIP de la entrega: se muestra qué incluirá, se prepara en segundo plano (por partes) y se descarga con URL firmada renovable. */
export default function PackagePanel({ deliveryId, canEdit, total, approved, bytes }: { deliveryId: string; canEdit: boolean; total: number; approved: number; bytes: { all: number; approved: number } }) {
  const [only, setOnly] = useState(false);
  const [inc, setInc] = useState<Set<string>>(new Set(["mp4", "thumbs", "srt"]));
  const [pk, setPk] = useState<Pkg[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("delivery_packages").select("id,options,status,progress,parts,error,created_at,expires_at").eq("delivery_id", deliveryId).order("created_at", { ascending: false }).limit(5);
    setPk((data ?? []) as Pkg[]);
  }, [deliveryId]);
  useEffect(() => { load(); }, [load]);
  const active = pk.some((p) => p.status === "queued" || p.status === "building");
  useEffect(() => { if (!active) return; const t = setInterval(load, 3000); return () => clearInterval(t); }, [active, load]);

  const n = only ? approved : total, size = only ? bytes.approved : bytes.all;
  async function request() {
    setMsg(null);
    if (!n) return setMsg(only ? "Ninguna pieza está aprobada todavía." : "La entrega no tiene piezas.");
    const { error } = await supabase.rpc("request_package", { p_delivery: deliveryId, p_options: { only_approved: only, include: [...inc] } });
    if (error) return setMsg(error.message);
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}` } }).catch(() => {});
    setMsg("Paquete en preparación. Puedes cerrar esta página: sigue en segundo plano."); load();
  }
  async function get(path: string, name: string) {
    const { data, error } = await supabase.storage.from("renders").createSignedUrl(path, 300, { download: name });   // URL nueva en cada descarga
    if (error || !data?.signedUrl) return setMsg("No se pudo generar el enlace de descarga. Reintenta.");
    const a = document.createElement("a"); a.href = data.signedUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  const act = async (fn: "retry_package" | "cancel_package", id: string) => { const { error } = await supabase.rpc(fn, { p_id: id }); if (error) setMsg(error.message); else load(); };

  return (
    <section className="mt-10" aria-labelledby="pk-h">
      <h2 id="pk-h" className="text-xl tracking-tight">Paquete de entrega</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Un ZIP con los archivos elegidos, nombres legibles y un manifiesto. Si es grande se divide en partes de hasta 40 MB (límite actual del almacenamiento).</p>
      {canEdit ? (
        <div className="mt-4 rounded-2xl bg-[var(--surface)] p-5 text-sm">
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2"><legend className="mb-2 font-medium">Contenido</legend>
            {Object.entries(LABEL).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={inc.has(k)} onChange={(e) => setInc((s) => { const x = new Set(s); if (e.target.checked) x.add(k); else x.delete(k); return x.size ? x : s; })} />{l}</label>)}
            <label className="flex items-center gap-2 text-[var(--muted)]"><input type="checkbox" checked disabled />Manifiesto (siempre)</label></fieldset>
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Solo piezas aprobadas ({approved} de {total})</label>
          <p className="mt-3 text-[var(--muted)]">Incluirá <strong className="text-[var(--text)]">{n}</strong> pieza{n === 1 ? "" : "s"}{inc.has("mp4") && size ? ` · MP4 ≈ ${mb(size)}` : ""}. SRT, VTT y transcripción solo existen para versiones con texto; las demás se listan en el manifiesto sin archivo.</p>
          <button onClick={request} disabled={!n || active} className="btn btn-primary mt-3"><Icon n="download" className="h-4 w-4" />{active ? "Preparando…" : "Preparar paquete"}</button>
        </div>
      ) : <p className="mt-3 text-sm text-[var(--muted)]">Solo propietarios, administradores y editores preparan paquetes.</p>}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">{msg}</p>
      {!!pk.length && <ul className="mt-2 space-y-3">{pk.map((p) => (
        <li key={p.id} className="rounded-2xl border border-[var(--border)] p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><strong className="font-medium">{p.options.include.map((k) => LABEL[k] ?? k).join(", ")}{p.options.only_approved ? " · solo aprobadas" : ""}</strong>
            <span className="chip !py-0.5 text-xs">{STATUS[p.status] ?? p.status}</span><span className="text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="ml-auto flex gap-3 text-xs">{canEdit && (p.status === "queued" || p.status === "building") && <button className="underline" onClick={() => act("cancel_package", p.id)}>Cancelar</button>}{canEdit && (p.status === "failed" || p.status === "cancelled") && <button className="underline" onClick={() => act("retry_package", p.id)}>Reintentar</button>}</span></div>
          {(p.status === "building" || p.status === "queued") && <div className="mt-2"><div className="h-1.5 max-w-sm rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[#111] transition-all" style={{ width: `${p.progress.total ? Math.round(((p.progress.done ?? 0) / p.progress.total) * 100) : 5}%` }} /></div><p className="mt-1 text-xs text-[var(--muted)]">{p.status === "queued" ? "Esperando al worker…" : `${p.progress.done ?? 0} de ${p.progress.total ?? "?"} piezas${p.progress.current ? ` · ${p.progress.current}` : ""}`}</p></div>}
          {p.error && <p role="alert" className="mt-2 text-xs">{p.error}</p>}
          {p.status === "ready" && <ul className="mt-2 flex flex-wrap gap-2">{p.parts.map((x) => <li key={x.path}><button onClick={() => get(x.path, x.name)} className="btn btn-ghost !py-1.5 !text-xs"><Icon n="download" className="h-3.5 w-3.5" />{x.kind === "manifest" ? "Manifiesto" : x.name.replace(/^.*-(parte\d+\.zip)$/, "$1")} · {mb(x.bytes)}</button></li>)}<li className="self-center text-xs text-[var(--muted)]">Disponible hasta el {new Date(p.expires_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</li></ul>}
        </li>))}</ul>}
    </section>
  );
}
