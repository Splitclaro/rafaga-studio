"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import LyricSample from "../../../components/LyricSample";
import { supabase } from "../../../lib/supabase";
import { downloadMp4 } from "../../../lib/download";
import { useProjects } from "../../../components/ProjectList";
import { useTextStyles } from "../../../lib/textStyles";
import { useWorkspaceFonts } from "../../../lib/fonts";
import { useCollections, Thumb } from "../../../components/Collections";
import ProjectClips from "../../../components/ProjectClips";
import CollectionsPicker from "../../../components/Collections";
import LibraryAll from "../../../components/LibraryAll";
import { useSearchParams } from "next/navigation";

type Tab = "all" | "videos" | "lyrics" | "songs" | "collections" | "fonts" | "styles";
type LyricRender = { id: string; variant: number; song: string; path: string; style: string; created_at: string; bytes: number; job_id: string };
type SongRow = { id: string; title: string; artist: string | null; bytes: number; created_at: string; storage_path: string; lyrics: boolean };

const TABS: [Tab, string, string][] = [["all", "Todo", "layers"], ["videos", "Proyectos", "film"], ["lyrics", "Vídeos con letra", "music"], ["songs", "Canciones", "music"], ["collections", "Packs de medios", "layers"], ["fonts", "Fuentes", "type"], ["styles", "Estilos", "text"]];
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const day = (d: string) => new Date(d).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });

