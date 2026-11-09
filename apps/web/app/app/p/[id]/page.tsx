"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, PROCESSING_ENABLED, BRIEF_MAX } from "../../../../lib/supabase";

type Project = { id: string; name: string; project_brief: string | null; clip_count: number; source_id: string };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<Project | null>(null);
  const [brief, setBrief] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return router.replace("/login");
      const { data, error } = await supabase.from("projects").select("id,name,project_brief,clip_count,source_id").eq("id", id).single();
      if (error) return setMsg("Proyecto no encontrado.");
      setP(data as Project); setBrief((data as Project).project_brief ?? "");
    })();
  }, [id, router]);

  async function saveBrief() {
    const { error } = await supabase.from("projects").update({ project_brief: brief.trim() || null }).eq("id", id);
    setMsg(error ? error.message : "Enfoque guardado.");
  }

  if (!p) return <main className="mx-auto max-w-3xl px-4 py-10">{msg ?? "Cargando…"}</main>;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/app" className="text-sm text-[var(--muted)] underline">← Proyectos</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">{p.name}</h1>
      <label className="block">
        <span className="font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
        <textarea rows={5} maxLength={BRIEF_MAX} className="mt-2 w-full rounded bg-[var(--surface)] px-3 py-2" value={brief} onChange={(e) => setBrief(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={saveBrief} className="rounded-lg border border-[var(--muted)] px-4 py-2">Guardar enfoque</button>
        <button disabled={!PROCESSING_ENABLED} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[#101216] disabled:opacity-50">Detectar momentos virales</button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">La selección y la puntuación son estimaciones editoriales de IA; no garantizan que un clip se haga viral.</p>
      {!PROCESSING_ENABLED && (
        <p role="note" className="mt-4 rounded-lg bg-[var(--surface)] p-3 text-sm">El procesamiento de vídeo todavía no está conectado en esta beta (falta el worker). Tu vídeo y tu enfoque ya están guardados y se usarán cuando se active.</p>
      )}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">{msg}</p>
    </main>
  );
}
