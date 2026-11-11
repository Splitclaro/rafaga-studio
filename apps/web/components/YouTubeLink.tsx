"use client";
import { useState } from "react";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import { youtubeIdFrom, type YtItem } from "@rafaga/providers/youtube";

/** Pegar un enlace de YouTube: se reconoce el vídeo (título, canal, portada) al momento. */
export default function YouTubeLink({ onPick }: { onPick: (item: YtItem) => void }) {
  const [v, setV] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  async function look(text: string) {
    const id = youtubeIdFrom(text);
    if (!id) { setErr(text.trim() ? "Eso no parece un enlace de YouTube. Copia la dirección del vídeo (youtube.com/watch?v=… o youtu.be/…)." : null); return; }
    setBusy(true); setErr(null);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch(`/api/youtube/video?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.message ?? "No se pudo reconocer el vídeo.");
      onPick(j.item as YtItem);
    } catch { setErr("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); look(v); }} className="rounded-2xl border hairline bg-white p-3">
      <label htmlFor="yt-link" className="mb-2 block text-sm font-medium">Enlace del vídeo de YouTube</label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon n="link" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input id="yt-link" value={v} onChange={(e) => { setV(e.target.value); setErr(null); }} onPaste={(e) => { const t = e.clipboardData.getData("text"); if (youtubeIdFrom(t)) { e.preventDefault(); setV(t); look(t); } }}
            placeholder="https://www.youtube.com/watch?v=…" inputMode="url" autoComplete="off" className="input !pl-9" aria-invalid={!!err} aria-describedby="yt-link-msg" />
        </div>
        <button disabled={busy || !v.trim()} className="btn btn-primary shrink-0">{busy ? "Reconociendo…" : "Reconocer"}</button>
      </div>
      <p id="yt-link-msg" role="status" className={`mt-2 min-h-5 text-sm ${err ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{err ?? "Pega el enlace y lo reconocemos al momento."}</p>
    </form>
  );
}
