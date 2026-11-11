"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import { youtubeIdFrom, type YtItem } from "@rafaga/providers/youtube";

/** Pegar un enlace de YouTube: se reconoce el vídeo (título, canal, portada) al momento. */
export default function YouTubeLink({ onPick }: { onPick: (item: YtItem) => void }) {
  const [v, setV] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  // «Elegir de mi canal»: solo si YouTube está conectado (OAuth de solo lectura). YouTube no entrega el archivo, solo la lista de tus vídeos.
  const [conn, setConn] = useState<"loading" | "yes" | "no">("loading");
  const [mine, setMine] = useState<{ id: string; title: string; publishedAt: string }[] | null>(null), [mineBusy, setMineBusy] = useState(false), [mineErr, setMineErr] = useState<string | null>(null);
  useEffect(() => { supabase.rpc("oauth_status").then(({ data }) => setConn(((data as { provider: string; status: string }[]) ?? []).some((c) => c.provider === "google" && c.status === "connected") ? "yes" : "no")); }, []);
  async function loadMine() {
    setMineBusy(true); setMineErr(null);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch("/api/oauth/action", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google", action: "list", what: "youtube" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setMineErr(j.message ?? "No se pudo leer tu canal. Vuelve a conectar YouTube en Conexiones.");
      setMine(j.items ?? []);
    } catch { setMineErr("No se pudo conectar. Inténtalo de nuevo."); } finally { setMineBusy(false); }
  }
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
    <form onSubmit={(e) => { e.preventDefault(); look(v); }} className="rounded-2xl border hairline bg-[var(--card)] p-3">
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
      <div className="mt-3 border-t hairline pt-3">
        {conn === "yes" ? (!mine ? <button type="button" onClick={loadMine} disabled={mineBusy} className="btn btn-ghost !py-1.5 !text-sm">{mineBusy ? "Leyendo tu canal…" : "Elegir uno de mis vídeos"}</button> : !mine.length ? <p className="text-sm text-[var(--muted)]">No hay vídeos subidos en tu canal.</p> : (
          <ul className="grid max-h-56 gap-1 overflow-auto" aria-label="Mis vídeos de YouTube">{mine.map((m) => (
            <li key={m.id}><button type="button" onClick={() => onPick({ id: m.id, title: m.title, channel: "Tu canal", channelId: "", thumb: `https://i.ytimg.com/vi/${m.id}/mqdefault.jpg`, status: "video", url: `https://www.youtube.com/watch?v=${m.id}`, wasLive: false, publishedAt: m.publishedAt })} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-[var(--hover)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`https://i.ytimg.com/vi/${m.id}/default.jpg`} alt="" className="h-10 w-16 shrink-0 rounded object-cover" /><span className="min-w-0 flex-1"><span className="line-clamp-1 text-sm font-medium">{m.title}</span><span className="text-xs text-[var(--muted)]">{m.publishedAt ? new Date(m.publishedAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : ""}</span></span></button></li>))}</ul>)
        ) : conn === "no" ? <p className="text-sm text-[var(--muted)]">¿Es tu vídeo? <Link href="/app/conexiones" className="font-semibold text-[var(--accent)]">Conecta YouTube</Link> y elígelo de tu canal.</p> : null}
        {mineErr && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{mineErr}</p>}
      </div>
    </form>
  );
}
