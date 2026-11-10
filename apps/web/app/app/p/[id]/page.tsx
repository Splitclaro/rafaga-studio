"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "../../../../components/Icon";
import BriefFields from "../../../../components/BriefFields";
import { composeBrief, normalizeBrief, type BriefData } from "@rafaga/selection/brief";
import ClipWall from "../../../../components/ui/ClipWall";
import type { WallClip } from "../../../../components/ui/ClipCard";
import { supabase, BRIEF_MAX } from "../../../../lib/supabase";
import { STAGE, MODE_LABEL } from "../../../../lib/projects";

type Project = { brief_data: unknown; id: string; name: string; project_brief: string | null; clip_count: number; mode: string; source_id: string };
type Job = { id: string; status: string; error_code: string | null; error_message: string | null; created_at: string; updated_at: string; attempts: number; metrics: Record<string, number | string> | null };
type Scores = { overall?: number; relevance?: number; hook?: number; standalone?: number; closure?: number; label?: string };
type Clip = { review_status: string; approved_version: number | null; current_version: number; version?: number; ratio?: string; id: string; title: string; thumb_path: string | null; title_source: string; thumb?: string; generation_id: string; favorite: boolean; created_at: string; candidate: { title?: string | null; reason: string | null; brief_fit: string | null; scores: Scores | null; start_ms: number; end_ms: number } | null; url?: string; path?: string; bytes?: number };
type Gen = { id: string; model: string; created_at: string; params: { rejected?: { reason: string }[]; fallbackReason?: string | null } | null };

