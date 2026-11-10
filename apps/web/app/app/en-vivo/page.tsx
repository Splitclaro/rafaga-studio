"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";

type Session = { id: string; hls_url: string; brief: string | null; status: string; captured_seconds: number; windows_done: number; gaps: number; reconnects: number; last_error: string | null; created_at: string; started_at: string | null; ended_at: string | null; max_seconds: number };
type Win = { id: string; session_id: string; idx: number; seconds: number; reason: string; project_id: string | null; created_at: string };
type ClipLite = { id: string; project_id: string; title: string; start_ms: number; end_ms: number; ready: boolean };
const ST: Record<string, string> = { queued: "En cola", capturing: "Capturando", paused: "En pausa", stopped: "Detenida", done: "Terminada", failed: "Con error" };
const REASON: Record<string, string> = { length: "Ventana completa", gap: "Cerrada por un corte en la emisión", stop: "Cerrada al detener", ended: "Fin de la emisión" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function EnVivo() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [clips, setClips] = useState<ClipLite[]>([]);
  const [queue, setQueue] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [url, setUrl] = useState(""); const [brief, setBrief] = useState(""); const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [yt, setYt] = useState<{ id: string; title: string } | null>(null);   // directo elegido en el buscador de YouTube
  useEffect(() => {
    const p = new URLSearchParams(window.location.search), id = p.get("yt");
    if (id && /^[\w-]{11}$/.test(id)) { setYt({ id, title: (p.get("title") ?? "Directo de YouTube").slice(0, 200) }); const b = p.get("brief"); if (b) setBrief(b.slice(0, 600)); }
  }, []);

  const load = useCallback(async () => {
    const { data: ss } = await supabase.from("live_sessions").select("id,hls_url,brief,status,captured_seconds,windows_done,gaps,reconnects,last_error,created_at,started_at,ended_at,max_seconds").order("created_at", { ascending: false }).limit(20);
    const list = (ss ?? []) as Session[]; setSessions(list);
    const cur = sel ?? list[0]?.id ?? null; if (!sel && cur) setSel(cur);
    if (!cur) return;
    const { data: w } = await supabase.from("live_windows").select("id,session_id,idx,seconds,reason,project_id,created_at").eq("session_id", cur).order("idx");
    setWins((w ?? []) as Win[]);
    const pids = (w ?? []).map((x) => x.project_id).filter(Boolean) as string[];
    if (!pids.length) { setClips([]); setQueue(0); return; }
    const [{ data: cs }, { data: js }] = await Promise.all([
      supabase.from("clips").select("id,project_id,title,candidate:clip_candidates(start_ms,end_ms)").in("project_id", pids).eq("discarded", false),
      supabase.from("jobs").select("status").in("project_id", pids).eq("kind", "detect"),
    ]);
    const ids = (cs ?? []).map((c) => c.id);
    const { data: rs } = ids.length ? await supabase.from("renders").select("clip_id").in("clip_id", ids).eq("status", "ready") : { data: [] };
    const ready = new Set((rs ?? []).map((r) => r.clip_id));
    setClips((cs ?? []).map((c) => { const k = (Array.isArray(c.candidate) ? c.candidate[0] : c.candidate) as { start_ms: number; end_ms: number } | null; return { id: c.id, project_id: c.project_id, title: c.title, start_ms: k?.start_ms ?? 0, end_ms: k?.end_ms ?? 0, ready: ready.has(c.id) }; }));
    setQueue((js ?? []).filter((j) => !["done", "failed", "cancelled"].includes(j.status)).length);
  }, [sel]);
  useEffect(() => { load(); const i = setInterval(load, 4000); return () => clearInterval(i); }, [load]);

  const active = sessions?.find((s) => ["queued", "capturing"].includes(s.status));
  const cur = sessions?.find((s) => s.id === sel) ?? null;

  async function start() {
    if (busy) return; setMsg(null);
    if (!/^https:\/\//i.test(url.trim())) return setMsg("La dirección debe empezar por https://");
    if (!/m3u8/i.test(url)) return setMsg("Debe ser la lista HLS de la emisión (termina en .m3u8). Una página de YouTube, Twitch o Kick no sirve como fuente.");
    if (!ok) return setMsg("Confirma que tienes autorización para capturar esta emisión.");
    setBusy(true);
    const { data, error } = await supabase.rpc("start_live_session", { p_url: url.trim(), p_brief: brief.trim() || null });
    setBusy(false);
    if (error) return setMsg(error.message.includes("session_active") ? "Ya hay una sesión activa en tu espacio. Deténla antes de empezar otra." : error.message);
    if (yt) await supabase.from("youtube_picks").update({ source_kind: "signal", updated_at: new Date().toISOString() }).eq("video_id", yt.id);
    setSel(data as string); setUrl(""); setBrief(""); setOk(false); setMsg("Sesión en cola. En cuanto el worker la recoja empezará a capturar.");
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    load();
  }
  async function act(id: string, action: "stop" | "pause" | "resume") {
    const { error } = await supabase.rpc("set_live_status", { p_session: id, p_action: action });
    if (error) return setMsg(error.message.includes("session_active") ? "Ya hay otra sesión activa." : error.message);
    if (action === "resume") { const { data: s } = await supabase.auth.getSession(); fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {}); }
    load();
  }
  function makeSummary() {
    const lines = wins.flatMap((w) => {
      const cs = clips.filter((c) => c.project_id === w.project_id);
      return [`Ventana ${w.idx + 1} · ${mmss(w.seconds)} de emisión`, ...(cs.length ? cs.map((c) => `  - ${c.title} (${mmss(c.start_ms / 1000)}–${mmss(c.end_ms / 1000)} dentro de la ventana) · ${window.location.origin}/app/c/${c.id}`) : ["  - Sin momentos destacados en esta ventana"])];
    });
    setSummary(`Resumen de la sesión\n${wins.length} ventanas, ${clips.length} momentos seleccionados\n\n${lines.join("\n")}`);
  }

  const ready = clips.filter((c) => c.ready).length;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6"><h1 className="text-3xl">En vivo</h1><p className="mt-1 max-w-3xl text-[var(--muted)]">Captura una emisión HLS que tengas autorización para usar y recibe clips mientras sigue en directo. Cada ~2 minutos se cierra una ventana y se buscan sus mejores momentos.</p></header>
      {msg && <p role="status" aria-live="polite" className="card mb-4 p-3 text-sm">{msg}</p>}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="text-base">Nueva sesión</h2>
            <div className="mt-3 space-y-3 text-sm">
              {yt && <div role="status" className="rounded-xl border hairline bg-white p-3 text-sm"><b>Directo de YouTube elegido:</b> {yt.title}<p className="mt-1 text-xs text-[var(--muted)]">YouTube no entrega la señal del directo. Pega abajo la lista HLS de tu emisión (por ejemplo, la segunda salida de tu codificador) y Ráfaga empezará a cortar. Tu selección y tu brief se conservan.</p></div>}
              <label className="block">Lista HLS (https, .m3u8)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://midominio.com/directo/index.m3u8" className="input mono mt-1" disabled={!!active} /></label>
              <label className="block">¿Qué momentos te interesan? (opcional)<textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={2000} className="input mt-1" placeholder="Goles y reacciones del comentarista. Evita la publicidad." disabled={!!active} /></label>
              <label className="flex items-start gap-2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" disabled={!!active} /><span>Confirmo que tengo autorización para capturar y reutilizar esta emisión.</span></label>
              <button onClick={start} disabled={busy || !!active} className="btn btn-primary w-full">{active ? "Ya hay una sesión activa" : busy ? "Iniciando…" : "Empezar a capturar"}</button>
            </div>
            <ul className="mt-4 space-y-1 text-xs text-[var(--muted)]">
              <li>· Solo HLS en MPEG-TS, sin DRM ni cifrado. Duración máxima 60 min por sesión.</li>
              <li>· Un directo de YouTube, Twitch o Kick no se acepta por su página; hace falta una lista HLS autorizada.</li>
              <li>· Una sesión activa por espacio. Pausar detiene la captura (y el consumo).</li>
              <li>· Si la emisión se corta, no se une lo de antes con lo de después.</li>
            </ul>
          </section>

          <section className="card p-4">
            <h2 className="mb-2 text-base">Sesiones</h2>
            {sessions === null && <div className="skeleton h-12" />}
            {sessions?.length === 0 && <p className="text-sm text-[var(--muted)]">Aún no has capturado ninguna emisión.</p>}
            <ul className="space-y-1">{sessions?.map((s) => (
              <li key={s.id}><button onClick={() => setSel(s.id)} aria-current={sel === s.id} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${sel === s.id ? "bg-[#111] text-white" : "hover:bg-[var(--hover)]"}`}>
                <span className="min-w-0"><span className="block truncate">{new Date(s.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><span className={`mono block text-xs ${sel === s.id ? "text-white/70" : "text-[var(--muted)]"}`}>{s.windows_done} ventanas · {mmss(Number(s.captured_seconds))}</span></span>
                <span className="shrink-0 text-xs">{["capturing", "queued"].includes(s.status) && <span className="pulse mr-1" aria-hidden />}{ST[s.status]}</span></button></li>))}</ul>
          </section>
        </aside>

        <section aria-live="polite">
          {!cur ? <div className="card grid min-h-72 place-items-center border-dashed p-10 text-center text-[var(--muted)]"><div><Icon n="live" className="mx-auto h-8 w-8" /><p className="mt-3">Empieza una sesión para ver aquí la captura y los clips.</p></div></div> : (<>
            <div className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-lg font-medium">{["capturing", "queued"].includes(cur.status) ? <span className="pulse" aria-hidden /> : <Icon n={cur.status === "failed" ? "x" : "check"} className="h-4 w-4" />}{ST[cur.status]}</div>
                <div className="flex gap-2">
                  {["queued", "capturing"].includes(cur.status) && <><button onClick={() => act(cur.id, "pause")} className="btn btn-ghost">Pausar</button><button onClick={() => act(cur.id, "stop")} className="btn btn-primary">Parar</button></>}
                  {["paused", "stopped"].includes(cur.status) && <button onClick={() => act(cur.id, "resume")} className="btn btn-primary">Reanudar</button>}
                </div>
              </div>
              <div className="mono mt-1 truncate text-xs text-[var(--muted)]">{cur.hls_url}</div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[["Capturado", `${mmss(Number(cur.captured_seconds))} / ${mmss(cur.max_seconds)}`], ["Ventanas", String(cur.windows_done)], ["Momentos elegidos", String(clips.length)], ["Clips listos", `${ready}`], ["En cola", String(queue)]].map(([k, v]) => <div key={k} className="rounded-xl bg-[var(--surface)] p-3"><dd className="mono text-lg">{v}</dd><dt className="text-xs text-[var(--muted)]">{k}</dt></div>)}
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]"><span>Cortes de emisión: <span className="mono">{cur.gaps}</span></span><span>Reconexiones: <span className="mono">{cur.reconnects}</span></span>{cur.windows_done === 0 && ["capturing"].includes(cur.status) && <span>Esperando la primera ventana completa (~2 min)…</span>}</div>
              {cur.last_error && <p role="alert" className="mt-3 rounded-lg bg-[var(--surface)] p-2 text-sm">⚠ {cur.last_error}</p>}
              {cur.status === "queued" && <p className="mt-3 text-sm text-[var(--muted)]">Esperando al worker. Si tarda, arranca solo en cuanto el programador de GitHub lo lance.</p>}
            </div>

            <div className="mt-5 flex items-center justify-between"><h2 className="text-lg">Ventanas y momentos</h2><button onClick={makeSummary} disabled={!wins.length} className="btn btn-ghost !py-1.5">Crear resumen</button></div>
            {summary && (<div className="card mt-3 p-4"><pre className="mono max-h-72 overflow-auto whitespace-pre-wrap text-xs">{summary}</pre><div className="mt-2 flex gap-2"><button className="btn btn-ghost !py-1.5" onClick={() => navigator.clipboard.writeText(summary)}>Copiar</button><button className="btn btn-ghost !py-1.5" onClick={() => setSummary(null)}>Cerrar</button></div><p className="mt-2 text-xs text-[var(--muted)]">Resumen en texto con enlaces a cada clip; no es un montaje de vídeo.</p></div>)}
            {!wins.length && <p className="card mt-3 border-dashed p-6 text-sm text-[var(--muted)]">Aún no hay ventanas. Aparecerán aquí cada ~2 minutos de emisión capturada.</p>}
            <ul className="mt-3 space-y-3">{wins.map((w) => { const cs = clips.filter((c) => c.project_id === w.project_id); return (
              <li key={w.id} className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Ventana {w.idx + 1}</span><span className="mono text-xs text-[var(--muted)]">{mmss(w.seconds)} · {REASON[w.reason] ?? w.reason}</span></div>
                {cs.length ? <ul className="mt-2 space-y-1">{cs.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{c.title}</span><span className="flex shrink-0 items-center gap-3 text-xs"><span className="mono text-[var(--muted)]">{mmss(c.start_ms / 1000)}–{mmss(c.end_ms / 1000)}</span>{c.ready ? <Link href={`/app/c/${c.id}`} className="underline">Editar</Link> : <span className="text-[var(--muted)]">Creando…</span>}</span></li>)}</ul>
                  : <p className="mt-2 text-sm text-[var(--muted)]">{w.project_id ? <>Analizando esta ventana… <Link href={`/app/p/${w.project_id}`} className="underline">Ver proyecto</Link></> : "Sin proyecto"}</p>}</li>); })}</ul>
          </>)}
        </section>
      </div>
    </main>
  );
}
