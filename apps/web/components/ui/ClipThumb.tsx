"use client";
// Miniatura de un clip: la firma el servidor (R2) tras comprobar el acceso; con caché en memoria para no repetir llamadas.
// Si el clip no tiene portada guardada (clips anteriores) y se da `renderId`, se muestra el primer fotograma del propio vídeo, solo cuando entra en pantalla.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { renderUrl } from "../../lib/r2url";

const cache = new Map<string, string | null>(), vcache = new Map<string, string | null>();
export default function ClipThumb({ clipId, renderId, className = "", fallback }: { clipId: string; renderId?: string; className?: string; fallback?: string | null }) {
  const [url, setUrl] = useState<string | null | undefined>(fallback ?? cache.get(clipId));
  const [vid, setVid] = useState<string | null | undefined>(renderId ? vcache.get(renderId) : null), [seen, setSeen] = useState(false), box = useRef<HTMLSpanElement>(null);
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
  useEffect(() => { const el = box.current; if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; } const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" }); io.observe(el); return () => io.disconnect(); }, []);
  useEffect(() => {
    if (url !== null || !renderId || !seen || vcache.has(renderId)) { if (renderId && vcache.has(renderId)) setVid(vcache.get(renderId)); return; }
    let stop = false; void renderUrl(renderId).then((u) => { vcache.set(renderId, u); if (!stop) setVid(u); });
    return () => { stop = true; };
  }, [url, renderId, seen]);
  /* eslint-disable @next/next/no-img-element */
  return (
    <span ref={box} className={`block ${className}`}>
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        : vid ? <video src={`${vid}#t=1.2`} muted playsInline preload="metadata" aria-hidden className="h-full w-full object-cover" />
        : <span aria-hidden className="block h-full w-full bg-[var(--surface)]" />}
    </span>
  );
}
