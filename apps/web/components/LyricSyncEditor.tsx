"use client";
// Editor de sincronización: línea de tiempo con palabras que se arrastran (pointerdown/pointermove) o se ajustan con
// botones ◀ ▶ y teclado (alternativa sin arrastre, WCAG 2.5.7), dudosas resaltadas, deshacer/rehacer y guardado con control de conflictos.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyncWord } from "@rafaga/lyrics";
import { supabase } from "../lib/supabase";
import { initEditor, nudge, resize, insert, remove, undo, redo, applyMarks, doubtfulIndexes, toPayload, type EditorState } from "../lib/synceditor";
import TapSync from "./TapSync";

const PX = 90;           // píxeles por segundo en la línea de tiempo
const STEP = 0.05;       // ajuste fino de los botones y del teclado
type Drag = { i: number; mode: "move" | "start" | "end"; x0: number; t0: number };

export default function LyricSyncEditor({ songId, audioUrl, lyrics, revision, words, onSaved }: { songId: string; audioUrl: string; lyrics: string; revision: number | null; words: SyncWord[]; onSaved?: (rev: number) => void }) {
  const [s, setS] = useState<EditorState>(() => initEditor(words)), [base, setBase] = useState(revision), [sel, setSel] = useState(0), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const drag = useRef<Drag | null>(null), sRef = useRef(s); sRef.current = s;
  useEffect(() => { setS(initEditor(words)); setBase(revision); }, [words, revision]);
  const doubtful = useMemo(() => new Set(doubtfulIndexes(s.words)), [s.words]);
  const total = Math.max(10, ...s.words.map((w) => w.end)) + 2;
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dt = (e.clientX - d.x0) / PX, w = sRef.current.words[d.i];
    if (!w) return;
    // Cada movimiento es respecto al estado de partida del arrastre: se deshace el paso anterior del mismo gesto para no llenar el historial.
    const cur = sRef.current;
    const prev = d.mode === "move" ? w.start : d.mode === "start" ? w.start : w.end;
    const target = d.t0 + dt;
    setS(d.mode === "move" ? nudge(cur, d.i, target - prev) : resize(cur, d.i, d.mode, target));
  }, []);
  const onUp = useCallback(() => { drag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); }, [onMove]);
  function down(e: React.PointerEvent, i: number, mode: Drag["mode"]) {
    e.preventDefault(); e.stopPropagation(); setSel(i);
    const w = s.words[i]; drag.current = { i, mode, x0: e.clientX, t0: mode === "end" ? w.end : w.start };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }
  function key(e: React.KeyboardEvent, i: number) {
    const d = e.key === "ArrowLeft" ? -STEP : e.key === "ArrowRight" ? STEP : 0; if (!d) return;
    e.preventDefault(); setS(e.shiftKey ? resize(s, i, "end", s.words[i].end + d) : nudge(s, i, d));
  }
  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/lyrics/songs/${songId}/alignment`, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify(toPayload(s, base)) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 201) { setBase(j.revision); setMsg(`Sincronización guardada (revisión ${j.revision}).`); onSaved?.(j.revision); }
    else if (r.status === 409) setMsg(`Hay una versión más reciente (revisión ${j.conflict?.current_revision}). Recarga la página para no perder esos cambios.`);
    else setMsg(j?.error?.message ?? "No se pudo guardar la sincronización.");
    setBusy(false);
  }
  async function restore() {
    if (!confirm("Se creará una revisión nueva con la sincronización automática original. Tus ediciones quedan en el historial.")) return;
    const r = await fetch(`/api/lyrics/songs/${songId}/alignment/restore`, { method: "POST", headers: { Authorization: `Bearer ${await token()}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(`Restaurada como revisión ${j.revision}. Recarga la canción para verla.`); onSaved?.(j.revision); } else setMsg(j?.error?.message ?? "No se pudo restaurar.");
  }

  return (
    <section className="card space-y-3 p-4" aria-label="Editor de sincronización">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost !min-h-9" onClick={() => setS(undo(s))} disabled={!s.past.length}>Deshacer</button>
        <button className="btn btn-ghost !min-h-9" onClick={() => setS(redo(s))} disabled={!s.future.length}>Rehacer</button>
        <button className="btn btn-ghost !min-h-9" onClick={() => { const t = window.prompt("Texto de la palabra nueva"); if (t?.trim()) setS(insert(s, sel + 1, t.trim().slice(0, 80))); }}>Insertar</button>
        <button className="btn btn-ghost !min-h-9" onClick={() => { setS(remove(s, sel)); setSel(Math.max(0, sel - 1)); }} disabled={s.words.length < 2}>Borrar</button>
        <button className="btn btn-ghost !min-h-9" onClick={() => void restore()}>Restaurar sincronización original</button>
        <button className="btn btn-primary !min-h-9 ml-auto" onClick={() => void save()} disabled={busy || !s.past.length}>Guardar</button>
      </div>
      {doubtful.size > 0 && <p className="text-xs text-[var(--muted)]">{doubtful.size} palabras dudosas, resaltadas. Arrástralas o ajústalas con ◀ ▶ y quedarán como revisadas.</p>}
      <div className="relative h-24 overflow-x-auto rounded-lg border hairline" role="group" aria-label="Línea de tiempo de palabras">
        <div className="relative h-full" style={{ width: total * PX }}>
          {s.words.map((w, i) => (
            <div key={i} role="button" tabIndex={0} aria-label={`${w.text}, de ${w.start.toFixed(2)} a ${w.end.toFixed(2)} segundos`} aria-pressed={sel === i}
              onPointerDown={(e) => down(e, i, "move")} onKeyDown={(e) => key(e, i)} onFocus={() => setSel(i)}
              className={`absolute top-3 flex h-12 select-none items-center overflow-hidden rounded-md border px-1 text-xs ${sel === i ? "bg-[var(--ink)] text-white" : w.manual ? "bg-[var(--hairline)]" : "bg-white"} ${doubtful.has(i) ? "ring-2 ring-[#B45309]" : ""}`}
              style={{ left: w.start * PX, width: Math.max(14, (w.end - w.start) * PX), touchAction: "none" }}>
              <span onPointerDown={(e) => down(e, i, "start")} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" aria-hidden />
              <span className="truncate">{w.text}</span>
              <span onPointerDown={(e) => down(e, i, "end")} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" aria-hidden />
            </div>))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-[var(--muted)]">Palabra: <b>{s.words[sel]?.text}</b></span>
        <button className="btn btn-ghost !min-h-9" aria-label="Mover 50 milisegundos antes" onClick={() => setS(nudge(s, sel, -STEP))}>◀</button>
        <button className="btn btn-ghost !min-h-9" aria-label="Mover 50 milisegundos después" onClick={() => setS(nudge(s, sel, STEP))}>▶</button>
        <span className="text-xs text-[var(--muted)]">Flechas del teclado mueven; con Mayús cambian el final.</span>
      </div>
      <details><summary className="cursor-pointer text-sm font-medium">Marcar tocando al ritmo</summary>
        <TapSync songId={songId} audioUrl={audioUrl} lyrics={lyrics} ensureLyrics={async () => true} onMarks={(m) => setS((cur) => applyMarks(cur, m))} />
      </details>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
