"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PendingStrip from "../../components/PendingStrip";
import Icon from "../../components/Icon";
import { ProjectCard, isActive, useProjects } from "../../components/ProjectList";
import { createProject, uploadSong, validateFile, probeDuration, MIN_SOURCE_SECONDS, WHOLE_VIDEO_MAX_SECONDS, STAGE, type ProjectMode } from "../../lib/projects";
import { supabase, BRIEF_MAX, MAX_UPLOAD_BYTES } from "../../lib/supabase";

type Tab = "clips" | "lyrics";
type Batch = { id: string; status: string; created_at: string; params: { n: number; song_id: string } };

/** Recetas: cada una crea un proyecto en un modo real que el worker procesa. */
const RECIPES: { mode: ProjectMode; label: string; icon: string; what: string; whole: boolean }[] = [
  { mode: "clips", label: "Clips", icon: "scissors", what: "Busca los mejores momentos y crea varios clips.", whole: false },
  { mode: "captions", label: "Captions", icon: "text", what: "Transcribe tu vídeo y lo subtitula entero. Luego edita texto, tiempos y estilo.", whole: true },
  { mode: "reframe", label: "Reframe", icon: "frame", what: "Convierte el vídeo a vertical, cuadrado o apaisado con desenfoque, recorte o barras.", whole: true },
  { mode: "social", label: "Social edits", icon: "share", what: "Vídeo entero listo para cada red: formato, subtítulos y zona segura.", whole: true },
  { mode: "broll", label: "B-roll", icon: "layers", what: "Subtitula tu vídeo y superpón imágenes o vídeos de tus colecciones en los momentos que elijas.", whole: true },
];
const DURATIONS = [["", "Automática"], ["30", "Hasta 30 s"], ["45", "Hasta 45 s"], ["60", "Hasta 60 s"], ["85", "Hasta 85 s"]] as const;
const parseTime = (s: string) => { if (!s.trim()) return null; const p = s.trim().split(":").map(Number); if (p.some((x) => !Number.isFinite(x) || x < 0)) return NaN; return p.reduce((t, x) => t * 60 + x, 0); };

