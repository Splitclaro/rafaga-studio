"use client";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import { StatusLabel, pieceStatus } from "../../../../../components/ui/status";

type Side = { id: string; title: string; current_version: number; review_status: string; approved_version: number | null; url?: string; ratio?: string; version?: number; preset?: string; brand?: string | null; start?: number; end?: number; dur?: number; hasRender: boolean };
const clock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;

async function loadSide(id: string): Promise<Side | null> {
  const { data: c } = await supabase.from("clips").select("id,title,current_version,review_status,approved_version").eq("id", id).maybeSingle();
  if (!c) return null;
  const [{ data: v }, { data: r }] = await Promise.all([
    supabase.from("clip_versions").select("composition").eq("clip_id", id).eq("version", c.current_version).maybeSingle(),
    supabase.from("renders").select("clip_version,ratio,storage_path,probe").eq("clip_id", id).eq("clip_version", c.current_version).eq("status", "ready").order("created_at", { ascending: false }).limit(1),
  ]);
  const comp = (v?.composition ?? {}) as { preset?: string; startSec?: number; endSec?: number };
  const rr = (r ?? [])[0] as { clip_version: number; ratio: string; storage_path: string; probe: { brand?: string | null; duration?: string | number } | null } | undefined;
  const url = rr ? (await supabase.storage.from("renders").createSignedUrl(rr.storage_path, 3600)).data?.signedUrl : undefined;
  return { ...(c as Side), url, ratio: rr?.ratio, version: rr?.clip_version, preset: comp.preset, brand: rr?.probe?.brand ?? null, start: comp.startSec, end: comp.endSec, dur: rr?.probe?.duration ? Number(rr.probe.duration) : undefined, hasRender: !!rr };
}

