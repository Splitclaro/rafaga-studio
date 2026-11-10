"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseLyrics } from "@rafaga/lyrics";
import { supabase } from "../lib/supabase";

type Mark = { text: string; line: number; start: number; end: number | null };
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const isTyping = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s.trim().replace(/\s+/g, " ")));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Sincronización manual por pulsación: marca el inicio de cada palabra (pulsar) y, en modo «mantener», su duración.
 * Guarda una versión reutilizable por todos los estilos y variantes de la canción (tiempos absolutos).
 */
export default function TapSync({ songId, audioUrl, lyrics, ensureLyrics, from = 0, onSaved }: {
  songId: string; audioUrl: string; lyrics: string; ensureLyrics: () => Promise<boolean>; from?: number; onSaved?: (n: number) => void;
}) {
  const words = useMemo(() => parseLyrics(lyrics).flatMap((l, li) => l.words.map((w) => ({ text: w, line: li }))), [lyrics]);
  const audio = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState(false);
  const [hold, setHold] = useState(false);
  const [rate, setRate] = useState(1);
  const [offset, setOffset] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const down = useRef(false);
  const marksRef = useRef<Mark[]>([]);
  marksRef.current = marks;

  // Cargar una sincronización manual guardada para esta letra
  useEffect(() => {
    (async () => {
      if (!lyrics.trim()) return;
      const key = `manual:${await sha256(lyrics)}`;
      const { data } = await supabase.from("song_alignments").select("words,created_at").eq("song_id", songId).eq("lyrics_sha256", key).maybeSingle();
      if (data) { setMarks((data.words as Mark[]).map((w) => ({ text: w.text, line: w.line, start: w.start, end: w.end }))); setSaved(new Date(data.created_at).toLocaleString("es")); }
      else { setMarks([]); setSaved(null); }
    })();
  }, [songId, lyrics]);

  const now = () => audio.current?.currentTime ?? 0;
  const press = useCallback(() => {
    if (down.current) return;            // repetición de tecla o doble evento: una sola marca
    const m = marksRef.current;
    if (m.length >= words.length) return;
    const t = now();
    if (m.length && t < m[m.length - 1].start) return; // nunca hacia atrás
    down.current = true;
    const w = words[m.length];
    setMarks([...m, { text: w.text, line: w.line, start: +t.toFixed(3), end: null }]);
  }, [words]);
  const release = useCallback(() => {
    if (!down.current) return;
    down.current = false;
    if (!hold) return;
    const m = marksRef.current; if (!m.length) return;
    const last = m[m.length - 1];
    setMarks([...m.slice(0, -1), { ...last, end: +Math.max(last.start + 0.05, now()).toFixed(3) }]);
  }, [hold]);
  const undo = useCallback(() => {
    const m = marksRef.current; if (!m.length) return;
    const back = m[m.length - 1].start;
    setMarks(m.slice(0, -1));
    if (audio.current) audio.current.currentTime = Math.max(0, back - 2);
  }, []);

  useEffect(() => {
    if (!active) return;
    const kd = (e: KeyboardEvent) => {
      if (isTyping(document.activeElement)) return;
      if (e.code === "Space") { e.preventDefault(); if (!e.repeat) press(); }
      else if (e.code === "Backspace" || (e.key === "z" && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); undo(); }
    };
    const ku = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(document.activeElement)) { e.preventDefault(); release(); } };
    const lost = () => { release(); audio.current?.pause(); };   // pérdida de foco: cerrar la marca abierta, sin duplicar
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", lost);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", lost); document.removeEventListener("visibilitychange", lost); };
  }, [active, press, release, undo]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);

  function start(fromT: number) {
    setActive(true); setMsg(null);
    const a = audio.current; if (!a) return;
    a.currentTime = fromT; a.playbackRate = rate; a.play().catch(() => setMsg("Pulsa reproducir en el audio para empezar."));
  }
  function repeatFrom(i: number) {
    const m = marksRef.current; if (!m[i]) return;
    setMarks(m.slice(0, i).map((x, k, arr) => (k === arr.length - 1 ? { ...x, end: x.end } : x)));
    start(Math.max(0, m[i].start - 2));
  }
  function nudge(i: number, field: "start" | "end", d: number) {
    setMarks((m) => m.map((x, k) => {
      if (k !== i) return x;
      const v = +(((x[field] ?? x.start + 0.3) + d)).toFixed(3);
      const lo = field === "start" ? (k ? m[k - 1].start : 0) : x.start + 0.05;
      const hi = field === "start" ? (x.end ?? Infinity) - 0.05 : Infinity;
      return { ...x, [field]: Math.min(hi, Math.max(lo, v)) };
    }));
  }
  function finalized(): Mark[] {
    return marks.map((x, i) => {
      const s = Math.max(0, x.start + offset);
      const nx = marks[i + 1];
      const nextS = nx ? nx.start + offset : Infinity;
      // Sin «mantener»: dentro de un verso dura hasta la siguiente palabra (no se acorta una nota sostenida);
      // al final de verso, hasta la siguiente entrada con un máximo de 2,5 s para no cubrir un instrumental.
      const e = x.end != null ? Math.min(x.end + offset, nextS) : nx && nx.line === x.line ? nextS - 0.01 : Math.min(nextS - 0.01, s + 2.5);
      return { ...x, start: +s.toFixed(3), end: +Math.max(s + 0.05, e).toFixed(3) };
    });
  }
  async function save() {
    if (!marks.length) return;
    if (marks.length < words.length && !confirm(`Has marcado ${marks.length} de ${words.length} palabras. Solo se guardan las marcadas; el resto usará la alineación automática en la próxima generación. ¿Guardar?`)) return;
    if (!(await ensureLyrics())) return;
    const { error } = await supabase.rpc("save_manual_alignment", { p_song: songId, p_words: finalized() });
    if (error) return setMsg(error.message);
    setSaved(new Date().toLocaleString("es")); setMsg(`Sincronización guardada (${marks.length} palabras). Se usará en todos los estilos y variantes de esta letra.`);
    setActive(false); audio.current?.pause(); onSaved?.(marks.length);
  }

  const next = words[marks.length];
  const lines = useMemo(() => { const out: { li: number; items: { i: number; text: string }[] }[] = []; words.forEach((w, i) => { const l = out[out.length - 1]; if (!l || l.li !== w.line) out.push({ li: w.line, items: [{ i, text: w.text }] }); else l.items.push({ i, text: w.text }); }); return out; }, [words]);

  if (!words.length) return <p className="text-sm text-[var(--muted)]">Escribe o importa la letra para sincronizarla a mano.</p>;
  return (
    <div className="space-y-3 text-sm">
      <audio ref={audio} src={audioUrl} controls preload="metadata" className="w-full" />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => start(marks.length ? Math.max(0, marks[marks.length - 1].start - 1) : from)} className="btn btn-primary">{marks.length ? "Continuar" : "Empezar"}</button>
        <fieldset className="inline-flex rounded-full bg-[var(--hover)] p-1"><legend className="sr-only">Modo</legend>
          {([[false, "Pulsar"], [true, "Mantener"]] as const).map(([v, l]) => <button key={l} aria-pressed={hold === v} onClick={() => setHold(v)} className={`rounded-full px-3 py-1 ${hold === v ? "bg-[#111] text-white" : ""}`}>{l}</button>)}
        </fieldset>
        <label className="flex items-center gap-1">Velocidad<select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded-full border border-[var(--border)] bg-white px-2 py-1">{[0.5, 0.75, 1].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
        <label className="flex items-center gap-2">Desplazar todo <input type="range" min={-0.5} max={0.5} step={0.01} value={offset} onChange={(e) => setOffset(Number(e.target.value))} /><span className="tnum w-14">{offset >= 0 ? "+" : ""}{offset.toFixed(2)} s</span></label>
      </div>
      <div className="rounded-2xl bg-[var(--surface)] p-4">
        <p className="text-xs text-[var(--muted)]">{active ? (hold ? "Mantén la barra espaciadora (o el botón) mientras suena cada palabra. Retroceso deshace." : "Pulsa la barra espaciadora (o el botón) al empezar cada palabra. Retroceso deshace.") : "Empieza y marca al ritmo del canto. La barra espaciadora no desplaza la página mientras sincronizas."}</p>
        <p className="mt-2 font-display text-2xl" aria-live="polite">{next ? <>Siguiente: <span className="underline underline-offset-4">{next.text}</span></> : "Todas las palabras marcadas"}</p>
        <button type="button" disabled={!active || !next} onPointerDown={(e) => { e.preventDefault(); press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
          className="mt-3 w-full select-none rounded-2xl bg-[#111] py-5 text-lg font-medium text-white disabled:opacity-30" style={{ touchAction: "none" }}>Marcar palabra</button>
        <div className="mt-2 flex gap-2"><button onClick={undo} disabled={!marks.length} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Deshacer última</button><button onClick={() => { setMarks([]); setActive(false); audio.current?.pause(); }} disabled={!marks.length} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Borrar marcas</button></div>
      </div>
      <div className="max-h-72 overflow-auto rounded-2xl border border-[var(--border)] p-3">
        {lines.map((l) => (
          <p key={l.li} className="mb-1.5 leading-7">{l.items.map(({ i, text }) => {
            const m = marks[i];
            return <span key={i} className={`mr-1 inline-flex items-center gap-1 rounded-lg px-1.5 ${m ? "bg-[#111] text-white" : i === marks.length ? "ring-1 ring-[#111]" : "text-[var(--muted)]"}`}>
              {text}{m && <span className="tnum text-[10px] opacity-70">{fmt(m.start + offset)}</span>}
              {m && <span className="inline-flex"><button aria-label={`Adelantar ${text}`} onClick={() => nudge(i, "start", -0.05)} className="px-0.5 text-[10px]">◀</button><button aria-label={`Retrasar ${text}`} onClick={() => nudge(i, "start", 0.05)} className="px-0.5 text-[10px]">▶</button><button aria-label={`Repetir desde ${text}`} onClick={() => repeatFrom(i)} className="px-0.5 text-[10px]">↺</button></span>}
            </span>;
          })}</p>))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={!marks.length} className="btn btn-primary disabled:opacity-40">Guardar sincronización</button>
        <span className="text-xs text-[var(--muted)]">{marks.length}/{words.length} palabras{saved ? ` · versión guardada ${saved}` : ""}</span>
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
