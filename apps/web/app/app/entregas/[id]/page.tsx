"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { downloadMp4 } from "../../../../lib/download";
import Icon from "../../../../components/Icon";
import ShareLinks from "../../../../components/ui/ShareLinks";
import PackagePanel from "../../../../components/ui/PackagePanel";
import { StatusLabel, STATUS_LABEL, pieceStatus, fmtDur } from "../../../../components/ui/status";

type Item = { clip_id: string; version: number; position: number; clip: { title: string; review_status: string; approved_version: number | null; current_version: number; thumb_path: string | null; project_id: string } ; render?: { storage_path: string; ratio: string; probe: { duration?: string | number; size?: string | number; brand?: string | null } | null; burn_subtitles: boolean }; thumb?: string };
const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "pieza";
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

export default function Entrega({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<{ name: string; description: string | null; project_id: string; created_at: string } | null>(null);
  const [project, setProject] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [only, setOnly] = useState<"all" | "approved">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: dl } = await supabase.from("deliveries").select("id,name,description,project_id,created_at").eq("id", id).maybeSingle();
    if (!dl) return setErr("No se encontró la entrega o no tienes acceso.");
    setD(dl);
    const [{ data: pr }, { data: it }, { data: ws }] = await Promise.all([
      supabase.from("projects").select("name,brand_kit_id").eq("id", dl.project_id).maybeSingle(),
      supabase.from("delivery_items").select("clip_id,version,position,clip:clips!inner(title,review_status,approved_version,current_version,thumb_path,project_id)").eq("delivery_id", id).order("position"),
      supabase.rpc("my_workspaces"),
    ]);
    setProject(pr?.name ?? ""); setRole(((ws ?? []) as { role: string; active: boolean }[]).find((w) => w.active)?.role ?? "");
    if (pr?.brand_kit_id) { const { data: k } = await supabase.from("brand_kits").select("name").eq("id", pr.brand_kit_id).maybeSingle(); setBrand(k?.name ?? null); }
    const list = (it ?? []) as unknown as Item[]; const cids = list.map((x) => x.clip_id);
    const { data: rs } = cids.length ? await supabase.from("renders").select("clip_id,clip_version,ratio,storage_path,probe,burn_subtitles,created_at").in("clip_id", cids).eq("status", "ready").order("created_at", { ascending: false }) : { data: [] };
    for (const x of list) x.render = ((rs ?? []) as { clip_id: string; clip_version: number; ratio: string; storage_path: string; probe: Item["render"] extends infer R ? (R extends { probe: infer P } ? P : never) : never; burn_subtitles: boolean }[]).find((r) => r.clip_id === x.clip_id && r.clip_version === x.version);
    const tp = list.map((x) => x.clip.thumb_path).filter((v): v is string => !!v);
    const sg = tp.length ? (await supabase.storage.from("renders").createSignedUrls(tp, 3600)).data ?? [] : []; const um = new Map(sg.map((v) => [v.path, v.signedUrl]));
    for (const x of list) if (x.clip.thumb_path) x.thumb = um.get(x.clip.thumb_path) ?? undefined;
    setItems(list);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (items ?? []).map((x) => ({ x, st: pieceStatus({ review_status: x.clip.review_status, approved_version: x.clip.approved_version === x.version ? x.version : x.clip.approved_version, current_version: x.version, hasRender: !!x.render }) })), [items]);
  const shown = rows.filter((r) => only === "all" || r.st.status === "approved");
  const approvedN = rows.filter((r) => r.st.status === "approved").length;
  const canEdit = ["owner", "admin", "editor", "member"].includes(role);
  const target = sel.size ? shown.filter((r) => sel.has(r.x.clip_id)) : shown;
  const withFile = target.filter((r) => r.x.render);

  const nameOf = (r: (typeof rows)[number], i: number) => `${safe(brand ?? project)}_${safe(project)}_${String(i + 1).padStart(2, "0")}-${safe(r.x.clip.title)}_${(r.x.render?.ratio ?? "9:16").replace(":", "x")}_v${r.x.version}.mp4`;
  async function downloadOne(r: (typeof rows)[number], i: number) {
    if (!r.x.render) return; const res = await downloadMp4("renders", r.x.render.storage_path, nameOf(r, i)); if (!res.ok) alert(res.error);
  }
  async function downloadAll() {
    if (!withFile.length) return setMsg("Ninguna pieza de esta selección tiene MP4 de la versión entregada.");
    setBusy(`Descargando ${withFile.length}…`); setMsg("Si el navegador pide permiso para varias descargas, acéptalo. Para un ZIP usa «Paquete de entrega» más abajo: son descargas individuales más el manifiesto.");
    for (const r of withFile) { await downloadOne(r, rows.indexOf(r)); await new Promise((res) => setTimeout(res, 900)); }
    const manifest = { entrega: d?.name, proyecto: project, marca: brand, exportado: new Date().toISOString(), piezas: withFile.map((r) => ({ titulo: r.x.clip.title, archivo: nameOf(r, rows.indexOf(r)), version: r.x.version, formato: r.x.render!.ratio, duracion_s: r.x.render!.probe?.duration ? +Number(r.x.render!.probe!.duration).toFixed(1) : null, subtitulos_incrustados: r.x.render!.burn_subtitles, estado: STATUS_LABEL(r.st.status), id_interno: r.x.clip_id })) };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })); a.download = `${safe(project)}_${safe(d?.name ?? "entrega")}_manifiesto.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setBusy(null);
  }
  async function remove() {
    if (!confirm("¿Borrar esta entrega? Solo desaparece la selección: los clips y sus MP4 se conservan.")) return;
    const { error } = await supabase.rpc("delete_delivery", { p_id: id }); if (error) return setMsg(error.message); router.push("/app/entregas");
  }

  if (err) return <main className="mx-auto max-w-xl px-4 py-16 text-center">{err}<br /><Link href="/app/entregas" className="underline">Ver entregas</Link></main>;
  if (!d || !items) return <main className="mx-auto max-w-6xl px-4 py-10"><div className="skeleton h-80" /></main>;
  const cover = items.find((x) => x.thumb)?.thumb;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-8">
      <nav aria-label="Ruta" className="mb-5 flex items-center gap-1.5 text-sm text-[var(--muted)]"><Link href="/app/entregas" className="hover:underline">Entregas</Link><span aria-hidden>/</span><span className="text-[var(--text)]">{d.name}</span></nav>
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        {cover && <img src={cover} alt="" className="h-40 w-28 shrink-0 rounded-2xl object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--muted)]">{brand ? `${brand} · ` : ""}{project}</p>
          <h1 className="text-3xl tracking-tight md:text-4xl">{d.name}</h1>
          {d.description && <p className="mt-2 max-w-2xl text-[var(--muted)]">{d.description}</p>}
          <p className="mt-2 text-sm text-[var(--muted)]">{items.length} pieza{items.length === 1 ? "" : "s"} · {approvedN} aprobada{approvedN === 1 ? "" : "s"} · creada el {new Date(d.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="flex flex-wrap gap-2"><button onClick={downloadAll} disabled={!!busy || !withFile.length} className="btn btn-primary"><Icon n="download" className="h-4 w-4" />{sel.size ? `Descargar selección (${withFile.length})` : only === "approved" ? `Descargar aprobadas (${withFile.length})` : `Descargar todo (${withFile.length})`}</button>{canEdit && <button onClick={remove} className="btn btn-ghost">Borrar entrega</button>}</div>
      </header>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-[var(--muted)]">{busy ?? msg}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2"><div role="tablist" aria-label="Contenido" className="flex gap-1.5">{([["all", `Todas (${rows.length})`], ["approved", `Solo aprobadas (${approvedN})`]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={only === k} onClick={() => setOnly(k)} className="chip">{l}</button>)}</div>
        <button onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map((r) => r.x.clip_id)))} className="ml-auto text-sm underline">{sel.size === shown.length && shown.length ? "Quitar selección" : "Seleccionar todo"}</button></div>

      {!shown.length ? <p className="mt-6 rounded-2xl bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">{only === "approved" ? "Ninguna pieza de esta entrega está aprobada todavía." : "Esta entrega no tiene piezas."}</p> : (
        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4">{shown.map((r) => { const i = rows.indexOf(r); const on = sel.has(r.x.clip_id); return (
          <li key={r.x.clip_id} className={`rounded-2xl p-1.5 ${on ? "bg-[var(--hover)] ring-2 ring-[#111]" : ""}`}>
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[var(--ink)]">
              {r.x.thumb ? <img src={r.x.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-xs text-white/60">Sin portada</div>}
              <label className="absolute left-2 top-2 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-white/90"><span className="sr-only">Seleccionar «{r.x.clip.title}»</span><input type="checkbox" checked={on} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.x.clip_id)) n.delete(r.x.clip_id); else n.add(r.x.clip_id); return n; })} className="h-4 w-4 accent-black" /></label>
              {r.x.render?.probe?.duration ? <span className="tnum absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs text-white">{fmtDur(Number(r.x.render.probe.duration) * 1000)}</span> : null}
            </div>
            <div className="px-1 pb-1 pt-2.5"><h3 className="line-clamp-2 text-[15px] font-medium leading-snug">{r.x.clip.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusLabel status={r.st.status} note={r.st.note} /><span className="tnum text-xs text-[var(--muted)]">{r.x.render?.ratio ?? "—"} · v{r.x.version}{r.x.render?.probe?.size ? ` · ${mb(Number(r.x.render.probe.size))}` : ""}</span></div>
              {r.x.version !== r.x.clip.current_version && <p className="mt-1 text-[11px] text-[var(--muted)]">El clip ya va por la v{r.x.clip.current_version}; esta entrega conserva la v{r.x.version}.</p>}
              <div className="mt-2.5 flex gap-1.5"><Link href={`/app/r/${r.x.clip_id}`} className="btn btn-ghost flex-1 !py-1.5 !text-xs">Abrir revisión</Link><button onClick={() => downloadOne(r, i)} disabled={!r.x.render} aria-label={`Descargar ${r.x.clip.title}`} className="btn btn-ghost !px-3 !py-1.5 disabled:opacity-40"><Icon n="download" className="h-4 w-4" /></button></div></div>
          </li>); })}</ul>)}

      <PackagePanel deliveryId={id} canEdit={canEdit} total={rows.length} approved={approvedN} bytes={{ all: rows.reduce((a, r) => a + Number(r.x.render?.probe?.size ?? 0), 0), approved: rows.filter((r) => r.st.status === "approved").reduce((a, r) => a + Number(r.x.render?.probe?.size ?? 0), 0) }} />
      <ShareLinks deliveryId={id} canEdit={canEdit} />
    </main>
  );
}
