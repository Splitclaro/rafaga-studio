"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { supabase, MAX_UPLOAD_BYTES } from "../lib/supabase";
import { sniffAudio } from "../lib/projects";
import { KIND_LABEL, KIND_ORDER, assetHref, countByKind, filterAssets, findDuplicates, findExisting, fmtBytes, type Asset, type AssetKind } from "../lib/library";

const PAGE = 48;
const MEDIA_MIME = (f: File) => (["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png", "image/webp"].includes(f.type) ? f.type : /\.mov$/i.test(f.name) ? "video/quicktime" : /\.mp4$/i.test(f.name) ? "video/mp4" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : /\.png$/i.test(f.name) ? "image/png" : "");
const KIND_ICON: Record<AssetKind, string> = { video: "film", image: "layers", audio: "music", logo: "layers", font: "type", export: "download" };
const day = (d: string) => new Date(d).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });

/** Biblioteca única: todo lo del espacio activo en una lista, con filtros por tipo y detección de duplicados. */
export default function LibraryAll({ q, onChanged }: { q: string; onChanged?: () => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [dupOnly, setDupOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("library_assets");
    if (error) { setMsg(error.message); setAssets([]); return; }
    setAssets(((data ?? []) as Asset[]).map((a) => ({ ...a, bytes: a.bytes == null ? null : Number(a.bytes) })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => findDuplicates(assets ?? []), [assets]);
  const dupKeys = useMemo(() => new Set(groups.flatMap((g) => g.assets.map((a) => a.asset_key))), [groups]);
  const exactN = groups.filter((g) => g.confidence === "exact").length;
  const counts = useMemo(() => countByKind(assets ?? []), [assets]);
  const list = useMemo(() => filterAssets(assets ?? [], { kind, q, dupKeys: dupOnly ? dupKeys : null }), [assets, kind, q, dupOnly, dupKeys]);
  const page = list.slice(0, shown);
  useEffect(() => { setShown(PAGE); }, [kind, q, dupOnly]);

  // Miniaturas solo de la página visible (imágenes y vídeos)
  useEffect(() => {
    const need = page.filter((a) => (a.kind === "image" || a.kind === "video" || a.kind === "logo") && !urls[a.asset_key]);
    if (!need.length) return;
    let alive = true;
    (async () => {
      const got: Record<string, string> = {};
      await Promise.all(need.map(async (a) => { const r = await supabase.storage.from(a.bucket).createSignedUrl(a.storage_path, 3600); if (r.data?.signedUrl) got[a.asset_key] = r.data.signedUrl; }));
      if (alive) setUrls((u) => ({ ...u, ...got }));
    })();
    return () => { alive = false; };
  }, [page, urls]);

  async function download(a: Asset) {
    const { data } = await supabase.storage.from(a.bucket).createSignedUrl(a.storage_path, 300, { download: a.name });
    if (data?.signedUrl) window.location.href = data.signedUrl; else setMsg("No se pudo generar el enlace de descarga.");
  }
  async function removeCopies(gi: number) {
    const g = groups[gi]; if (!g?.removable.length) return;
    const names = g.removable.map((a) => `«${a.name}»${a.container ? ` (${a.container})` : ""}`).join(", ");
    if (!confirm(`Se conserva «${g.keep.name}»${g.keep.container ? ` (${g.keep.container})` : ""}, la más antigua.\n\nSe borrarán ${g.removable.length} copia${g.removable.length === 1 ? "" : "s"}: ${names}.\n\nNo se puede deshacer. Si una copia está en otro pack, ese pack dejará de tenerla.`)) return;
    setBusy("Quitando copias…");
    for (const a of g.removable) {
      const { error } = await supabase.from("media_items").delete().eq("id", a.ref_id);
      if (error) { setMsg(error.message); break; }
      await supabase.storage.from(a.bucket).remove([a.storage_path]);
    }
    setBusy(null); await load(); onChanged?.();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const { data: s } = await supabase.auth.getSession();
    const { data: wsr } = await supabase.from("workspaces").select("id").limit(1).single();
    const w = wsr?.id as string | undefined; const uid = s.session?.user.id;
    if (!w || !uid) return setMsg("Sesión no válida.");
    let packId: string | null = null; const notes: string[] = [];
    for (const f of Array.from(files)) {
      const dupes = findExisting(f, assets ?? []);
      if (dupes.length && !confirm(`Ya tienes «${dupes[0].name}» con el mismo tamaño${dupes[0].container ? ` en ${dupes[0].container}` : ""}. ¿Subir «${f.name}» igualmente?`)) { notes.push(`«${f.name}» omitido: ya existe.`); continue; }
      if (f.size > MAX_UPLOAD_BYTES) { notes.push(`«${f.name}» supera ${MAX_UPLOAD_BYTES / 1048576} MB.`); continue; }
      setBusy(`Subiendo ${f.name}…`);
      const audio = await sniffAudio(f);
      if (audio) {
        const path = `${w}/songs/${crypto.randomUUID()}.${audio === "audio/mpeg" ? "mp3" : "wav"}`;
        const up = await supabase.storage.from("originals").upload(path, f, { contentType: audio });
        if (up.error) { notes.push(`${f.name}: ${up.error.message}`); continue; }
        const ins = await supabase.from("songs").insert({ workspace_id: w, title: f.name.replace(/\.[^.]+$/, ""), storage_path: path, mime: audio, bytes: f.size, created_by: uid });
        if (ins.error) { await supabase.storage.from("originals").remove([path]); notes.push(`${f.name}: ${ins.error.message}`); }
        continue;
      }
      const mime = MEDIA_MIME(f);
      if (!mime) { notes.push(`«${f.name}» no es un vídeo (MP4, MOV, WebM), una foto (JPG, PNG, WebP) ni un audio (MP3, WAV). Las fuentes y logos se suben en Marca.`); continue; }
      if (!packId) {   // los medios viven en packs: se usa (o crea) «Sin clasificar»
        const ex = await supabase.from("media_collections").select("id").eq("name", "Sin clasificar").maybeSingle();
        packId = ex.data?.id ?? (await supabase.from("media_collections").insert({ workspace_id: w, name: "Sin clasificar", created_by: uid }).select("id").single()).data?.id ?? null;
        if (!packId) { notes.push("No se pudo crear el pack «Sin clasificar»."); break; }
      }
      const path = `${w}/media/${packId}/${crypto.randomUUID()}.${mime.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg")}`;
      const up = await supabase.storage.from("originals").upload(path, f, { contentType: mime });
      if (up.error) { notes.push(`${f.name}: ${up.error.message}`); continue; }
      const ins = await supabase.from("media_items").insert({ workspace_id: w, collection_id: packId, kind: mime.startsWith("image") ? "photo" : "video", name: f.name, storage_path: path, mime, bytes: f.size, created_by: uid });
      if (ins.error) { await supabase.storage.from("originals").remove([path]); notes.push(`${f.name}: ${ins.error.message}`); }
    }
    setBusy(null); setMsg(notes.length ? notes.join(" ") : null); await load(); onChanged?.();
  }

  return (
    <section aria-label="Todo el contenido">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1">
          <button aria-pressed={kind === "all"} onClick={() => setKind("all")} className="chip">Todo <span className="mono text-xs opacity-70">{assets ? counts.all : "·"}</span></button>
          {KIND_ORDER.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className="chip">{KIND_LABEL[k]} <span className="mono text-xs opacity-70">{assets ? counts[k] : "·"}</span></button>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button aria-pressed={dupOnly} onClick={() => setDupOnly(!dupOnly)} disabled={!groups.length} className="chip disabled:opacity-40">Duplicados <span className="mono text-xs opacity-70">{groups.length}</span></button>
          <label className="btn btn-primary !py-1.5 !text-xs cursor-pointer"><Icon n="upload" className="h-3.5 w-3.5" />Subir<input type="file" multiple className="sr-only" accept="video/*,image/*,audio/*,.mp3,.wav,.mov" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} /></label>
        </div>
      </div>
      {msg && <p role="alert" className="card mb-4 p-3 text-sm">{msg}</p>}
      {busy && <p role="status" aria-live="polite" className="mb-3 text-sm text-[var(--muted)]">{busy}</p>}

      {!!groups.length && (dupOnly || exactN > 0) && (
        <details open={dupOnly} className="card mb-5 p-4">
          <summary className="cursor-pointer text-sm font-medium">{exactN ? `${exactN} grupo${exactN === 1 ? "" : "s"} de duplicados exactos` : "Sin duplicados exactos"}{groups.length - exactN ? ` · ${groups.length - exactN} posible${groups.length - exactN === 1 ? "" : "s"}` : ""}</summary>
          <p className="mt-2 text-xs text-[var(--muted)]">Exacto: mismo contenido y tamaño. Posible: mismo nombre y tamaño, sin poder confirmarlo. Las exportaciones no cuentan: se pueden regenerar.</p>
          <ul className="mt-3 space-y-3">{groups.map((g, gi) => (
            <li key={g.id} className="rounded-2xl border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{g.confidence === "exact" ? "Exacto" : "Posible"} · {g.assets.length} archivos · {fmtBytes(g.keep.bytes)}</span>
                {!!g.removable.length && <button onClick={() => removeCopies(gi)} className="btn btn-ghost !px-3 !py-1 !text-xs">Quitar {g.removable.length} copia{g.removable.length === 1 ? "" : "s"}</button>}</div>
              <ul className="mt-2 space-y-1">{g.assets.map((a) => <li key={a.asset_key} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 truncate">{a === g.keep && g.confidence === "exact" ? <b>Se conserva · </b> : null}{a.name} <span className="text-[var(--muted)]">· {KIND_LABEL[a.kind]}{a.container ? ` · ${a.container}` : ""} · {day(a.created_at)}</span></span><Link href={assetHref(a)} className="text-xs underline">Abrir</Link></li>)}</ul>
              {g.note && <p className="mt-2 text-xs text-[var(--muted)]">{g.note}</p>}
            </li>))}</ul>
        </details>)}

      {!assets ? <ul className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="skeleton aspect-square" />)}</ul>
        : !list.length ? <div className="card border-dashed p-10 text-center"><p className="text-[var(--muted)]">{q || kind !== "all" || dupOnly ? "Nada coincide con este filtro." : "Aún no hay nada en tu biblioteca. Sube vídeos, fotos o canciones, o crea un proyecto."}</p></div>
        : <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{page.map((a) => (
            <li key={a.asset_key} className="card overflow-hidden">
              <div className="relative grid aspect-square place-items-center bg-[var(--hover)] text-[var(--muted)]">
                {urls[a.asset_key] && a.kind === "video" ? <video src={urls[a.asset_key]} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : urls[a.asset_key] && (a.kind === "image" || a.kind === "logo") ? <img src={urls[a.asset_key]} alt="" className={`h-full w-full ${a.kind === "logo" ? "object-contain p-3" : "object-cover"}`} />
                  : <Icon n={KIND_ICON[a.kind]} className="h-6 w-6" />}
                {dupKeys.has(a.asset_key) && <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#111]">Duplicado</span>}
              </div>
              <div className="p-2.5 text-xs"><div className="truncate text-sm font-medium" title={a.name}>{a.name}</div>
                <div className="mono truncate text-[var(--muted)]">{KIND_LABEL[a.kind]}{a.container ? ` · ${a.container}` : ""}</div>
                <div className="mono text-[var(--muted)]">{fmtBytes(a.bytes)} · {day(a.created_at)}</div>
                <div className="mt-2 flex gap-1"><Link href={assetHref(a)} className="btn btn-ghost !px-2.5 !py-1 !text-xs">Abrir</Link>{a.kind !== "font" && <button onClick={() => download(a)} className="btn btn-ghost !px-2.5 !py-1 !text-xs" aria-label={`Descargar ${a.name}`}><Icon n="download" className="h-3.5 w-3.5" /></button>}</div></div>
            </li>))}</ul>
          {list.length > shown && <div className="mt-5 text-center"><button onClick={() => setShown(shown + PAGE)} className="btn btn-ghost">Ver más ({list.length - shown})</button></div>}
        </>}
    </section>
  );
}
