"use client";
// Nuevo proyecto v2: subir (reanudable) → tarjeta de validación → panel de creación → proyecto.
// Activo solo con NEXT_PUBLIC_PIPELINE_VERSION=v2; sin esa variable «Nuevo proyecto» es el flujo de siempre.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UploadPanel from "./UploadPanel";
import CreationPanel from "./CreationPanel";
import { supabase } from "../lib/supabase";

interface Src { status: string; duration_ms: number | null; width: number | null; height: number | null; has_audio: boolean | null; thumb_path: string | null }
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function NuevoV2() {
  const router = useRouter();
  const [done, setDone] = useState<{ project_id: string; source_id: string; name: string; file?: File } | null>(null);
  const localUrl = useMemo(() => (done?.file ? URL.createObjectURL(done.file) : null), [done]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {   // tira de fotogramas del archivo local (solo en el navegador; no sube nada)
    setFrames([]); if (!localUrl) return;
    let stop = false; const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = localUrl;
    const out: string[] = [], N = 10, cv = document.createElement("canvas"); cv.width = 120; cv.height = 68;
    const grab = (i: number) => { if (stop || i >= N) { if (!stop) setFrames(out); return; } v.currentTime = Math.max(0, (v.duration * (i + 0.5)) / N); };
    v.onseeked = () => { cv.getContext("2d")?.drawImage(v, 0, 0, cv.width, cv.height); out.push(cv.toDataURL("image/jpeg", 0.6)); grab(out.length); };
    v.onloadedmetadata = () => grab(0); v.onerror = () => undefined;
    return () => { stop = true; v.src = ""; };
  }, [localUrl]);
  async function remove() { if (!done) return; await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", done.project_id); setDone(null); setSrc(null); }
  const [src, setSrc] = useState<Src | null>(null);

  useEffect(() => {
    if (!done) return;
    let stop = false;
    const tick = async () => {
      const { data } = await supabase.from("sources").select("status,duration_ms,width,height,has_audio,thumb_path").eq("id", done.source_id).single();
      if (!stop && data) setSrc(data as Src);
      if (!stop && (data as Src | null)?.status !== "validated" && (data as Src | null)?.status !== "failed") setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; };
  }, [done]);

  return (
    <main className="mx-auto max-w-[1100px] min-w-0 px-4 pb-20 pt-6 md:px-8">
      <h1 className="text-3xl">Nuevo proyecto</h1>
      <section className="mt-5 space-y-5">
        {!done && <UploadPanel onDone={(d) => setDone(d)} onImported={(id) => router.push(`/app/p/${id}`)} />}
        {done && (
          <div className="card flex flex-col gap-4 p-4 sm:flex-row" aria-live="polite">
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-[var(--ink)] sm:w-60">
              {localUrl ? <video src={`${localUrl}#t=1`} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-white/70">Sin miniatura</div>}
              {src?.height ? <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">{src.height >= 2160 ? "4K" : src.height >= 1080 ? "1080p" : src.height >= 720 ? "720p" : "480p"}</span> : null}
              {src?.duration_ms ? <span className="tnum absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{clock(src.duration_ms)}</span> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3"><div className="truncate font-medium">{done.name}</div>
                <button type="button" onClick={remove} aria-label="Quitar vídeo" className="btn btn-ghost !px-2 !py-1 !text-xs">Quitar</button></div>
              {!src || src.status === "uploaded" || src.status === "pending" ? <p className="mt-1 text-sm text-[var(--muted)]">Validando y preparando el vídeo… Puedes cerrar la pestaña: el proceso sigue en el servidor.</p>
                : src.status === "failed" ? <p role="alert" className="mt-1 text-sm">El archivo no se pudo validar. Revisa el formato (MP4/MOV con H.264) y vuelve a subirlo.</p>
                : <p className="mt-1 text-sm text-[var(--muted)]">{src.width}×{src.height} · {src.has_audio === false ? "sin audio" : "con audio"} · validado</p>}
              <p className="mt-2 text-xs text-[var(--muted)]">Idioma, rango, diseño y subtítulos se ajustan debajo.</p>
            </div>
          </div>
        )}
        {/* Como en OpusClip: la receta y todos los ajustes se ven y se pueden configurar ANTES de subir; «Crear» se activa cuando el vídeo está listo. */}
        <CreationPanel filmstrip={frames} projectId={done && src?.status === "validated" ? done.project_id : null} durationMs={done && src?.status === "validated" ? src.duration_ms : null} onCreated={() => done && router.push(`/app/p/${done.project_id}`)} />
      </section>
    </main>
  );
}
