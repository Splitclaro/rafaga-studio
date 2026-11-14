"use client";
// Biblioteca de Lyric Studio: Mis vídeos, Mis canciones, Paquetes de ganchos, Paquetes de medios, Estilos de texto y Portadas.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { listStylesV2 } from "../lib/styles";
import { officialCollections } from "../lib/lyricsettings";
import { libraryVideos, songBadge } from "../lib/lyriccutover";

const TABS = ["Mis vídeos", "Mis canciones", "Paquetes de ganchos", "Paquetes de medios", "Crear desde vídeo", "Colecciones Ráfaga", "Estilos de texto", "Portadas"] as const;
type Tab = (typeof TABS)[number];
type Row = { id: string; title: string; sub?: string };
type Hook = { id: string; name: string; hooks: string[] };
type Src = { id: string; duration_ms: number };
type Seg = { start_ms: number; end_ms: number; keep: boolean };

export default function LyricLibrary({ workspaceId }: { workspaceId: string | null }) {
  const [tab, setTab] = useState<Tab>("Mis canciones"), [rows, setRows] = useState<Row[] | null>(null), [packs, setPacks] = useState<Hook[]>([]);
  const [officialEmpty, setOfficialEmpty] = useState<string | null>(null), [sources, setSources] = useState<Src[]>([]), [colls, setColls] = useState<{ id: string; name: string }[]>([]);
  const [wz, setWz] = useState({ source: "", coll: "", length: 5, mode: "exacto" as "exacto" | "rapido" }), [segs, setSegs] = useState<Seg[]>([]), [busy, setBusy] = useState(false);
  const [name, setName] = useState(""), [text, setText] = useState(""), [editing, setEditing] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    if (tab === "Mis vídeos") {
      const [{ data: v2 }, { data: old }] = await Promise.all([supabase.from("renders").select("id,status,kind,created_at,clips(title)").eq("kind", "mp4").order("created_at", { ascending: false }).limit(30), supabase.from("lyric_videos").select("id,variant,status,storage_path,songs(title)").order("created_at", { ascending: false }).limit(30)]);
      setRows(libraryVideos((old ?? []).map((r: any) => ({ id: r.id, variant: r.variant, status: r.status, storage_path: r.storage_path, song_title: r.songs?.title })), (v2 ?? []).map((r: any) => ({ id: r.id, status: r.status, title: r.clips?.title }))).map((v) => ({ id: v.id, title: v.title, sub: `${v.status} · ${v.origin === "v2" ? "Nuevo" : "Flujo anterior"}` })));
    }
    else if (tab === "Mis canciones") { const { data } = await supabase.from("songs").select("id,title,artist,status,source_id").order("created_at", { ascending: false }); setRows((data ?? []).map((s: any) => ({ id: s.id, title: s.title, sub: `${s.artist ?? "Sin artista"} · ${s.status}${songBadge(s) ? ` · ${songBadge(s)} (solo en el flujo anterior)` : ""}` }))); }
    else if (tab === "Paquetes de ganchos") { const { data } = await supabase.from("hook_packs").select("id,name,hooks").order("created_at"); setPacks((data ?? []) as Hook[]); setRows([]); }
    else if (tab === "Estilos de texto") { const { data } = await supabase.from("text_styles").select("id,name,style"); setRows(listStylesV2((data ?? []) as never).map((s) => ({ id: s.id, title: s.name, sub: `${s.style.font} · ${s.preset}` }))); }
    else if (tab === "Colecciones Ráfaga") { const { data } = await supabase.from("media_collections").select("id,name,official").eq("purpose", "backgrounds"); const o = officialCollections((data ?? []) as { id: string; name: string; official: boolean }[]); setOfficialEmpty(o.empty); setRows(o.items.map((c) => ({ id: c.id, title: c.name }))); }
    else if (tab === "Crear desde vídeo") { const { data } = await supabase.from("sources").select("id,duration_ms,status").eq("status", "validated").not("width", "is", null).order("created_at", { ascending: false }).limit(30); setSources((data ?? []) as Src[]); const { data: cs } = await supabase.from("media_collections").select("id,name").eq("purpose", "backgrounds"); setColls((cs ?? []) as { id: string; name: string }[]); setRows([]); }
    else { const purpose = tab === "Portadas" ? "artwork" : "backgrounds"; const { data } = await supabase.from("media_collections").select("id,name,purpose").eq("purpose", purpose).order("created_at"); setRows((data ?? []).map((c: any) => ({ id: c.id, title: c.name }))); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const hdr = async (idem?: string) => ({ Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) });
  /** «Crear desde vídeo»: proponer segmentos → revisar/excluir → cortar (rápido o exacto) → guardar en el paquete. */
  async function propose() {
    setBusy(true); setMsg(null); setSegs([]);
    const r = await fetch("/api/lyrics/media/split", { method: "POST", headers: await hdr(`split-${crypto.randomUUID()}`), body: JSON.stringify({ source_id: wz.source, collection_id: wz.coll, length_s: wz.length }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { setBusy(false); return setMsg(j?.error?.message ?? j?.field ? "Revisa la duración elegida." : "No se pudo analizar el vídeo."); }
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const { data } = await supabase.from("job_stages").select("status,output").eq("job_id", j.job_id).limit(1);
      const st = data?.[0] as { status: string; output: { segments?: { start_ms: number; end_ms: number }[] } } | undefined;
      if (st?.status === "done") { setSegs((st.output.segments ?? []).map((g) => ({ ...g, keep: true }))); setBusy(false); return setMsg("Revisa los segmentos y excluye los que no quieras."); }
      if (st?.status === "failed") break;
    }
    setBusy(false); setMsg("No se pudo analizar el vídeo. Inténtalo de nuevo.");
  }
  async function cutSegments() {
    const keep = segs.filter((g) => g.keep).map(({ start_ms, end_ms }) => ({ start_ms, end_ms })); if (!keep.length) return setMsg("Elige al menos un segmento.");
    setBusy(true); const r = await fetch("/api/lyrics/media/cut", { method: "POST", headers: await hdr(`cut-${crypto.randomUUID()}`), body: JSON.stringify({ source_id: wz.source, collection_id: wz.coll, segments: keep, cut_mode: wz.mode }) });
    setBusy(false); setMsg(r.ok ? `Cortando ${keep.length} segmentos sin audio. Aparecerán en el paquete en unos segundos.` : "No se pudo cortar el vídeo.");
  }
  /** Subida directa a R2: crea el elemento, PUT con la URL firmada y completa con duración y tamaño leídos en el navegador. */
  async function uploadMedia(file: File, collection: string) {
    setBusy(true); setMsg(null);
    try {
      const kind = file.type.startsWith("video/") ? "video" : "photo";
      const meta = await new Promise<{ duration_ms: number; width: number; height: number }>((res) => {
        const url = URL.createObjectURL(file);
        if (kind === "video") { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => { res({ duration_ms: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight }); URL.revokeObjectURL(url); }; v.onerror = () => res({ duration_ms: 0, width: 0, height: 0 }); v.src = url; }
        else { const im = new Image(); im.onload = () => { res({ duration_ms: 0, width: im.naturalWidth, height: im.naturalHeight }); URL.revokeObjectURL(url); }; im.onerror = () => res({ duration_ms: 0, width: 0, height: 0 }); im.src = url; }
      });
      const r = await fetch("/api/lyrics/media/items", { method: "POST", headers: await hdr(), body: JSON.stringify({ collection_id: collection, name: file.name.replace(/\.[^.]+$/, ""), kind, mime: file.type, bytes: file.size }) });
      const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? "No se pudo empezar la subida.");
      const put = await fetch(j.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file }); if (!put.ok) throw new Error("La subida a almacenamiento falló.");
      await fetch(`/api/lyrics/media/items/${j.item_id}/complete`, { method: "POST", headers: await hdr(), body: JSON.stringify(meta) });
      setMsg("Archivo subido."); void load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function newCollection(purpose: "backgrounds" | "artwork") {
    const n = window.prompt("Nombre del paquete"); if (!n?.trim() || !workspaceId) return;
    const { error } = await supabase.rpc("create_media_collection", { p_ws: workspaceId, p_name: n.trim(), p_purpose: purpose });
    setMsg(error ? (error.message.includes("duplicate") ? "Ya tienes un paquete con ese nombre." : "No se pudo crear el paquete.") : "Paquete creado."); void load();
  }
  const [target, setTarget] = useState("");
  /** «Probar con la canción de demostración»: cada apertura crea su propia copia en tu espacio. */
  async function openDemo() {
    setBusy(true); const r = await fetch("/api/lyrics/demo", { method: "POST", headers: await hdr(`demo-${crypto.randomUUID()}`) }); setBusy(false);
    setMsg(r.ok ? "Preparando la canción de demostración. En unos segundos aparecerá en Mis canciones." : "No se pudo abrir la demostración."); if (r.ok) void load();
  }
  async function savePack() {
    if (!workspaceId) return setMsg("No se encontró tu espacio de trabajo.");
    const hooks = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!name.trim() || !hooks.length) return setMsg("Ponle un nombre y escribe al menos un gancho (uno por línea).");
    const { error } = await supabase.rpc("save_hook_pack", { p_ws: workspaceId, p_id: editing, p_name: name.trim(), p_hooks: hooks });
    if (error) return setMsg(error.message.includes("hook") ? "Revisa los ganchos: máximo 100 por paquete y 120 caracteres cada uno." : "No se pudo guardar el paquete.");
    setMsg("Paquete guardado."); setName(""); setText(""); setEditing(null); void load();
  }
  return (
    <section className="card space-y-3 p-4" aria-label="Biblioteca">
      <div role="tablist" className="flex flex-wrap gap-2">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full border px-3 py-1 text-xs ${tab === t ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "hairline"}`}>{t}</button>)}</div>
      {tab === "Crear desde vídeo" ? (
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <label>Vídeo<select className="w-full rounded-lg border hairline px-2 py-1.5" value={wz.source} onChange={(e) => setWz({ ...wz, source: e.target.value })}><option value="">Elige un vídeo</option>{sources.map((x) => <option key={x.id} value={x.id}>{Math.round(x.duration_ms / 1000)} s · {x.id.slice(0, 6)}</option>)}</select></label>
            <label>Paquete de destino<select className="w-full rounded-lg border hairline px-2 py-1.5" value={wz.coll} onChange={(e) => setWz({ ...wz, coll: e.target.value })}><option value="">Elige un paquete</option>{colls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Duración de cada segmento<select className="w-full rounded-lg border hairline px-2 py-1.5" value={wz.length} onChange={(e) => setWz({ ...wz, length: Number(e.target.value) })}>{[3, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n} s</option>)}</select></label>
          </div>
          <button className="btn btn-primary !min-h-9" disabled={busy || !wz.source || !wz.coll} onClick={() => void propose()}>{busy ? "Analizando…" : "Proponer segmentos"}</button>
          {segs.length > 0 && <>
            <ul className="space-y-1">{segs.map((g, i) => <li key={i} className="flex items-center gap-2"><input type="checkbox" checked={g.keep} onChange={(e) => setSegs(segs.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} aria-label={`Incluir segmento ${i + 1}`} /> {(g.start_ms / 1000).toFixed(1)} s → {(g.end_ms / 1000).toFixed(1)} s</li>)}</ul>
            <div role="radiogroup" aria-label="Tipo de corte" className="flex gap-3"><label><input type="radio" checked={wz.mode === "exacto"} onChange={() => setWz({ ...wz, mode: "exacto" })} /> Exacto (recodifica)</label><label><input type="radio" checked={wz.mode === "rapido"} onChange={() => setWz({ ...wz, mode: "rapido" })} /> Rápido (sin recodificar)</label></div>
            <button className="btn btn-primary !min-h-9" disabled={busy} onClick={() => void cutSegments()}>Guardar en el paquete</button></>}
        </div>
      ) : tab === "Colecciones Ráfaga" && officialEmpty ? <p className="text-sm text-[var(--muted)]">{officialEmpty}</p>
      : tab === "Paquetes de ganchos" ? (
        <div className="space-y-3">
          <div className="grid gap-2"><input className="w-full rounded-lg border hairline px-2 py-1.5 text-sm" placeholder="Nombre del paquete" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nombre del paquete" />
            <textarea className="w-full rounded-lg border hairline px-2 py-1.5 text-sm" rows={4} placeholder="Un gancho por línea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ganchos" />
            <div><button className="btn btn-primary !min-h-9" onClick={() => void savePack()}>{editing ? "Guardar cambios" : "Crear paquete"}</button></div></div>
          {packs.length === 0 ? <p className="text-sm text-[var(--muted)]">Aún no tienes paquetes de ganchos.</p> : <ul className="space-y-1 text-sm">{packs.map((p) => <li key={p.id} className="flex items-center justify-between rounded-lg border hairline px-3 py-2"><span><b>{p.name}</b> · {p.hooks.length} ganchos</span><button className="btn btn-ghost !min-h-8" onClick={() => { setEditing(p.id); setName(p.name); setText(p.hooks.join("\n")); }}>Editar</button></li>)}</ul>}
        </div>
      ) : rows === null ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : !rows.length ? <p className="text-sm text-[var(--muted)]">Aquí aparecerán tus {tab.toLowerCase()}.</p> : (
        <ul className="divide-y hairline text-sm">{rows.map((r) => <li key={r.id} className="flex justify-between gap-3 py-2"><span className="font-medium">{r.title}</span><span className="text-xs text-[var(--muted)]">{r.sub}</span></li>)}</ul>)}
      {(tab === "Paquetes de medios" || tab === "Portadas") && <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Subir a" className="rounded-lg border hairline px-2 py-1.5" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Subir a…</option>{(rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
        <input type="file" accept={tab === "Portadas" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"} disabled={!target || busy} onChange={(e) => { const f = e.target.files?.[0]; if (f && target) void uploadMedia(f, target); e.target.value = ""; }} aria-label="Archivo" />
        <button className="btn btn-ghost !min-h-9" onClick={() => void newCollection(tab === "Portadas" ? "artwork" : "backgrounds")}>Nuevo paquete</button></div>}
      {tab === "Mis canciones" && <div><button className="btn btn-ghost !min-h-9" disabled={busy} onClick={() => void openDemo()}>Probar con la canción de demostración</button></div>}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
