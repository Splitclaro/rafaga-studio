"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BriefFields, { EMPTY_BRIEF, briefText } from "../../components/BriefFields";
import { normalizeBrief, type BriefData } from "@rafaga/selection/brief";
import HomeOverview from "../../components/HomeOverview";
import Icon from "../../components/Icon";
import { ProjectCard, isActive, useProjects } from "../../components/ProjectList";
import { createProject, uploadSong, validateFile, probeDuration, MIN_SOURCE_SECONDS, WHOLE_VIDEO_MAX_SECONDS, STAGE, type ProjectMode } from "../../lib/projects";
import { supabase, BRIEF_MAX, MAX_VIDEO_BYTES } from "../../lib/supabase";

type Tab = "clips" | "lyrics";
const TOOLS: { mode: ProjectMode | "lyrics"; label: string; glyph: string; bg: string; fg: string; badge?: string }[] = [
  { mode: "clips", label: "Clips IA", glyph: "✂", bg: "#E3EAFF", fg: "#2A55F5", badge: "Nuevo" },
  { mode: "lyrics", label: "Lyric Studio", glyph: "♪", bg: "#DDF3E6", fg: "#0F7B4F" },
  { mode: "reframe", label: "Reencuadre", glyph: "▣", bg: "#FFE9D6", fg: "#C2570C" },
  { mode: "captions", label: "Subtítulos", glyph: "Aa", bg: "#F1E4FF", fg: "#7A3FD1" },
  { mode: "social", label: "Social edits", glyph: "◈", bg: "#FFE3EE", fg: "#C1274F" },
  { mode: "broll", label: "B-roll", glyph: "▤", bg: "#E0F4F7", fg: "#0B7285" },
];
const LOOKS = ["Momentos graciosos", "Consejos", "Polémicas", "Historias", "Citas"];
const STATE_CHIP: Record<string, string> = { done: "background:#E6F4EC;color:#0F7B4F", failed: "background:#FDECEA;color:#B42318" };
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
  const [bd, setBd] = useState<BriefData>(EMPTY_BRIEF);
  const brief = briefText(bd);
  const [count, setCount] = useState(5);
  const [maxLen, setMaxLen] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
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
      const id = await createProject({ file, name: "", brief, briefData: normalizeBrief(bd), count, mode, maxSeconds: maxLen ? Number(maxLen) : undefined, rangeStart: a ?? 0, rangeEnd: b ?? undefined, onStep: setMsg });
      // Un solo paso: tras subir se encola la detección y se despierta al worker (sin segundo clic en el proyecto).
      setMsg("Encolando la detección…");
      const { error: de } = await supabase.rpc("request_detection", { p_project: id, p_key: crypto.randomUUID() });
      if (!de) { const { data: ss } = await supabase.auth.getSession(); fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${ss.session?.access_token ?? ""}` } }).catch(() => {}); }
      router.push(`/app/p/${id}`);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }
  async function pickAudio(f: File | undefined) {
    if (!f || busy) return;
    setBusy(true); setMsg(null);
    try { const id = await uploadSong(f, "", "", setMsg); router.push(`/app/lyric-studio?song=${id}`); }
    catch (x) { setMsg(x instanceof Error ? x.message : "Error al subir."); setBusy(false); }
  }

  const recent = (rows ?? []).filter((p) => !p.archived_at).slice(0, 5);
  const has = (t: string) => bd.objective.toLowerCase().includes(t.toLowerCase());
  const toggleLook = (t: string) => setBd((x) => { const low = x.objective.toLowerCase(); if (low.includes(t.toLowerCase())) { const re = new RegExp("\\s*Busca " + t.toLowerCase() + "\\.?", "i"); return { ...x, objective: x.objective.replace(re, "").trim() }; } return { ...x, objective: (x.objective ? x.objective.replace(/\s+$/, "") + " " : "") + "Busca " + t.toLowerCase() + "." }; });
  const pickTool = (m: ProjectMode | "lyrics") => { if (m === "lyrics") return router.push("/app/lyric-studio"); setMode(m); setFile(null); setDur(null); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const toolLabel = TOOLS.find((t) => t.mode === mode)?.label ?? "Clips IA";
  const pill = "inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-white px-[18px] text-sm font-medium hover:bg-[var(--hover)]";

  return (
    <main className="px-4 pb-14 pt-1 md:px-8">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8">
        {/* Hero */}
        <section aria-label="Crear clips" className="flex flex-col items-center gap-5 rounded-[18px] bg-[linear-gradient(115deg,#E4EBFF_0%,#EFF1FF_45%,#E7F5FF_100%)] px-5 py-8 md:px-8">
          <h1 className="text-center text-[28px] font-bold leading-[1.15] md:text-[34px]">Convierte tu vídeo largo en <span className="bg-[linear-gradient(90deg,#2A55F5,#4F8BFF)] bg-clip-text text-transparent">clips listos para publicar</span></h1>
          <form onSubmit={submit} className="flex w-full max-w-[640px] flex-col items-center gap-3">
            <input ref={fileInput} id="file" type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.mkv" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
              className={`flex w-full items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-[0_1px_0_rgba(27,29,42,.04)] ${drag ? "ring-2 ring-[var(--accent)]" : ""}`}>
              <Icon n="upload" className="h-[18px] w-[18px] shrink-0 text-[var(--accent)]" />
              <label htmlFor="file" className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center truncate text-base">
                {file ? <span className="truncate font-medium">{file.name} <span className="mono text-xs font-normal text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB{dur ? ` · ${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}` : ""}</span></span> : <span className="truncate text-[var(--muted)]">Arrastra tu vídeo aquí o elige un archivo</span>}
              </label>
              <button type={file ? "submit" : "button"} onClick={() => { if (!file) fileInput.current?.click(); }} disabled={busy} className="inline-flex min-h-12 items-center whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#3B66FF,#1F3FCB)] px-6 text-[15px] font-bold tracking-wide text-white disabled:opacity-60 md:px-[30px]">{busy ? "SUBIENDO…" : file ? (mode === "clips" ? "OBTENER CLIPS" : `CREAR CON ${toolLabel.toUpperCase()}`) : "ELEGIR VÍDEO"}</button>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => fileInput.current?.click()} className={pill}><Icon n="upload" className="h-4 w-4 text-[var(--accent)]" />Subir archivo</button>
              <Link href="/app/lyric-studio" className={pill}><Icon n="music" className="h-4 w-4 text-[#0F7B4F]" />Crear vídeo con letra</Link>
              <Link href="/app/nuevo" className={pill}><Icon n="layers" className="h-4 w-4 text-[var(--accent)]" />Paso a paso</Link>
            </div>
            {mode !== "clips" && <p className="chip">Herramienta: <b>{toolLabel}</b><button type="button" aria-label="Quitar herramienta" onClick={() => { setMode("clips"); setFile(null); }} className="ml-1 text-[var(--muted)]">✕</button></p>}
            <p role="status" aria-live="polite" className="min-h-5 text-center text-sm text-[var(--muted)]">{msg ?? (file ? (mode === "clips" && !brief ? "Sin encargo: Ráfaga elige los mejores momentos por sí sola." : "") : "")}</p>
          </form>
          <div className="flex w-full max-w-[560px] items-center gap-3.5 rounded-xl border border-[#EEEEF4] bg-white px-3.5 py-2"><span aria-hidden className="text-[var(--accent)]">✦</span><span className="flex-1 text-sm text-[var(--muted)]">Cuéntalo con tus palabras. El Director IA lo prepara.</span><Link href="/app/director" className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold text-[var(--accent-ink)]">Probar Director IA →</Link></div>
        </section>

        {/* Qué buscar + conexiones */}
        <section aria-label="Qué buscar y conexiones" className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="card flex flex-col gap-3 p-5">
            <div><b className="font-display text-base">Di qué buscar</b><br /><span className="text-sm text-[var(--muted)]">Opcional. Sin encargo, Ráfaga elige los mejores momentos por sí sola.</span></div>
            <div className="flex flex-wrap gap-2">{LOOKS.map((t) => <button key={t} type="button" onClick={() => toggleLook(t)} aria-pressed={has(t)} className="chip">{t}</button>)}</div>
            <label className="flex flex-wrap items-center gap-2.5 text-sm text-[var(--muted)]">Número de clips
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="input !w-auto">{[3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select>
              <span className="mx-1">Duración</span>
              <select value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className="input !w-auto">{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <details className="text-sm"><summary className="cursor-pointer text-[var(--muted)]">Más detalles del encargo y tramo</summary>
              <div className="mt-3"><BriefFields value={bd} onChange={setBd} compact /></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Tramo desde<input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" className="input mono mt-1" inputMode="numeric" /></label><label>Tramo hasta<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fin del vídeo" className="input mono mt-1" inputMode="numeric" /></label></div></details>
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-[#D5D6E2] bg-white px-4 py-3.5"><span aria-hidden className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#E3EAFF] text-[#2A55F5]">☁</span><span className="flex-1"><b className="text-sm">Importar desde Drive o Dropbox</b><br /><span className="text-[13px] text-[var(--muted)]">Elige un vídeo guardado en tu nube.</span></span><span className="rounded-md bg-[#F0F1F7] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">Próximamente</span></div>
            <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-[#D5D6E2] bg-white px-4 py-3.5"><span aria-hidden className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#F1E4FF] text-[#7A3FD1]">◉</span><span className="flex-1"><b className="text-sm">Conectar Twitch</b><br /><span className="text-[13px] text-[var(--muted)]">Elige una de tus emisiones.</span></span><span className="rounded-md bg-[#F0F1F7] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">Próximamente</span></div>
          </div>
        </section>

        {/* Demos */}
        <section aria-labelledby="dm" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="dm" className="text-[19px]">Demos</h2><span className="text-[13px] text-[var(--muted)]">Mira qué hace Ráfaga con un vídeo de ejemplo. Sin subir nada.</span></div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">{[["1:40", "Podcast", "linear-gradient(135deg,#C9D6FF,#7F95E0)"], ["0:36", "Entrevista", "linear-gradient(135deg,#FFE9C7,#E8A94A)"], ["0:36", "Tutorial", "linear-gradient(135deg,#CDEFD9,#5DB383)"], ["0:37", "Directo", "linear-gradient(135deg,#FFD6E4,#E58AB0)"]].map(([d, t, g]) => <Link key={t} href="/app/demos" className="card block overflow-hidden"><span className="block aspect-[16/10]" style={{ background: g }} /><span className="block px-3 py-2.5"><span className="mono text-xs text-[var(--muted)]">DEMO · {d}</span><br /><b className="text-sm">{t}</b></span></Link>)}</div>
        </section>

        {/* Herramientas */}
        <section aria-labelledby="hi" className="flex flex-col gap-3">
          <h2 id="hi" className="text-[19px]">Herramientas de IA</h2>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">{TOOLS.map((t) => (
            <button key={t.label} type="button" onClick={() => pickTool(t.mode)} aria-pressed={t.mode === mode} className={`relative flex min-h-[172px] flex-col items-center gap-3 rounded-2xl border bg-white px-3 pb-4 pt-[18px] text-center ${t.mode === mode ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[#EEEEF4]"}`}>
              {t.badge && <span className="absolute right-2.5 top-2.5 rounded-lg bg-[#F0F1F7] px-2 text-[11px] font-semibold text-[var(--muted)]">{t.badge}</span>}
              <i className="grid h-[76px] w-[76px] place-items-center rounded-[20px] text-[32px] not-italic" style={{ background: t.bg, color: t.fg }}>{t.glyph}</i><b className="text-[15px] font-semibold">{t.label}</b>
            </button>))}</div>
        </section>

        {/* Recientes */}
        <section aria-labelledby="rp" className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="rp" className="text-[19px]">Proyectos recientes</h2><Link href="/app/proyectos" className="text-sm font-semibold text-[var(--accent-ink)]">Ver todos</Link></div>
          {err && <p role="alert" className="text-sm text-[var(--danger)]">No se pudieron cargar los proyectos: {err}</p>}
          {!rows && !err && <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
          {rows && !recent.length && <div className="rounded-[14px] border border-dashed border-[#D5D6E2] p-8 text-center text-[var(--muted)]">Todavía no hay proyectos. Sube un vídeo arriba para empezar.</div>}
          {!!recent.length && <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{recent.map((p) => (
            <li key={p.id}><Link href={`/app/p/${p.id}`} className="flex flex-col overflow-hidden rounded-[14px] bg-[#F0F0F5]">
              <span className="thumb relative block aspect-[16/10]">{p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                <span className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ ...(isActive(p.status) ? { background: "#EAEFFF", color: "#1B3FD0" } : p.clips > 0 ? { background: "#E6F4EC", color: "#0F7B4F" } : p.status === "failed" ? { background: "#FDECEA", color: "#B42318" } : { background: "#fff", color: "#6A6F85" }) }}>{isActive(p.status) ? "Procesando" : p.status === "failed" ? "Con error" : p.clips > 0 ? `${p.clips} clip${p.clips === 1 ? "" : "s"}` : "Borrador"}</span></span>
              <span className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5"><span className="text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span><b className="truncate text-sm font-semibold">{p.name}</b></span></Link></li>))}</ul>}
        </section>
      </div>
    </main>
  );
}
