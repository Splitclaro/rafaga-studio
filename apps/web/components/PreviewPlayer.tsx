"use client";
// Vista previa y pantalla completa de un clip. NO renderiza ningún MP4: reproduce la copia ligera (proxy) y dibuja encima con `sceneAt`,
// el mismo motor de cajas que usa la exportación (diseño, encuadre, titular y subtítulos). Las zonas seguras solo se dibujan aquí.
import { useCallback, useEffect, useRef, useState } from "react";
import { sceneAt, mapTime, unmapTime, RATIO_SIZE, PRESET_IMPACTO, PLATFORM_LABEL, type CompositionV2, type Platform, type Word } from "@rafaga/composition";

export interface PClip {
  id: string; title: string; overall: number | null; reason: string | null; reasons?: Record<string, string>;
  comp: CompositionV2 | null; startS: number; endS: number; warnings?: string[];
}
const PLATFORMS: Platform[] = ["tiktok", "instagram_reels", "youtube_shorts"];

export default function PreviewPlayer({ clips, index, onIndex, onClose, proxyUrl, src, words, onEdit, onExport, fullscreen = false }: {
  clips: PClip[]; index: number; onIndex: (i: number) => void; onClose?: () => void; proxyUrl: string | null; src: { w: number; h: number };
  words: Word[]; onEdit: (id: string) => void; onExport: (id: string) => void; fullscreen?: boolean;
}) {
  const clip = clips[index];
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false), [zones, setZones] = useState<Platform[]>([]), [t, setT] = useState(0);
  const comp = clip?.comp ?? null;
  const dur = comp ? comp.duration : 0;
  const clipWords = useCallback(() => words.filter((w) => w.start >= clip.startS && w.end <= clip.endS + 0.05).map((w) => ({ ...w, start: w.start - clip.startS, end: w.end - clip.startS })), [words, clip]);

  const draw = useCallback((tOut: number) => {
    const cv = canvas.current, v = video.current; if (!cv || !comp) return;
    const { width: W, height: H } = RATIO_SIZE[comp.aspect], k = cv.width / W, ctx = cv.getContext("2d")!;
    const scene = sceneAt(comp, tOut, src.w, src.h, { words: clipWords(), style: PRESET_IMPACTO, safeZones: zones });
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
    const ready = v && v.readyState >= 2 && v.videoWidth > 0;
    const cover = (box: { x: number; y: number; w: number; h: number }, fx: number) => {
      const s = Math.max(box.w / v!.videoWidth, box.h / v!.videoHeight), sw = box.w / s, sh = box.h / s;
      ctx.drawImage(v!, (v!.videoWidth - sw) * fx, (v!.videoHeight - sh) / 2, sw, sh, box.x * k, box.y * k, box.w * k, box.h * k);
    };
    if (ready) {
      if (scene.plan.background === "blur") { ctx.save(); ctx.filter = "blur(22px) brightness(0.8)"; cover({ x: -40, y: -40, w: W + 80, h: H + 80 }, 0.5); ctx.restore(); }
      if (scene.cropX != null) cover(scene.plan.video, scene.cropX);
      else if (comp.layout === "fit_full") ctx.drawImage(v!, scene.plan.video.x * k, scene.plan.video.y * k, scene.plan.video.w * k, scene.plan.video.h * k);
      else cover(scene.plan.video, 0.5);
      if (scene.plan.secondary) cover(scene.plan.secondary, 0.8);
    }
    // titular
    if (scene.headline) {
      const b = scene.headline.box, size = Math.max(10, Math.min(b.h / scene.headline.lines.length * 0.78, (b.w * 0.94) / (Math.max(...scene.headline.lines.map((l) => l.length)) * 0.7)) * k);
      ctx.font = `800 ${size}px Inter, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = size / 8; ctx.strokeStyle = "rgba(0,0,0,.7)";
      scene.headline.lines.forEach((l, i) => { const y = (b.y + b.h / 2) * k + (i - (scene.headline!.lines.length - 1) / 2) * size * 1.15; ctx.strokeText(l, (b.x + b.w / 2) * k, y); ctx.fillStyle = i === 1 && scene.headline!.accent ? scene.headline!.accent : "#fff"; ctx.fillText(l, (b.x + b.w / 2) * k, y); });
    }
    // subtítulos (grupo y palabra activa)
    if (scene.subtitle && scene.plan.subtitles) {
      const b = scene.plan.subtitles, size = PRESET_IMPACTO.fontSize * (comp.aspect === "9:16" ? 0.55 : 0.5) * k;
      ctx.font = `800 ${size}px Inter, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = size / 6; ctx.strokeStyle = "#000";
      let wi = 0;
      scene.subtitle.lines.forEach((line, li) => {
        const y = (b.y + b.h / 2) * k + (li - (scene.subtitle!.lines.length - 1) / 2) * size * 1.2, parts = line.split(" "), total = ctx.measureText(line).width;
        let x = (b.x + b.w / 2) * k - total / 2; ctx.textAlign = "left";
        parts.forEach((p) => { const w = ctx.measureText(p + " ").width; ctx.strokeText(p, x, y); ctx.fillStyle = wi === scene.subtitle!.active ? PRESET_IMPACTO.active : "#fff"; ctx.fillText(p, x, y); x += w; wi++; });
      });
    }
    // zonas seguras: solo vista previa
    for (const o of scene.overlays) { ctx.fillStyle = "rgba(255,40,40,.28)"; ctx.fillRect(o.rect.x * k, o.rect.y * k, o.rect.w * k, o.rect.h * k); }
  }, [comp, src, zones, clipWords]);

  // Bucle de reproducción: tiempo del clip ↔ tiempo del proxy (saltando los cortes).
  useEffect(() => {
    const v = video.current; if (!v || !comp || !proxyUrl) return;
    let raf = 0; const f0 = comp.fragments[0]?.start ?? clip.startS;
    const tick = () => {
      let rel = v.currentTime - f0;
      const cut = comp.cuts?.find((c) => rel >= c.s && rel < c.e); if (cut && playing) { v.currentTime = f0 + cut.e; rel = cut.e; }
      const tOut = mapTime(Math.max(0, rel), comp.cuts);
      if (tOut >= dur - 0.02 && playing) { v.currentTime = f0 + unmapTime(0, comp.cuts); }
      setT(tOut); draw(tOut); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [comp, proxyUrl, playing, draw, dur, clip]);

  useEffect(() => { const v = video.current; if (v && comp) { v.currentTime = (comp.fragments[0]?.start ?? clip.startS); setPlaying(false); v.pause(); } }, [clip?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); } }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < clips.length - 1) onIndex(index + 1);
      else if (e.key === " ") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", key); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [fullscreen, index, clips.length, onClose, onIndex, toggle]);

  if (!clip) return null;
  const aspect = comp ? RATIO_SIZE[comp.aspect] : { width: 1080, height: 1920 }, ratio = aspect.width / aspect.height;
  const panel = (
    <div className={`flex min-w-0 flex-col gap-3 ${fullscreen ? "w-[320px] shrink-0 overflow-y-auto p-5 text-white" : ""}`}>
      <div><h2 className="text-lg font-semibold leading-tight">{clip.title}</h2>
        <p className="mt-1 text-sm opacity-80">{clip.overall != null ? `Encaje estimado ${clip.overall}/100 · ` : ""}{Math.round(dur)} s · {index + 1} de {clips.length}</p></div>
      {clip.reason && <p className="text-sm opacity-90">{clip.reason}</p>}
      {clip.reasons && <ul className="space-y-1 text-xs opacity-80">{Object.values(clip.reasons).map((r) => <li key={r}>{r}</li>)}</ul>}
      {clip.warnings?.length ? <p className="rounded-lg bg-yellow-500/20 p-2 text-xs">{clip.warnings.join(" · ")}</p> : null}
      <fieldset className="text-xs"><legend className="mb-1 opacity-80">Zonas seguras (solo vista previa)</legend>
        <div className="flex flex-wrap gap-2">{PLATFORMS.map((p) => <label key={p} className="flex items-center gap-1"><input type="checkbox" checked={zones.includes(p)} onChange={(e) => setZones((z) => (e.target.checked ? [...z, p] : z.filter((x) => x !== p)))} />{PLATFORM_LABEL[p]}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !py-1.5 !text-xs" onClick={() => onEdit(clip.id)}>Editar</button>
        <button type="button" className="btn btn-ghost !py-1.5 !text-xs" onClick={() => onExport(clip.id)}>Exportar</button>
        {!fullscreen && <span className="self-center text-xs opacity-60">Pulsa el vídeo para verlo en pantalla completa</span>}
      </div>
    </div>
  );
  const stage = (
    <div className="relative mx-auto" style={fullscreen ? { height: "calc(100vh - 32px)", aspectRatio: String(ratio) } : { width: "100%", maxWidth: 270, aspectRatio: String(ratio) }}>
      <video ref={video} src={proxyUrl ?? undefined} className="hidden" playsInline preload="auto" crossOrigin="anonymous" />
      <canvas ref={canvas} width={540} height={Math.round(540 / ratio)} className="h-full w-full rounded-xl bg-black" onClick={fullscreen ? toggle : undefined} aria-label={`Vista previa de ${clip.title}`} />
      {!proxyUrl && <p className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/80">La copia ligera todavía no está lista.</p>}
      <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2 text-white">
        <button type="button" className="rounded-full bg-black/60 px-3 py-1 text-xs" onClick={toggle} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? "❚❚" : "▶"}</button>
        <span className="rounded-full bg-black/60 px-2 py-1 text-xs tnum">{t.toFixed(1)} / {dur.toFixed(1)} s</span>
      </div>
    </div>
  );
  if (!fullscreen) return <div className="flex flex-col gap-3 lg:flex-row">{stage}{panel}</div>;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Pantalla completa: ${clip.title}`} className="fixed inset-0 z-50 flex items-center justify-center gap-6 bg-black p-4">
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-sm text-white" onClick={onClose} aria-label="Cerrar (Esc)">Esc ✕</button>
      <button type="button" className="absolute left-4 top-1/2 rounded-full bg-white/15 px-3 py-2 text-white disabled:opacity-30" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Anterior (←)">‹</button>
      {stage}{panel}
      <button type="button" className="absolute right-4 top-1/2 rounded-full bg-white/15 px-3 py-2 text-white disabled:opacity-30" disabled={index >= clips.length - 1} onClick={() => onIndex(index + 1)} aria-label="Siguiente (→)">›</button>
    </div>
  );
}
