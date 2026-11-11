"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import { downloadMp4, fileName } from "../../../lib/download";

type R = { id: string; ratio: string; burn_subtitles: boolean; storage_path: string; probe: { size?: string; duration?: string } | null; created_at: string; clip_id: string; clip_version: number; clips: { title: string; project_id: string; projects: { name: string } | null } | null };
const mb = (s?: string) => (s ? `${(Number(s) / 1048576).toFixed(1)} MB` : "—");
const dur = (s?: string) => { const n = Math.round(Number(s ?? 0)); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : "—"; };

/** Exportados: todos los MP4 ya renderizados del espacio, con descarga validada (se comprueba que sea un MP4 real antes de guardarlo). */
export default function Exportados() {
  const [rows, setRows] = useState<R[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(""), [ratio, setRatio] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);

  useEffect(() => { (async () => {
    const { data, error } = await supabase.from("renders").select("id,ratio,burn_subtitles,storage_path,probe,created_at,clip_id,clip_version,clips!inner(title,project_id,projects(name))").eq("status", "ready").not("storage_path", "is", null).order("created_at", { ascending: false }).limit(300);
    if (error) return setErr(error.message);
    setRows((data ?? []) as unknown as R[]);
  })(); }, []);

  const shown = useMemo(() => (rows ?? []).filter((r) => (!ratio || r.ratio === ratio) && (!q.trim() || `${r.clips?.title} ${r.clips?.projects?.name}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, q, ratio]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function get(rs: R[]) {
    setBusy(true); setMsg(null); let ok = 0; const bad: string[] = [];
    for (const r of rs) {
      const res = await downloadMp4("renders", r.storage_path, fileName(`${r.clips?.projects?.name ?? "proyecto"}_${r.clips?.title ?? "clip"}_${r.ratio.replace(":", "x")}`));
      if (res.ok) ok++; else bad.push(`«${r.clips?.title}»: ${res.error}`);
      await new Promise((x) => setTimeout(x, 400));
    }
    setBusy(false); setMsg(`${ok} descargado${ok === 1 ? "" : "s"}.${bad.length ? ` ${bad.length} con error. ${bad[0]}` : ""}${rs.length > 1 ? " Si el navegador pide permiso para varias descargas, acéptalo." : ""}`);
  }
  const chosen = shown.filter((r) => sel.has(r.id));

  return (
    <main className="mx-auto max-w-[1240px] px-4 pb-20 pt-8 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl tracking-tight">Exportados</h1><p className="mt-1 text-sm text-[var(--muted)]">Todos los MP4 ya renderizados. Cada descarga se comprueba antes de guardarse.</p></div>
        <Link href="/app/entregas" className="btn btn-ghost">Entregas (ZIP con SRT y portadas)</Link>
      </header>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-sm"><Icon n="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por clip o proyecto" aria-label="Buscar exportados" className="input !pl-9" /></div>
        {["", "9:16", "1:1", "16:9"].map((r) => <button key={r || "all"} aria-pressed={ratio === r} onClick={() => setRatio(r)} className="chip">{r || "Todos los formatos"}</button>)}
        <button onClick={() => get(chosen)} disabled={!chosen.length || busy} className="btn btn-primary ml-auto">{busy ? "Descargando…" : `Descargar${chosen.length ? ` (${chosen.length})` : ""}`}</button>
      </div>
      {err && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">No se pudieron cargar los exportados: {err}</p>}
      {msg && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{msg}</p>}
      {!rows && !err && <div className="skeleton mt-6 h-64" />}
      {rows && !rows.length && <div className="card mt-6 border-dashed p-12 text-center"><p className="text-lg font-semibold">Aún no has exportado ningún clip</p><p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">Abre un clip en el editor y pulsa Exportar, o descarga desde los resultados de un proyecto.</p><Link href="/app/biblioteca" className="btn btn-primary mt-5">Ir a Proyectos</Link></div>}
      {!!rows?.length && (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b hairline text-xs text-[var(--muted)]"><tr><th className="w-10 p-3"><span className="sr-only">Seleccionar</span></th><th className="p-3">Clip</th><th className="p-3">Proyecto</th><th className="p-3">Formato</th><th className="p-3">Duración</th><th className="p-3">Tamaño</th><th className="p-3">Fecha</th><th className="p-3"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-b hairline last:border-0 hover:bg-[var(--hover)]">
                <td className="p-3"><input type="checkbox" aria-label={`Seleccionar ${r.clips?.title}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4" /></td>
                <td className="p-3 font-medium">{r.clips?.title}<span className="ml-2 text-xs font-normal text-[var(--muted)]">v{r.clip_version}</span></td>
                <td className="p-3 text-[var(--muted)]"><Link href={`/app/p/${r.clips?.project_id}`} className="hover:underline">{r.clips?.projects?.name ?? "—"}</Link></td>
                <td className="p-3"><span className="chip !min-h-6 !py-0">{r.ratio}</span> <span className="text-xs text-[var(--muted)]">{r.burn_subtitles ? "con subtítulos" : "sin subtítulos"}</span></td>
                <td className="tnum p-3">{dur(r.probe?.duration)}</td><td className="tnum p-3">{mb(r.probe?.size)}</td>
                <td className="tnum p-3 text-[var(--muted)]">{new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="p-3 text-right"><button onClick={() => get([r])} disabled={busy} className="btn btn-ghost !min-h-9 !py-1"><Icon n="download" className="h-4 w-4" />MP4</button></td>
              </tr>))}</tbody>
          </table>
          {!shown.length && <p className="p-6 text-center text-sm text-[var(--muted)]">Ningún exportado coincide con el filtro.</p>}
        </div>
      )}
    </main>
  );
}
