"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "../../components/Icon";
import ProjectGrid, { useProjects } from "../../components/ProjectList";
import { createProject, validateFile } from "../../lib/projects";
import { BRIEF_MAX, MAX_UPLOAD_BYTES } from "../../lib/supabase";

export default function Dashboard() {
  const router = useRouter();
  const { rows, err } = useProjects();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adv, setAdv] = useState(false);

  function pick(f: File | null) {
    if (!f) return;
    const e = validateFile(f);
    setMsg(e); setFile(e ? null : f);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !file) return;
    setBusy(true); setMsg(null);
    try { router.push(`/app/p/${await createProject({ file, name, brief, count, onStep: setMsg })}`); }
    catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Del vídeo largo al momento que importa</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">Sube un vídeo, cuéntanos qué clips necesitas y la IA propone los mejores momentos, con subtítulos listos para editar.</p>
      </header>

      <section aria-labelledby="nuevo" className="rounded-2xl bg-[var(--surface)] p-5 md:p-6">
        <h2 id="nuevo" className="mb-4 text-lg font-medium">Nuevo proyecto</h2>
        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-2">
          <div>
            <input ref={input} id="file" type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <label htmlFor="file" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
              className={`flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-[var(--select)] ${drag ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-white/15 hover:border-white/30"}`}>
              <Icon n="upload" className="h-9 w-9 text-[var(--accent)]" />
              {file ? (<>
                <span className="mt-3 max-w-full truncate font-medium">{file.name}</span>
                <span className="tnum mt-1 text-sm text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB · pulsa para cambiar</span>
              </>) : (<>
                <span className="mt-3 font-medium">Arrastra tu vídeo aquí o pulsa para elegirlo</span>
                <span className="mt-1 text-sm text-[var(--muted)]">MP4, MOV o WebM · hasta {MAX_UPLOAD_BYTES / 1048576} MB por ahora</span>
              </>)}
            </label>
          </div>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">Describe el tema, a quién te diriges y qué momentos quieres destacar. Opcional.</span>
              <textarea rows={5} maxLength={BRIEF_MAX} value={brief} onChange={(e) => setBrief(e.target.value)} className="mt-2 w-full rounded-lg bg-[var(--bg)] px-3 py-2 ring-1 ring-white/10" placeholder="Es un podcast sobre emprender. Quiero consejos prácticos para principiantes, tono directo y clips sobre errores al vender. Evita la parte de patrocinadores." />
              <span className="tnum text-xs text-[var(--muted)]">{brief.length}/{BRIEF_MAX}</span>
            </label>
            <button type="button" aria-expanded={adv} onClick={() => setAdv(!adv)} className="self-start text-sm text-[var(--muted)] underline">Ajustes avanzados</button>
            {adv && (
              <div className="grid gap-3 rounded-lg bg-[var(--bg)] p-3 text-sm">
                <label>Nombre del proyecto<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded bg-[var(--surface)] px-3 py-2" placeholder="Por defecto, el nombre del archivo" /></label>
                <label>Número de clips: <span className="tnum">{count}</span><input type="range" min={3} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full" /></label>
              </div>
            )}
            <button disabled={busy || !file} className="mt-auto rounded-xl bg-[var(--accent)] px-5 py-3 font-semibold text-[#101216] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Subiendo…" : "Crear proyecto"}</button>
            <p role="status" aria-live="polite" className={`min-h-5 text-sm ${msg && !busy ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{!file && !msg ? "Elige un vídeo para continuar." : msg}</p>
          </div>
        </form>
      </section>

      <section aria-labelledby="recientes" className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recientes" className="text-lg font-medium">Proyectos recientes</h2>
          <Link href="/app/proyectos" className="text-sm text-[var(--muted)] underline">Ver todos</Link>
        </div>
        {err && <p role="alert" className="text-[var(--danger)]">{err}</p>}
        {!rows && !err && <p className="text-[var(--muted)]">Cargando…</p>}
        {rows && <ProjectGrid rows={rows.slice(0, 6)} />}
      </section>

      <section aria-labelledby="como" className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="como" className="sr-only">Cómo funciona</h2>
        {[["1", "Sube", "Tu vídeo o podcast largo."], ["2", "Cuéntanos", "Qué clips necesitas y qué evitar."], ["3", "Detecta", "La IA propone momentos con gancho y cierre."], ["4", "Edita y exporta", "Corrige subtítulos y descarga el MP4."]].map(([n, t, d]) => (
          <div key={n} className="rounded-xl bg-[var(--surface)] p-4"><div className="tnum text-sm text-[var(--accent)]">{n}</div><div className="font-medium">{t}</div><div className="text-sm text-[var(--muted)]">{d}</div></div>
        ))}
      </section>
    </main>
  );
}