export default function Biblioteca() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (["all", "videos", "lyrics", "songs", "collections", "fonts", "styles"].includes(sp.get("tab") ?? "") ? (sp.get("tab") as Tab) : "all"));
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { rows: projects, reload: reloadProjects } = useProjects();
  const { saved: styles, reload: reloadStyles } = useTextStyles();
  const { fonts, reload: reloadFonts } = useWorkspaceFonts();
  const { cols, reload: reloadCols } = useCollections();
  const [lyrics, setLyrics] = useState<LyricRender[] | null>(null);
  const [songs, setSongs] = useState<SongRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadLyrics = useCallback(async () => {
    const [{ data: lv }, { data: so }] = await Promise.all([
      supabase.from("lyric_videos").select("id,variant,song_id,storage_path,params,probe,created_at,job_id").eq("status", "ready").order("created_at", { ascending: false }).limit(200),
      supabase.from("songs").select("id,title,artist,bytes,created_at,storage_path,lyrics_text").order("created_at", { ascending: false }),
    ]);
    const names = new Map((so ?? []).map((s) => [s.id, s.title]));
    setLyrics((lv ?? []).map((v) => ({ id: v.id, variant: v.variant, song: names.get(v.song_id) ?? "Canción", path: v.storage_path ?? "", style: (v.params as { style?: string })?.style ?? "", created_at: v.created_at, bytes: Number((v.probe as { format?: { size?: string } })?.format?.size ?? 0), job_id: v.job_id })));
    setSongs((so ?? []).map((s) => ({ id: s.id, title: s.title, artist: s.artist, bytes: Number(s.bytes), created_at: s.created_at, storage_path: s.storage_path, lyrics: !!s.lyrics_text })));
  }, []);
  useEffect(() => { loadLyrics(); }, [loadLyrics]);

  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  async function dl(bucket: string, path: string, name: string) {
    const r = await downloadMp4(bucket, path, name); if (!r.ok) setMsg(r.error);
  }
  async function delProject(id: string, name: string) {
    if (!confirm(`¿Borrar el proyecto «${name}»? Dejará de aparecer con sus clips.`)) return;
    const { error } = await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return setMsg(error.message); reloadProjects();
  }
  async function delSong(s: SongRow) {
    if (!confirm(`¿Borrar la canción «${s.title}» y sus vídeos con letra?`)) return;
    const { error } = await supabase.from("songs").delete().eq("id", s.id);
    if (error) return setMsg(error.message);
    await supabase.storage.from("originals").remove([s.storage_path]); loadLyrics();
  }
  async function delFont(id: string, path: string) {
    if (!confirm("¿Borrar esta fuente? Los clips que la usen no podrán exportarse hasta elegir otra.")) return;
    await supabase.from("workspace_fonts").delete().eq("id", id); await supabase.storage.from("brand-assets").remove([path]); reloadFonts();
  }
  async function delStyle(id: string) { if (!confirm("¿Borrar este estilo?")) return; await supabase.from("text_styles").delete().eq("id", id); reloadStyles(); }
  async function delCol(id: string, name: string, paths: string[]) {
    if (!confirm(`¿Borrar el pack «${name}» y sus ${paths.length} archivos? Los vídeos ya exportados se conservan.`)) return;
    if (paths.length) await supabase.storage.from("originals").remove(paths);
    await supabase.from("media_collections").delete().eq("id", id); reloadCols();
  }

  const counts: Record<Tab, number | null> = { all: null, videos: projects?.length ?? null, lyrics: lyrics?.length ?? null, songs: songs?.length ?? null, collections: cols?.length ?? null, fonts: fonts ? fonts.length + 2 : null, styles: styles?.length ?? null };
  const Empty = ({ text, href, cta }: { text: string; href: string; cta: string }) => <div className="card border-dashed p-10 text-center"><p className="text-[var(--muted)]">{text}</p><Link href={href} className="btn btn-primary mt-4">{cta}</Link></div>;
  const Skel = () => <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <li key={i} className="skeleton aspect-[4/3]" />)}</ul>;
  const list = useMemo(() => tab, [tab]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Biblioteca</h1><p className="mt-1 text-[var(--muted)]">Todo lo que has subido o generado en un solo sitio: vídeos, imágenes, audio, logos, fuentes y exportaciones. Detecta archivos repetidos.</p></div>
        <label className="card flex w-full items-center gap-2 px-3 py-2 sm:w-72"><Icon n="search" className="h-4 w-4 text-[var(--muted)]" /><span className="sr-only">Buscar en la biblioteca</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" className="w-full bg-transparent text-sm outline-none" /></label>
      </header>

      <div role="tablist" aria-label="Tipo de contenido" className="mb-6 flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([k, l, i]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="chip shrink-0"><Icon n={i} className="h-3.5 w-3.5" />{l}<span className="mono text-xs opacity-70">{counts[k] ?? "·"}</span></button>))}
      </div>
      {msg && <p role="alert" className="card mb-4 p-3 text-sm">{msg}</p>}

      {list === "all" && <LibraryAll q={q} onChanged={() => { reloadCols(); loadLyrics(); }} />}

      {list === "videos" && <div className="mb-3 flex justify-end"><button className="chip" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>Archivados <span className="mono text-xs opacity-70">{projects?.filter((p) => p.archived_at).length ?? "·"}</span></button></div>}
      {list === "videos" && (!projects ? <Skel /> : !projects.filter((p) => match(p.name) && !!p.archived_at === showArchived).length ? <Empty text={q ? "Nada coincide con tu búsqueda." : showArchived ? "No hay proyectos archivados." : "Aún no tienes proyectos. Sube un vídeo y aquí verás sus clips."} href="/app" cta="Crear un proyecto" /> : (
        <ul className="space-y-3">{projects.filter((p) => match(p.name) && !!p.archived_at === showArchived).map((p) => <ProjectClips key={p.id} p={p} onDelete={delProject} onChanged={reloadProjects} />)}</ul>))}

      {list === "lyrics" && !!lyrics?.length && <div className="mb-3 flex justify-end"><button className="btn btn-primary !px-3 !py-1.5 !text-xs" onClick={async () => { const l = lyrics.filter((v) => match(v.song) && v.path); setMsg(`Descargando ${l.length} vídeos… acepta las descargas múltiples si el navegador lo pide.`); for (const v of l) { await dl("renders", v.path, `${v.song}-${v.variant}.mp4`); await new Promise((r) => setTimeout(r, 900)); } }}><Icon n="download" className="h-3.5 w-3.5" />Descargar todos</button></div>}
      {list === "lyrics" && (!lyrics ? <Skel /> : !lyrics.filter((v) => match(v.song)).length ? <Empty text={q ? "Nada coincide con tu búsqueda." : "Aún no has generado vídeos con letra."} href="/app/lyric-studio" cta="Abrir Lyric Studio" /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{lyrics.filter((v) => match(v.song)).map((v) => (
          <li key={v.id} className="card flex items-center gap-3 p-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-white"><Icon n="music" /></span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{v.song} · #{v.variant}</div><div className="mono text-xs text-[var(--muted)]">{v.style.replace("custom:", "Mi estilo")}{v.bytes ? ` · ${mb(v.bytes)}` : ""} · {day(v.created_at)}</div></div>
            <button className="btn btn-primary !px-3 !py-1.5 !text-xs" onClick={() => dl("renders", v.path, `${v.song}-${v.variant}.mp4`)} aria-label={`Descargar ${v.song} ${v.variant}`}><Icon n="download" className="h-3.5 w-3.5" /></button></li>))}</ul>))}

      {list === "songs" && (!songs ? <Skel /> : !songs.filter((s) => match(s.title)).length ? <Empty text={q ? "Nada coincide con tu búsqueda." : "Aún no has subido canciones."} href="/app/lyric-studio" cta="Subir una canción" /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{songs.filter((s) => match(s.title)).map((s) => (
          <li key={s.id} className="card flex items-center gap-3 p-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-white"><Icon n="music" /></span>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{s.title}</div><div className="mono truncate text-xs text-[var(--muted)]">{s.artist ?? "Sin artista"} · {mb(s.bytes)} · {s.lyrics ? "con letra" : "sin letra"}</div></div>
            <div className="flex shrink-0 gap-1"><Link href={`/app/lyric-studio?song=${s.id}`} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Abrir</Link><button className="btn btn-ghost !px-3 !py-1.5 !text-xs" onClick={() => delSong(s)}>Borrar</button></div></li>))}</ul>))}

      {list === "collections" && (<>
        <p className="mb-3 text-sm text-[var(--muted)]">Un pack de medios agrupa tus vídeos y fotos para usarlos como fondo en Lyric Studio o como B-roll en el editor de clips. No es lo mismo que una colección de clips.</p>
        <div className="card mb-5 p-4"><CollectionsPicker selected={null} onSelect={() => {}} cols={cols} reload={reloadCols} /></div>
        {!!cols?.filter((c) => match(c.name)).length && <ul className="grid gap-4 sm:grid-cols-2">{cols.filter((c) => match(c.name)).map((c) => (
          <li key={c.id} className="card p-4"><div className="flex items-center justify-between"><h3 className="text-base">{c.name}</h3><span className="mono text-xs text-[var(--muted)]">{c.items.length} archivos</span></div>
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">{c.items.map((it) => <li key={it.id} className="shrink-0"><Thumb item={it} className="h-24 w-[54px] rounded-lg" /></li>)}{!c.items.length && <li className="text-sm text-[var(--muted)]">Vacío</li>}</ul>
            <div className="mt-3 flex gap-2"><button className="btn btn-ghost !px-3 !py-1.5 !text-xs ml-auto" onClick={() => delCol(c.id, c.name, c.items.map((i) => i.storage_path))}>Borrar pack</button></div></li>))}</ul>}
      </>)}

      {list === "fonts" && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {[{ id: "bootzy", family: "Bootzy TM", note: "Fuente de los resultados · incluida" }, { id: "arial", family: "Arial", note: "Incluida" }].filter((f) => match(f.family)).map((f) => <li key={f.id} className="card p-4"><div className="text-2xl" style={{ fontFamily: `"${f.family}", Arial` }}>Ñandú bailó una canción</div><div className="mt-1 text-xs text-[var(--muted)]">{f.family} · {f.note}</div></li>)}
          {fonts?.filter((f) => match(f.family)).map((f) => <li key={f.id} className="card p-4"><div className="text-2xl" style={{ fontFamily: `"${f.family}", Arial` }}>Ñandú bailó una canción</div><div className="mt-1 flex items-center justify-between text-xs text-[var(--muted)]"><span>{f.family} · {Math.round(f.bytes / 1024)} KB</span><button className="underline" onClick={() => delFont(f.id, f.storage_path)}>Borrar</button></div></li>)}
          <li><Link href="/app/brand-kits" className="card flex h-full min-h-24 items-center justify-center border-dashed p-4 text-sm text-[var(--muted)] hover:bg-[var(--hover)]">Subir una fuente</Link></li>
        </ul>)}

      {list === "styles" && (!styles ? <Skel /> : !styles.filter((s) => match(s.name)).length ? <Empty text={q ? "Nada coincide con tu búsqueda." : "Crea tu primer estilo de texto en Style Studio."} href="/app/style-studio" cta="Abrir Style Studio" /> : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{styles.filter((s) => match(s.name)).map((s) => (
          <li key={s.id} className="card overflow-hidden"><div className="grid h-28 place-items-center bg-[#151515]"><LyricSample style={s.style} text="bajo la luna" scale={0.26} step={2} /></div>
            <div className="flex items-center justify-between p-3 text-sm"><span className="truncate font-medium">{s.name}</span><span className="flex gap-2 text-xs"><Link href="/app/style-studio" className="underline">Editar</Link><button className="underline" onClick={() => delStyle(s.id)}>Borrar</button></span></div></li>))}</ul>))}
    </main>
  );
}
