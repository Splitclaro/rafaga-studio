"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { STAGE } from "../../../lib/projects";
import OpsStatus from "../../../components/OpsStatus";

type J = { id: string; kind: string; status: string; attempts: number; error_code: string | null; created_at: string; started_at: string | null; finished_at: string | null; metrics: Record<string, number | string> | null };
const KIND: Record<string, string> = { detect: "Detección de clips", render: "Exportación", lyrics: "Vídeos con letra", automation: "Automatización", live: "En vivo" };
const CAUSE: Record<string, string> = { no_speech: "Sin habla", no_speech_range: "Sin habla en el tramo", too_short: "Vídeo demasiado corto", orphaned: "Interrumpido 3 veces", permanent: "Error permanente", transient: "Error temporal (agotó reintentos)" };
const PERIODS = [[1, "24 h"], [7, "7 días"], [30, "30 días"], [90, "90 días"]] as const;
const MIN_SAMPLE = 20;

function pct(xs: number[], p: number) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; }
const fmt = (ms: number | null) => (ms == null ? "—" : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);

export default function Analitica() {
  const [days, setDays] = useState<number>(30);
  const [kind, setKind] = useState("all");
  const [jobs, setJobs] = useState<J[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [storage, setStorage] = useState<{ label: string; bytes: number; n: number }[] | null>(null);
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setJobs(null);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const all: J[] = [];
      for (let page = 0; page < 5; page++) {   // hasta 5000 trabajos por consulta
        let q = supabase.from("jobs").select("id,kind,status,attempts,error_code,created_at,started_at,finished_at,metrics").gte("created_at", since).order("created_at", { ascending: false }).range(page * 1000, page * 1000 + 999);
        if (kind !== "all") q = q.eq("kind", kind);
        const { data } = await q;
        all.push(...((data ?? []) as J[]));
        if ((data ?? []).length < 1000) break;
        if (page === 4) setTruncated(true);
      }
      if (!off) { setJobs(all); setAt(new Date()); }
    })();
    return () => { off = true; };
  }, [days, kind]);

  useEffect(() => {
    (async () => {
      const [src, songs, media, rend, lyr] = await Promise.all([
        supabase.from("sources").select("bytes"), supabase.from("songs").select("bytes"), supabase.from("media_items").select("bytes"),
        supabase.from("renders").select("probe").eq("status", "ready"), supabase.from("lyric_videos").select("probe").eq("status", "ready"),
      ]);
      const sum = (rows: { bytes?: number | null }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.bytes ?? 0), 0);
      const sumProbe = (rows: { probe: { size?: string | number; format?: { size?: string | number } } | null }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.probe?.size ?? r.probe?.format?.size ?? 0), 0);
      setStorage([
        { label: "Vídeos originales", bytes: sum(src.data), n: src.data?.length ?? 0 },
        { label: "Canciones", bytes: sum(songs.data), n: songs.data?.length ?? 0 },
        { label: "Packs de medios", bytes: sum(media.data), n: media.data?.length ?? 0 },
        { label: "Clips exportados", bytes: sumProbe(rend.data as never), n: rend.data?.length ?? 0 },
        { label: "Vídeos con letra", bytes: sumProbe(lyr.data as never), n: lyr.data?.length ?? 0 },
      ]);
    })();
  }, []);

  const s = useMemo(() => {
    if (!jobs) return null;
    const fin = jobs.filter((j) => ["done", "failed", "cancelled"].includes(j.status));
    const failed = jobs.filter((j) => j.status === "failed");
    const queue = jobs.filter((j) => j.started_at).map((j) => new Date(j.started_at!).getTime() - new Date(j.created_at).getTime());
    const proc = jobs.filter((j) => j.status === "done" && j.started_at && j.finished_at).map((j) => new Date(j.finished_at!).getTime() - new Date(j.started_at!).getTime());
    const phase = (k: string) => jobs.filter((j) => j.status === "done").map((j) => Number(j.metrics?.[k])).filter((v) => Number.isFinite(v) && v > 0);
    const causes: Record<string, number> = {};
    for (const j of failed) { const c = j.error_code ?? "sin código"; causes[c] = (causes[c] ?? 0) + 1; }
    const byKind: Record<string, { n: number; done: number; failed: number }> = {};
    for (const j of jobs) { const b = (byKind[j.kind] ??= { n: 0, done: 0, failed: 0 }); b.n++; if (j.status === "done") b.done++; if (j.status === "failed") b.failed++; }
    return {
      total: jobs.length, done: jobs.filter((j) => j.status === "done").length, failed: failed.length, cancelled: jobs.filter((j) => j.status === "cancelled").length,
      running: jobs.length - fin.length, retried: jobs.filter((j) => j.attempts > 1).length, orphaned: causes.orphaned ?? 0,
      failRate: fin.length ? failed.length / fin.length : null, queue, proc, causes, byKind,
      phases: [["Transcripción (ASR)", phase("asr_ms")], ["Selección de momentos", phase("selection_ms")], ["Primer clip", phase("first_clip_ms")], ["Lote de clips completo", phase("all_clips_ms")], ["Primer vídeo con letra", phase("first_ms")], ["Trabajo con letra completo", phase("total_ms")]] as [string, number[]][],
    };
  }, [jobs]);

  const Row = ({ label, xs }: { label: string; xs: number[] }) => (
    <tr className="border-b border-[var(--border)]"><td className="py-1.5 pr-3">{label}</td><td className="tnum text-right">{xs.length}</td><td className="tnum text-right">{fmt(pct(xs, 50))}</td><td className="tnum text-right">{fmt(pct(xs, 95))}</td>
      <td className="pl-3 text-xs text-[var(--muted)]">{!xs.length ? "sin datos" : xs.length < MIN_SAMPLE ? "muestra insuficiente" : ""}</td></tr>);

  return (
    <main className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Analítica</h1><p className="mt-1 text-sm text-[var(--muted)]">Operación real de tu workspace: volumen, fallos por causa, cola y tiempos por fase. Sin métricas sociales hasta tener conexiones autorizadas.</p></div>
        <div className="flex flex-wrap gap-2 text-sm">
          <div role="radiogroup" aria-label="Periodo" className="inline-flex rounded-full bg-[var(--hover)] p-1">{PERIODS.map(([d, l]) => <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-full px-3 py-1 ${days === d ? "bg-[var(--ink)] text-white" : ""}`}>{l}</button>)}</div>
          <label className="sr-only" htmlFor="kind">Tipo de trabajo</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5"><option value="all">Todos los tipos</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
      </header>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border hairline bg-[var(--card)] p-4 text-sm"><span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">⚭</span><span className="min-w-0 flex-1"><b>Métricas de redes: conecta una cuenta primero.</b><br /><span className="text-[var(--muted)]">Las cifras sociales solo se muestran si la plataforma las entrega por su API oficial. No inventamos números. Abajo, la operación real de tu espacio.</span></span><a href="/app/conexiones" className="btn btn-primary">Conectar cuenta</a></div>
      <div className="mt-5"><OpsStatus compact /></div>

      {!s ? <div className="skeleton mt-6 h-64" /> : (<>
        <section className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {([["Trabajos", s.total], [STAGE.done, s.done], [STAGE.failed, s.failed], ["Cancelados", s.cancelled], ["En curso", s.running], ["Con reintentos", s.retried]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-xs text-[var(--muted)]">{k}</div><div className="tnum text-2xl font-semibold">{v}</div></div>))}
        </section>
        <p className="mt-2 text-xs text-[var(--muted)]">Tasa de fallo: {s.failRate == null ? "—" : `${(s.failRate * 100).toFixed(1)} %`} de los trabajos terminados.{truncated ? " Se muestran los 5000 más recientes del periodo." : ""} Actualizado {at?.toLocaleTimeString("es")}.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-[var(--border)] p-4">
            <h2 className="font-medium">Tiempos (p50 / p95)</h2>
            <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-[var(--muted)]"><th className="pb-1 font-normal">Fase</th><th className="text-right font-normal">n</th><th className="text-right font-normal">p50</th><th className="text-right font-normal">p95</th><th /></tr></thead>
              <tbody><Row label="Espera en cola" xs={s.queue} /><Row label="Proceso completo" xs={s.proc} />{s.phases.map(([l, xs]) => <Row key={l} label={l} xs={xs} />)}</tbody></table>
            <p className="mt-2 text-xs text-[var(--muted)]">Con menos de {MIN_SAMPLE} trabajos los percentiles no son representativos. La espera en cola solo se mide en trabajos creados desde esta versión.</p>
          </section>
          <section className="rounded-xl border border-[var(--border)] p-4">
            <h2 className="font-medium">Fallos por causa</h2>
            {!Object.keys(s.causes).length ? <p className="mt-3 text-sm text-[var(--muted)]">Ningún fallo en el periodo.</p> : (
              <ul className="mt-3 space-y-2 text-sm">{Object.entries(s.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                <li key={c}><div className="flex justify-between"><span>{CAUSE[c] ?? c}</span><span className="tnum">{n}</span></div><div className="mt-1 h-1.5 rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${(n / s.failed) * 100}%` }} /></div></li>))}</ul>)}
            <h2 className="mt-6 font-medium">Por tipo de trabajo</h2>
            <table className="mt-2 w-full text-sm"><tbody>{Object.entries(s.byKind).map(([k, b]) => <tr key={k} className="border-b border-[var(--border)]"><td className="py-1.5">{KIND[k] ?? k}</td><td className="tnum text-right">{b.n}</td><td className="tnum text-right text-[var(--muted)]">{b.done} listos · {b.failed} fallidos</td></tr>)}</tbody></table>
          </section>
        </div>
      </>)}

      <section className="mt-6 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-medium">Almacenamiento</h2>
        {!storage ? <div className="skeleton mt-3 h-24" /> : (<>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-5">{storage.map((x) => <li key={x.label} className="rounded-lg bg-[var(--surface)] p-3"><div className="text-xs text-[var(--muted)]">{x.label}</div><div className="tnum font-semibold">{mb(x.bytes)}</div><div className="tnum text-xs text-[var(--muted)]">{x.n} archivos</div></li>)}</ul>
          <p className="mt-2 text-xs text-[var(--muted)]">Total {mb(storage.reduce((a, x) => a + x.bytes, 0))} según los tamaños registrados (no incluye proxies ni miniaturas). Plan actual de almacenamiento: gratuito, 1 GB y 50 MB por archivo.</p>
        </>)}
      </section>
    </main>
  );
}
