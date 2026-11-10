"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { clampEdge, MIN_CLIP_SEC, MAX_CLIP_SEC, type BrollItem, type Word } from "@rafaga/composition";

const FRAMES = 14;
const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}.${String(Math.floor((x % 1) * 10))}`;

/**
 * Línea de tiempo del clip sobre la fuente: miniaturas reales, dos asas de recorte (inicio y fin) y cabezal.
 * El rango visible se fija al abrir (clip ± margen) para que las miniaturas no cambien mientras se arrastra.
 * Con `tracks` muestra además palabras y B-roll en su posición.
 */
export default function Timeline({ src, srcDuration, start, end, t, words, broll, tracks, onTrim, onSeek, onSelectWord }: {
  src: string; srcDuration: number; start: number; end: number; t: number; words: Word[]; broll: BrollItem[]; tracks: boolean;
  onTrim: (start: number, end: number) => void; onSeek: (rel: number) => void; onSelectWord?: (i: number) => void;
}) {
  const win = useRef<{ a: number; b: number } | null>(null);
  if (!win.current && srcDuration > 0) {
    const len = end - start, pad = Math.max(8, len * 0.5);
    win.current = { a: Math.max(0, start - pad), b: Math.min(srcDuration, end + pad) };
  }
  const W = win.current;
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ edge: "start" | "end"; v: number } | null>(null);
  const cvs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [done, setDone] = useState(0);

  // Miniaturas: un vídeo auxiliar que salta a cada posición y la dibuja
  useEffect(() => {
    if (!src || !W) return;
    let dead = false; setDone(0);
    const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = src;
    const once = (ev: string, ms = 5000) => new Promise<void>((res) => { const to = setTimeout(res, ms); v.addEventListener(ev, () => { clearTimeout(to); res(); }, { once: true }); });
    (async () => {
      await once("loadedmetadata");
      for (let i = 0; i < FRAMES && !dead; i++) {
        const at = W.a + ((i + 0.5) * (W.b - W.a)) / FRAMES;
        const s = once("seeked"); v.currentTime = at; await s;
        const c = cvs.current[i]; if (c && v.videoWidth) { const h = c.height, w = Math.round((v.videoWidth / v.videoHeight) * h); c.width = 160; const x = c.getContext("2d"); x?.drawImage(v, (160 - w) / 2, 0, w, h); }
        if (!dead) setDone(i + 1);
      }
    })();
    return () => { dead = true; v.removeAttribute("src"); v.load(); };
  }, [src, W?.a, W?.b]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = W ? W.b - W.a : 1;
  const pct = (sec: number) => `${Math.max(0, Math.min(100, ((sec - (W?.a ?? 0)) / span) * 100))}%`;
  const s = drag?.edge === "start" ? drag.v : start, e = drag?.edge === "end" ? drag.v : end;
  const toSec = (clientX: number) => { const r = box.current!.getBoundingClientRect(); return (W?.a ?? 0) + ((clientX - r.left) / r.width) * span; };
  const begin = (edge: "start" | "end") => (ev: React.PointerEvent) => {
    if (!W) return; ev.preventDefault(); (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    const move = (p: PointerEvent) => setDrag({ edge, v: clampEdge(edge, Math.min(W.b, Math.max(W.a, toSec(p.clientX))), start, end, srcDuration) });
    const up = (p: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const v = clampEdge(edge, Math.min(W.b, Math.max(W.a, toSec(p.clientX))), start, end, srcDuration);
      setDrag(null); if (Math.abs(v - (edge === "start" ? start : end)) >= 0.02) onTrim(edge === "start" ? v : start, edge === "end" ? v : end);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const key = (edge: "start" | "end") => (ev: React.KeyboardEvent) => {
    const d = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0; if (!d) return; ev.preventDefault();
    const step = ev.shiftKey ? 1 : 0.1; const cur = edge === "start" ? start : end;
    const v = clampEdge(edge, cur + d * step, start, end, srcDuration);
    if (v !== cur) onTrim(edge === "start" ? v : start, edge === "end" ? v : end);
  };
  const lenNow = e - s;
  const dens = useMemo(() => words.map((w, i) => ({ i, a: start + w.start, b: start + w.end })), [words, start]);

  if (!W) return <div className="skeleton h-20 w-full max-w-[860px]" aria-label="Cargando línea de tiempo" />;
  return (
    <div className="w-full max-w-[860px]" aria-label="Recorte del clip">
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]"><span className="tnum">Inicio {clock(s)} · Fin {clock(e)}</span><span className="tnum">{lenNow.toFixed(1)} s (mín. {MIN_CLIP_SEC}, máx. {MAX_CLIP_SEC})</span></div>
      <div ref={box} className="relative h-14 select-none overflow-hidden rounded-xl bg-[#151515]">
        <div className="absolute inset-0 flex">{Array.from({ length: FRAMES }, (_, i) => <canvas key={i} ref={(c) => { cvs.current[i] = c; }} width={160} height={56} className="h-full flex-1 bg-[#222] object-cover" style={{ opacity: done > i ? 1 : 0.35 }} />)}</div>
        <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(s) }} />
        <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(e) }} />
        <div className="absolute inset-y-0 border-y-2 border-white" style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} onClick={(ev) => onSeek(Math.max(0, Math.min(lenNow, toSec(ev.clientX) - s)))} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(start + t) }} aria-hidden />
        {(["start", "end"] as const).map((edge) => (
          <div key={edge} role="slider" tabIndex={0} aria-label={edge === "start" ? "Inicio del clip" : "Fin del clip"} aria-valuemin={W.a} aria-valuemax={W.b} aria-valuenow={edge === "start" ? s : e} aria-valuetext={clock(edge === "start" ? s : e)}
            onPointerDown={begin(edge)} onKeyDown={key(edge)} className="absolute inset-y-0 z-10 w-3 cursor-col-resize touch-none rounded-sm bg-white outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111]" style={{ left: `calc(${pct(edge === "start" ? s : e)} - ${edge === "start" ? 0 : 12}px)` }}><span className="mx-auto mt-5 block h-4 w-0.5 rounded bg-[var(--ink)]" /></div>))}
      </div>
      {tracks && (
        <div className="mt-1 space-y-1" aria-label="Pistas">
          <div className="relative h-5 rounded bg-[var(--hover)]" title="Palabras">{dens.filter((d) => d.b > W.a && d.a < W.b).map((d) => <button key={d.i} onClick={() => { onSeek(Math.max(0, d.a - start)); onSelectWord?.(d.i); }} aria-label={`Palabra ${d.i + 1}`} className="absolute top-0.5 h-4 rounded-sm bg-[var(--ink)]/70 hover:bg-[var(--ink)]" style={{ left: pct(d.a), width: `max(2px, calc(${pct(d.b)} - ${pct(d.a)}))` }} />)}</div>
          <div className="relative h-5 rounded bg-[var(--hover)]" title="B-roll">{broll.map((b, i) => <span key={i} className="absolute top-0.5 h-4 rounded-sm border border-[var(--ink)] bg-white" style={{ left: pct(start + b.start), width: `max(3px, calc(${pct(start + b.start + b.dur)} - ${pct(start + b.start)}))` }} title={b.name ?? "B-roll"} />)}</div>
        </div>)}
    </div>
  );
}
