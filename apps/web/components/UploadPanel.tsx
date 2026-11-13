"use client";
// Panel de subida v2: soltar o elegir archivo, cuota antes de subir, progreso real (bytes, velocidad, tiempo restante),
// cancelar, reanudar tras recargar, aviso de duplicado y ficha final con el estado de validación.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { httpApi, localResumeStore, runUpload, type UploadEvent } from "../lib/uploader";

const MAX = 4294967296;
const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtEta = (s: number | null) => (s == null ? "calculando…" : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
type Done = { project_id: string; source_id: string; job_id: string; name: string };
type Pending = { upload_id: string; project_id: string; source_id: string; name: string; size: number };

export default function UploadPanel({ workspaceId, onDone }: { workspaceId?: string; onDone?: (d: Done) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [ev, setEv] = useState<UploadEvent | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used_bytes: number; quota_bytes: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const ctl = useRef<{ cancel: () => Promise<void> } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem("rafaga-upload:pending") ?? "null"); if (p) setPending(p); } catch { /* sin almacenamiento */ }
    if (!workspaceId) return;
    (async () => { const r = await fetch(`/api/uploads?workspace_id=${workspaceId}`, { headers: { Authorization: `Bearer ${await token()}` } }); if (r.ok) setQuota(await r.json()); })();
  }, [workspaceId]);

  const hashes = (f: File) => new Promise<{ prefix: Promise<string>; full: Promise<string> }>((resolve) => {
    const w = new Worker(new URL("../lib/hash.worker.ts", import.meta.url), { type: "module" });
    let rp!: (s: string) => void, rf!: (s: string) => void;
    const prefix = new Promise<string>((r) => (rp = r)), full = new Promise<string>((r) => (rf = r));
    w.onmessage = (e) => { if (e.data.kind === "prefix") rp(e.data.sha256_prefix); if (e.data.kind === "full") { rf(e.data.sha256); w.terminate(); } };
    w.postMessage({ file: f });
    resolve({ prefix, full });
  });

  async function start(f: File, force = false, resume?: Pending) {
    setMsg(null); setDup(null); setBusy(true);
    try {
      if (f.size > MAX) throw new Error("El archivo supera los 4 GB. Recórtalo o comprímelo y vuelve a subirlo.");
      if (quota && quota.used_bytes + f.size > quota.quota_bytes) throw new Error(`No queda espacio: usas ${fmtBytes(quota.used_bytes)} de ${fmtBytes(quota.quota_bytes)}. Borra o archiva proyectos.`);
      const t = await token(), h = await hashes(f);
      let s = resume;
      if (!s) {
        const r = await fetch("/api/uploads", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", "Idempotency-Key": `up-${crypto.randomUUID()}` },
          body: JSON.stringify({ workspace_id: workspaceId, name: f.name.replace(/\.[^.]+$/, ""), bytes: f.size, mime: f.type || "video/mp4", sha256_prefix: await h.prefix, force }) });
        const b = await r.json();
        if (r.status === 409) { setDup(b.duplicate_of_project); setBusy(false); return; }
        if (!r.ok) throw new Error(b?.error?.message ?? "No se pudo empezar la subida.");
        s = { upload_id: b.upload_id, project_id: b.project_id, source_id: b.source_id, name: f.name, size: f.size };
        try { localStorage.setItem("rafaga-upload:pending", JSON.stringify(s)); } catch { /* sin almacenamiento */ }
      }
      const up = runUpload({ uploadId: s.upload_id, file: f, api: httpApi(t), store: localResumeStore, sha256: () => h.full, onEvent: setEv });
      ctl.current = up;
      const res = await up.promise;
      ctl.current = null;
      try { localStorage.removeItem("rafaga-upload:pending"); } catch { /* sin almacenamiento */ }
      setPending(null);
      if (res) onDone?.({ project_id: s.project_id, source_id: s.source_id, job_id: res.job_id, name: f.name });
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel() { await ctl.current?.cancel(); try { localStorage.removeItem("rafaga-upload:pending"); } catch { /* sin almacenamiento */ } setPending(null); setBusy(false); setMsg("Subida cancelada. No se ha guardado nada."); }
  const pick = (f: File | undefined) => { if (f) { setFile(f); if (!busy) start(f); } };
  const pct = ev ? Math.round((100 * ev.bytesSent) / Math.max(1, ev.totalBytes)) : 0;

  return (
    <div className="card p-4">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
        className={`grid place-items-center rounded-xl border border-dashed p-6 text-center text-sm ${drag ? "bg-[var(--surface-2,#f2f2f5)]" : ""}`}>
        <p>Suelta aquí tu vídeo o elige cómo subirlo</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>Subir archivo</button>
          <button type="button" className="btn btn-ghost" disabled title="Disponible cuando se active la importación">Google Drive</button>
          <button type="button" className="btn btn-ghost" disabled title="Disponible cuando se active la importación">Dropbox</button>
          <button type="button" className="btn btn-ghost" disabled title="Disponible cuando se active la importación">Enlace directo</button>
        </div>
        <input ref={input} type="file" accept="video/*,.mov,.mp4,.mkv,.webm" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <p className="mt-2 text-xs text-[var(--muted)]">Hasta 4 GB y 60 minutos.{quota ? ` Espacio usado: ${fmtBytes(quota.used_bytes)} de ${fmtBytes(quota.quota_bytes)}.` : ""}</p>
      </div>

      {pending && !busy && (
        <div className="mt-3 text-sm" role="status">
          Hay una subida a medias de «{pending.name}». Vuelve a elegir el mismo archivo para continuar donde se quedó.
          <input type="file" className="ml-2 text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size === pending.size) { setFile(f); start(f, false, pending); } else if (f) setMsg("Ese no es el mismo archivo."); }} />
        </div>
      )}

      {ev && busy && (
        <div className="mt-4" aria-live="polite">
          <div className="flex justify-between text-xs"><span>{file?.name}</span><span className="tnum">{pct} %</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-black/10"><div className="h-full bg-[var(--accent,#2A55F5)]" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 flex justify-between text-xs text-[var(--muted)] tnum">
            <span>{fmtBytes(ev.bytesSent)} de {fmtBytes(ev.totalBytes)} · {ev.speedBps ? `${fmtBytes(ev.speedBps)}/s` : "—"}</span>
            <span>{ev.state === "retrying" ? "Reintentando…" : ev.state === "completing" ? "Verificando…" : `Quedan ${fmtEta(ev.etaS)}`}</span>
          </div>
          <button type="button" className="btn btn-ghost mt-2 !px-2 !py-1 text-xs" onClick={cancel}>Cancelar subida</button>
        </div>
      )}

      {dup && file && (
        <div className="mt-3 text-sm" role="alert">
          Ya subiste este vídeo. <a className="underline" href={`/app/p/${dup}`}>Abrir el proyecto existente</a> o{" "}
          <button type="button" className="underline" onClick={() => start(file, true)}>subirlo igualmente</button>.
        </div>
      )}
      {msg && <p className="mt-3 text-sm" role="alert">{msg}</p>}
      {ev?.state === "done" && <p className="mt-3 text-sm" role="status">Subida completa. Validando el archivo… Puedes cerrar la pestaña: el proceso sigue en el servidor.</p>}
    </div>
  );
}
