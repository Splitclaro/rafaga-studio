"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

type Project = { id: string; name: string; created_at: string; project_brief: string | null };

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return router.replace("/login");
      const { data, error } = await supabase.from("projects").select("id,name,created_at,project_brief").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) setErr(error.message); else setProjects(data as Project[]);
    })();
  }, [router]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Proyectos</h1>
        <div className="flex gap-3">
          <Link href="/app/new" className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[#101216]">Nuevo proyecto</Link>
          <button className="text-sm text-[var(--muted)] underline" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Salir</button>
        </div>
      </header>
      {err && <p role="alert" className="text-[var(--danger)]">{err}</p>}
      {projects === null && !err && <p className="text-[var(--muted)]">Cargando…</p>}
      {projects?.length === 0 && <p className="rounded-xl bg-[var(--surface)] p-6 text-[var(--muted)]">Aún no hay proyectos. Sube un vídeo y cuéntanos qué clips necesitas.</p>}
      <ul className="space-y-3">
        {projects?.map((p) => (
          <li key={p.id}><Link href={`/app/p/${p.id}`} className="block rounded-xl bg-[var(--surface)] p-4 hover:outline hover:outline-1 hover:outline-[var(--select)]">
            <div className="font-medium">{p.name}</div>
            <div className="tnum text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleString("es")}</div>
          </Link></li>
        ))}
      </ul>
    </main>
  );
}
