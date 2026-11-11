"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeWordAt, groupWords, PRESET_IMPACTO, type Word } from "@rafaga/composition";

const OUT = { w: 1080, h: 1920 };

export default function SubtitleEditor({ initialWords, duration }: { initialWords: Word[]; duration: number }) {
  const [words, setWords] = useState<Word[]>(initialWords);
  const [style, setStyle] = useState({ ...PRESET_IMPACTO });
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(0.3);
  const stage = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  const groups = useMemo(() => groupWords(words, style), [words, style]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / OUT.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((p) => {
        const n = p + dt;
        if (n >= duration) { setPlaying(false); return duration; }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, duration]);

  // Misma función de palabra activa que usa el export (packages/composition).
  const cur = groups.find((g) => activeWordAt(g, t) >= 0);
  const activeIdx = cur ? activeWordAt(cur, t) : -1;
  let k = 0;

  const editWord = (i: number, text: string) =>
    setWords((ws) => ws.map((w, j) => (j === i ? { ...w, text } : w))); // conserva intervalo

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,360px)_280px]">
      <section aria-label="Transcripción" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Transcripción (clic para saltar)</h2>
        <ol className="max-h-[560px] space-y-2 overflow-auto">
          {words.map((w, i) => (
            <li key={i} className="flex items-center gap-2">
              <button className="tnum w-14 text-left text-xs text-[var(--muted)]" onClick={() => { setPlaying(false); setT(w.start); }}>{w.start.toFixed(2)}s</button>
              <input aria-label={`Palabra ${i + 1}`} className="w-full rounded bg-[var(--card)] ring-1 ring-[var(--border)] px-2 py-1" value={w.text} onChange={(e) => editWord(i, e.target.value)} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Preview" className="flex flex-col items-center gap-3">
        <div ref={stage} className="relative aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-xl bg-[#303640]" data-testid="stage">
          {cur && (
            <div
              className="absolute left-0 right-0 text-center font-bold leading-[1.15]"
              style={{ bottom: `${(1 - style.y) * OUT.h * scale}px`, fontSize: style.fontSize * scale, fontFamily: style.fontName, padding: `0 ${OUT.w * 0.06 * scale}px`, WebkitTextStroke: `${style.outlineWidth * scale * 2}px #101216`, paintOrder: "stroke fill", textTransform: style.uppercase ? "uppercase" : "none" }}
              data-testid="caption"
            >
              {cur.lines.map((line, li) => (
                <div key={li}>
                  {line.map((w) => {
                    const idx = k++;
                    return <span key={idx} data-active={idx === activeIdx} style={{ color: idx === activeIdx ? style.active : style.primary }}>{w.text}{" "}</span>;
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex w-full max-w-[360px] items-center gap-3">
          <button className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? "Pausa" : "Reproducir"}</button>
          <input aria-label="Posición" type="range" className="w-full" min={0} max={duration} step={1 / 30} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
          <span className="tnum w-14 text-right text-sm">{t.toFixed(2)}s</span>
        </div>
      </section>

      <section aria-label="Estilo" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <h2 className="mb-3 font-medium text-[var(--muted)]">Estilo · preset Impacto</h2>
        <label className="mb-3 block">Color activo
          <input type="color" className="ml-2 align-middle" value={style.active} onChange={(e) => setStyle({ ...style, active: e.target.value })} /></label>
        <label className="mb-3 block">Tamaño ({style.fontSize})
          <input type="range" className="w-full" min={48} max={140} value={style.fontSize} onChange={(e) => setStyle({ ...style, fontSize: Number(e.target.value) })} /></label>
        <label className="mb-3 block">Posición vertical
          <input type="range" className="w-full" min={0.3} max={0.9} step={0.01} value={style.y} onChange={(e) => setStyle({ ...style, y: Number(e.target.value) })} /></label>
        <p className="mt-4 text-xs text-[var(--muted)]">Datos de fixture, solo desarrollo. Sin vídeo real ni guardado todavía.</p>
      </section>
    </div>
  );
}
