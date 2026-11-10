"use client";
import { useEffect, useMemo, useRef } from "react";
import { layoutLyrics, frameState, canvasSize, LOOK_FONT, type LyricLook, type TimedWord } from "@rafaga/lyrics";

export type PreviewMedia = { url: string; kind: "video" | "photo" } | null;

/** Muestra de letra con tiempos conocidos para las tarjetas (no es la canción del usuario). */
export function sampleWords(text = "todavía te busco en la ciudad y no sé volver"): TimedWord[] {
  const ws = text.split(/\s+/).filter(Boolean);
  let t = 0.3; const out: TimedWord[] = [];
  ws.forEach((w, i) => { const d = 0.28 + Math.min(0.5, w.length * 0.06); out.push({ text: w, start: +t.toFixed(2), end: +(t + d).toFixed(2), line: Math.floor(i / 3), confidence: 1, origin: "asr" }); t += d + (i % 3 === 2 ? 0.7 : 0.08); });
  return out;
}

/**
 * Vista previa con el MISMO layout que el export (posiciones, saltos, tiempos al frame).
 * El tratamiento de imagen (grano, aberración) se aproxima con filtros del navegador y se indica como aproximado.
 */
export default function LookPreview({ look, ratio, words, len, media, time, className = "", label }: {
  look: LyricLook; ratio: string; words: TimedWord[]; len: number; media?: PreviewMedia; time?: number; className?: string; label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mediaEl = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const { W, H } = canvasSize(ratio, 720);
  const L = useMemo(() => layoutLyrics(words, look, W, H, len), [words, look, W, H, len]);

  useEffect(() => {
    mediaEl.current = null;
    if (!media) return;
    if (media.kind === "photo") { const im = new Image(); im.crossOrigin = "anonymous"; im.src = media.url; mediaEl.current = im; return; }
    const v = document.createElement("video"); v.src = media.url; v.muted = true; v.loop = true; v.playsInline = true; v.crossOrigin = "anonymous"; v.play().catch(() => {}); mediaEl.current = v;
    return () => { v.pause(); v.removeAttribute("src"); v.load(); };
  }, [media]);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext("2d"); if (!g) return;
    let raf = 0; const t0 = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = () => {
      const t = time ?? (reduce ? Math.min(len, 2.2) : ((performance.now() - t0) / 1000) % Math.max(1, len));
      const r = L.image, tr = look.treatment;
      g.fillStyle = look.canvas.bg; g.fillRect(0, 0, W, H);
      g.save();
      g.filter = `saturate(${(1 - tr.desaturate * 0.75).toFixed(2)}) brightness(${(1 + tr.brightness).toFixed(2)}) blur(${(tr.soften * 2.2 * (W / 1080)).toFixed(2)}px)`;
      const m = mediaEl.current;
      const ready = m && (m instanceof HTMLImageElement ? m.complete && m.naturalWidth > 0 : m.readyState >= 2);
      if (ready && m) {
        const sw = m instanceof HTMLImageElement ? m.naturalWidth : m.videoWidth, shh = m instanceof HTMLImageElement ? m.naturalHeight : m.videoHeight;
        const z = look.image.zoom, s = Math.max(r.w / sw, r.h / shh) * z;
        const cw = r.w / s, ch = r.h / s;
        const sx = (sw - cw) / 2 * (1 + look.image.offsetX), sy = (shh - ch) / 2 * (1 + look.image.offsetY);
        g.drawImage(m, sx, sy, cw, ch, r.x, r.y, r.w, r.h);
      } else {
        const grd = g.createLinearGradient(0, r.y, 0, r.y + r.h);
        grd.addColorStop(0, "#5d7486"); grd.addColorStop(0.6, "#8f8d86"); grd.addColorStop(1, "#2b2b2e");
        g.fillStyle = grd; g.fillRect(r.x, r.y, r.w, r.h);
      }
      g.restore();
      if (tr.vignette > 0) { const vg = g.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.3, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(0,0,0,${(tr.vignette * 0.55).toFixed(2)})`); g.fillStyle = vg; g.fillRect(r.x, r.y, r.w, r.h); }
      // Letra: mismas posiciones y tiempos que el ASS del export
      g.font = `${L.weight} ${L.em}px ${LOOK_FONT.css}`; g.textBaseline = "alphabetic";
      g.letterSpacing = `${(L.tracking * L.em).toFixed(2)}px`;
      for (const { word, alpha } of frameState(L, t)) {
        g.globalAlpha = alpha;
        if (L.shadow > 0) { const d = Math.max(1, Math.round(L.em * 0.04 * L.shadow * 2)); g.fillStyle = "rgba(0,0,0,0.4)"; g.fillText(word.text, word.x + d, word.y + d + L.em * LOOK_FONT.ascent / 2048); }
        g.fillStyle = L.color; g.fillText(word.text, word.x, word.y + L.em * LOOK_FONT.ascent / 2048);
      }
      g.globalAlpha = 1;
      if (time == null && !reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [L, look, W, H, len, time]);

  return <canvas ref={ref} width={W} height={H} role="img" aria-label={label ?? `Vista previa: ${look.name}`} className={`block h-auto w-full bg-black ${className}`} />;
}
