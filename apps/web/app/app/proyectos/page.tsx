"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import ProjectGrid, { useProjects } from "../../../components/ProjectList";

export default function Proyectos() {
  const { rows, err } = useProjects();
  const [q, setQ] = useState("");
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Proyectos</h1>
        <Link href="/app" className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white"><Icon n="plus" className="h-4 w-4" />Nuevo proyecto</Link>
      </header>
      <label className="mb-5 flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-2"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar proyectos</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" className="w-full bg-transparent outline-none" /></label>
      {err && <p role="alert" className="text-[var(--danger)]">{err}</p>}
      {!rows && !err && <p className="text-[var(--muted)]">Cargando…</p>}
      {rows && <ProjectGrid rows={rows} query={q} />}
    </main>
  );
}
