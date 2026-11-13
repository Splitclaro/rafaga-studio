"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../../../components/Icon";
import BriefFields, { EMPTY_BRIEF, briefText } from "../../../components/BriefFields";
import { normalizeBrief, type BriefData } from "@rafaga/selection/brief";
import { createProject, validateFile, probeDuration, MIN_SOURCE_SECONDS, WHOLE_VIDEO_MAX_SECONDS, type ProjectMode } from "../../../lib/projects";
import { supabase, MAX_VIDEO_BYTES } from "../../../lib/supabase";

const STEPS = ["Origen", "Objetivo", "Parámetros", "Confirmar"] as const;
const GOALS: { mode: ProjectMode; t: string; d: string; whole: boolean }[] = [
  { mode: "clips", t: "Mejores momentos", d: "Busca los mejores momentos y crea varios clips.", whole: false },
  { mode: "captions", t: "Subtítulos", d: "Transcribe y subtitula el vídeo entero.", whole: true },
  { mode: "reframe", t: "Reencuadre", d: "Convierte el vídeo a vertical, cuadrado o apaisado.", whole: true },
  { mode: "social", t: "Social edits", d: "Vídeo entero listo para cada red.", whole: true },
  { mode: "broll", t: "B-roll", d: "Subtitula y superpón tus imágenes o vídeos.", whole: true },
];
const LOOKS = ["Momentos graciosos", "Consejos", "Polémicas", "Historias", "Citas"];
const DURATIONS = [["", "Automática"], ["30", "Hasta 30 s"], ["45", "Hasta 45 s"], ["60", "Hasta 60 s"], ["85", "Hasta 85 s"]] as const;
const parseTime = (s: string) => { if (!s.trim()) return null; const p = s.trim().split(":").map(Number); if (p.some((x) => !Number.isFinite(x) || x < 0)) return NaN; return p.reduce((t, x) => t * 60 + x, 0); };
const clock = (d: number) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}`;

/** Nuevo proyecto en 4 pasos (diseño maestro): origen, objetivo, parámetros y confirmación. Crea el mismo proyecto real que Inicio. */
export default function Nuevo() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null), [dur, setDur] = useState<number | null>(null), [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<ProjectMode>("clips");
  const [bd, setBd] = useState<BriefData>(EMPTY_BRIEF);
  const [count, setCount] = useState(5), [maxLen, setMaxLen] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const goal = GOALS.find((g) => g.mode === mode)!;
  const brief = briefText(bd);
  const has = (t: string) => bd.objective.toLowerCase().includes(t.toLowerCase());
  const toggleLook = (t: string) => setBd((x) => { if (x.objective.toLowerCase().includes(t.toLowerCase())) return { ...x, objective: x.objective.replace(new RegExp("\\s*Busca " + t.toLowerCase() + "\\.?", "i"), "").trim() }; return { ...x, objective: (x.objective ? x.objective.replace(/\s+$/, "") + " " : "") + "Busca " + t.toLowerCase() + "." }; });

  async function pick(f: File | null) {
    if (!f) return;
    const e = validateFile(f); if (e) { setMsg(e); setFile(null); return; }
    const d = await probeDuration(f); setDur(d);
    if (d !== null && d < MIN_SOURCE_SECONDS) { setMsg(`Este vídeo dura ${d.toFixed(1)} s. Hacen falta al menos ${MIN_SOURCE_SECONDS} s.`); setFile(null); return; }
    setMsg(null); setFile(f);
  }
  function next() {
    setMsg(null);
    if (step === 0 && !file) return setMsg("Elige un vídeo para continuar.");
    if (step === 1 && goal.whole && dur !== null && dur > WHOLE_VIDEO_MAX_SECONDS) return setMsg(`«${goal.t}» procesa el vídeo entero y admite hasta ${WHOLE_VIDEO_MAX_SECONDS / 60} min (el tuyo dura ${(dur / 60).toFixed(1)}). Elige «Mejores momentos» para vídeos largos.`);
    if (step === 2) { const a = parseTime(from), b = parseTime(to); if (Number.isNaN(a) || Number.isNaN(b)) return setMsg("El tramo debe tener formato mm:ss o hh:mm:ss."); if (a != null && b != null && b <= a) return setMsg("El final del tramo debe ser posterior al inicio."); if (b != null && dur !== null && b > dur + 0.5) return setMsg("El tramo termina después del final del vídeo."); }
    setStep((s) => Math.min(3, s + 1));
  }
  async function start() {
    if (busy || !file) return; setBusy(true); setMsg(null);
    try {
      const a = parseTime(from), b = parseTime(to);
      const id = await createProject({ file, name: "", brief: mode === "clips" ? brief : "", briefData: mode === "clips" ? normalizeBrief(bd) : undefined, count: dur ? Math.max(1, Math.min(count, Math.floor(dur / 18))) : count, mode, maxSeconds: maxLen ? Number(maxLen) : undefined, rangeStart: a ?? 0, rangeEnd: b ?? undefined, onStep: setMsg });
      setMsg("Encolando la detección…");
      const { error } = await supabase.rpc("request_detection", { p_project: id, p_key: crypto.randomUUID() });
      if (error) throw new Error(error.message);
      const { data: ss } = await supabase.auth.getSession(); fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${ss.session?.access_token ?? ""}` } }).catch(() => {});
      router.push(`/app/p/${id}`);
    } catch (x) { setMsg(x instanceof Error ? x.message : "Error inesperado"); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-[900px] px-4 pb-20 pt-6 md:px-8">
      <h1 className="text-3xl">Nuevo proyecto</h1>
      <ol className="mt-4 flex flex-wrap gap-2" aria-label="Pasos">{STEPS.map((l, i) => <li key={l}><button type="button" onClick={() => i < step && setStep(i)} aria-current={i === step ? "step" : undefined} className={`chip ${i === step ? "on" : ""}`}><span className="mono">0{i + 1}</span>{l}</button></li>)}</ol>
      <section className="card mt-5 p-6">
        {step === 0 && (<>
          <h2 className="text-2xl">¿De dónde viene el vídeo?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-soft)] p-4"><b>Archivo local</b><br /><span className="text-sm text-[var(--muted)]">Sube desde tu equipo.</span></div>
            <div className="rounded-xl border border-dashed hairline p-4 text-[var(--muted)]"><b className="text-[var(--ink)]">Drive y Dropbox</b> <span className="chip !min-h-6 !py-0">Próximamente</span><br /><span className="text-sm">Importar desde tu almacenamiento.</span></div></div>
          <input ref={input} type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.mkv" className="sr-only" id="nf" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <label htmlFor="nf" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }} className={`mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed px-6 py-10 text-center ${drag ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-2)] hover:border-[var(--accent)]"}`}>
            <Icon n="upload" className="h-7 w-7 text-[var(--accent)]" />
            {file ? <><b>{file.name}</b><span className="mono text-xs text-[var(--muted)]">{(file.size / 1048576).toFixed(1)} MB{dur ? ` · ${clock(dur)}` : ""} · se valida antes de subir</span></> : <><b>Suelta el vídeo aquí o elige un archivo</b><span className="text-sm text-[var(--muted)]">MP4, MOV, M4V, MKV o WebM · hasta {MAX_VIDEO_BYTES / 1073741824} GB</span></>}
          </label>
          <p className="mt-3 text-sm text-[var(--muted)]">¿Tu vídeo está en YouTube? YouTube no entrega el archivo: descárgalo en YouTube Studio y súbelo aquí.</p>
        </>)}
        {step === 1 && (<>
          <h2 className="text-2xl">¿Qué quieres obtener?</h2>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Objetivo">{GOALS.map((g) => <button key={g.mode} role="radio" aria-checked={mode === g.mode} onClick={() => setMode(g.mode)} className={`rounded-xl border p-4 text-left ${mode === g.mode ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "hairline hover:bg-[var(--hover)]"}`}><b>{g.t}</b><br /><span className="text-sm text-[var(--muted)]">{g.d}</span></button>)}</div>
          {mode === "clips" && <div className="mt-5"><div className="mb-2 flex flex-wrap gap-2">{LOOKS.map((t) => <button key={t} type="button" onClick={() => toggleLook(t)} aria-pressed={has(t)} className="chip">{t}</button>)}</div><BriefFields value={bd} onChange={setBd} /></div>}
        </>)}
        {step === 2 && (<>
          <h2 className="text-2xl">Parámetros</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {mode === "clips" && <label className="text-sm font-medium">Número de clips · <span className="mono">{count}</span><input type="range" min={3} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-2 w-full" /></label>}
            {mode === "clips" && <label className="text-sm font-medium">Duración de cada clip<select value={maxLen} onChange={(e) => setMaxLen(e.target.value)} className="input mt-1">{DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
            <label className="text-sm font-medium">Tramo desde<input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" className="input mono mt-1" inputMode="numeric" /></label>
            <label className="text-sm font-medium">Tramo hasta<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="fin del vídeo" className="input mono mt-1" inputMode="numeric" /></label>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">El formato, el encuadre y el estilo de subtítulos se eligen después, en el editor de cada clip.</p>
        </>)}
        {step === 3 && (<>
          <h2 className="text-2xl">Resumen de la tarea</h2>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-[var(--muted)]">Origen</dt><dd className="font-semibold">{file?.name}{dur ? ` · ${clock(dur)}` : ""}</dd>
            <dt className="text-[var(--muted)]">Objetivo</dt><dd className="font-semibold">{goal.t}{mode === "clips" ? (brief ? ", con tu encargo" : ", sin encargo (Ráfaga elige)") : ""}</dd>
            <dt className="text-[var(--muted)]">Salida</dt><dd className="font-semibold">{mode === "clips" ? `${dur ? Math.max(1, Math.min(count, Math.floor(dur / 18))) : count} clips${dur && Math.floor(dur / 18) < count ? " (máximo posible en este vídeo)" : ""}${maxLen ? ` · hasta ${maxLen} s` : ""}` : goal.t}{from || to ? ` · tramo ${from || "0:00"}–${to || "fin"}` : ""}</dd>
            <dt className="text-[var(--muted)]">Consumo estimado</dt><dd className="font-semibold">{dur ? `${Math.max(1, Math.round(dur / 60))} min del plan` : "—"} <span className="font-normal text-[var(--muted)]">(equivale a la duración del vídeo)</span></dd>
          </dl>
          <p className="mt-4 rounded-xl bg-[var(--surface)] p-3 text-sm text-[var(--muted)]"><b className="text-[var(--ink)]">Se hará automáticamente:</b> transcribir, elegir momentos, reencuadrar, subtitular y preparar vistas previas. No se publica nada.</p>
        </>)}
        <p role="status" aria-live="polite" className="mt-4 min-h-5 text-sm text-[var(--muted)]">{msg}</p>
        <div className="mt-2 flex justify-between gap-3">
          {step === 0 ? <Link href="/app" className="btn btn-ghost">Cancelar</Link> : <button onClick={() => setStep((s) => s - 1)} disabled={busy} className="btn btn-ghost">Atrás</button>}
          {step < 3 ? <button onClick={next} className="btn btn-primary">{step === 2 ? "Revisar" : "Continuar"}</button> : <button onClick={start} disabled={busy} className="btn btn-primary">{busy ? "Subiendo…" : "Empezar a procesar"}</button>}
        </div>
      </section>
    </main>
  );
}
