"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import type { YtItem, YtFilter } from "@rafaga/providers/youtube";

const FILTERS: [YtFilter, string][] = [["all", "Todos"], ["live", "En directo"], ["video", "Vídeos publicados"], ["upcoming", "Próximos"]];
const mmss = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
type Err = { kind: "quota" | "not_configured" | "rate" | "invalid_key" | "service" | "network"; message: string };

async function authed(url: string, signal?: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  return fetch(url, { signal, headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
}

/** Buscador de YouTube dentro del creador: resultados reales (servidor), filtros oficiales, espera al escribir y descarte de respuestas antiguas. */
export default function YouTubeSearch({ onPick }: { onPick: (item: YtItem) => void }) {
  const [q, setQ] = useState(""), [filter, setFilter] = useState<YtFilter>("all");
  const [items, setItems] = useState<YtItem[] | null>(null), [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState<Err | null>(null), [loading, setLoading] = useState(false), [more, setMore] = useState(false), [checking, setChecking] = useState<string | null>(null);
  const seq = useRef(0), ctl = useRef<AbortController | null>(null);

  const run = useCallback(async (query: string, f: YtFilter, token?: string) => {
    const my = ++seq.current; ctl.current?.abort(); const c = (ctl.current = new AbortController());
    token ? setMore(true) : setLoading(true); setErr(null);
    try {
      const r = await authed(`/api/youtube/search?${new URLSearchParams({ q: query, filter: f, ...(token ? { pageToken: token } : {}) })}`, c.signal);
      const j = await r.json();
      if (my !== seq.current) return;   // llegó tarde: ya hay una búsqueda más reciente
      if (!r.ok) { setErr({ kind: (j.error ?? "service") as Err["kind"], message: j.message ?? "No se pudo buscar en YouTube." }); if (!token) setItems(null); return; }
      setItems((prev) => (token ? [...(prev ?? []), ...j.items] : j.items)); setNext(j.nextPageToken ?? null);
    } catch (e) { if ((e as Error).name === "AbortError" || my !== seq.current) return; setErr({ kind: "network", message: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo." }); }
    finally { if (my === seq.current) { setLoading(false); setMore(false); } }
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { seq.current++; ctl.current?.abort(); setItems(null); setErr(null); setLoading(false); return; }
    const t = setTimeout(() => run(q.trim(), filter), 450);   // breve espera al escribir
    return () => clearTimeout(t);
  }, [q, filter, run]);

  async function choose(it: YtItem) {
    setChecking(it.id); setErr(null);
    try {   // el estado puede haber cambiado desde la búsqueda: empezado, terminado o desaparecido
      const r = await authed(`/api/youtube/video?id=${encodeURIComponent(it.id)}`); const j = await r.json();
      if (!r.ok) { setErr({ kind: (j.error ?? "service") as Err["kind"], message: j.message ?? "No se pudo comprobar el vídeo." }); return; }
      onPick(j.item as YtItem);
    } catch { setErr({ kind: "network", message: "No se pudo comprobar el estado del vídeo." }); }
    finally { setChecking(null); }
  }
  // Enlaces pegados: se reconocen sin gastar una búsqueda
  const pasted = /youtu\.?be|youtube\.com/i.test(q) ? q.trim() : null;

  return (
    <div>
      <label className="flex items-center gap-2 rounded-2xl border hairline bg-white px-4 py-3 focus-within:shadow-[var(--ring)]"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar en YouTube</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca un tema, un canal, un artista o un evento…" className="w-full bg-transparent outline-none" autoComplete="off" /></label>
      <div role="group" aria-label="Filtrar resultados" className="mt-2 flex flex-wrap gap-1.5">{FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className="chip">{l}</button>)}</div>

      {pasted && <button type="button" onClick={() => choose({ id: pasted } as YtItem)} className="mt-3 w-full rounded-xl border hairline bg-white p-3 text-left text-sm hover:bg-[var(--hover)]"><b>Usar este enlace</b><span className="block truncate text-[var(--muted)]">{pasted}</span></button>}
      <div aria-live="polite" className="mt-3 min-h-6">
        {loading && <ul aria-label="Buscando" className="space-y-2">{[0, 1, 2].map((i) => <li key={i} className="skeleton h-[72px]" />)}</ul>}
        {err && !loading && <div role="alert" className="rounded-xl border hairline bg-white p-3 text-sm"><b>{err.kind === "quota" ? "Cuota de YouTube agotada" : err.kind === "not_configured" ? "Búsqueda aún no disponible" : err.kind === "rate" ? "Demasiadas búsquedas" : err.kind === "network" ? "Sin conexión" : "YouTube no responde"}</b><p className="mt-0.5 text-[var(--muted)]">{err.message}</p>{["service", "network"].includes(err.kind) && <button type="button" onClick={() => run(q.trim(), filter)} className="btn btn-ghost mt-2 !py-1 !text-xs">Reintentar</button>}</div>}
        {!loading && !err && items && !items.length && <p className="rounded-xl border border-dashed hairline p-4 text-center text-sm text-[var(--muted)]">Sin resultados para «{q.trim()}»{filter !== "all" ? ` en «${FILTERS.find((x) => x[0] === filter)?.[1]}»` : ""}. Prueba con otras palabras o cambia el filtro.</p>}
        {!loading && !!items?.length && (
          <ul className="space-y-2">{items.map((it) => (
            <li key={it.id}><button type="button" onClick={() => choose(it)} disabled={checking === it.id} className="flex w-full items-center gap-3 rounded-xl border hairline bg-white p-2 text-left hover:bg-[var(--hover)] focus-visible:shadow-[var(--ring)] disabled:opacity-60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-[#151515]"><img src={it.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />{typeof it.durationSec === "number" && <span className="mono absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] text-white">{mmss(it.durationSec)}</span>}</span>
              <span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm font-medium">{it.title}</span><span className="block truncate text-xs text-[var(--muted)]">{it.channel}{it.status === "upcoming" && it.scheduledAt ? ` · ${when(it.scheduledAt)}` : it.wasLive ? " · grabación de un directo" : ""}</span></span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${it.status === "live" ? "bg-[var(--ink)] text-white" : "border hairline"}`}>{checking === it.id ? "Comprobando…" : it.status === "live" ? "En directo" : it.status === "upcoming" ? "Próximo" : "Vídeo"}</span>
            </button></li>))}</ul>)}
        {!loading && next && <div className="mt-3 text-center"><button type="button" onClick={() => run(q.trim(), filter, next)} disabled={more} className="btn btn-ghost">{more ? "Cargando…" : "Cargar más"}</button></div>}
      </div>
    </div>
  );
}
