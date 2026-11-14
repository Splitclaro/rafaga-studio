"use client";
// Biblioteca de Lyric Studio: Mis vídeos, Mis canciones, Paquetes de ganchos, Paquetes de medios, Estilos de texto y Portadas.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { listStylesV2 } from "../lib/styles";

const TABS = ["Mis vídeos", "Mis canciones", "Paquetes de ganchos", "Paquetes de medios", "Estilos de texto", "Portadas"] as const;
type Tab = (typeof TABS)[number];
type Row = { id: string; title: string; sub?: string };
type Hook = { id: string; name: string; hooks: string[] };

export default function LyricLibrary({ workspaceId }: { workspaceId: string | null }) {
  const [tab, setTab] = useState<Tab>("Mis canciones"), [rows, setRows] = useState<Row[] | null>(null), [packs, setPacks] = useState<Hook[]>([]);
  const [name, setName] = useState(""), [text, setText] = useState(""), [editing, setEditing] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    if (tab === "Mis vídeos") { const { data } = await supabase.from("renders").select("id,status,kind,created_at,clips(title)").eq("kind", "mp4").order("created_at", { ascending: false }).limit(30); setRows((data ?? []).map((r: any) => ({ id: r.id, title: r.clips?.title ?? "Vídeo", sub: `${r.status} · ${new Date(r.created_at).toLocaleDateString("es")}` }))); }
    else if (tab === "Mis canciones") { const { data } = await supabase.from("songs").select("id,title,artist,status").not("source_id", "is", null).order("created_at", { ascending: false }); setRows((data ?? []).map((s: any) => ({ id: s.id, title: s.title, sub: `${s.artist ?? "Sin artista"} · ${s.status}` }))); }
    else if (tab === "Paquetes de ganchos") { const { data } = await supabase.from("hook_packs").select("id,name,hooks").order("created_at"); setPacks((data ?? []) as Hook[]); setRows([]); }
    else if (tab === "Estilos de texto") { const { data } = await supabase.from("text_styles").select("id,name,style"); setRows(listStylesV2((data ?? []) as never).map((s) => ({ id: s.id, title: s.name, sub: `${s.style.font} · ${s.preset}` }))); }
    else { const purpose = tab === "Portadas" ? "artwork" : "backgrounds"; const { data } = await supabase.from("media_collections").select("id,name,purpose").eq("purpose", purpose).order("created_at"); setRows((data ?? []).map((c: any) => ({ id: c.id, title: c.name }))); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

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
      {tab === "Paquetes de ganchos" ? (
        <div className="space-y-3">
          <div className="grid gap-2"><input className="w-full rounded-lg border hairline px-2 py-1.5 text-sm" placeholder="Nombre del paquete" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nombre del paquete" />
            <textarea className="w-full rounded-lg border hairline px-2 py-1.5 text-sm" rows={4} placeholder="Un gancho por línea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ganchos" />
            <div><button className="btn btn-primary !min-h-9" onClick={() => void savePack()}>{editing ? "Guardar cambios" : "Crear paquete"}</button></div></div>
          {packs.length === 0 ? <p className="text-sm text-[var(--muted)]">Aún no tienes paquetes de ganchos.</p> : <ul className="space-y-1 text-sm">{packs.map((p) => <li key={p.id} className="flex items-center justify-between rounded-lg border hairline px-3 py-2"><span><b>{p.name}</b> · {p.hooks.length} ganchos</span><button className="btn btn-ghost !min-h-8" onClick={() => { setEditing(p.id); setName(p.name); setText(p.hooks.join("\n")); }}>Editar</button></li>)}</ul>}
        </div>
      ) : rows === null ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : !rows.length ? <p className="text-sm text-[var(--muted)]">Aquí aparecerán tus {tab.toLowerCase()}.</p> : (
        <ul className="divide-y hairline text-sm">{rows.map((r) => <li key={r.id} className="flex justify-between gap-3 py-2"><span className="font-medium">{r.title}</span><span className="text-xs text-[var(--muted)]">{r.sub}</span></li>)}</ul>)}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}
