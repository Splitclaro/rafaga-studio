"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { STAGE } from "../lib/projects";

type Row = { id: string; name: string; created_at: string; project_brief: string | null; status: string | null; clips: number };

export function useProjects() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("projects").select("id,name,created_at,project_brief").is("deleted_at", null).order("created_at", { ascending: false });
      if (error) return setErr(error.message);
      const ids = (data ?? []).map((p) => p.id);
      const jobs = ids.length ? (await supabase.from("jobs").select("project_id,status,created_at").in("project_id", ids).eq("kind", "detect").order("created_at", { ascending: false })).data ?? [] : [];
      const clips = ids.length ? (await supabase.from("clips").select("project_id").in("project_id", ids).eq("discarded", false)).data ?? [] : [];
      setRows((data ?? []).map((p) => ({ ...p, status: jobs.find((j) => j.project_id === p.id)?.status ?? null, clips: clips.filter((c) => c.project_id === p.id).length })));
    })();
  }, []);
  return { rows, err };
}

export function Chip({ status }: { status: string | null }) {
  const tone = status === "done" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : status === "failed" ? "bg-[var(--danger)]/15 text-[var(--danger)]" : status ? "bg-[var(--select)]/20 text-[var(--select)]" : "bg-black/10 text-[var(--muted)]";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{status ? STAGE[status] ?? status : "Sin analizar"}</span>;
}

export default function ProjectGrid({ rows, query = "" }: { rows: Row[]; query?: string }) {
  const q = query.trim().toLowerCase();
  const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  if (!list.length) return <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">{q ? "Ningún proyecto coincide con tu búsqueda." : "Aún no tienes proyectos. Sube tu primer vídeo arriba."}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((p) => (
        <li key={p.id}>
          <Link href={`/app/p/${p.id}`} className="block h-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 outline-offset-0 hover:outline hover:outline-1 hover:outline-[var(--select)]">
            <div className="flex items-start justify-between gap-2"><h3 className="truncate font-medium">{p.name}</h3><Chip status={p.status} /></div>
            {p.project_brief && <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{p.project_brief}</p>}
            <div className="tnum mt-3 text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} · {p.clips} clip{p.clips === 1 ? "" : "s"}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
