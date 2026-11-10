"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type D = { id: string; name: string; description: string | null; project_id: string; cover_clip_id: string | null; created_at: string; items: number; approved: number; cover?: string; project?: string };

export default function Entregas() {
  const [rows, setRows] = useState<D[] | null>(null);
  useEffect(() => { (async () => {
    const { data: ds } = await supabase.from("deliveries").select("id,name,description,project_id,cover_clip_id,created_at").order("created_at", { ascending: false });
    const list = (ds ?? []) as D[]; const ids = list.map((d) => d.id);
    const [{ data: it }, { data: ps }] = await Promise.all([
      ids.length ? supabase.from("delivery_items").select("delivery_id,clip_id,version,clips!inner(review_status,approved_version,thumb_path)").in("delivery_id", ids) : { data: [] },
      list.length ? supabase.from("projects").select("id,name").in("id", [...new Set(list.map((d) => d.project_id))]) : { data: [] },
    ]);
    const items = (it ?? []) as unknown as { delivery_id: string; clip_id: string; version: number; clips: { review_status: string; approved_version: number | null; thumb_path: string | null } }[];
    const pn = new Map((ps ?? []).map((p) => [p.id, p.name]));
    const coverPath = new Map<string, string>();
    for (const d of list) { const c = items.find((x) => x.delivery_id === d.id && x.clip_id === d.cover_clip_id) ?? items.find((x) => x.delivery_id === d.id && x.clips.thumb_path); if (c?.clips.thumb_path) coverPath.set(d.id, c.clips.thumb_path); }
    const paths = [...new Set(coverPath.values())];
    const sg = paths.length ? (await supabase.storage.from("renders").createSignedUrls(paths, 3600)).data ?? [] : [];
    const um = new Map(sg.map((x) => [x.path, x.signedUrl]));
    setRows(list.map((d) => { const mine = items.filter((x) => x.delivery_id === d.id); return { ...d, project: pn.get(d.project_id), items: mine.length, approved: mine.filter((x) => x.clips.review_status === "approved" && x.clips.approved_version === x.version).length, cover: coverPath.get(d.id) ? um.get(coverPath.get(d.id)!) ?? undefined : undefined }; }));
  })(); }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <h1 className="text-3xl tracking-tight">Entregas</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Selecciones de piezas con su versión fijada, listas para revisar y descargar. Se crean desde los resultados de un proyecto con «Añadir a entrega».</p>
      {!rows ? <div className="skeleton mt-8 h-64" /> : !rows.length ? (
        <div className="mt-8 rounded-3xl bg-[var(--surface)] p-12 text-center"><p className="text-lg tracking-tight">Aún no hay entregas</p><p className="mt-1 text-sm text-[var(--muted)]">Abre un proyecto, selecciona las piezas y pulsa «Añadir a entrega».</p><Link href="/app/biblioteca" className="btn btn-primary mt-5">Ir a los proyectos</Link></div>
      ) : (
        <ul className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{rows.map((d) => (
          <li key={d.id}><Link href={`/app/entregas/${d.id}`} className="group block">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-[var(--hover)]">{d.cover ? <img src={d.cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" /> : <div className="grid h-full place-items-center text-xs text-white/60">Sin portada</div>}</div>
            <h2 className="mt-3 text-base font-medium tracking-tight">{d.name}</h2>
            <p className="text-sm text-[var(--muted)]">{d.project ?? "Proyecto"} · {d.items} pieza{d.items === 1 ? "" : "s"} · {d.approved} aprobada{d.approved === 1 ? "" : "s"}</p>
            <p className="text-xs text-[var(--muted)]">{new Date(d.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}</p></Link></li>))}</ul>)}
    </main>
  );
}
