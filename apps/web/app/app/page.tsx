"use client";
import { useEffect, useRef, useState } from "react";
import HomeHero from "../../components/HomeHero";
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
const TOOLS: { mode: ProjectMode | "lyrics"; label: string; icon: string; tone: string; hint: string; badge?: string }[] = [
  { mode: "clips", label: "Clips IA", icon: "scissors", tone: "blue", hint: "Corta lo mejor", badge: "Nuevo" },
  { mode: "lyrics", label: "Lyric Studio", icon: "music", tone: "violet", hint: "Vídeos con letra" },
  { mode: "reframe", label: "Reencuadre", icon: "frame", tone: "sky", hint: "Vertical o cuadrado" },
  { mode: "captions", label: "Subtítulos", icon: "text", tone: "mint", hint: "Texto automático" },
  { mode: "social", label: "Social edits", icon: "share", tone: "orange", hint: "Listo para redes" },
  { mode: "broll", label: "B-roll", icon: "layers", tone: "charcoal", hint: "Imágenes encima" },
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
      const id = await createProject({ file, name: "", brief, briefData: normalizeBrief(bd), count: dur ? Math.max(1, Math.min(count, Math.floor(dur / 18))) : count, mode, maxSeconds: maxLen ? Number(maxLen) : undefined, rangeStart: a ?? 0, rangeEnd: b ?? undefined, onStep: setMsg });
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
        <section aria-label="Crear clips" className="hero-soft relative flex flex-col items-center gap-5 overflow-hidden px-5 py-10 md:px-8">
          <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, #6C4DFF, transparent 70%)" }} />
          <span aria-hidden className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full opacity-50 blur-3xl" style={{ background: "radial-gradient(circle, #5DF9C0, transparent 70%)" }} />
          <h1 className="relative text-center text-[30px] font-extrabold leading-[1.1] md:text-[40px]">Convierte tu vídeo largo<br className="hidden md:block" /> en clips listos para publicar</h1>
          <ol aria-label="Cómo funciona" className="relative flex flex-wrap justify-center gap-2.5">
            {([["1", "Sube tu vídeo", "upload", "blue"], ["2", "Elige qué buscar", "wand", "violet"], ["3", "Descarga tus clips", "download", "mint"]] as const).map(([n, t, ic, tone]) => (
              <li key={n} className={`tag tag-${tone}`}><span className="tag-ico"><Icon n={ic} className="h-4 w-4" /></span><span className="tnum opacity-60">{n}</span>{t}</li>))}
          </ol>
          <HomeHero />
          <div className="flex w-full max-w-[560px] items-center gap-3.5 relative rounded-[18px] border border-white/80 bg-white/80 px-3.5 py-2 shadow-[var(--shadow-1)] backdrop-blur"><span aria-hidden className="ico-tile grad !h-8 !w-8 !rounded-[10px]"><Icon n="wand" className="h-4 w-4" /></span><span className="flex-1 text-sm text-[var(--muted)]">Cuéntalo con tus palabras. El Director IA lo prepara.</span><Link href="/app/director" className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold text-[var(--accent-ink)]">Probar Director IA →</Link></div>
        </section>

        {/* Qué buscar + conexiones */}
        <section aria-label="Qué buscar y conexiones">
          <div className="grid gap-2.5 md:grid-cols-2">
            <div className="flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-white px-4 py-3.5 shadow-[var(--shadow-1)]"><span aria-hidden className="tag tag-sky !h-10 !w-10 !justify-center !rounded-xl !p-0"><Icon n="folder" className="h-5 w-5" /></span><span className="flex-1"><b className="text-sm">Drive y Dropbox</b><br /><span className="text-[13px] text-[var(--muted)]">Puedes conectar tu cuenta; elegir vídeos de tu nube llegará próximamente.</span></span><Link href="/app/conexiones" className="rounded-md bg-[#F0F1F7] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink)]">Conectar</Link></div>
            <div className="flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-white px-4 py-3.5 shadow-[var(--shadow-1)]"><span aria-hidden className="tag tag-violet !h-10 !w-10 !justify-center !rounded-xl !p-0"><Icon n="live" className="h-5 w-5" /></span><span className="flex-1"><b className="text-sm">Conectar Twitch</b><br /><span className="text-[13px] text-[var(--muted)]">Elige una de tus emisiones.</span></span><span className="rounded-md bg-[#F0F1F7] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">Próximamente</span></div>
          </div>
        </section>

        {/* Demos */}
        <section aria-labelledby="dm" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="dm" className="text-[19px]">Demos</h2><span className="text-[13px] text-[var(--muted)]">Mira qué hace Ráfaga con un vídeo de ejemplo. Sin subir nada.</span></div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">{[["1:40", "Podcast", "emprender"], ["0:36", "Entrevista", "entrevista"], ["0:36", "Tutorial", "tutorial"], ["0:37", "Directo", "directo"]].map(([d, t, f]) => <Link key={t} href="/app/demos" className="card group block overflow-hidden"><span className="relative block aspect-[16/10] overflow-hidden bg-[var(--surface)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/demo/poster-${f}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /><span aria-hidden className="absolute inset-0 grid place-items-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-[var(--ink)] shadow">▶</span></span></span><span className="block px-3 py-2.5"><span className="mono text-xs text-[var(--muted)]">DEMO · {d}</span><br /><b className="text-sm">{t}</b></span></Link>)}</div>
        </section>

        {/* Herramientas */}
        <section aria-labelledby="hi" className="flex flex-col gap-3">
          <h2 id="hi" className="text-[19px]">Herramientas de IA</h2>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">{TOOLS.map((t) => (
            <button key={t.label} type="button" onClick={() => pickTool(t.mode)} aria-pressed={t.mode === mode} className={`lift relative flex min-h-[164px] flex-col items-center justify-center gap-3 rounded-[22px] border bg-white px-3 pb-4 pt-5 text-center shadow-[var(--shadow-1)] ${t.mode === mode ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/20" : "border-[var(--border)]"}`}>
              {t.badge && <span className="status status-ok absolute right-2.5 top-2.5 !px-2 !py-0.5 !text-[11px]">{t.badge}</span>}
              <span className={`tag tag-${t.tone} !h-16 !w-16 !justify-center !rounded-[20px] !p-0`}><Icon n={t.icon} className="h-7 w-7" /></span>
              <span className="flex flex-col"><b className="text-[15px] font-semibold">{t.label}</b><span className="text-xs text-[var(--muted)]">{t.hint}</span></span>
            </button>))}</div>
        </section>

        {/* Recientes */}
        <section aria-labelledby="rp" className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="rp" className="text-[19px]">Proyectos recientes</h2><Link href="/app/proyectos" className="text-sm font-semibold text-[var(--accent-ink)]">Ver todos</Link></div>
          {err && <p role="alert" className="text-sm text-[var(--danger)]">No se pudieron cargar los proyectos: {err}</p>}
          {!rows && !err && <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>}
          {rows && !recent.length && <div className="rounded-[14px] border border-dashed border-[var(--border-2)] p-8 text-center text-[var(--muted)]">Todavía no hay proyectos. Sube un vídeo arriba para empezar.</div>}
          {!!recent.length && <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">{recent.map((p) => (
            <li key={p.id}><Link href={`/app/p/${p.id}`} className="lift flex flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-white shadow-[var(--shadow-1)]">
              <span className="thumb relative block aspect-[16/10]">{p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                <span className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ ...(isActive(p.status) ? { background: "#EEF4FF", color: "#2E55E6" } : p.clips > 0 ? { background: "#DDFBEF", color: "#0B8A5E" } : p.status === "failed" ? { background: "#FDE8EA", color: "#C42B3B" } : { background: "#fff", color: "#646B7E" }) }}>{isActive(p.status) ? "Procesando" : p.status === "failed" ? "Con error" : p.clips > 0 ? `${p.clips} clip${p.clips === 1 ? "" : "s"}` : "Borrador"}</span></span>
              <span className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5"><span className="text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</span><b className="truncate text-sm font-semibold">{p.name}</b></span></Link></li>))}</ul>}
        </section>
      </div>
    </main>
  );
}
