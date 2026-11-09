"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, BRIEF_MAX } from "../../../../lib/supabase";

type Project = { id: string; name: string; project_brief: string | null; clip_count: number };
type Job = { id: string; status: string; error_message: string | null; created_at: string; attempts: number };
type Clip = { id: string; title: string; generation_id: string; favorite: boolean; candidate: { reason: string | null; brief_fit: string | null; scores: { overall?: number } | null; start_ms: number; end_ms: number } | null; url?: string };

const STAGE: Record<string, string> = { queued: "En cola", validating: "Validando", extracting: "Extrayendo audio", transcribing: "Transcribiendo", selecting: "Seleccionando momentos", tracking: "Reencuadrando", rendering: "Renderizando", done: "Listo", failed: "Fallido", cancelled: "Cancelado" };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<Project | null>(null);
  const [brief, setBrief] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wake, setWake] = useState<"woken" | "warm" | "cold" | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data: j } = await supabase.from("jobs").select("id,status,error_message,created_at,attempts").eq("project_id", id).eq("kind", "detect").order("created_at", { ascending: false }).limit(1);
    setJob((j?.[0] as Job) ?? null);
    const { data: cs } = await supabase.from("clips").select("id,title,generation_id,favorite,candidate:clip_candidates(reason,brief_fit,scores,start_ms,end_ms)").eq("project_id", id).eq("discarded", false).order("created_at", { ascending: false });
    const list = (cs ?? []) as unknown as Clip[];
    for (const c of list) {
      const { data: r } = await supabase.from("renders").select("storage_path").eq("clip_id", c.id).eq("status", "ready").limit(1);
      if (r?.[0]?.storage_path) c.url = (await supabase.storage.from("renders").createSignedUrl(r[0].storage_path, 600)).data?.signedUrl;
    }
    setClips(list);
  }, [id]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return router.replace("/login");
      const { data, error } = await supabase.from("projects").select("id,name,project_brief,clip_count").eq("id", id).single();
      if (error) return setMsg("Proyecto no encontrado.");
      setP(data as Project); setBrief((data as Project).project_brief ?? "");
      await load();
    })();
  }, [id, router, load]);

  const active = job && !["done", "failed", "cancelled"].includes(job.status);
  useEffect(() => { if (!active) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [active, load]);

  async function saveBrief() {
    const { error } = await supabase.from("projects").update({ project_brief: brief.trim() || null }).eq("id", id);
    setMsg(error ? error.message : "Enfoque guardado.");
    return !error;
  }

  async function detect() {
    if (busyRef.current) return; // doble clic no duplica
    busyRef.current = true; setBusy(true); setMsg(null);
    try {
      if (!(await saveBrief())) return;
      const { error } = await supabase.rpc("request_detection", { p_project: id, p_key: crypto.randomUUID() });
      if (error) setMsg(error.message);
      else {
        setMsg("Detección solicitada.");
        await load();
        const { data: s } = await supabase.auth.getSession();
        fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } })
          .then((r) => r.json()).then((j) => setWake(j.woken ? "woken" : j.reason === "already_running" ? "warm" : "cold")).catch(() => setWake("cold"));
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  if (!p) return <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">{msg ?? "Cargando…"}</main>;
  const waitingMin = job?.status === "queued" ? Math.floor((Date.now() - new Date(job.created_at).getTime()) / 60000) : 0;
  const hasRun = !!job && job.status === "done" || clips.length > 0;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <Link href="/app/proyectos" className="text-sm text-[var(--muted)] underline">← Proyectos</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">{p.name}</h1>
      <label className="block">
        <span className="font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
        <textarea rows={5} maxLength={BRIEF_MAX} className="mt-2 w-full rounded bg-[var(--surface)] px-3 py-2" value={brief} onChange={(e) => setBrief(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={saveBrief} className="rounded-lg border border-[var(--muted)] px-4 py-2">Guardar enfoque</button>
        <button onClick={detect} disabled={busy || !!active} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[#101216] disabled:opacity-50">{hasRun ? "Volver a detectar" : "Detectar momentos virales"}</button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">La selección y la puntuación son estimaciones editoriales de IA; no garantizan que un clip se haga viral. Volver a detectar reutiliza la transcripción y conserva los clips anteriores.</p>

      {job && (
        <section aria-live="polite" className="mt-6 rounded-xl bg-[var(--surface)] p-4 text-sm">
          <div className="font-medium">Estado: {STAGE[job.status] ?? job.status}{job.attempts > 1 ? ` · intento ${job.attempts}` : ""}</div>
          {job.status === "queued" && <p className="mt-1 text-[var(--muted)]">{wake === "warm" ? "El worker ya está activo: debería recogerlo en segundos." : wake === "woken" ? "Arrancando el worker (suele tardar 1–2 min la primera vez)." : "El worker arranca según el programador de GitHub, que puede tardar varios minutos."} Llevas {waitingMin} min en cola.{waitingMin >= 15 && " Si sigue así, el worker no está activo."}</p>}
          {job.error_message && <p role="alert" className="mt-1 text-[var(--danger)]">{job.error_message}</p>}
        </section>
      )}

      {clips.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium">Clips</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {clips.map((c) => (
              <li key={c.id} className="rounded-xl bg-[var(--surface)] p-3">
                {c.url ? <video src={c.url} controls preload="metadata" className="aspect-[9/16] w-full rounded bg-black" /> : <div className="grid aspect-[9/16] place-items-center rounded bg-black text-sm text-[var(--muted)]">Renderizando…</div>}
                <div className="mt-2 font-medium">{c.title}</div>
                {c.candidate && (<>
                  <div className="tnum text-xs text-[var(--muted)]">{(c.candidate.start_ms / 1000).toFixed(1)}s – {(c.candidate.end_ms / 1000).toFixed(1)}s · Estimación de IA: {c.candidate.scores?.overall ?? "–"}/10</div>
                  {c.candidate.brief_fit && <p className="mt-1 text-sm"><span className="text-[var(--muted)]">Por qué encaja con tu objetivo: </span>{c.candidate.brief_fit}</p>}
                </>)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {job?.status === "done" && clips.length === 0 && <p className="mt-6 rounded-lg bg-[var(--surface)] p-3 text-sm">No se encontraron momentos que encajen con tu enfoque. Prueba a ampliarlo o a dejarlo vacío.</p>}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-[var(--muted)]">{msg}</p>
    </main>
  );
}
