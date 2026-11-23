"use client";
// Editor de vídeo avanzado · proyectos: crear (vertical, horizontal, cuadrado, 4:5, o «de largo a corto» desde Autoclip), abrir, renombrar y borrar.
// Fuentes públicas: P1 (tamaños 9:16, 16:9, 4:5, 1:1 y proyectos), P3 (clips de Autoclip en el editor).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import { createProject, deleteProject } from "../../../lib/editorstore";
import { TL_ASPECTS, type TlAspect } from "@rafaga/composition";

type Row = { id: string; name: string; aspect: TlAspect; updated_at: string };
const NEW: { aspect: TlAspect; t: string; d: string }[] = [
  { aspect: "9:16", t: "Vertical · 9:16", d: "TikTok, Reels y Shorts" }, { aspect: "16:9", t: "Horizontal · 16:9", d: "YouTube y webs" },
  { aspect: "1:1", t: "Cuadrado · 1:1", d: "Publicaciones cuadradas" }, { aspect: "4:5", t: "Vertical 4:5", d: "Publicaciones de Instagram" },
];
const when = (iso: string) => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Avanzado() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null), [err, setErr] = useState<string | null>(null), [q, setQ] = useState(""), [busy, setBusy] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("editor_projects").select("id,name,aspect,updated_at").order("updated_at", { ascending: false }).limit(200);
    if (error) setErr("No se pudieron cargar tus proyectos. Vuelve a intentarlo en unos segundos."); else { setErr(null); setRows((data ?? []) as Row[]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const list = useMemo(() => (rows ?? []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);

  async function create(aspect: TlAspect) {
    if (busy) return; setBusy(aspect); setMsg(null);
    try { router.push(`/app/avanzado/${await createProject("Proyecto sin título", aspect)}`); } catch (e) { setMsg((e as Error).message); setBusy(null); }
  }
  async function remove(r: Row) {
    if (!confirm(`¿Borrar «${r.name}»? Los medios originales no se tocan.`)) return;
    if (await deleteProject(r.id)) { setRows((x) => (x ?? []).filter((y) => y.id !== r.id)); setMsg(`«${r.name}» borrado.`); } else setMsg("No se pudo borrar el proyecto.");
  }
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">Editor de vídeo avanzado</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Monta un vídeo en una línea de tiempo con capas de vídeo, texto y sonido. Se guarda solo y lo exportas desde aquí.</p></header>
      <section aria-labelledby="h-new" className="mb-8">
        <h2 id="h-new" className="mb-3 text-lg">Nuevo proyecto</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {NEW.map((n) => (<li key={n.aspect}><button type="button" disabled={!!busy} onClick={() => void create(n.aspect)} className="card lift flex h-full w-full items-start gap-3 p-4 text-left disabled:opacity-60">
            <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface)]"><span className="block border-2 border-[var(--ink)]" style={{ width: 14 * (TL_ASPECTS[n.aspect].width / Math.max(TL_ASPECTS[n.aspect].width, TL_ASPECTS[n.aspect].height)), height: 14 * (TL_ASPECTS[n.aspect].height / Math.max(TL_ASPECTS[n.aspect].width, TL_ASPECTS[n.aspect].height)) }} /></span>
            <span><b className="block">{busy === n.aspect ? "Creando…" : n.t}</b><span className="text-sm text-[var(--muted)]">{n.d}</span></span></button></li>))}
          <li><Link href="/app/autoclip/nuevo" className="card lift flex h-full items-start gap-3 p-4"><Icon n="scissors" className="mt-0.5 h-5 w-5 shrink-0" /><span><b className="block">De largo a corto</b><span className="text-sm text-[var(--muted)]">Elige clips de un vídeo largo en Autoclip y edítalos aquí</span></span></Link></li>
        </ul>
        {msg && <p role="status" className="mt-3 text-sm">{msg}</p>}
      </section>
      <section aria-labelledby="h-proj">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="h-proj" className="text-lg">Proyectos {rows ? <span className="tnum text-sm text-[var(--muted)]">({list.length})</span> : null}</h2>
          <label className="card flex w-full items-center gap-2 px-3 py-2 sm:w-64"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar proyecto</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proyecto" className="w-full bg-transparent text-sm outline-none" /></label></div>
        {err && <p role="alert" className="card p-4 text-sm">{err} <button className="underline" onClick={() => void load()}>Reintentar</button></p>}
        {!rows && !err && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="skeleton h-20" />)}</ul>}
        {rows && !list.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">{q ? "Ningún proyecto coincide con la búsqueda." : "Aún no hay proyectos. Empieza uno arriba: se guarda en tu cuenta."}</p>}
        {!!list.length && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((r) => (
          <li key={r.id} className="card flex items-center justify-between gap-2 p-4"><Link href={`/app/avanzado/${r.id}`} className="min-w-0 flex-1"><b className="line-clamp-1">{r.name}</b><span className="block text-xs text-[var(--muted)]">{r.aspect} · editado {when(r.updated_at)}</span></Link>
            <button type="button" aria-label={`Borrar ${r.name}`} className="btn btn-ghost !min-h-9 shrink-0" onClick={() => void remove(r)}>Borrar</button></li>))}</ul>}
      </section>
    </main>
  );
}
