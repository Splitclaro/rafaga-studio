"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { downloadMp4 } from "../../../lib/download";
import { StatusLabel, pieceStatus, fmtDur } from "../../../components/ui/status";

type Item = { clip_id: string; version: number; title: string; review_status: string; approved_version: number | null; current_version: number; thumb_path: string | null; render_path: string | null; ratio: string | null; duration: string | null; size: string | null };
type Cm = { id: string; clip_id: string; version: number; at_sec: number | null; body: string; kind: string; who: string; created_at: string };
type View = { error?: string; delivery: { name: string; description: string | null; created_at: string; project: string; brand: string | null }; perms: { download: boolean; comment: boolean; approve: boolean }; expires_at: string; items: Item[]; comments: Cm[] };
const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "pieza";
const ERR: Record<string, string> = { invalid: "Este enlace no es válido. Pide uno nuevo a quien te lo envió.", expired: "Este enlace ha caducado. Pide uno nuevo a quien te lo envió.", revoked: "Este enlace se ha desactivado. Pide uno nuevo a quien te lo envió." };

/** Página pública de revisión: acceso solo con el token del enlace (sin cuenta). Todo pasa por RPC con comprobación de permisos en el servidor. */
export default function Revision({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Item | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [t, setT] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const dlg = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("share_view", { p_token: token });
    if (error || !data) return setErr("No se pudo cargar la revisión. Inténtalo de nuevo en unos minutos.");
    const j = data as View; if (j.error) return setErr(ERR[j.error] ?? ERR.invalid);
    setV(j);
    const paths = j.items.map((i) => i.thumb_path).filter((x): x is string => !!x);
    if (paths.length) { const { data: sg } = await supabase.storage.from("renders").createSignedUrls(paths, 3600); setThumbs(Object.fromEntries((sg ?? []).flatMap((x) => (x.signedUrl && x.path ? [[x.path, x.signedUrl] as [string, string]] : [])))); }
  }, [token]);
  useEffect(() => { load(); try { setName(localStorage.getItem("rafaga.guest") ?? ""); } catch {} }, [load]);
  useEffect(() => { try { if (name) localStorage.setItem("rafaga.guest", name); } catch {} }, [name]);

  useEffect(() => {
    setSrc(null); setMsg(null); setBody("");
    if (!open?.render_path) return; let off = false;
    supabase.storage.from("renders").createSignedUrl(open.render_path, 900).then(({ data }) => { if (!off) setSrc(data?.signedUrl ?? null); });
    return () => { off = true; };
  }, [open]);
  useEffect(() => { if (open) dlg.current?.focus(); }, [open]);
  useEffect(() => { const el = video.current; if (!el) return; const f = () => setT(el.currentTime); el.addEventListener("timeupdate", f); return () => el.removeEventListener("timeupdate", f); }, [src]);

  async function comment(e: React.FormEvent) {
    e.preventDefault(); if (!open) return; setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("share_comment", { p_token: token, p_clip: open.clip_id, p_at: +t.toFixed(2), p_body: body, p_name: name });
    setBusy(false); if (error) return setMsg(error.message); setBody(""); load();
  }
  async function decide(status: "approved" | "changes_requested") {
    if (!open) return; setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("share_decide", { p_token: token, p_clip: open.clip_id, p_status: status, p_note: body, p_name: name });
    setBusy(false); if (error) return setMsg(error.message);
    setBody(""); setMsg(status === "approved" ? "Gracias: has aprobado esta pieza." : "Gracias: se han solicitado cambios."); await load();
  }
  async function download(i: Item) {
    if (!i.render_path || !v) return;
    const f = `${safe(v.delivery.project)}_${safe(i.title)}_${(i.ratio ?? "9:16").replace(":", "x")}_v${i.version}.mp4`;
    const r = await downloadMp4("renders", i.render_path, f); if (!r.ok) alert(r.error);
  }

  if (err) return <main className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center"><div><h1 className="text-2xl tracking-tight">Revisión no disponible</h1><p className="mt-3 text-[var(--muted)]">{err}</p></div></main>;
  if (!v) return <main className="mx-auto max-w-5xl px-6 py-12"><div className="skeleton h-72" /></main>;
  const cur = open ? v.items.find((i) => i.clip_id === open.clip_id) ?? open : null;
  const st = cur ? pieceStatus({ review_status: cur.review_status, approved_version: cur.approved_version, current_version: cur.version, hasRender: !!cur.render_path }) : null;
  const cms = cur ? v.comments.filter((c) => c.clip_id === cur.clip_id && c.version === cur.version) : [];
  const stale = !!cur && cur.version !== cur.current_version;
  const approved = v.items.filter((i) => i.review_status === "approved" && i.approved_version === i.version).length;
  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-10 md:px-8">
      <header>
        <p className="text-sm text-[var(--muted)]">{v.delivery.brand ? `${v.delivery.brand} · ` : ""}{v.delivery.project}</p>
        <h1 className="mt-1 text-3xl tracking-tight md:text-4xl">{v.delivery.name}</h1>
        {v.delivery.description && <p className="mt-3 max-w-2xl text-[var(--muted)]">{v.delivery.description}</p>}
        <p className="mt-3 text-sm text-[var(--muted)]">{v.items.length} pieza{v.items.length === 1 ? "" : "s"} · {approved} aprobada{approved === 1 ? "" : "s"} · enlace válido hasta el {new Date(v.expires_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{v.perms.comment ? "Puedes comentar" : "Solo lectura"}{v.perms.approve ? ", aprobar o pedir cambios" : ""}{v.perms.download ? " y descargar" : ""}.</p>
      </header>
      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 lg:grid-cols-4">
        {v.items.map((i) => { const s = pieceStatus({ review_status: i.review_status, approved_version: i.approved_version, current_version: i.version, hasRender: !!i.render_path }); return (
          <li key={i.clip_id}><button onClick={() => setOpen(i)} className="block w-full text-left">
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[var(--ink)]">
              {i.thumb_path && thumbs[i.thumb_path] ? <img src={thumbs[i.thumb_path]} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-xs text-white/60">Sin portada</div>}
              {i.duration && <span className="tnum absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{fmtDur(Number(i.duration) * 1000)}</span>}
            </div>
            <h2 className="mt-2.5 line-clamp-2 text-[15px] font-medium leading-snug">{i.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusLabel status={s.status} /><span className="tnum text-xs text-[var(--muted)]">{i.ratio ?? "—"} · v{i.version}</span></div></button></li>); })}
      </ul>

      {cur && (
        <div role="dialog" aria-modal="true" aria-label={cur.title} ref={dlg} tabIndex={-1} className="fixed inset-0 z-40 overflow-auto bg-white" onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-5 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section>
              <div className="flex items-start justify-between gap-3"><h2 className="text-2xl tracking-tight">{cur.title}</h2><button onClick={() => setOpen(null)} className="btn btn-ghost !py-1.5 !text-xs">Cerrar</button></div>
              <div className="mt-3 grid place-items-center rounded-3xl bg-[#EFEFEF] p-3 md:p-6">{src ? <video ref={video} src={src} controls playsInline preload="metadata" className="max-h-[70vh] w-auto max-w-full rounded-2xl bg-black" /> : <div className="grid h-[50vh] place-items-center text-sm text-[var(--muted)]">{cur.render_path ? <span className="pulse" aria-label="Cargando" /> : "Esta pieza aún no tiene vídeo."}</div>}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">{st && <StatusLabel status={st.status} />}<span className="tnum text-sm text-[var(--muted)]">{cur.ratio} · v{cur.version}</span>{v.perms.download && cur.render_path && <button onClick={() => download(cur)} className="btn btn-ghost ml-auto !py-1.5 !text-xs">Descargar MP4</button>}</div>
              {stale && <p className="mt-2 text-sm text-[var(--muted)]">El equipo ya trabaja en la v{cur.current_version}; esta entrega muestra la v{cur.version}. Las decisiones sobre esta versión ya no se aceptan: pide una entrega actualizada.</p>}
            </section>
            <aside aria-label="Comentarios">
              <h3 className="text-lg tracking-tight">Comentarios <span className="tnum text-sm text-[var(--muted)]">{cms.length}</span></h3>
              <ol className="mt-3 max-h-[34vh] space-y-2.5 overflow-auto pr-1">
                {!cms.length && <li className="text-sm text-[var(--muted)]">Todavía no hay comentarios.</li>}
                {cms.map((c) => <li key={c.id} className={`rounded-xl p-3 text-sm ${c.kind === "approval" ? "bg-[var(--ink)] text-white" : c.kind === "changes" ? "bg-white ring-1 ring-inset ring-[#111]" : "bg-[var(--surface)]"}`}>
                  <div className="flex items-center gap-2 text-xs opacity-80"><strong>{c.who}</strong>{c.kind === "approval" && "· aprobó"}{c.kind === "changes" && "· pidió cambios"}{c.at_sec != null && <button onClick={() => { if (video.current) video.current.currentTime = c.at_sec!; }} className="tnum underline">en {clock(c.at_sec)}</button>}</div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p></li>)}
              </ol>
              {v.perms.comment && !stale ? (
                <form onSubmit={comment} className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                  <label className="block text-sm">Tu nombre<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="input mt-1" autoComplete="name" /></label>
                  <label className="block text-sm">Comentario<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className="input mt-1 resize-y" placeholder={`Se vinculará al instante ${clock(t)}`} /></label>
                  <div className="flex flex-wrap gap-2"><button disabled={busy || !body.trim() || !name.trim()} className="btn btn-ghost !py-1.5 !text-xs">Comentar en {clock(t)}</button>
                    {v.perms.approve && <><button type="button" disabled={busy || !name.trim()} onClick={() => decide("changes_requested")} className="btn btn-ghost !py-1.5 !text-xs">Pedir cambios</button><button type="button" disabled={busy || !name.trim()} onClick={() => decide("approved")} className="btn btn-primary !py-1.5 !text-xs">Aprobar v{cur.version}</button></>}</div>
                </form>) : <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">{stale ? "Esta versión ya no admite comentarios." : "Este enlace es de solo lectura."}</p>}
              <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">{msg}</p>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
