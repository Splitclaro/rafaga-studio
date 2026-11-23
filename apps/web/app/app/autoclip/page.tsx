"use client";
// Autoclip: historial de vídeos analizados dentro de la herramienta y entrada para analizar uno nuevo.
import Link from "next/link";
import Icon from "../../../components/Icon";
import { useProjects, ProjectCard } from "../../../components/ProjectList";

export default function Autoclip() {
  const { rows, err } = useProjects();
  const list = (rows ?? []).filter((p) => !p.archived_at);
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Autoclip</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Sube un podcast, un directo o una entrevista. Ráfaga lo analiza en el servidor, te propone los mejores momentos con su motivo y puedes ajustar los cortes, exportarlos o llevarlos al editor avanzado.</p></div>
        <Link href="/app/autoclip/nuevo" className="btn btn-primary"><Icon n="upload" className="h-4 w-4" />Analizar un vídeo</Link>
      </header>
      <section aria-labelledby="h-hist">
        <h2 id="h-hist" className="mb-3 text-lg">Vídeos analizados</h2>
        {err && <p role="alert" className="card p-4 text-sm">No se pudo cargar el historial: {err}. Vuelve a intentarlo en unos segundos.</p>}
        {!rows && !err && <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
        {rows && !list.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">Todavía no has analizado ningún vídeo. Pulsa «Analizar un vídeo» para empezar.</p>}
        {!!list.length && <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}</ul>}
      </section>
    </main>
  );
}
