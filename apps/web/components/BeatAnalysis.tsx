"use client";
import { useEffect, useState } from "react";
import { detectBeats, beatsReliable, type BeatResult } from "@rafaga/lyrics";

/** Analiza el ritmo del tramo en el navegador (misma función que usa el worker) y dice con honestidad si hay pulso claro. */
export default function BeatAnalysis({ audioUrl, start, end, enabled, intensity }: { audioUrl: string; start: number; end: number; enabled: boolean; intensity: "soft" | "medium" | "dynamic" }) {
  const [r, setR] = useState<BeatResult | null | "busy" | "error">(null);
  useEffect(() => {
    if (!enabled || !audioUrl) { setR(null); return; }
    let off = false; setR("busy");
    const t = setTimeout(async () => {
      try {
        const buf = await (await fetch(audioUrl)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new Ctx(); const dec = await ac.decodeAudioData(buf); await ac.close();
        const from = Math.max(0, start), to = Math.min(dec.duration, end > from ? end : dec.duration);
        const sr = 22050, n = Math.max(1, Math.floor((to - from) * sr));
        const oc = new OfflineAudioContext(1, n, sr); const src = oc.createBufferSource(); src.buffer = dec; src.connect(oc.destination); src.start(0, from, to - from);
        const out = await oc.startRendering();
        if (!off) setR(detectBeats(out.getChannelData(0), sr));
      } catch { if (!off) setR("error"); }
    }, 400);
    return () => { off = true; clearTimeout(t); };
  }, [audioUrl, start, end, enabled]);
  if (!enabled) return null;
  const target = { soft: 3.2, medium: 2.0, dynamic: 1.1 }[intensity];
  return (
    <p role="status" aria-live="polite" className="rounded-xl bg-white px-3 py-2 text-xs sm:col-span-2">
      {r === "busy" || r === null ? "Analizando el ritmo del tramo…" : r === "error" ? "No se pudo analizar el ritmo en el navegador. El worker lo intentará al generar y, si no hay pulso claro, usará una cadencia estable." :
        beatsReliable(r) ? <>Ritmo detectado: <strong>{Math.round(r.bpm)} BPM</strong> · confianza {r.confidence >= 0.75 ? "alta" : "media"}. Los cortes caerán en los beats.</>
          : <>No se detecta un pulso claro (confianza {Math.round(r.confidence * 100)} %). Se usará una <strong>cadencia estable de {target.toFixed(1)} s</strong> y se indicará en el resultado; no se presentará como «al ritmo».</>}
    </p>
  );
}
