"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { supabase } from "../lib/supabase";
import type { YtItem } from "@rafaga/providers/youtube";

/** Elegir un vídeo de tu propio canal (YouTube conectado, solo lectura). No hay descarga por enlace: YouTube no entrega el archivo. */
export default function YouTubeLink({ onPick }: { onPick: (item: YtItem) => void }) {
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
  return (
    <div className="rounded-2xl border hairline bg-[var(--card)] p-3">
      <p className="text-sm font-medium">¿El vídeo está en tu canal de YouTube?</p>
      <p className="mt-1 text-sm text-[var(--muted)]">Elígelo para guardar su título y tu encargo. YouTube no entrega el archivo de ningún vídeo, ni conectando tu cuenta, así que después tendrás que subirlo.</p>
      <div className="mt-3">
        {conn === "yes" ? (!mine ? <button type="button" onClick={loadMine} disabled={mineBusy} className="btn btn-ghost !py-1.5 !text-sm">{mineBusy ? "Leyendo tu canal…" : "Elegir uno de mis vídeos"}</button> : !mine.length ? <p className="text-sm text-[var(--muted)]">No hay vídeos subidos en tu canal.</p> : (
          <ul className="grid max-h-56 gap-1 overflow-auto" aria-label="Mis vídeos de YouTube">{mine.map((m) => (
            <li key={m.id}><button type="button" onClick={() => onPick({ id: m.id, title: m.title, channel: "Tu canal", channelId: "", thumb: `https://i.ytimg.com/vi/${m.id}/mqdefault.jpg`, status: "video", url: `https://www.youtube.com/watch?v=${m.id}`, wasLive: false, publishedAt: m.publishedAt })} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-[var(--hover)]">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`https://i.ytimg.com/vi/${m.id}/default.jpg`} alt="" className="h-10 w-16 shrink-0 rounded object-cover" /><span className="min-w-0 flex-1"><span className="line-clamp-1 text-sm font-medium">{m.title}</span><span className="text-xs text-[var(--muted)]">{m.publishedAt ? new Date(m.publishedAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : ""}</span></span></button></li>))}</ul>)
        ) : conn === "no" ? <p className="text-sm text-[var(--muted)]">¿Es tu vídeo? <Link href="/app/conexiones" className="font-semibold text-[var(--accent)]">Conecta YouTube</Link> y elígelo de tu canal.</p> : null}
        {mineErr && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{mineErr}</p>}
      </div>
    </div>
  );
}
