"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { peaks, rmsEnvelope, topMoments, repeatedLineSpans, type Moment } from "@rafaga/lyrics";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const MIN = 3;

/** Selector del tramo de la canción: forma de onda con asas arrastrables + 3 mejores momentos. */
export default function RangePicker({ songId, audioUrl, start, end, onChange }: { songId: string; audioUrl: string; start: number; end: number; onChange: (s: number, e: number) => void }) {
  const [duration, setDuration] = useState(0);
  const [wave, setWave] = useState<number[] | null>(null);
  const [env, setEnv] = useState<number[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [moments, setMoments] = useState<Moment[]>([]);
  const [len, setLen] = useState(30);
  const [busyMoments, setBusyMoments] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<"s" | "e" | "m" | null>(null);
  const grab = useRef(0);
  const e0 = end > 0 ? end : duration;

  // Decodifica el audio una vez por canción: forma de onda + envolvente RMS (sin subirlo a ningún servicio)
  useEffect(() => {
    setWave(null); setEnv(null); setMoments([]); setState("loading");
    let dead = false;
    (async () => {
      try {
        const buf = await (await fetch(audioUrl)).arrayBuffer();
        const ctx = new AudioContext();
        const dec = await ctx.decodeAudioData(buf);
        const mono = new Float32Array(dec.length);
        for (let c = 0; c < dec.numberOfChannels; c++) { const d = dec.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / dec.numberOfChannels; }
        if (dead) return;
        setDuration(dec.duration); setWave(peaks(mono, 900)); setEnv(rmsEnvelope(mono, dec.sampleRate, 0.5)); setState("idle");
        ctx.close();
      } catch { if (!dead) setState("error"); }
    })();
    return () => { dead = true; };
  }, [audioUrl]);

  const draw = useCallback(() => {
    const c = canvas.current; if (!c || !wave || !duration) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const s = (start / duration) * w, e = (e0 / duration) * w;
    g.fillStyle = "#FAFAFA"; g.fillRect(0, 0, w, h);
    const bw = w / wave.length;
    wave.forEach((p, i) => { const x = i * bw, inside = x + bw >= s && x <= e; const bh = Math.max(2, p * h * 0.9); g.fillStyle = inside ? "#111" : "#C9C9C9"; g.fillRect(x, (h - bh) / 2, Math.max(1, bw - 0.6), bh); });
    g.fillStyle = "rgba(17,17,17,.06)"; g.fillRect(s, 0, e - s, h);
    for (const x of [s, e]) { g.fillStyle = "#111"; g.fillRect(x - 1.5, 0, 3, h); g.beginPath(); g.roundRect(x - 6, h / 2 - 14, 12, 28, 4); g.fill(); g.fillStyle = "#fff"; g.fillRect(x - 1, h / 2 - 6, 2, 12); }
    const t = audio.current?.currentTime ?? 0; if (playing) { g.fillStyle = "#111"; g.fillRect((t / duration) * w - 1, 0, 2, h); }
  }, [wave, duration, start, e0, playing]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const r = () => draw(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [draw]);
  useEffect(() => { if (!playing) return; const i = setInterval(() => { draw(); const a = audio.current; if (a && a.currentTime >= e0) { a.pause(); setPlaying(false); } }, 80); return () => clearInterval(i); }, [playing, draw, e0]);

  const set = (s: number, e: number) => { s = Math.max(0, Math.min(s, duration - MIN)); e = Math.min(duration, Math.max(e, s + MIN)); onChange(+s.toFixed(1), +(e >= duration - 0.05 ? 0 : e).toFixed(1)); };
  const xToT = (ev: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return Math.max(0, Math.min(duration, ((ev.clientX - r.left) / r.width) * duration)); };
  const down = (ev: React.PointerEvent) => {
    if (!duration) return; const t = xToT(ev), px = (x: number) => Math.abs(x - t) / duration * (canvas.current?.clientWidth ?? 1);
    drag.current = px(start) < 14 ? "s" : px(e0) < 14 ? "e" : t > start && t < e0 ? "m" : (Math.abs(t - start) < Math.abs(t - e0) ? "s" : "e");
    grab.current = t - start; canvas.current?.setPointerCapture(ev.pointerId); move(ev);
  };
  const move = (ev: React.PointerEvent) => {
    if (!drag.current) return; const t = xToT(ev);
    if (drag.current === "s") set(Math.min(t, e0 - MIN), e0);
    else if (drag.current === "e") set(start, Math.max(t, start + MIN));
    else { const L = e0 - start; const s = Math.max(0, Math.min(duration - L, t - grab.current)); set(s, s + L); }
  };
  const up = (ev: React.PointerEvent) => { drag.current = null; canvas.current?.releasePointerCapture(ev.pointerId); };

  function play() {
    const a = audio.current; if (!a) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    a.currentTime = start; a.play(); setPlaying(true);
  }

  async function detect() {
    if (!env) return; setBusyMoments(true);
    let repeated: { start: number; end: number }[] = [];
    const { data } = await supabase.from("song_alignments").select("words").eq("song_id", songId).order("created_at", { ascending: false }).limit(1);
    if (data?.[0]) repeated = repeatedLineSpans(data[0].words as { text: string; start: number; end: number; line: number }[]);
    setMoments(topMoments(env, { len, k: 3, repeated, duration }));
    setBusyMoments(false);
  }

  const total = duration || 0;
  const presets = useMemo(() => [["Toda", 0, 0], ["30 s", start, Math.min(total, start + 30)], ["45 s", start, Math.min(total, start + 45)], ["60 s", start, Math.min(total, start + 60)]] as const, [start, total]);

  return (
    <div>
      <audio ref={audio} src={audioUrl} preload="metadata" onLoadedMetadata={(e) => !duration && setDuration(e.currentTarget.duration)} onEnded={() => setPlaying(false)} className="hidden" />
      <div className="relative">
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="h-28 w-full touch-none cursor-ew-resize rounded-xl border hairline" role="img" aria-label={`Forma de onda. Tramo de ${fmt(start)} a ${fmt(e0)}`} />
        {state === "loading" && <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/80 text-sm text-[var(--muted)]"><span className="pulse mr-2" aria-hidden />Analizando el audio…</div>}
        {state === "error" && <div role="alert" className="absolute inset-0 grid place-items-center rounded-xl bg-white/90 px-4 text-center text-sm">No se pudo analizar el audio en este navegador. Puedes escribir el tramo a mano abajo; la detección de momentos no estará disponible.</div>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <button type="button" onClick={play} disabled={!duration} className="btn btn-primary">{playing ? "Pausa" : "Escuchar tramo"}</button>
        <label>Desde (s)<input type="number" min={0} step={0.5} value={start} onChange={(e) => set(Number(e.target.value), e0)} className="input mono mt-1 w-24" /></label>
        <label>Hasta (s)<input type="number" min={0} step={0.5} value={end} onChange={(e) => set(start, Number(e.target.value) || duration)} className="input mono mt-1 w-24" /></label>
        <div className="mono ml-auto text-[var(--muted)]" aria-live="polite">{fmt(start)} – {fmt(e0)} · {(e0 - start).toFixed(1)} s{total ? ` de ${fmt(total)}` : ""}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Duración del tramo">
        {presets.map(([l, s, e]) => <button key={l} type="button" className="chip" onClick={() => (l === "Toda" ? onChange(0, 0) : set(s, e))}>{l}</button>)}
      </div>

      <div className="mt-5 rounded-2xl border hairline bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={detect} disabled={!env || busyMoments} className="btn btn-primary"><Icon n="wand" className="h-4 w-4" />Detectar los 3 mejores momentos</button>
          <label className="flex items-center gap-2 text-sm">Duración
            <select value={len} onChange={(e) => setLen(Number(e.target.value))} className="input !w-auto !py-1.5"><option value={15}>15 s</option><option value={30}>30 s</option><option value={45}>45 s</option><option value={60}>60 s</option></select></label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Estimación automática por energía del audio y repetición de versos. No es una garantía de rendimiento: tú decides cuál usar.</p>
        {!!moments.length && (
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {moments.map((m, i) => (
              <li key={i} className="card p-3 text-sm">
                <div className="flex items-baseline justify-between"><span className="font-medium">Momento {i + 1}</span><span className="mono text-xs text-[var(--muted)]">{m.score}/100</span></div>
                <div className="mono mt-1">{fmt(m.start)} – {fmt(m.end)}</div>
                <ul className="mt-1 list-disc pl-4 text-xs text-[var(--muted)]">{m.why.map((w) => <li key={w}>{w}</li>)}</ul>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => { const a = audio.current; if (a) { a.currentTime = m.start; a.play(); setPlaying(true); onChange(m.start, m.end); } }}>Escuchar</button>
                  <button type="button" className="btn btn-primary !px-3 !py-1.5 !text-xs" onClick={() => onChange(m.start, m.end)}>Usar este tramo</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
