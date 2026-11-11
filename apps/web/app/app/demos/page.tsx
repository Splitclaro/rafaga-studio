"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { createProject } from "../../../lib/projects";
import { supabase } from "../../../lib/supabase";

const DEMOS = [
  { id: "emprender", title: "Monólogo: tres errores al emprender", len: "1:42", file: "/demo/ejemplo-emprender.mp4", brief: "Busca consejos concretos y errores que se pueden evitar.", note: "Voz sintética creada por Ráfaga. Sin personas ni contenido de terceros." },
];

/** Demos: prueba el flujo completo sin subir nada. Crea un proyecto real en tu espacio con un vídeo de ejemplo propio. */
export default function Demos() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);
  async function use(d: (typeof DEMOS)[number]) {
    if (busy) return; setBusy(d.id); setMsg("Descargando el vídeo de ejemplo…");
    try {
      const blob = await (await fetch(d.file)).blob();
      const file = new File([blob], `${d.id}.mp4`, { type: "video/mp4" });
      const id = await createProject({ file, name: `Ejemplo · ${d.title}`, brief: d.brief, count: 3, mode: "clips", onStep: setMsg });
      setMsg("Encolando la detección…");
      const { error } = await supabase.rpc("request_detection", { p_project: id, p_key: crypto.randomUUID() });
      if (!error) { const { data: ss } = await supabase.auth.getSession(); fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${ss.session?.access_token ?? ""}` } }).catch(() => {}); }
      router.push(`/app/p/${id}`);
    } catch (x) { setMsg(x instanceof Error ? x.message : "No se pudo crear el ejemplo."); setBusy(null); }
  }
  return (
    <main className="mx-auto max-w-[1000px] px-4 pb-20 pt-8 md:px-10">
      <h1 className="text-3xl tracking-tight">Demos</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Prueba Ráfaga sin subir nada: se crea un proyecto en tu espacio con un vídeo de ejemplo y verás todo el recorrido, de la detección a los clips con subtítulos.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">{DEMOS.map((d) => (
        <li key={d.id} className="card p-5">
          <span className="mono text-xs text-[var(--muted)]">DEMO · {d.len}</span>
          <h2 className="mt-1 text-lg">{d.title}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{d.note}</p>
          <button onClick={() => use(d)} disabled={!!busy} className="btn btn-primary mt-4">{busy === d.id ? "Creando…" : "Usar este vídeo"}</button>
        </li>))}</ul>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-[var(--muted)]">{msg}</p>
      <section className="card mt-8 p-5"><h2 className="text-lg">Cómo funciona</h2>
        <ol className="mt-3 space-y-3 text-sm">{[["Trae tu vídeo", "Sube el archivo o usa una demo."], ["Di qué buscar", "Momentos graciosos, consejos, polémicas… tú decides."], ["Recibe clips ordenados", "Por encaje estimado, listos para revisar, editar y descargar."]].map(([t, x], i) => <li key={t} className="flex gap-3"><span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-ink)]">{i + 1}</span><span><b className="block font-medium">{t}</b><span className="text-[var(--muted)]">{x}</span></span></li>)}</ol>
        <Link href="/app" className="btn btn-ghost mt-4"><Icon n="upload" className="h-4 w-4" />Usar mi propio vídeo</Link></section>
    </main>
  );
}
