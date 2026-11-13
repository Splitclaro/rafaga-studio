"use client";
// Nuevo proyecto v2: subir (reanudable) → tarjeta de validación → panel de creación → proyecto.
// Activo solo con NEXT_PUBLIC_PIPELINE_VERSION=v2; sin esa variable «Nuevo proyecto» es el flujo de siempre.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import UploadPanel from "./UploadPanel";
import CreationPanel from "./CreationPanel";
import { supabase } from "../lib/supabase";

interface Src { status: string; duration_ms: number | null; width: number | null; height: number | null; has_audio: boolean | null; thumb_path: string | null }
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function NuevoV2() {
  const router = useRouter();
  const [done, setDone] = useState<{ project_id: string; source_id: string; name: string } | null>(null);
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
    <main className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 md:px-8">
      <h1 className="text-3xl">Nuevo proyecto</h1>
      <section className="mt-5 space-y-5">
        {!done && <UploadPanel onDone={(d) => setDone(d)} />}
        {done && (
          <div className="card p-4" aria-live="polite">
            <div className="font-medium">{done.name}</div>
            {!src || src.status === "uploaded" || src.status === "pending" ? <p className="mt-1 text-sm text-[var(--muted)]">Validando y preparando el vídeo… Puedes cerrar la pestaña: el proceso sigue en el servidor.</p>
              : src.status === "failed" ? <p role="alert" className="mt-1 text-sm">El archivo no se pudo validar. Revisa el formato (MP4/MOV con H.264) y vuelve a subirlo.</p>
              : <p className="mt-1 text-sm text-[var(--muted)]">{src.duration_ms ? clock(src.duration_ms) : "—"} · {src.width}×{src.height} · {src.has_audio === false ? "sin audio (solo modos Manual y Destacados)" : "con audio"} · validado</p>}
          </div>
        )}
        {done && src?.status === "validated" && src.duration_ms && (
          <CreationPanel projectId={done.project_id} durationMs={src.duration_ms} onCreated={() => router.push(`/app/p/${done.project_id}`)} />
        )}
      </section>
    </main>
  );
}