function Compare({ projectId }: { projectId: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [a, b] = [sp.get("a"), sp.get("b")];
  const [sides, setSides] = useState<[Side | null, Side | null] | null>(null);
  const [sync, setSync] = useState(false);
  const [pick, setPick] = useState<0 | 1>(0);
  const [msg, setMsg] = useState<string | null>(null);
  const refs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const load = useCallback(async () => { if (!a || !b) return; setSides([await loadSide(a), await loadSide(b)]); }, [a, b]);
  useEffect(() => { load(); }, [load]);

  // Reproducción sincronizada: solo si el usuario la activa, y solo para el mismo fragmento
  const [x, y] = sides ?? [null, null];
  const overlap = x && y && x.start != null && y.start != null && x.end != null && y.end != null ? Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start)) / Math.min(x.end - x.start, y.end - y.start) : 0;
  const sameFragment = overlap > 0.8;
  useEffect(() => {
    if (!sync) return; const [v0, v1] = [refs[0].current, refs[1].current]; if (!v0 || !v1) return;
    const play = (s: HTMLVideoElement, o: HTMLVideoElement) => () => { if (o.paused) o.play().catch(() => {}); };
    const pause = (o: HTMLVideoElement) => () => { if (!o.paused) o.pause(); };
    const seek = (s: HTMLVideoElement, o: HTMLVideoElement) => () => { if (Math.abs(o.currentTime - s.currentTime) > 0.15) o.currentTime = s.currentTime; };
    const h = [["play", play(v0, v1), v0], ["pause", pause(v1), v0], ["seeked", seek(v0, v1), v0], ["play", play(v1, v0), v1], ["pause", pause(v0), v1], ["seeked", seek(v1, v0), v1]] as const;
    h.forEach(([e, f, el]) => el.addEventListener(e, f)); return () => h.forEach(([e, f, el]) => el.removeEventListener(e, f));
  }, [sync, sides]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(s: Side, status: "approved" | "changes_requested") {
    const { error } = await supabase.rpc("set_review", { p_clip: s.id, p_status: status, p_version: s.current_version, p_note: status === "approved" ? "Elegida en la comparación" : null });
    setMsg(error ? error.message : status === "approved" ? `«${s.title}» aprobada (v${s.current_version}).` : "Cambios solicitados."); load();
  }
  const close = () => router.push(`/app/p/${projectId}`);

  if (!a || !b) return <main className="mx-auto max-w-xl px-4 py-16 text-center">Selecciona dos piezas en el proyecto para compararlas.<br /><Link href={`/app/p/${projectId}`} className="underline">Volver al proyecto</Link></main>;
  if (!sides) return <main className="px-4 py-10 md:px-8"><div className="skeleton h-[60vh]" /></main>;
  const list = [x, y];
  const card = (s: Side | null, i: 0 | 1) => {
    if (!s) return <div className="rounded-2xl bg-[var(--surface)] p-8 text-sm">No se pudo cargar esta pieza (¿sin acceso?).</div>;
    const st = pieceStatus({ review_status: s.review_status, approved_version: s.approved_version, current_version: s.current_version, hasRender: s.hasRender });
    return (
      <section aria-label={`Variante ${i === 0 ? "A" : "B"}`} className={`${pick !== i ? "max-md:hidden" : ""} min-w-0`}>
        <div className="flex items-center justify-between gap-2"><h2 className="min-w-0 truncate text-lg tracking-tight"><span className="text-[var(--muted)]">{i === 0 ? "A" : "B"} · </span>{s.title}</h2><StatusLabel status={st.status} note={st.note} /></div>
        <div className="mt-3 grid place-items-center rounded-2xl bg-[#EFEFEF] p-3">{s.url ? <video ref={refs[i]} src={s.url} controls playsInline preload="metadata" className="max-h-[62vh] w-auto max-w-full rounded-xl bg-black" /> : <div className="grid h-[40vh] place-items-center text-sm text-[var(--muted)]">Sin MP4 exportado de la v{s.current_version}.</div>}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--muted)]">Estilo</dt><dd>{s.preset ?? "—"}</dd><dt className="text-[var(--muted)]">Formato</dt><dd>{s.ratio ?? "—"}</dd><dt className="text-[var(--muted)]">Versión</dt><dd>v{s.version ?? s.current_version}</dd>
          <dt className="text-[var(--muted)]">Marca</dt><dd>{s.brand ? "Aplicada" : "Sin marca"}</dd><dt className="text-[var(--muted)]">Fragmento</dt><dd className="tnum">{s.start != null && s.end != null ? `${clock(s.start)}–${clock(s.end)} del original` : "—"}</dd></dl>
        <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => choose(s, "approved")} className="btn btn-primary !py-1.5 !text-xs">Elegir esta</button><button onClick={() => choose(s, "changes_requested")} className="btn btn-ghost !py-1.5 !text-xs">Solicitar cambios</button><Link href={`/app/c/${s.id}`} className="btn btn-ghost !py-1.5 !text-xs">Abrir editor</Link><Link href={`/app/r/${s.id}`} className="btn btn-ghost !py-1.5 !text-xs">Revisión</Link></div>
      </section>
    );
  };
  return (
    <main className="px-4 pb-12 pt-5 md:px-8">
      <nav aria-label="Ruta" className="mb-3 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Link href={`/app/p/${projectId}`} className="hover:underline">Proyecto</Link><span aria-hidden>/</span><span className="text-[var(--text)]">Comparar</span></nav>
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-3xl tracking-tight">Comparar variantes</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className={`flex items-center gap-2 ${sameFragment ? "" : "opacity-50"}`}><input type="checkbox" checked={sync} disabled={!sameFragment} onChange={(e) => setSync(e.target.checked)} />Reproducción sincronizada</label>
          <button onClick={close} className="btn btn-ghost">Cerrar comparación</button></div></div>
      <p className="mt-1 text-sm text-[var(--muted)]">{sameFragment ? "Mismo fragmento del original: puedes sincronizar la reproducción si lo activas." : "Son fragmentos distintos del original: no se ofrece una comparación temporal exacta."}</p>
      <div role="tablist" aria-label="Variante" className="mt-3 flex gap-1.5 md:hidden">{(["A", "B"] as const).map((l, i) => <button key={l} role="tab" aria-selected={pick === i} onClick={() => setPick(i as 0 | 1)} className="chip">Variante {l}</button>)}</div>
      <div className="mt-5 grid gap-8 md:grid-cols-2">{card(list[0], 0)}{card(list[1], 1)}</div>
      <p role="status" aria-live="polite" className="mt-4 min-h-5 text-sm">{msg}</p>
    </main>
  );
}
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense><Compare projectId={id} /></Suspense>; }
