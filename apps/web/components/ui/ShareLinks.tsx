"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type L = { id: string; label: string | null; expires_at: string; revoked_at: string | null; allow_download: boolean; allow_comment: boolean; allow_approve: boolean; views: number; last_viewed_at: string | null; created_at: string };
const state = (l: L) => (l.revoked_at ? "Revocado" : new Date(l.expires_at) < new Date() ? "Caducado" : "Activo");

/** Enlaces de revisión para externos: token acotado, caducidad y permisos; el enlace completo solo se muestra al crearlo. */
export default function ShareLinks({ deliveryId, canEdit }: { deliveryId: string; canEdit: boolean }) {
  const [links, setLinks] = useState<L[] | null>(null);
  const [days, setDays] = useState(7), [label, setLabel] = useState("");
  const [comment, setComment] = useState(true), [approve, setApprove] = useState(false), [download, setDownload] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("share_links").select("id,label,expires_at,revoked_at,allow_download,allow_comment,allow_approve,views,last_viewed_at,created_at").eq("delivery_id", deliveryId).order("created_at", { ascending: false });
    setLinks((data ?? []) as L[]);
  }, [deliveryId]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setFresh(null);
    const { data, error } = await supabase.rpc("create_share_link", { p_delivery: deliveryId, p_days: days, p_download: download, p_comment: comment, p_approve: approve && comment, p_label: label || null });
    if (error) return setMsg(error.message);
    setFresh(`${window.location.origin}/revision/${data as string}`); setLabel(""); load();
  }
  async function revoke(l: L) {
    if (!confirm("¿Revocar este enlace? Dejará de funcionar de inmediato para quien lo tenga.")) return;
    const { error } = await supabase.rpc("revoke_share_link", { p_id: l.id }); if (error) setMsg(error.message); else { setMsg("Enlace revocado."); load(); }
  }
  return (
    <section className="mt-10" aria-labelledby="share-h">
      <h2 id="share-h" className="text-xl tracking-tight">Compartir para revisión</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Quien reciba el enlace ve solo esta entrega, sin cuenta ni acceso a tu espacio. Caduca y puedes revocarlo cuando quieras. No enviamos el enlace por email: cópialo y compártelo tú.</p>
      {canEdit ? (
        <form onSubmit={create} className="mt-4 grid gap-4 rounded-2xl bg-[var(--surface)] p-5 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3 text-sm">
            <label className="block">Nombre del enlace (opcional)<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Cliente, equipo de marketing…" className="input mt-1" /></label>
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2"><legend className="sr-only">Permisos</legend>
              <label className="flex items-center gap-2"><input type="checkbox" checked={comment} onChange={(e) => { setComment(e.target.checked); if (!e.target.checked) setApprove(false); }} />Puede comentar</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={approve && comment} disabled={!comment} onChange={(e) => setApprove(e.target.checked)} />Puede aprobar o pedir cambios</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />Ve el botón de descarga</label>
            </fieldset>
            {download && <p className="text-xs text-[var(--muted)]">Quien puede reproducir un vídeo puede técnicamente guardarlo; este permiso solo muestra u oculta el botón de descarga.</p>}
          </div>
          <div className="flex flex-col justify-end gap-2"><label className="text-sm">Caduca en<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input mt-1">{[[1, "1 día"], [7, "7 días"], [30, "30 días"], [90, "90 días"]].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label><button className="btn btn-primary">Crear enlace</button></div>
        </form>
      ) : <p className="mt-3 text-sm text-[var(--muted)]">Solo propietarios, administradores y editores pueden crear enlaces.</p>}
      {fresh && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#111] p-3 text-sm text-white"><code className="min-w-0 flex-1 truncate">{fresh}</code><button className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#111]" onClick={() => navigator.clipboard.writeText(fresh).then(() => setMsg("Enlace copiado. Solo se muestra ahora."))}>Copiar</button></div>}
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">{msg}</p>
      {!!links?.length && <ul className="mt-2 divide-y divide-[var(--border)]">{links.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
          <span className="min-w-0 flex-1"><strong className="font-medium">{l.label ?? "Enlace sin nombre"}</strong><span className="block text-xs text-[var(--muted)]">{state(l) === "Activo" ? `Caduca el ${new Date(l.expires_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}` : state(l)} · {l.allow_comment ? "comenta" : "solo lectura"}{l.allow_approve ? ", aprueba" : ""}{l.allow_download ? ", descarga" : ""} · {l.views} visita{l.views === 1 ? "" : "s"}{l.last_viewed_at ? ` · última ${new Date(l.last_viewed_at).toLocaleDateString("es", { day: "numeric", month: "short" })}` : ""}</span></span>
          <span className="chip !py-0.5 text-xs">{state(l)}</span>{canEdit && state(l) === "Activo" && <button onClick={() => revoke(l)} className="text-xs underline">Revocar</button>}</li>))}</ul>}
    </section>
  );
}
