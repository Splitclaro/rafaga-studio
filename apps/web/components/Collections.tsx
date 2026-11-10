"use client";
import { useCallback, useEffect, useState } from "react";
import { RAFAGA_COLLECTIONS } from "@rafaga/lyrics";
import { supabase, MAX_UPLOAD_BYTES } from "../lib/supabase";

export type MediaItem = { id: string; kind: "video" | "photo"; name: string; storage_path: string; url?: string };
export type Collection = { id: string; name: string; items: MediaItem[] };
const MEDIA = ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png", "image/webp"];

/** Colecciones propias del workspace con miniaturas firmadas. */
export function useCollections() {
  const [cols, setCols] = useState<Collection[] | null>(null);
  const reload = useCallback(async () => {
    const [{ data: c }, { data: it }] = await Promise.all([
      supabase.from("media_collections").select("id,name").order("created_at"),
      supabase.from("media_items").select("id,collection_id,kind,name,storage_path").order("created_at"),
    ]);
    const items = (it ?? []) as (MediaItem & { collection_id: string })[];
    await Promise.all(items.map(async (x) => { x.url = (await supabase.storage.from("originals").createSignedUrl(x.storage_path, 3600)).data?.signedUrl; }));
    setCols((c ?? []).map((k) => ({ id: k.id, name: k.name, items: items.filter((x) => x.collection_id === k.id) })));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { cols, reload };
}

export function Thumb({ item, className = "" }: { item: MediaItem; className?: string }) {
  if (!item.url) return <div className={`bg-[#222] ${className}`} />;
  return item.kind === "photo"
    ? <img src={item.url} alt="" className={`object-cover ${className}`} />
    : <video src={item.url} muted playsInline preload="metadata" className={`object-cover ${className}`} onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />;
}

export default function CollectionsPicker({ selected, onSelect, cols, reload }: { selected: string | null; onSelect: (id: string | null) => void; cols: Collection[] | null; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<"rafaga" | "custom">("custom");
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function ws() { const { data } = await supabase.from("workspaces").select("id").limit(1).single(); return data?.id as string; }
  async function create() {
    const name = newName.trim(); if (!name) return;
    const { data: s } = await supabase.auth.getSession();
    const { data, error } = await supabase.from("media_collections").insert({ workspace_id: await ws(), name, created_by: s.session?.user.id }).select("id").single();
    if (error) return setMsg(error.code === "23505" ? "Ya tienes una colección con ese nombre." : error.message);
    setNewName(""); setMsg(null); await reload(); onSelect(data.id);
  }
  async function upload(colId: string, files: FileList | null) {
    if (!files?.length) return;
    const { data: s } = await supabase.auth.getSession();
    const w = await ws();
    for (const f of Array.from(files)) {
      const mime = MEDIA.includes(f.type) ? f.type : /\.mov$/i.test(f.name) ? "video/quicktime" : /\.mp4$/i.test(f.name) ? "video/mp4" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : /\.png$/i.test(f.name) ? "image/png" : "";
      if (!mime) { setMsg(`«${f.name}» no es un vídeo (MP4, MOV, WebM) ni una foto (JPG, PNG, WebP).`); continue; }
      if (f.size > MAX_UPLOAD_BYTES) { setMsg(`«${f.name}» supera ${MAX_UPLOAD_BYTES / 1048576} MB.`); continue; }
      setBusy(`Subiendo ${f.name}…`);
      const path = `${w}/media/${colId}/${crypto.randomUUID()}.${mime.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg")}`;
      const up = await supabase.storage.from("originals").upload(path, f, { contentType: mime });
      if (up.error) { setMsg(up.error.message); continue; }
      const ins = await supabase.from("media_items").insert({ workspace_id: w, collection_id: colId, kind: mime.startsWith("image") ? "photo" : "video", name: f.name, storage_path: path, mime, bytes: f.size, created_by: s.session?.user.id });
      if (ins.error) { await supabase.storage.from("originals").remove([path]); setMsg(ins.error.message); }
    }
    setBusy(null); await reload();
  }
  async function removeItem(it: MediaItem) {
    await supabase.from("media_items").delete().eq("id", it.id);
    await supabase.storage.from("originals").remove([it.storage_path]); await reload();
  }
  async function removeCol(c: Collection) {
    if (!confirm(`¿Borrar la colección «${c.name}» y sus ${c.items.length} archivos?`)) return;
    await supabase.storage.from("originals").remove(c.items.map((i) => i.storage_path));
    await supabase.from("media_collections").delete().eq("id", c.id);
    if (selected === c.id) onSelect(null);
    await reload();
  }

  return (
    <div>
      <div role="tablist" className="inline-flex rounded-full bg-[var(--hover)] p-1 text-sm">
        {([["rafaga", "Ráfaga Collections"], ["custom", "Custom Collections"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 ${tab === k ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{l}</button>
        ))}
      </div>

      {tab === "rafaga" && (
        <>
          <p className="mt-3 text-sm text-[var(--muted)]">Colecciones de la plataforma. Se están preparando sus vídeos y fotos; mientras tanto, usa tus propias colecciones o un color sólido.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RAFAGA_COLLECTIONS.map((c) => (
              <li key={c.id} className="flex aspect-[4/3] flex-col justify-end rounded-2xl border border-dashed border-[var(--border)] p-3" aria-disabled>
                <span className="font-display text-lg leading-tight">{c.name}</span>
                <span className="text-xs text-[var(--muted)]">{c.hint}</span>
                <span className="mt-1 text-xs">Sin medios todavía</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "custom" && (
        <div className="mt-3">
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Nombre de la nueva colección" className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm" />
            <button onClick={create} disabled={!newName.trim()} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40">Crear colección</button>
          </div>
          {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
          {busy && <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--muted)]">{busy}</p>}
          {cols?.length === 0 && <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">Crea una colección y sube tus vídeos o fotos. Cada vídeo con letra los irá alternando de fondo.</p>}
          <ul className="mt-3 space-y-3">
            {cols?.map((c) => (
              <li key={c.id} className={`rounded-2xl border p-3 ${selected === c.id ? "border-[var(--ink)] ring-1 ring-[#111]" : "border-[var(--border)]"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => onSelect(selected === c.id ? null : c.id)} aria-pressed={selected === c.id} className="font-display min-w-0 flex-1 truncate text-left text-lg">{selected === c.id ? "✓ " : ""}{c.name}</button>
                  <span className="text-xs text-[var(--muted)] tnum">{c.items.length} archivo{c.items.length === 1 ? "" : "s"}</span>
                  <label className="cursor-pointer rounded-full border border-[var(--border)] px-3 py-1 text-xs">Añadir<input type="file" multiple accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { upload(c.id, e.target.files); e.target.value = ""; }} /></label>
                  <button onClick={() => removeCol(c)} className="text-xs underline">Borrar</button>
                </div>
                {!!c.items.length && (
                  <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {c.items.map((it) => (
                      <li key={it.id} className="group relative shrink-0">
                        <Thumb item={it} className="h-24 w-[54px] rounded-lg" />
                        <button onClick={() => removeItem(it)} aria-label={`Quitar ${it.name}`} className="absolute right-0.5 top-0.5 hidden h-5 w-5 rounded-full bg-black/70 text-xs text-white group-hover:block">×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
