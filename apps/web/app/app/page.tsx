"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "../../components/Icon";
import { Chip, useProjects } from "../../components/ProjectList";
import { createProject, validateFile, probeDuration, MIN_SOURCE_SECONDS, STAGE } from "../../lib/projects";
import { supabase, BRIEF_MAX, MAX_UPLOAD_BYTES } from "../../lib/supabase";

type LyricBatch = { id: string; status: string; created_at: string; params: { n: number; song_id: string } };

export default function Dashboard() {
  const router = useRouter();
  const { rows, err } = useProjects();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [stats, setStats] = useState<{ clips: number; lyrics: number; songs: number } | null>(null);
  const [batches, setBatches] = useState<(LyricBatch & { title: string })[]>([]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      setName((s.session?.user.email ?? "").split("@")[0]);
      const [c, l, so, b] = await Promise.all([
        supabase.from("clips").select("id", { count: "exact", head: true }),
        supabase.from("lyric_videos").select("id", { count: "exact", head: true }).eq("status", "ready"),
        supabase.from("songs").select("id,title"),
        supabase.from("jobs").select("id,status,created_at,params").eq("kind", "lyrics").order("created_at", { ascending: false }).limit(4),
      ]);
      setStats({ clips: c.count ?? 0, lyrics: l.count ?? 0, songs: so.data?.length ?? 0 });
      const titles = new Map((so.data ?? []).map((x) => [x.id, x.title]));
      setBatches(((b.data ?? []) as LyricBatch[]).map((x) => ({ ...x, title: titles.get(x.params.song_id) ?? "Canción" })));
    })();
  }, []);

  async function pick(f: File | null) {
    if (!f) return;
    const e = validateFile(f);
    if (e) { setMsg(e); setFile(null); return; }
    const d = await probeDuration(f);
    if (d !== null && d < MIN_SOURCE_SECONDS) { setMsg(`Este vídeo dura ${d.toFixed(1)} s. Para buscar momentos hace falta al menos ${MIN_SOURCE_SECONDS} s.`); setFile(null); return; }
    setMsg(null); setFile(f);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !file) return;
    setBusy(true); setMsg(null);
    try { router.push(`/app/p/${await createProject({ file, name: "", brief, count, onStep: setMsg })}`); }
    catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 md:px-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[2.6rem] leading-[1.05] md:text-[3.4rem]">{name ? `hola, ${name}` : "hola"}<br /><span className="text-[var(--muted)]">¿qué creamos hoy?</span></h1>
        {stats && (
          <dl className="flex gap-6 text-sm" aria-label="Tu actividad">
            {[["clips", stats.clips], ["vídeos con letra", stats.lyrics], ["canciones", stats.songs]].map(([k, v]) => (
              <div key={k as string} className="flex flex-col-reverse"><dt className="text-[var(--muted)]">{k}</dt><dd className="font-display text-3xl tnum">{v}</dd></div>
            ))}
          </dl>
        )}
      </header>

      {/* Panel de creación: el único gesto decorativo (perforaciones de película) */}
      <section aria-label="Crear" className="film-edge grid gap-4 rounded-[28px] bg-[#111] px-4 py-8 text-white md:grid-cols-[1.6fr_1fr] md:px-6 md:py-9">
        <form onSubmit={submit} className="rounded-[20px] bg-white p-5 text-[var(--text)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl">clips desde un vídeo</h2>
            <span className="text-xs text-[var(--muted)]">MP4, MOV o WebM, hasta {MAX_UPLOAD_BYTES / 1048576} MB</span>
          </div>
          <input ref={input} id="file" type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <label htmlFor="file" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
            className={`mt-4 flex min-h-28 cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-[#111] ${drag ? "border-[#111] bg-[var(--hover)]" : "border-[var(--border)] hover:border-[#999]"}`}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#111] text-white"><Icon n="upload" /></span>
            {file ? <span className="min-w-0"><span className="block truncate font-medium">{file.name}</span><span className="tnum text-sm text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB. Pulsa para cambiarlo.</span></span>
              : <span><span className="block font-medium">Arrastra tu vídeo o pulsa para elegirlo</span><span className="text-sm text-[var(--muted)]">Podcasts, entrevistas, directos grabados.</span></span>}
          </label>
          <label className="mt-4 block">
            <span className="font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
            <textarea rows={3} maxLength={BRIEF_MAX} value={brief} onChange={(e) => setBrief(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2" placeholder="Es un podcast sobre emprender. Quiero consejos para principiantes y errores al vender. Evita la parte del patrocinador." />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">Clips <input type="number" min={3} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(3, Number(e.target.value) || 5)))} className="tnum w-16 rounded-lg border border-[var(--border)] px-2 py-1" /></label>
            <button disabled={busy || !file} className="ml-auto rounded-full bg-[#111] px-6 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Subiendo…" : "Crear proyecto"}</button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--muted)]">{msg ?? (!file ? "Elige un vídeo para empezar." : brief ? "" : "Sin descripción: los momentos se detectan automáticamente.")}</p>
        </form>

        <div className="grid gap-4">
          <Link href="/app/lyric-studio" className="flex min-h-44 flex-col justify-between rounded-[20px] bg-white p-5 text-[var(--text)] hover:bg-[#f2f2f2]">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--border)]"><Icon n="music" /></span>
            <span><span className="font-display block text-2xl">vídeos con letra</span><span className="text-sm text-[var(--muted)]">Sube una canción y genera varias versiones a la vez.</span></span>
          </Link>
          <div className="grid grid-cols-2 gap-4">
            {[["/app/proyectos", "film", "tus proyectos"], ["/app/brand-kits", "brand", "marca y fuentes"]].map(([h, i, t]) => (
              <Link key={h} href={h} className="flex flex-col gap-6 rounded-[20px] border border-white/20 p-4 text-white hover:bg-white/10">
                <Icon n={i} /><span className="font-display text-lg leading-tight">{t}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="recientes">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recientes" className="text-2xl">proyectos recientes</h2>
            <Link href="/app/proyectos" className="text-sm underline underline-offset-4">Ver todos</Link>
          </div>
          {err && <p role="alert">No se pudieron cargar los proyectos: {err}</p>}
          {!rows && !err && <p className="text-[var(--muted)]">Cargando…</p>}
          {rows?.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-[var(--muted)]">Todavía no hay proyectos. Sube tu primer vídeo en el panel de arriba.</p>}
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {rows?.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link href={`/app/p/${p.id}`} className="grid grid-cols-[56px_1fr_auto] items-center gap-4 py-3 hover:bg-[var(--surface)]">
                  <span aria-hidden className="grid h-14 w-14 place-items-center rounded-xl bg-[#111] text-white"><Icon n="film" /></span>
                  <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-sm text-[var(--muted)]">{p.project_brief ?? "Detección automática"}</span></span>
                  <span className="text-right text-sm"><Chip status={p.status} /><span className="tnum mt-1 block text-[var(--muted)]">{p.clips} clip{p.clips === 1 ? "" : "s"}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="letras">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="letras" className="text-2xl">últimos vídeos con letra</h2>
            <Link href="/app/lyric-studio" className="text-sm underline underline-offset-4">Abrir</Link>
          </div>
          {!batches.length && <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-[var(--muted)]">Aquí aparecerán tus lotes de vídeos con letra.</p>}
          <ul className="space-y-2">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href="/app/lyric-studio" className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] px-4 py-3 hover:bg-[var(--hover)]">
                  <span className="min-w-0"><span className="block truncate font-medium">{b.title}</span><span className="tnum text-sm text-[var(--muted)]">{b.params.n} vídeo{b.params.n === 1 ? "" : "s"}, {new Date(b.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</span></span>
                  <span className="shrink-0 text-sm">{STAGE[b.status] ?? b.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
