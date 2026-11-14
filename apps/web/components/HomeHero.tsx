"use client";
// Hero del Inicio con la estructura de OpusClip: pestañas (clips de vídeo largo · edición automática · abrir editor), entrada de enlace con
// «Obtener clips en 1 clic», y accesos a subir, Drive y un proyecto de muestra. Todo desemboca en la pantalla de creación (receta + ajustes + resumen).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

type Tab = "clips" | "auto" | "editor";
const TABS: [Tab, string][] = [["clips", "Clips de vídeo largo"], ["auto", "Edición automática"], ["editor", "Abrir editor"]];

export default function HomeHero() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("clips"), [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const nuevo = tab === "auto" ? "/app/nuevo?receta=cleanup" : "/app/nuevo";
  async function go(e: React.FormEvent) {
    e.preventDefault(); if (!url.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const t = (await supabase.auth.getSession()).data.session?.access_token ?? "";
      const r = await fetch("/api/import/link", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", "Idempotency-Key": `imp-${crypto.randomUUID()}` }, body: JSON.stringify({ url: url.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error?.message ?? "No se pudo importar el enlace."); return; }
      router.push(j.project_id ? `/app/p/${j.project_id}` : "/app/proyectos");
    } finally { setBusy(false); }
  }
  const pill = "chip hover:bg-[var(--hover)]";
  return (
    <div className="w-full max-w-[760px] rounded-[22px] border hairline bg-[var(--card)] p-2">
      <div role="tablist" aria-label="Qué quieres hacer" className="flex flex-wrap gap-1 px-1 pt-1">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-sm ${tab === k ? "bg-[var(--surface)] font-semibold" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>{l}</button>)}
      </div>
      {tab === "editor" ? (
        <div className="p-5 text-sm"><p className="text-[var(--muted)]">Elige un proyecto y abre cualquiera de sus clips en el editor: recorte, subtítulos, encuadre y plantilla.</p>
          <Link href="/app/proyectos" className="btn btn-primary mt-3">Ir a mis proyectos</Link></div>
      ) : (<>
        <form onSubmit={go} className="mx-2 mt-2 flex items-center gap-2 rounded-full border hairline py-1.5 pl-4 pr-1.5">
          <span aria-hidden className="text-[var(--muted)]">⛓</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Pega un enlace de vídeo (https://…)" aria-label="Enlace del vídeo" className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none" />
          <button type="submit" disabled={!url.trim() || busy} className="btn btn-primary !min-h-11 !rounded-full !px-5">{busy ? "Comprobando…" : "Obtener clips en 1 clic"}</button>
        </form>
        <p role="status" aria-live="polite" className="min-h-5 px-5 pt-1 text-sm text-[var(--muted)]">{msg}</p>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Link href={nuevo} className={pill}>⇪ Subir</Link>
          <Link href="/app/conexiones" className={pill}>△ Google Drive</Link>
          <Link href="/app/demos" className={pill}>Probar un proyecto de muestra</Link>
          <Link href="/app/lyric-studio" className={pill}>♪ Crear vídeo con letra</Link>
        </div>
      </>)}
    </div>
  );
}