export default function Dashboard() {
  const router = useRouter();
  const { rows, err } = useProjects();
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("clips");
  const [mode, setMode] = useState<ProjectMode>("clips");
  const [file, setFile] = useState<File | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [maxLen, setMaxLen] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [adv, setAdv] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [batches, setBatches] = useState<(Batch & { title: string })[]>([]);

  useEffect(() => {
    (async () => {
      const [so, b] = await Promise.all([
        supabase.from("songs").select("id,title"),
        supabase.from("jobs").select("id,status,created_at,params").eq("kind", "lyrics").order("created_at", { ascending: false }).limit(4),
      ]);
      const titles = new Map((so.data ?? []).map((x) => [x.id, x.title]));
      setBatches(((b.data ?? []) as Batch[]).map((x) => ({ ...x, title: titles.get(x.params.song_id) ?? "Canción" })));
    })();
  }, []);

  const recipe = RECIPES.find((r) => r.mode === mode)!;
  async function pick(f: File | null) {
    if (!f) return;
    const e = validateFile(f);
    if (e) { setMsg(e); setFile(null); return; }
    const d = await probeDuration(f); setDur(d);
    if (d !== null && d < MIN_SOURCE_SECONDS) { setMsg(`Este vídeo dura ${d.toFixed(1)} s. Hacen falta al menos ${MIN_SOURCE_SECONDS} s.`); setFile(null); return; }
    if (recipe.whole && d !== null && d > WHOLE_VIDEO_MAX_SECONDS) { setMsg(`Esta herramienta procesa el vídeo entero y admite hasta ${WHOLE_VIDEO_MAX_SECONDS / 60} min (el tuyo dura ${(d / 60).toFixed(1)}). Usa «Clips» para vídeos largos.`); setFile(null); return; }
    setMsg(null); setFile(f);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !file) return;
    const a = parseTime(from), b = parseTime(to);
    if (Number.isNaN(a) || Number.isNaN(b)) return setMsg("El tramo debe tener formato mm:ss o hh:mm:ss.");
    if (a != null && b != null && b <= a) return setMsg("El final del tramo debe ser posterior al inicio.");
    if (b != null && dur !== null && b > dur + 0.5) return setMsg("El tramo termina después del final del vídeo.");
    setBusy(true); setMsg(null);
    try {
      const id = await createProject({ file, name: "", brief, count, mode, maxSeconds: maxLen ? Number(maxLen) : undefined, rangeStart: a ?? 0, rangeEnd: b ?? undefined, onStep: setMsg });
      router.push(`/app/p/${id}`);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }
  async function pickAudio(f: File | undefined) {
    if (!f || busy) return;
    setBusy(true); setMsg(null);
    try { const id = await uploadSong(f, "", "", setMsg); router.push(`/app/lyric-studio?song=${id}`); }
    catch (x) { setMsg(x instanceof Error ? x.message : "Error al subir."); setBusy(false); }
  }

  const current = rows?.filter((p) => isActive(p.status)) ?? [];
  const recent = rows?.filter((p) => !isActive(p.status)).slice(0, 8) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mx-auto mb-8 max-w-3xl">
        <h1 className="text-4xl tracking-tight md:text-5xl">Tu próximo gran momento.</h1>
        <p className="mt-2 text-base text-[var(--muted)]">Continúa un proyecto o transforma una nueva fuente.</p>
      </header>
      {/* Creación */}
      <section aria-label="Crear" className="mx-auto max-w-3xl">
        <div className="flex items-end justify-between gap-3">
          <div role="tablist" aria-label="Tipo de generación" className="inline-flex rounded-t-2xl border border-b-0 hairline bg-[var(--surface)] p-1 pb-0">
            {([["clips", "Clips de vídeo largo", "scissors"], ["lyrics", "Vídeo con letra", "music"]] as const).map(([k, l, i]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }} className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm font-medium ${tab === k ? "bg-white text-[var(--text)] shadow-[0_-1px_0_#fff,0_0_0_1px_var(--border)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}><Icon n={i} className="h-4 w-4" />{l}</button>
            ))}
          </div>
          <Link href="/app/biblioteca" className="mb-1 flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"><Icon n="grid" className="h-4 w-4" />Todos los proyectos</Link>
        </div>

        <div className="card-raised rounded-tl-none p-5 md:p-6">
          {tab === "clips" ? (
            <form onSubmit={submit}>
              <input ref={fileInput} id="file" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              <label htmlFor="file" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
                className={`flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed bg-white px-5 py-5 transition-colors focus-within:shadow-[var(--ring)] ${drag ? "border-[#111] bg-[var(--hover)]" : "hairline hover:border-[#bdbdbd]"}`}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#111] text-white"><Icon n="upload" /></span>
                {file ? <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.name}</span><span className="mono text-xs text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB{dur ? ` · ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}` : ""}</span></span>
                  : <span className="min-w-0 flex-1"><span className="block font-medium">Suelta tu vídeo aquí o elige un archivo</span><span className="text-sm text-[var(--muted)]">MP4, MOV o WebM, hasta {MAX_UPLOAD_BYTES / 1048576} MB</span></span>}
                <span className="btn btn-ghost hidden sm:inline-flex">{file ? "Cambiar" : "Subir"}</span>
              </label>

              {mode === "clips" ? (
                <label className="mt-4 block">
                  <span className="text-sm font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
                  <textarea rows={2} maxLength={BRIEF_MAX} value={brief} onChange={(e) => setBrief(e.target.value)} className="input mt-1.5 resize-y" placeholder="Es un podcast sobre emprender. Quiero consejos para principiantes y errores al vender. Evita la parte del patrocinador." />
                </label>
              ) : (
                <div className="mt-4 flex items-start gap-3 rounded-xl border hairline bg-white p-3 text-sm"><Icon n={recipe.icon} className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="font-medium">{recipe.label}.</span> {recipe.what}</span></div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setAdv(!adv)} aria-expanded={adv} className="chip"><Icon n={adv ? "chevD" : "chevR"} className="h-3 w-3" />Ajustes</button>
                <span className="mono text-xs text-[var(--muted)]">{mode === "clips" ? `${count} clips` : recipe.label}{maxLen ? ` · hasta ${maxLen} s` : ""}{from || to ? ` · ${from || "0:00"}–${to || "fin"}` : ""}</span>
                <button disabled={busy || !file} className="btn btn-primary ml-auto px-6 py-2.5">{busy ? "Subiendo…" : mode === "clips" ? "Obtener clips" : `Crear con ${recipe.label}`}</button>
              </div>
              {adv && (
                <div className="mt-3 grid gap-3 rounded-2xl border hairline bg-white p-4 text-sm sm:grid-cols-2">
                  {mode === "clips" && <label>Número de clips · <span className="mono">{count}</span><input type="range" min={3} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-2 w-full" /></label>}
                  {mode === "clips" && <label>Duración de cada clip<select value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className="input mt-1">{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
                  <label>Tramo desde<input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" className="input mono mt-1" inputMode="numeric" /></label>
                  <label>Tramo hasta<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fin del vídeo" className="input mono mt-1" inputMode="numeric" /></label>
                </div>
              )}
              <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--muted)]">{msg ?? (file ? (mode === "clips" && !brief ? "Sin descripción: los momentos se detectan automáticamente." : "") : "Elige un vídeo para empezar.")}</p>
            </form>
          ) : (
            <div>
              <input ref={audioInput} type="file" accept="audio/*,.mp3,.wav" className="sr-only" id="audio" onChange={(e) => { pickAudio(e.target.files?.[0]); e.target.value = ""; }} />
              <label htmlFor="audio" className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed hairline bg-white px-5 py-5 hover:border-[#bdbdbd]">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#111] text-white"><Icon n="music" /></span>
                <span className="min-w-0 flex-1"><span className="block font-medium">Sube tu canción (MP3 o WAV)</span><span className="text-sm text-[var(--muted)]">Después eliges el tramo, la letra, el estilo y cuántos vídeos quieres.</span></span>
                <span className="btn btn-ghost hidden sm:inline-flex">{busy ? "Subiendo…" : "Subir canción"}</span>
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm"><span className="text-[var(--muted)]">O sigue con una canción ya subida:</span><Link href="/app/lyric-studio" className="chip">Abrir Lyric Studio</Link></div>
              <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--muted)]">{msg}</p>
            </div>
          )}
        </div>

        {tab === "clips" && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Herramientas">
            {RECIPES.map((r) => (
              <button key={r.mode} aria-pressed={mode === r.mode} onClick={() => { setMode(r.mode); setFile(null); setMsg(null); setDur(null); }} className="chip"><Icon n={r.icon} className="h-3.5 w-3.5" />{r.label}</button>
            ))}
          </div>
        )}
      </section>

      {/* En curso */}
      <PendingStrip />

      {current.length > 0 && (
        <section aria-labelledby="curso" className="mt-12">
          <h2 id="curso" className="mb-3 flex items-center gap-2 text-lg"><span className="pulse" aria-hidden />En curso</h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{current.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}</ul>
        </section>
      )}

      {/* Recientes */}
      <section aria-labelledby="recientes" className="mt-12">
        <div className="mb-3 flex items-center gap-4">
          <h2 id="recientes" className="text-lg tracking-tight">Continúa donde lo dejaste</h2>
          <Link href="/app/biblioteca" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]">Ver todos</Link>
        </div>
        {err && <p role="alert">No se pudieron cargar los proyectos: {err}</p>}
        {!rows && !err && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
        {rows && !recent.length && !current.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">Todavía no hay proyectos. Sube tu primer vídeo arriba.</p>}
        {!!recent.length && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{recent.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}</ul>}
      </section>

      {!!batches.length && (
        <section aria-labelledby="letras" className="mt-12">
          <div className="mb-3 flex items-center gap-4"><h2 id="letras" className="text-lg">Vídeos con letra</h2><Link href="/app/lyric-studio" className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]">Abrir Lyric Studio</Link></div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {batches.map((b) => (
              <li key={b.id}><Link href="/app/lyric-studio" className="card lift block overflow-hidden">
                <div className="dots-dark relative grid aspect-video place-items-center bg-[#111] text-white"><Icon n="music" className="h-8 w-8 text-white/70" /><span className="chip absolute left-2 top-2 !py-0.5">{isActive(b.status) && <span className="pulse" aria-hidden />}{STAGE[b.status] ?? b.status}</span></div>
                <div className="p-3"><div className="truncate text-sm font-medium">{b.title}</div><div className="mono text-xs text-[var(--muted)]">{b.params.n} vídeo{b.params.n === 1 ? "" : "s"} · {new Date(b.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</div></div>
              </Link></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
