"use client";
// Miniatura de un clip: la firma el servidor (R2) tras comprobar el acceso; con caché en memoria para no repetir llamadas.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const cache = new Map<string, string | null>();
export default function ClipThumb({ clipId, className = "", fallback }: { clipId: string; className?: string; fallback?: string | null }) {
  const [url, setUrl] = useState<string | null | undefined>(fallback ?? cache.get(clipId));
  useEffect(() => {
    if (fallback || cache.has(clipId)) { setUrl(fallback ?? cache.get(clipId)); return; }
    let stop = false;
    (async () => {
      try {
        const t = (await supabase.auth.getSession()).data.session?.access_token ?? "";
        const r = await fetch(`/api/uploads/clips/${clipId}/thumb`, { headers: { Authorization: `Bearer ${t}` } });
        const u = r.ok ? ((await r.json()).url as string | null) : null; cache.set(clipId, u ?? null); if (!stop) setUrl(u ?? null);
      } catch { if (!stop) setUrl(null); }
    })();
    return () => { stop = true; };
  }, [clipId, fallback]);
  /* eslint-disable-next-line @next/next/no-img-element */
  return url ? <img src={url} alt="" loading="lazy" className={`object-cover ${className}`} /> : <span aria-hidden className={`block bg-[var(--surface)] ${className}`} />;
}
