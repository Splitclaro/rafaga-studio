"use client";
// Inicio: las tres herramientas de Ráfaga y lo último de cada una. El historial completo vive dentro de cada herramienta.
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../components/Icon";
import { useProjects, isActive } from "../../components/ProjectList";
import { supabase } from "../../lib/supabase";

type Item = { id: string; title: string; href: string; when: string; note?: string };
const day = (iso: string) => new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });

export default function Inicio() {
  const { rows } = useProjects();
  const [songs, setSongs] = useState<Item[] | null>(null), [clips, setClips] = useState<Item[] | null>(null);
  useEffect(() => { (async () => {
    const [s, c] = await Promise.all([
      supabase.from("songs").select("id,title,created_at").order("created_at", { ascending: false }).limit(3),
      supabase.from("clips").select("id,title,created_at").order("created_at", { ascending: false }).limit(3),
    ]);
    setSongs(((s.data ?? []) as { id: string; title: string; created_at: string }[]).map((x) => ({ id: x.id, title: x.title || "Canción sin título", href: `/app/editor?song=${x.id}`, when: x.created_at })));
    setClips(((c.data ?? []) as { id: string; title: string; created_at: string }[]).map((x) => ({ id: x.id, title: x.title, href: `/app/c/${x.id}`, when: x.created_at })));
  })(); }, []);
  const analyzed: Item[] | null = rows ? rows.filter((p) => !p.archived_at).slice(0, 3).map((p) => ({ id: p.id, title: p.name, href: `/app/autoclip/${p.id}`, when: p.created_at, note: isActive(p.status) ? "Analizando" : p.clips ? `${p.clips} clip${p.clips === 1 ? "" : "s"}` : undefined })) : null;

  const TOOLS = [
    { id: "editor", href: "/app/editor", icon: "music", name: "Editor de vídeos", what: "Convierte una canción en un vídeo con la letra sincronizada: audio, letras, estilo y render.", cta: "Crear un vídeo con letra", recent: songs, empty: "Aún no has subido canciones." },
    { id: "avanzado", href: "/app/avanzado", icon: "layers", name: "Editor de vídeo avanzado", what: "Abre un proyecto, ajusta cortes, encuadre, subtítulos y audio, guarda versiones y exporta.", cta: "Abrir el editor", recent: clips, empty: "Aún no hay proyectos para editar." },
    { id: "autoclip", href: "/app/autoclip", icon: "scissors", name: "Autoclip", what: "Sube un podcast, un directo o una entrevista y recibe los mejores momentos, listos para revisar y exportar.", cta: "Analizar un vídeo largo", recent: analyzed, empty: "Aún no has analizado ningún vídeo." },
  ] as const;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-8"><h1 className="text-3xl md:text-4xl">¿Qué vas a crear hoy?</h1><p className="mt-1 text-[var(--muted)]">Elige una herramienta. Lo que hagas se guarda y lo encontrarás dentro de ella.</p></header>
      <ul className="grid gap-4 lg:grid-cols-3" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <li key={t.id} className="card flex flex-col p-5">
            <span aria-hidden className="ico-tile grad mb-3 !h-11 !w-11 !rounded-[12px]"><Icon n={t.icon} className="h-5 w-5" /></span>
            <h2 className="text-xl">{t.name}</h2>
            <p className="mt-1 flex-1 text-sm text-[var(--muted)]">{t.what}</p>
            <Link href={t.href} className="btn btn-primary mt-4 w-full justify-center">{t.cta}</Link>
            <div className="mt-5 border-t hairline pt-3">
              <h3 className="mb-2 text-xs font-semibold text-[var(--muted)]">Recientes</h3>
              {t.recent === null ? <div className="skeleton h-14" aria-busy="true" /> : !t.recent.length ? <p className="text-sm text-[var(--muted)]">{t.empty}</p> :
                <ul className="space-y-1">{t.recent.map((r) => <li key={r.id}><Link href={r.href} className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--hover)]"><span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-[var(--muted)]">{r.note ? `${r.note} · ` : ""}{day(r.when)}</span></Link></li>)}</ul>}
            </div>
          </li>))}
      </ul>
    </main>
  );
}
