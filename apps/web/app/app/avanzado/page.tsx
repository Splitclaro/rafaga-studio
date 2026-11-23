"use client";
// Editor de vídeo avanzado: crear o abrir un proyecto y editarlo. Hoy abre los clips existentes en el editor de clips (recorte, encuadre, subtítulos,
// audio, versiones y exportación). El montaje multipista desde cero está en construcción y se dice en pantalla.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";

type Clip = { id: string; title: string; created_at: string; technical_state: string | null; project_id: string };
const STATE: Record<string, string> = { preparando: "Preparando", disponible: "Listo para editar", exportando: "Exportando", fallido: "Con error" };

export default function Avanzado() {
  const [clips, setClips] = useState<Clip[] | null>(null), [err, setErr] = useState<string | null>(null), [q, setQ] = useState("");
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from("clips").select("id,title,created_at,technical_state,project_id,projects!inner(mode)").neq("projects.mode", "lyrics").order("created_at", { ascending: false }).limit(120);
    if (error) setErr(error.message); else setClips((data ?? []) as unknown as Clip[]);
  })(); }, []);
  const list = useMemo(() => (clips ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [clips, q]);
  const NEW = [
    { t: "Vertical · 9:16", d: "TikTok, Reels y Shorts", href: null as string | null, icon: "frame" },
    { t: "Horizontal · 16:9", d: "YouTube y webs", href: null, icon: "film" },
    { t: "De largo a corto", d: "Elige clips de un vídeo largo con Autoclip y edítalos aquí", href: "/app/autoclip/nuevo", icon: "scissors" },
  ];
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">Editor de vídeo avanzado</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Abre un proyecto, ajusta cortes, encuadre, subtítulos y audio, guarda versiones y exporta.</p></header>
      <section aria-labelledby="h-new" className="mb-8">
        <h2 id="h-new" className="mb-3 text-lg">Nuevo proyecto</h2>
        <ul className="grid gap-3 sm:grid-cols-3">{NEW.map((n) => (
          <li key={n.t}>{n.href
            ? <Link href={n.href} className="card lift flex h-full items-start gap-3 p-4"><Icon n={n.icon} className="mt-0.5 h-5 w-5 shrink-0" /><span><b className="block">{n.t}</b><span className="text-sm text-[var(--muted)]">{n.d}</span></span></Link>
            : <div className="card flex h-full items-start gap-3 p-4 opacity-70" aria-disabled="true"><Icon n={n.icon} className="mt-0.5 h-5 w-5 shrink-0" /><span><b className="block">{n.t}</b><span className="text-sm text-[var(--muted)]">{n.d}</span><span className="mt-1 block text-xs text-[var(--muted)]">Montaje desde cero: en construcción.</span></span></div>}
          </li>))}</ul>
      </section>
      <section aria-labelledby="h-proj">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="h-proj" className="text-lg">Proyectos {clips ? <span className="tnum text-sm text-[var(--muted)]">({list.length})</span> : null}</h2>
          <label className="card flex w-full items-center gap-2 px-3 py-2 sm:w-64"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar proyecto</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proyecto" className="w-full bg-transparent text-sm outline-none" /></label></div>
        {err && <p role="alert" className="card p-4 text-sm">No se pudieron cargar los proyectos: {err}. Vuelve a intentarlo en unos segundos.</p>}
        {!clips && !err && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="skeleton h-20" />)}</ul>}
        {clips && !list.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">{q ? "Ningún proyecto coincide con la búsqueda." : "Aún no hay proyectos. Empieza con «De largo a corto»: los clips que elijas aparecerán aquí."}</p>}
        {!!list.length && <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((c) => (
          <li key={c.id}><Link href={`/app/c/${c.id}`} className="card lift block p-4"><b className="line-clamp-2 text-sm">{c.title}</b><span className="mt-1 flex justify-between text-xs text-[var(--muted)]"><span>{STATE[c.technical_state ?? ""] ?? "Clip"}</span><span>{new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</span></span></Link></li>))}</ul>}
      </section>
    </main>
  );
}
