"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { Chip, isActive, useProjects, type Row } from "../../../components/ProjectList";
import { supabase } from "../../../lib/supabase";
import { MODE_LABEL } from "../../../lib/projects";

type Sort = "recent" | "oldest" | "name";
type Flt = "all" | "active" | "archived";

/** Proyectos (diseño maestro): rejilla o lista con estado, clips, menú de acciones reales y búsqueda. */
export default function Proyectos() {
  const { rows, err, reload } = useProjects();
  const [q, setQ] = useState(""), [flt, setFlt] = useState<Flt>("all"), [sort, setSort] = useState<Sort>("recent"), [grid, setGrid] = useState(true);
  const [menu, setMenu] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]), [fid, setFid] = useState<string>("");
  const loadFolders = useCallback(async () => { const { data } = await supabase.from("project_folders").select("id,name").order("name"); setFolders((data ?? []) as { id: string; name: string }[]); }, []);
  useEffect(() => { loadFolders(); }, [loadFolders]);
  async function newFolder() { const n = prompt("Nombre de la carpeta:")?.trim(); if (!n) return; const { data: s2 } = await supabase.auth.getSession(); const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single(); const { error } = await supabase.from("project_folders").insert({ name: n.slice(0, 80), workspace_id: ws?.id, created_by: s2.session?.user.id }); setMsg(error ? error.message : "Carpeta creada."); loadFolders(); }
  async function delFolder(f: { id: string; name: string }) { if (!confirm(`¿Eliminar la carpeta «${f.name}»? Sus proyectos vuelven a la lista principal.`)) return; const { error } = await supabase.from("project_folders").delete().eq("id", f.id); setMsg(error ? error.message : "Carpeta eliminada."); setFid(""); loadFolders(); reload(); }
  async function move(p: Row) { setMenu(null); const opts = ["(Sin carpeta)", ...folders.map((f) => f.name)]; const n = prompt(`Mover «${p.name}» a:\n${opts.map((o, i) => `${i}. ${o}`).join("\n")}\nEscribe el número.`); if (n === null) return; const i = Number(n); if (!Number.isInteger(i) || i < 0 || i > folders.length) return setMsg("Número no válido."); const { error } = await supabase.from("projects").update({ folder_id: i === 0 ? null : folders[i - 1].id }).eq("id", p.id); setMsg(error ? error.message : "Proyecto movido."); reload(); }

  const shown = useMemo(() => {
    const l = (rows ?? []).filter((p) => (!fid || p.folder_id === fid) && (flt === "all" ? !p.archived_at : flt === "archived" ? !!p.archived_at : !p.archived_at && isActive(p.status)) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
    return l.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "es") : sort === "oldest" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  }, [rows, q, flt, sort, fid]);
  const nArch = (rows ?? []).filter((p) => p.archived_at).length;

  async function rename(p: Row) { const n = prompt("Nuevo nombre del proyecto:", p.name)?.trim(); setMenu(null); if (!n || n === p.name) return; const { error } = await supabase.from("projects").update({ name: n.slice(0, 150) }).eq("id", p.id); setMsg(error ? error.message : "Proyecto renombrado."); reload(); }
  async function dup(p: Row) { setMenu(null); const { error } = await supabase.rpc("duplicate_project", { p_project: p.id, p_name: null }); setMsg(error ? error.message : "Proyecto duplicado (misma fuente y encargo; los clips se detectan de nuevo)."); reload(); }
  async function arch(p: Row) { setMenu(null); const { error } = await supabase.rpc("archive_project", { p_project: p.id, p_archived: !p.archived_at }); setMsg(error ? error.message : p.archived_at ? "Proyecto restaurado." : "Proyecto archivado."); reload(); }
  async function del(p: Row) { setMenu(null); if (!confirm(`¿Eliminar «${p.name}»? Dejará de aparecer con sus clips.`)) return; const { error } = await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", p.id); setMsg(error ? error.message : "Proyecto eliminado."); reload(); }

  const Menu = ({ p }: { p: Row }) => (
    <div className="relative">
      <button aria-label={`Acciones de ${p.name}`} aria-expanded={menu === p.id} onClick={(e) => { e.preventDefault(); setMenu(menu === p.id ? null : p.id); }} className="grid h-9 w-9 place-items-center rounded-lg bg-white/90 text-[var(--ink)] shadow-sm hover:bg-white"><span aria-hidden className="text-lg leading-none">⋯</span></button>
      {menu === p.id && (
        <div role="menu" className="card-raised absolute right-0 z-20 mt-1 w-44 p-1 text-sm">
          <button role="menuitem" onClick={() => rename(p)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]">Renombrar</button>
          <button role="menuitem" onClick={() => move(p)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]">Mover a carpeta…</button>
          <button role="menuitem" onClick={() => dup(p)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]">Duplicar</button>
          <button role="menuitem" onClick={() => arch(p)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--hover)]">{p.archived_at ? "Restaurar" : "Archivar"}</button>
          <button role="menuitem" onClick={() => del(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[var(--danger)] hover:bg-[var(--hover)]">Eliminar…</button>
        </div>)}
    </div>
  );

  return (
    <main className="mx-auto max-w-[1240px] px-4 pb-20 pt-8 md:px-10" onClick={() => menu && setMenu(null)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl tracking-tight">Proyectos</h1><p className="mt-1 text-sm text-[var(--muted)]">Los proyectos se conservan hasta que los elimines.</p></div>
        <div className="flex gap-2"><Link href="/app/brand-kits#medios" className="btn btn-ghost">Biblioteca de medios</Link><button onClick={newFolder} className="btn btn-ghost"><Icon n="folder" className="h-4 w-4" />Nueva carpeta</button><Link href="/app/nuevo" className="btn btn-primary"><Icon n="plus" className="h-4 w-4" />Nuevo proyecto</Link></div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-sm"><Icon n="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proyecto" aria-label="Buscar proyecto" className="input !pl-9" /></div>
        {([["all", "Todos"], ["active", "En curso"], ["archived", `Archivados${nArch ? ` (${nArch})` : ""}`]] as const).map(([k, l]) => <button key={k} aria-pressed={flt === k} onClick={() => setFlt(k)} className="chip">{l}</button>)}
        <label className="ml-auto flex items-center gap-2 text-sm text-[var(--muted)]">Ordenar<select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input !w-auto"><option value="recent">Última modificación</option><option value="oldest">Más antiguos</option><option value="name">Nombre</option></select></label>
        <div className="inline-flex rounded-xl border hairline bg-[var(--card)] p-0.5"><button aria-label="Rejilla" aria-pressed={grid} onClick={() => setGrid(true)} className={`grid h-9 w-9 place-items-center rounded-lg ${grid ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : ""}`}><Icon n="grid" className="h-4 w-4" /></button><button aria-label="Lista" aria-pressed={!grid} onClick={() => setGrid(false)} className={`grid h-9 w-9 place-items-center rounded-lg ${!grid ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : ""}`}><Icon n="text" className="h-4 w-4" /></button></div>
      </div>
      {!!folders.length && <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Carpetas"><button aria-pressed={!fid} onClick={() => setFid("")} className="chip">Todas</button>{folders.map((f) => <span key={f.id} className="inline-flex items-center gap-1"><button aria-pressed={fid === f.id} onClick={() => setFid(f.id)} className="chip"><Icon n="folder" className="h-3.5 w-3.5" />{f.name}</button>{fid === f.id && <button aria-label={`Eliminar carpeta ${f.name}`} onClick={() => delFolder(f)} className="text-xs text-[var(--danger)] underline">Eliminar</button>}</span>)}</div>}
      {msg && <p role="status" className="card mt-4 p-3 text-sm">{msg}</p>}
      {err && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">No se pudieron cargar los proyectos: {err}</p>}
      {!rows && !err && <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
      {rows && !shown.length && <div className="card mt-6 border-dashed p-12 text-center"><p className="text-lg font-semibold">{q || flt !== "all" ? "Ningún proyecto coincide" : "Todavía no hay proyectos"}</p><p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">Sube un vídeo desde Inicio y Ráfaga lo convierte en clips.</p><Link href="/app" className="btn btn-primary mt-5">Subir un vídeo</Link></div>}
      {!!shown.length && grid && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{shown.map((p) => (
          <li key={p.id} className="card lift group">
            <Link href={`/app/p/${p.id}`} className="block overflow-hidden rounded-t-2xl">
              <div className="relative aspect-video bg-[var(--surface)]">
                {p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : <div className="thumb h-full w-full" />}
                <div className="absolute left-2 top-2"><Chip status={p.status} /></div>
                {p.mode !== "clips" && <span className="chip absolute bottom-2 left-2 !min-h-6 !py-0">{MODE_LABEL[p.mode] ?? p.mode}</span>}
              </div>
            </Link>
            <div className="absolute right-2 top-2"><Menu p={p} /></div>
            <div className="p-3"><Link href={`/app/p/${p.id}`} className="block truncate text-sm font-semibold">{p.name}</Link><div className="mt-0.5 flex justify-between text-xs text-[var(--muted)]"><span className="tnum">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span><span className="tnum">{p.clips} clip{p.clips === 1 ? "" : "s"}</span></div></div>
          </li>))}</ul>)}
      {!!shown.length && !grid && (
        <ul className="mt-6 space-y-2">{shown.map((p) => (
          <li key={p.id} className="card flex items-center gap-3 p-3">
            <Link href={`/app/p/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3"><span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)]">{p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : <span className="thumb block h-full w-full" />}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} · {p.clips} clip{p.clips === 1 ? "" : "s"}</span></span></Link>
            <Chip status={p.status} /><Menu p={p} />
          </li>))}</ul>)}
    </main>
  );
}
