"use client";
// Vista previa de letra: dibuja con `lyricSceneAt` (el mismo motor que la exportación). Espera a la fuente antes de maquetar,
// arrastre y teclado para la posición, recorte, bucle, «Otra variante», zonas seguras (solo 9:16) y pantalla completa (Esc la cierra).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lyricSceneAt, lyricLayout, lyricTimeline, lyricFrameSize, fontFor, SAFE_ZONES, type LyricComposition } from "@rafaga/composition";
import { pointerToPosition, keyNudge, loopTime, nextVariantSeed, clampCrop } from "../lib/lyricpreview";

export default function LyricPreview({ composition, onChange }: { composition: LyricComposition; onChange: (c: LyricComposition) => void }) {
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null), t0 = useRef(0), raf = useRef(0);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(true), [loop, setLoop] = useState(true), [safe, setSafe] = useState(false), [full, setFull] = useState(false);
  const c = composition, frame = lyricFrameSize(c), f = fontFor(c.style.font, c.style.weight);
  // La fuente se carga ANTES de maquetar: si no, las medidas del diseño no coincidirían con lo dibujado.
  useEffect(() => { setReady(false); let live = true; void document.fonts.load(`${c.style.weight} 40px '${c.style.font}'`).catch(() => undefined).finally(() => live && setReady(true)); return () => { live = false; }; }, [c.style.font, c.style.weight]);
  const L = useMemo(() => lyricLayout(c), [c]), TL = useMemo(() => lyricTimeline(c, L), [c, L]);
  const draw = useCallback((t: number) => {
    const ctx = cv.current?.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = c.background.color; ctx.fillRect(0, 0, frame.width, frame.height);
    if (c.settings.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${c.settings.dim})`; ctx.fillRect(0, 0, frame.width, frame.height); }
    const s = lyricSceneAt(c, t, L, TL);
    for (const w of s.words) {
      ctx.save(); ctx.globalAlpha = w.alpha; ctx.font = `${c.style.italic ? "italic " : ""}${c.style.weight} ${L.em}px '${L.family}'`; (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(c.style.tracking ?? 0) * L.em}px`; ctx.textBaseline = "top";
      const cx = w.box.x + w.box.w / 2 + w.dx, cy = w.box.y + w.dy; ctx.translate(cx, cy + w.box.h / 2); ctx.scale(w.scale, w.scale); ctx.translate(-cx, -(cy + w.box.h / 2));
      if (c.style.effect === "shadow") { ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 6; } else if (c.style.effect === "glow") { ctx.shadowColor = c.style.activeColor; ctx.shadowBlur = 16; }
      ctx.fillStyle = w.active && (c.style.active === "color" || c.style.active === "underline") ? c.style.activeColor : c.style.color;
      const text = w.text; if (c.style.effect === "stroke") { ctx.lineWidth = Math.max(2, L.em * 0.08); ctx.strokeStyle = "#000"; ctx.strokeText(text, w.box.x + w.dx, w.box.y + w.dy); }
      ctx.fillText(text, w.box.x + w.dx, w.box.y + w.dy);
      if (w.active && c.style.active === "underline") ctx.fillRect(w.box.x + w.dx, w.box.y + w.dy + w.box.h - 4, w.box.w, 4);
      ctx.restore();
    }
    if (s.hook) { ctx.font = `700 ${L.em}px Inter`; ctx.fillStyle = "#fff"; ctx.textBaseline = "top"; ctx.fillText(s.hook, 40, 40); }
    if (safe && c.aspect === "9:16") { ctx.fillStyle = "rgba(255,0,0,.18)"; for (const z of SAFE_ZONES.tiktok.unsafe) ctx.fillRect(z.rect.x * frame.width, z.rect.y * frame.height, z.rect.w * frame.width, z.rect.h * frame.height); }
  }, [c, L, TL, frame.width, frame.height, safe]);
  useEffect(() => {
    if (!ready) return; let last = performance.now(), t = t0.current;
    const tick = (now: number) => { if (playing) t = loopTime(t + (now - last) / 1000, c.duration, loop); last = now; t0.current = t; draw(t); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf.current);
  }, [ready, playing, loop, draw, c.duration]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const setPos = (p: { x: number; y: number }) => onChange({ ...c, style: { ...c.style, position: p } });
  const move = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); setPos(pointerToPosition(((e.clientX - r.left) / r.width) * frame.width, ((e.clientY - r.top) / r.height) * frame.height, frame)); };
  const reset = () => { t0.current = 0; };
  void f;
  return (
    <div ref={box} className={full ? "fixed inset-0 z-50 flex flex-col items-center justify-center bg-black p-4" : "space-y-2"} role={full ? "dialog" : undefined} aria-label="Vista previa de la letra">
      <canvas ref={cv} width={frame.width} height={frame.height} tabIndex={0} aria-label="Letra: arrastra o usa las flechas para moverla" className="max-h-[70vh] w-auto max-w-full touch-none rounded-lg bg-black"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => { if (e.buttons) move(e); }}
        onKeyDown={(e) => { if (e.key.startsWith("Arrow")) { e.preventDefault(); setPos(keyNudge(c.style.position, e.key, e.shiftKey)); } }} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button className="btn btn-ghost !min-h-8" onClick={() => setPlaying(!playing)}>{playing ? "Pausar" : "Reproducir"}</button>
        <button className="btn btn-ghost !min-h-8" onClick={reset}>Reiniciar</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />Bucle</label>
        <button className="btn btn-ghost !min-h-8" onClick={() => { reset(); onChange({ ...c, seed: nextVariantSeed(c.seed) }); }}>Otra variante</button>
        {c.aspect === "9:16" && <label className="flex items-center gap-1"><input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />Zonas seguras</label>}
        <label className="flex items-center gap-1">Recorte<input type="range" min={0} max={1} step={0.01} value={c.settings.crop} onChange={(e) => onChange({ ...c, settings: { ...c.settings, crop: clampCrop(Number(e.target.value)) } })} /></label>
        <button className="btn btn-ghost !min-h-8" onClick={() => setFull(!full)}>{full ? "Salir (Esc)" : "Pantalla completa"}</button>
      </div>
    </div>
  );
}
