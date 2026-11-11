"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BriefFields, { EMPTY_BRIEF, briefText } from "../../components/BriefFields";
import { normalizeBrief, type BriefData } from "@rafaga/selection/brief";
import HomeOverview from "../../components/HomeOverview";
import YouTubeLink from "../../components/YouTubeLink";
import type { YtItem } from "@rafaga/providers/youtube";
import Icon from "../../components/Icon";
import { ProjectCard, isActive, useProjects } from "../../components/ProjectList";
import { createProject, uploadSong, validateFile, probeDuration, MIN_SOURCE_SECONDS, WHOLE_VIDEO_MAX_SECONDS, STAGE, type ProjectMode } from "../../lib/projects";
import { supabase, BRIEF_MAX, MAX_VIDEO_BYTES } from "../../lib/supabase";

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
  const [origin, setOrigin] = useState<"file" | "youtube">("file");
  const [yt, setYt] = useState<YtItem | null>(null);
  const [ytProject, setYtProject] = useState<string | null>(null);   // proyecto con original autorizado ya vinculado a este vídeo
  const [mode, setMode] = useState<ProjectMode>("clips");
  const [file, setFile] = useState<File | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [bd, setBd] = useState<BriefData>(EMPTY_BRIEF);
  const brief = briefText(bd);
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

  // Encargo enviado desde el Director IA
  useEffect(() => { try { const b = new URLSearchParams(window.location.search).get("brief"); if (b) setBd((x) => ({ ...x, objective: b.slice(0, 1000) })); } catch {} }, []);
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
      const id = await createProject({ file, name: yt?.title ?? "", brief, briefData: normalizeBrief(bd), count, mode, maxSeconds: maxLen ? Number(maxLen) : undefined, rangeStart: a ?? 0, rangeEnd: b ?? undefined, youtubeId: yt?.id, onStep: setMsg });
      if (yt) await supabase.from("youtube_picks").update({ project_id: id, source_kind: "original", updated_at: new Date().toISOString() }).eq("video_id", yt.id);
      router.push(`/app/p/${id}`);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }
  /** Selección en el buscador: se conserva (con el brief) aunque aún no haya fuente, y se averigua qué se puede hacer con ella. */
  async function onYtPick(it: YtItem) {
    setYt(it); setMsg(null); setYtProject(null);
    const { data: s } = await supabase.auth.getSession(); const uid = s.session?.user.id;
    const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
    if (uid && ws) await supabase.from("youtube_picks").upsert({ workspace_id: ws.id, video_id: it.id, title: it.title, channel: it.channel, thumb: it.thumb, status: it.status, duration_sec: it.durationSec ?? null, scheduled_at: it.scheduledAt ?? null, brief: brief || null, clip_count: Math.min(20, count), created_by: uid, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,video_id,created_by" });
    const { data: pj } = await supabase.from("projects").select("id").eq("youtube_id", it.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(1);
    if (pj?.[0]) setYtProject(pj[0].id);
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
    <main className="px-4 pb-20 pt-8 md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[34px] leading-[1.1] tracking-tight [text-wrap:balance]">Tu próximo gran momento.</h1>
            <p className="mt-2 text-base text-[var(--muted)]">Elige una fuente, cuéntanos qué buscas y Ráfaga corta por ti.</p>
          </div>
          <Link href="/app/biblioteca" className="flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"><Icon n="grid" className="h-4 w-4" />Todos los proyectos</Link>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          {/* Crear */}
          <section aria-label="Crear" className="card p-5 md:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Qué quieres crear" className="inline-flex rounded-xl border hairline bg-[var(--surface)] p-[3px]">
                {([["clips", "Clips de vídeo largo", "scissors"], ["lyrics", "Vídeo con letra", "music"]] as const).map(([k, l, i]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setMsg(null); }} className={`flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm ${tab === k ? "bg-white font-semibold text-[var(--text)] shadow-[0_0_0_1px_var(--border)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}><Icon n={i} className="h-4 w-4" />{l}</button>
                ))}
              </div>
              {tab === "clips" && (
                <label className="flex items-center gap-2 text-sm text-[var(--muted)]">Herramienta
                  <select value={mode} onChange={(e) => { setMode(e.target.value as ProjectMode); setFile(null); setMsg(null); setDur(null); }} className="input !w-auto !py-1.5 text-[var(--text)]">
                    {RECIPES.map((r) => <option key={r.mode} value={r.mode}>{r.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {tab === "clips" ? (
            <form onSubmit={submit}>
              <input ref={fileInput} id="file" type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.mkv" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              {mode === "clips" && <div role="group" aria-label="Origen del vídeo" className="mb-4 inline-flex rounded-full border hairline bg-[var(--surface)] p-[3px] text-sm">{([["file", "Subir archivo"], ["youtube", "Enlace de YouTube"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={origin === k} onClick={() => { setOrigin(k); setMsg(null); }} className={`rounded-full px-4 py-2 ${origin === k ? "bg-[var(--ink)] font-semibold text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>{l}</button>)}</div>}
              {mode === "clips" && origin === "youtube" && (!yt ? <YouTubeLink onPick={onYtPick} /> : (
                <div className="rounded-2xl border hairline bg-white p-3">
                  <div className="flex items-center gap-3">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={yt.thumb} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="line-clamp-2 text-sm font-medium">{yt.title}</div><div className="truncate text-xs text-[var(--muted)]">{yt.channel}{yt.durationSec ? ` · ${Math.floor(yt.durationSec / 60)} min` : ""}</div></div><button type="button" onClick={() => { setYt(null); setYtProject(null); setFile(null); }} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Cambiar</button></div>
                  {ytProject ? <div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-sm text-[var(--muted)]">Ya tienes un proyecto con este vídeo.</p><Link href={`/app/p/${ytProject}`} className="btn btn-primary">Abrir proyecto</Link></div>
                    : <p className="mt-3 text-sm text-[var(--muted)]">Vídeo reconocido. YouTube no permite que nuestro servidor descargue el vídeo, así que hace falta su archivo: elígelo abajo y pulsa «Obtener clips». Si el vídeo es tuyo, lo descargas en YouTube Studio → Contenido → ⋮ → Descargar. El título y tu encargo se conservan.</p>}
                </div>))}
              {(mode !== "clips" || origin === "file" || (yt && !ytProject)) && <label htmlFor="file" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
                className={`flex cursor-pointer items-center gap-4 rounded-2xl border-[1.5px] border-dashed px-5 py-7 transition-colors focus-within:shadow-[var(--ring)] ${drag ? "border-[var(--accent)] bg-[#EEF2FF]" : "border-[#9FB3FF] bg-[var(--surface)] hover:border-[var(--accent)]"}`}>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#1D4FFF_0%,#4F7BFF_60%,#22D3EE_130%)] text-white"><Icon n="upload" /></span>
                {file ? <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.name}</span><span className="mono text-xs text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB{dur ? ` · ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}` : ""}</span></span>
                  : <span className="min-w-0 flex-1"><span className="block font-medium">Suelta tu vídeo aquí o elige un archivo</span><span className="text-sm text-[var(--muted)]">MP4, MOV, M4V, MKV o WebM, hasta {MAX_VIDEO_BYTES / 1073741824} GB</span></span>}
                <span className="btn btn-ghost hidden sm:inline-flex">{file ? "Cambiar" : "Subir"}</span>
              </label>}

              {mode === "clips" ? (
                <div className="mt-4"><BriefFields value={bd} onChange={setBd} compact /></div>
              ) : (
                <div className="mt-4 flex items-start gap-3 rounded-xl border hairline bg-white p-3 text-sm"><Icon n={recipe.icon} className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="font-medium">{recipe.label}.</span> {recipe.what}</span></div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setAdv(!adv)} aria-expanded={adv} className="chip"><Icon n={adv ? "chevD" : "chevR"} className="h-3 w-3" />Ajustes</button>
                <span className="mono text-xs text-[var(--muted)]">{mode === "clips" ? `${count} clips` : recipe.label}{maxLen ? ` · hasta ${maxLen} s` : ""}{from || to ? ` · ${from || "0:00"}–${to || "fin"}` : ""}</span>
                <button disabled={busy || !file || (origin === "youtube" && !yt)} className="btn btn-primary ml-auto !px-7 !py-3 !text-[15px]">{busy ? "Subiendo…" : mode === "clips" ? "Obtener clips" : `Crear con ${recipe.label}`}</button>
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
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--hover)] text-[var(--accent)]"><Icon n="music" /></span>
                <span className="min-w-0 flex-1"><span className="block font-medium">Sube tu canción (MP3 o WAV)</span><span className="text-sm text-[var(--muted)]">Después eliges el tramo, la letra, el estilo y cuántos vídeos quieres.</span></span>
                <span className="btn btn-ghost hidden sm:inline-flex">{busy ? "Subiendo…" : "Subir canción"}</span>
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm"><span className="text-[var(--muted)]">O sigue con una canción ya subida:</span><Link href="/app/lyric-studio" className="chip">Abrir Lyric Studio</Link></div>
              <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--muted)]">{msg}</p>
            </div>
            )}
          </section>

          <aside aria-label="Resumen"><HomeOverview rows={rows} /></aside>
        </div>

        {/* Recientes */}
        <section aria-labelledby="recientes" className="mt-12">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="recientes" className="text-2xl tracking-tight">Continúa donde lo dejaste</h2>
            <Link href="/app/biblioteca" className="text-sm font-semibold text-[var(--accent)]">Abrir biblioteca</Link>
          </div>
          {err && <p role="alert">No se pudieron cargar los proyectos: {err}</p>}
          {!rows && !err && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
          {rows && !rows.length && <p className="card border-dashed p-8 text-center text-[var(--muted)]">Todavía no hay proyectos. Sube tu primer vídeo arriba.</p>}
          {!!rows?.length && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[...current, ...recent].slice(0, 8).map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}</ul>}
        </section>

        {!!batches.length && (
          <section aria-labelledby="letras" className="mt-12">
            <div className="mb-4 flex items-baseline justify-between gap-4"><h2 id="letras" className="text-2xl tracking-tight">Vídeos con letra</h2><Link href="/app/lyric-studio" className="text-sm font-semibold text-[var(--accent)]">Abrir Lyric Studio</Link></div>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {batches.map((b) => (
                <li key={b.id}><Link href="/app/lyric-studio" className="card lift block overflow-hidden">
                  <div className="relative grid aspect-video place-items-center bg-[linear-gradient(135deg,#141B34,#0B1020)] text-white/70"><Icon n="music" className="h-8 w-8" /><span className="chip absolute left-2 top-2 !py-0.5">{isActive(b.status) && <span className="pulse" aria-hidden />}{STAGE[b.status] ?? b.status}</span></div>
                  <div className="p-3"><div className="truncate text-sm font-medium">{b.title}</div><div className="tnum text-xs text-[var(--muted)]">{b.params.n} vídeo{b.params.n === 1 ? "" : "s"}, {new Date(b.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</div></div>
                </Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