const PHASES = ["queued", "extracting", "transcribing", "selecting", "rendering", "done"] as const;
const REASON: Record<string, string> = { indices: "Fragmento inválido", duration: "Duración fuera de rango", overlap: "Solapaba con otro mejor", excluded: "Caía en tus exclusiones", closure: "No terminaba en frase completa", scores: "Puntuación no válida" };
const letter = (v?: number) => (v == null ? "–" : v >= 9 ? "A" : v >= 8 ? "A-" : v >= 7 ? "B+" : v >= 6 ? "B" : v >= 5 ? "C+" : "C");
const dur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`; };

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<Project | null>(null);
  const [thumb, setThumb] = useState<string | undefined>();
  const [bd, setBd] = useState<BriefData>({ objective: "" });
  const brief = composeBrief(normalizeBrief(bd));
  const [job, setJob] = useState<Job | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [gens, setGens] = useState<Gen[]>([]);
  const [sort, setSort] = useState<"score" | "time">("score");
  const [onlyFav, setOnlyFav] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wake, setWake] = useState<"woken" | "warm" | "cold" | null>(null);
  const [tick, setTick] = useState(0);
  const busyRef = useRef(false);
  const detectRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    const { data: j } = await supabase.from("jobs").select("id,status,error_code,error_message,created_at,updated_at,attempts,metrics").eq("project_id", id).eq("kind", "detect").order("created_at", { ascending: false }).limit(1);
    setJob((j?.[0] as Job) ?? null);
    const [{ data: cs }, { data: gs }] = await Promise.all([
      supabase.from("clips").select("id,title,thumb_path,title_source,review_status,approved_version,current_version,generation_id,favorite,created_at,candidate:clip_candidates(title,reason,brief_fit,scores,start_ms,end_ms)").eq("project_id", id).eq("discarded", false).order("created_at", { ascending: false }),
      supabase.from("generations").select("id,model,created_at,params").eq("project_id", id).order("created_at", { ascending: false }),
    ]);
    setGens((gs ?? []) as Gen[]);
    const list = (cs ?? []) as unknown as Clip[];
    const ids = list.map((c) => c.id);
    const { data: rs } = ids.length ? await supabase.from("renders").select("clip_id,clip_version,storage_path,probe,ratio,created_at").in("clip_id", ids).eq("status", "ready").order("created_at", { ascending: false }) : { data: [] };
    const latest = new Map<string, { clip_version: number; storage_path: string; probe: { size?: string | number } | null; ratio: string }>();
    for (const r of (rs ?? []) as { clip_id: string; clip_version: number; storage_path: string; probe: { size?: string | number } | null; ratio: string }[]) if (!latest.has(r.clip_id)) latest.set(r.clip_id, r);
    const rp = [...latest.values()].map((r) => r.storage_path);
    const vsg = rp.length ? (await supabase.storage.from("renders").createSignedUrls(rp, 3600)).data ?? [] : [];
    const vmap = new Map(vsg.map((x) => [x.path, x.signedUrl]));
    for (const c of list) { const r = latest.get(c.id); if (r) { c.path = r.storage_path; c.bytes = Number(r.probe?.size ?? 0); c.version = r.clip_version; c.ratio = r.ratio; c.url = vmap.get(r.storage_path) ?? undefined; } }
    const tp = list.map((c) => c.thumb_path).filter((x): x is string => !!x);
    if (tp.length) { const { data: sg } = await supabase.storage.from("renders").createSignedUrls(tp, 3600); const m = new Map((sg ?? []).map((x) => [x.path, x.signedUrl])); for (const c of list) if (c.thumb_path) c.thumb = m.get(c.thumb_path) ?? undefined; }
    setClips(list);
  }, [id]);

  useEffect(() => { const f = () => { load(); }; window.addEventListener("rafaga:reload-clips", f); return () => window.removeEventListener("rafaga:reload-clips", f); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return router.replace("/login");
      const { data, error } = await supabase.from("projects").select("id,name,project_brief,brief_data,clip_count,mode,source_id").eq("id", id).single();
      if (error) return setMsg("Proyecto no encontrado.");
      setP(data as Project); setBd(normalizeBrief((data as Project).brief_data) ?? { objective: (data as Project).project_brief ?? "" });
      const { data: src } = await supabase.from("sources").select("thumb_path").eq("id", (data as Project).source_id).single();
      if (src?.thumb_path) setThumb((await supabase.storage.from("originals").createSignedUrl(src.thumb_path, 3600)).data?.signedUrl);
      await load();
    })();
  }, [id, router, load]);

  const active = !!job && !["done", "failed", "cancelled"].includes(job.status);
  useEffect(() => { if (!active) return; const t = setInterval(() => { load(); setTick((x) => x + 1); }, 4000); return () => clearInterval(t); }, [active, load]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  async function saveBrief() {
    const { error } = await supabase.from("projects").update({ project_brief: brief.trim() || null, brief_data: normalizeBrief(bd) }).eq("id", id);
    setMsg(error ? error.message : "Enfoque guardado."); return !error;
  }
  async function detect() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMsg(null);
    try {
      if (p?.mode === "clips" && !(await saveBrief())) return;
      const { error } = await supabase.rpc("request_detection", { p_project: id, p_key: crypto.randomUUID() });
      if (error) { setMsg(error.message); return; }
      setMsg("Proceso solicitado."); await load();
      const { data: s } = await supabase.auth.getSession();
      fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).then((r) => r.json()).then((j) => setWake(j.woken ? "woken" : j.reason === "already_running" ? "warm" : "cold")).catch(() => setWake("cold"));
    } finally { busyRef.current = false; setBusy(false); }
  }
  detectRef.current = detect;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  async function rename(c: Clip, title: string, mode: "edit" | "restore" = "edit") {
    const t = title.trim().replace(/\s+/g, " ");
    if (!t) return setMsg("El título no puede estar vacío.");
    const src = mode === "restore" ? (gens.find((g) => g.id === c.generation_id)?.model.startsWith("lexical") ? "lexical" : "ai") : "user";
    const { error } = await supabase.from("clips").update({ title: t.slice(0, 160), title_source: src }).eq("id", c.id);
    if (error) return setMsg(error.message);
    setClips((l) => l.map((x) => (x.id === c.id ? { ...x, title: t.slice(0, 160), title_source: src } : x))); setRenaming(null);
  }
  async function patch(c: Clip, v: Partial<{ favorite: boolean; discarded: boolean }>) {
    const { error } = await supabase.from("clips").update(v).eq("id", c.id);
    if (error) return setMsg(error.message);
    setClips((l) => (v.discarded ? l.filter((x) => x.id !== c.id) : l.map((x) => (x.id === c.id ? { ...x, ...v } : x))));
  }
  async function download(c: Clip) {
    if (!c.path) return;
    const { data } = await supabase.storage.from("renders").createSignedUrl(c.path, 300, { download: `${c.title.replace(/[^\w\-áéíóúñ ]/gi, "").slice(0, 40) || "clip"}.mp4` });
    if (data?.signedUrl) window.location.href = data.signedUrl;
  }

  const genModel = (c: Clip) => gens.find((g) => g.id === c.generation_id)?.model ?? "desconocido";
  const isLex = (c: Clip) => genModel(c).startsWith("lexical");
  async function asReframe() {
    const { error } = await supabase.from("projects").update({ mode: "reframe" }).eq("id", id);
    if (error) return setMsg(error.message);
    setP((x) => (x ? { ...x, mode: "reframe" } : x)); setMsg("Proyecto convertido a Reencuadre: se reutiliza el vídeo subido.");
    busyRef.current = false; await detectRef.current?.();
  }
  const sorted = useMemo(() => {
    const l = clips.filter((c) => !onlyFav || c.favorite);
    return [...l].sort((a, b) => sort === "score" ? (b.candidate?.scores?.overall ?? -1) - (a.candidate?.scores?.overall ?? -1) : (a.candidate?.start_ms ?? 0) - (b.candidate?.start_ms ?? 0));
  }, [clips, sort, onlyFav]);

  if (!p) return <main className="mx-auto max-w-5xl px-4 py-10 text-[var(--muted)]">{msg ?? <span className="skeleton block h-40" />}</main>;
  const waiting = job?.status === "queued" ? Math.floor((Date.now() - new Date(job.created_at).getTime()) / 60000) : 0;
  const elapsed = job ? Math.max(0, Math.round(((active ? Date.now() : new Date(job.updated_at).getTime()) - new Date(job.created_at).getTime()) / 1000)) : 0;
  const phaseIdx = job ? Math.max(0, PHASES.indexOf((job.status === "validating" ? "extracting" : job.status === "tracking" ? "rendering" : job.status) as (typeof PHASES)[number])) : -1;
  const latestGen = gens[0];
  const rejected = latestGen?.params?.rejected ?? [];
  const rejCount = rejected.reduce<Record<string, number>>((a, r) => ({ ...a, [r.reason]: (a[r.reason] ?? 0) + 1 }), {});
  const tool = p.mode !== "clips";
  const hasRun = (!!job && job.status === "done") || clips.length > 0;
  void tick;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 md:px-8">
      <Link href="/app/biblioteca" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">← Biblioteca</Link>
      <header className="mt-3 flex flex-wrap items-center gap-4">
        <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-[#111]">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <div className="dots-dark grid h-full place-items-center text-white/60"><Icon n="film" /></div>}</div>
        <div className="min-w-0 flex-1"><h1 className="truncate text-2xl">{p.name}</h1><div className="mt-1 flex flex-wrap gap-2 text-xs"><span className="chip !py-0.5">{MODE_LABEL[p.mode] ?? p.mode}</span>{latestGen && <span className="chip !py-0.5">{latestGen.model === "lexical-v1" ? "Selección sin IA" : latestGen.model.startsWith("herramienta") ? "Herramienta" : "Selección con IA"}</span>}</div></div>
      </header>

      <section className="card mt-6 p-5">
        {!tool ? (<>
          <BriefFields value={bd} onChange={setBd} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={saveBrief} className="btn btn-ghost">Guardar enfoque</button>
            <button onClick={detect} disabled={busy || active} className="btn btn-primary"><Icon n="wand" className="h-4 w-4" />{hasRun ? "Volver a detectar" : "Detectar momentos virales"}</button>
            <span className="text-xs text-[var(--muted)]">{latestGen?.model.startsWith("lexical") ? "Selección sin IA: coincidencia de tu enfoque con la transcripción y reglas de duración y cierre." : "Estimación de IA, no garantiza viralidad."} Volver a detectar reutiliza la transcripción y conserva tus clips.</span>
          </div>
        </>) : (
          <div className="flex flex-wrap items-center gap-3"><Icon n="wand" className="h-5 w-5" /><span className="text-sm">Herramienta <strong>{MODE_LABEL[p.mode]}</strong>: cuando termine el proceso, abre el clip en el editor para ajustarlo.</span>
            {!active && !clips.length && <button onClick={detect} disabled={busy} className="btn btn-primary ml-auto">Procesar vídeo</button>}</div>
        )}
        <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--muted)]">{msg}</p>
      </section>

      {job && (
        <section aria-live="polite" aria-label="Estado del proceso" className="card mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium">{active ? <span className="pulse" aria-hidden /> : <Icon n={job.status === "done" ? "check" : "x"} className="h-4 w-4" />}{STAGE[job.status] ?? job.status}{job.attempts > 1 ? ` · intento ${job.attempts}` : ""}</div>
            <div className="mono text-sm text-[var(--muted)]">{elapsed >= 60 ? `${Math.floor(elapsed / 60)} min ${elapsed % 60} s` : `${elapsed} s`}{job.status === "done" ? ` · ${clips.length} clip${clips.length === 1 ? "" : "s"}` : ""}</div>
          </div>
          {job.status !== "failed" && job.status !== "cancelled" && (
            <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Etapas">{(["En cola", "Audio", "Transcripción", "Momentos", "Clips"] as const).map((l, i) => (
              <li key={l}><div className={`h-1.5 rounded-full ${i < phaseIdx || job.status === "done" ? "bg-[#111]" : i === phaseIdx ? "skeleton !rounded-full" : "bg-[#E5E5E5]"}`} /><span className={`mt-1 block text-xs ${i <= phaseIdx || job.status === "done" ? "" : "text-[var(--muted)]"}`}>{l}</span></li>))}</ol>)}
          {job.status === "queued" && <p className="mt-3 text-sm text-[var(--muted)]">{wake === "warm" ? "El worker ya está activo: lo recogerá en segundos." : wake === "woken" ? "Arrancando el worker (1–2 min la primera vez)." : "El worker arranca según el programador de GitHub, que puede tardar varios minutos."} Llevas {waiting} min en cola.{waiting >= 15 && " Si sigue así, el worker no está activo."}</p>}
          {job.error_message && <p role="alert" className="mt-3 text-sm">⚠ {job.error_message}</p>}
          {job.status === "failed" && (job.error_code === "no_speech" || job.error_code === "no_speech_range" || /no se detectó voz|no hay habla/i.test(job.error_message ?? "")) && (
            <div className="mt-3 rounded-xl bg-[var(--surface)] p-4 text-sm">
              <p className="font-medium">Cómo seguir sin volver a subir el vídeo</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
                <li>Si es música: la detección de momentos busca frases habladas. Para canciones usa Lyric Studio con el audio.</li>
                <li>Si es un vídeo sin voz: conviértelo en un clip reencuadrado (sin subtítulos). No se repite la subida ni la transcripción.</li>
                <li>Si sí hay voz pero muy baja o tapada por música, el reconocimiento no la encuentra: prueba con una versión con la voz más alta.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2"><button onClick={asReframe} disabled={busy} className="btn btn-primary !py-1.5 !text-xs">Convertir en clip reencuadrado</button><Link href="/app/lyric-studio" className="btn btn-ghost !py-1.5 !text-xs">Abrir Lyric Studio</Link></div>
            </div>)}
          {job.status === "failed" && job.error_code === "too_short" && <p className="mt-2 text-sm text-[var(--muted)]">Sube un vídeo de al menos 15 s, o usa Reencuadrar / Subtítulos desde Inicio, que no necesitan buscar momentos.</p>}
          {job.metrics && job.status === "done" && (
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-[var(--muted)]">Ver detalle técnico</summary>
              <dl className="mono mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">{Object.entries(job.metrics).filter(([k]) => /ms$|^raw|accepted|rejected|selector|words|mode/.test(k)).map(([k, v]) => <div key={k} className="flex justify-between border-b hairline py-1"><dt>{k}</dt><dd>{/ms$/.test(k) ? `${(Number(v) / 1000).toFixed(1)} s` : String(v)}</dd></div>)}</dl></details>)}
        </section>
      )}

      {!!clips.length && (
        <ClipWall projectId={id} projectName={p.name} showScore={!tool} onFavorite={async (cid, v) => { await supabase.from("clips").update({ favorite: v }).eq("id", cid); setClips((l) => l.map((x) => (x.id === cid ? { ...x, favorite: v } : x))); }}
          onDiscard={async (cid) => { await supabase.from("clips").update({ discarded: true }).eq("id", cid); setClips((l) => l.filter((x) => x.id !== cid)); }}
          clips={clips.map<WallClip>((c) => ({ id: c.id, title: c.title, title_source: c.title_source, thumb: c.thumb, url: c.url, path: c.path, bytes: c.bytes, favorite: c.favorite, version: c.version ?? c.current_version, ratio: c.ratio,
            review_status: c.review_status, approved_version: c.approved_version, current_version: c.current_version, durMs: c.candidate ? c.candidate.end_ms - c.candidate.start_ms : undefined,
            score: c.candidate?.scores?.overall ?? null, reason: c.candidate?.reason, brief_fit: c.candidate?.brief_fit, created_at: c.created_at, hasRender: !!c.path }))} />
      )}

      {!tool && !!rejected.length && (
        <details className="card mt-6 p-4 text-sm"><summary className="cursor-pointer font-medium">Por qué no se eligieron otros momentos <span className="mono text-[var(--muted)]">{rejected.length}</span></summary>
          <ul className="mt-3 space-y-1">{Object.entries(rejCount).map(([k, n]) => <li key={k} className="flex justify-between border-b hairline py-1"><span>{REASON[k] ?? k}</span><span className="mono">{n}</span></li>)}</ul>
          {latestGen?.params?.fallbackReason && <p className="mt-3 text-xs text-[var(--muted)]">La selección con IA no estaba disponible ({latestGen.params.fallbackReason.slice(0, 90)}…), por eso se usó coincidencia de palabras.</p>}
        </details>
      )}
    </main>
  );
}
