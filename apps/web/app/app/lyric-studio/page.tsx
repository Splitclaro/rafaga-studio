"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseLyrics, planVariants, moreIsCopy, type MoreLock, DEFAULT_BG, LOOKS, resolveLook, type BgSettings, type FilterName, type LyricLook, type DeepPartial } from "@rafaga/lyrics";
import { PRESETS, type SubtitleStyle } from "@rafaga/composition";
import { supabase, MAX_UPLOAD_BYTES } from "../../../lib/supabase";
import { downloadMp4 } from "../../../lib/download";
import { STAGE } from "../../../lib/projects";
import CollectionsPicker, { Thumb, useCollections } from "../../../components/Collections";
import { useTextStyles } from "../../../lib/textStyles";
import RangePicker from "../../../components/RangePicker";
import LyricSample from "../../../components/LyricSample";
import { useSearchParams } from "next/navigation";
import LookPreview, { sampleWords } from "../../../components/LookPreview";
import TapSync from "../../../components/TapSync";
import BeatAnalysis from "../../../components/BeatAnalysis";

type Overrides = Record<string, DeepPartial<LyricLook>>;
type StudioSettings = { styles?: string[]; overrides?: Overrides; res?: 1080 | 720; native?: boolean; variation?: number; ratio?: string; settings?: Partial<BgSettings> };
type Song = { id: string; title: string; artist: string | null; storage_path: string; lyrics_text: string | null; studio_settings?: StudioSettings | null };
type Batch = { id: string; status: string; error_message: string | null; params: { n: number; ratio: string; styles?: string[]; backgrounds?: string[]; [k: string]: unknown }; created_at: string };
type LV = { id: string; variant: number; status: string; storage_path: string | null; params: { style: string; background: string; look?: unknown; shots?: { start: number; dur: number; src?: string | null }[]; collection_id?: string | null }; url?: string };

const LOOK_IDS = ["archivo", "diario", "panoramico"] as const;
const styleLabel = (k: string) => (k.startsWith("look:") ? LOOKS[k.slice(5)]?.name ?? k : k.startsWith("custom:") ? "Mi estilo" : k);
const LYRIC_STYLES = ["Tune", "Palabra", "Tune mayúsculas", "Letra", "Letra suave", "Karaoke", "Impacto", "Limpio", "Pop", "Cine", "Neón", "Fantasma", "Desenfoque", "Máquina", "Caja negra", "Karaoke con caja"];
const COLORS = ["#111111", "#1E3A8A", "#7F1D1D", "#14532D", "#4C1D95", "#F5F5F5"];
const FILTERS: [FilterName, string, string][] = [["none", "Ninguno", "none"], ["midnight", "Midnight", "saturate(.85) hue-rotate(-12deg) brightness(.92)"], ["super8", "Super 8", "sepia(.35) saturate(1.15) contrast(1.05)"], ["noir", "Noir", "grayscale(1) contrast(1.18)"], ["vaporwave", "Vaporwave", "saturate(1.35) hue-rotate(-28deg)"]];

async function sniffAudio(f: File): Promise<"audio/wav" | "audio/mpeg" | null> {
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const str = (a: number, z: number) => String.fromCharCode(...b.slice(a, z));
  if (str(0, 4) === "RIFF" && str(8, 12) === "WAVE") return "audio/wav";
  if (str(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

function Step({ n: k, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 flex items-baseline gap-3 text-xl"><span className="font-display grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-ink)]">{k}</span>{title}</h2>
      {children}
    </section>
  );
}

export default function LyricStudio() {
  const params = useSearchParams();
  const { cols, reload: reloadCols } = useCollections();
  const { saved: myStyles } = useTextStyles();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [start, setStart] = useState(0), [end, setEnd] = useState(0);
  const [styles, setStyles] = useState<string[]>(["look:diario"]);
  const [bgMode, setBgMode] = useState<"collection" | "solid">("solid");
  const [collection, setCollection] = useState<string | null>(null);
  const [colors, setColors] = useState<string[]>(["#111111"]);
  const [settings, setSettings] = useState<BgSettings>(DEFAULT_BG);
  const [textScale, setTextScale] = useState(1);
  const [n, setN] = useState(3);
  const [ratio, setRatio] = useState<"9:16" | "4:5" | "1:1" | "16:9" | "4:3">("9:16");
  const [seed, setSeed] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<LV | null>(null);
  const [moreLock, setMoreLock] = useState<MoreLock>({ style: true, background: false, shots: false });
  const [moreN, setMoreN] = useState(3);
  const [swapShot, setSwapShot] = useState(0);
  const [videos, setVideos] = useState<LV[]>([]);
  const [step, setStep] = useState(0);
  const [newTitle, setNewTitle] = useState(""), [newArtist, setNewArtist] = useState("");
  const [overrides, setOverrides] = useState<Overrides>({});
  const [kits, setKits] = useState<{ id: string; name: string; config: { lyric?: { look: string | null; style: string | null }; export?: { ratios?: string[] } } }[]>([]);
  useEffect(() => { supabase.from("brand_kits").select("id,name,config").is("archived_at", null).order("created_at").then(({ data }) => setKits(((data ?? []) as typeof kits).filter((k) => k.config?.lyric))); }, []);
  const loadKit = (id: string) => {
    const k = kits.find((x) => x.id === id); if (!k?.config.lyric) return;
    const { look, style } = k.config.lyric;
    setStyles(look && LOOKS[look] ? [`look:${look}`] : style ? [style] : ["look:diario"]); setOverrides({});
    const r = k.config.export?.ratios?.[0]; if (r && ["9:16", "4:5", "1:1", "16:9", "4:3"].includes(r)) setRatio(r as typeof ratio);
    setNative(!!look && look === "archivo");
    if (look && LOOKS[look] && (k.config as { montage?: string }).montage === "ritmo") setOverrides({ [look]: { montage: { cut: "beat" } } });
  };
  const [res, setRes] = useState<1080 | 720>(1080);
  const [native, setNative] = useState(false);
  const [variation, setVariation] = useState(0.5);
  const [syncTab, setSyncTab] = useState<"auto" | "manual">("auto");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const activeLookId = styles.find((x) => x.startsWith("look:"))?.slice(5) ?? null;
  const activeLook = useMemo(() => (activeLookId ? resolveLook(activeLookId, overrides[activeLookId] ?? {}) : null), [activeLookId, overrides]);
  const setOv = (id: string, part: DeepPartial<LyricLook>) => setOverrides((o) => {
    const cur = o[id] ?? {};
    const merged: DeepPartial<LyricLook> = { ...cur };
    for (const k of Object.keys(part) as (keyof LyricLook)[]) merged[k] = { ...(cur[k] as object ?? {}), ...(part[k] as object) } as never;
    return { ...o, [id]: merged };
  });

  useEffect(() => { const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduce) { setStep(2); return; } const i = setInterval(() => setStep((s) => s + 1), 520); return () => clearInterval(i); }, []);
  const loadSongs = useCallback(async () => {
    const { data } = await supabase.from("songs").select("id,title,artist,storage_path,lyrics_text,studio_settings").order("created_at", { ascending: false });
    setSongs((data ?? []) as Song[]);
    return (data ?? []) as Song[];
  }, []);
  const wanted = params.get("song");
  useEffect(() => { loadSongs().then((l) => { const w = l.find((x) => x.id === wanted); if (w) choose(w); }); }, [loadSongs, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  const [recent, setRecent] = useState<{ id: string; song: string; variant: number; url?: string; path: string }[] | null>(null);
  const loadRecent = useCallback(async () => {
    const [{ data: lv }, { data: so }] = await Promise.all([
      supabase.from("lyric_videos").select("id,variant,song_id,storage_path").eq("status", "ready").order("created_at", { ascending: false }).limit(8),
      supabase.from("songs").select("id,title"),
    ]);
    const names = new Map((so ?? []).map((x) => [x.id, x.title]));
    const rows = await Promise.all((lv ?? []).filter((v) => v.storage_path).map(async (v) => ({ id: v.id, song: names.get(v.song_id) ?? "Canción", variant: v.variant, path: v.storage_path as string, url: (await supabase.storage.from("renders").createSignedUrl(v.storage_path as string, 900)).data?.signedUrl })));
    setRecent(rows);
  }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);
  const loadBatches = useCallback(async (s: Song) => {
    const { data } = await supabase.from("jobs").select("id,status,error_message,params,created_at").eq("kind", "lyrics").contains("params", { song_id: s.id }).order("created_at", { ascending: false }).limit(20);
    setBatches((data ?? []) as Batch[]);
  }, []);
  const loadVideos = useCallback(async (job: string) => {
    const { data } = await supabase.from("lyric_videos").select("id,variant,status,storage_path,params").eq("job_id", job).order("variant");
    const list = (data ?? []) as LV[];
    await Promise.all(list.map(async (v) => { if (v.storage_path) v.url = (await supabase.storage.from("renders").createSignedUrl(v.storage_path, 900)).data?.signedUrl; }));
    setVideos(list);
  }, []);
  async function choose(s: Song) {
    setSong(s); setLyrics(s.lyrics_text ?? ""); setStart(0); setEnd(0); setOpenBatch(null); setVideos([]);
    // Ajustes guardados de esta canción (preset, overrides, resolución…): se recuperan al volver
    const st = s.studio_settings ?? {};
    if (st.styles?.length) setStyles(st.styles); if (st.overrides) setOverrides(st.overrides); else setOverrides({});
    if (st.res) setRes(st.res); if (typeof st.native === "boolean") setNative(st.native); if (typeof st.variation === "number") setVariation(st.variation);
    if (st.ratio && ["9:16", "4:5", "1:1", "16:9", "4:3"].includes(st.ratio)) setRatio(st.ratio as typeof ratio);
    if (st.settings) setSettings({ ...DEFAULT_BG, ...st.settings });
    setLoadedFor(s.id);
    setAudioUrl((await supabase.storage.from("originals").createSignedUrl(s.storage_path, 3600)).data?.signedUrl ?? "");
    loadBatches(s);
  }
  useEffect(() => {
    if (!song || loadedFor !== song.id) return;
    const st: StudioSettings = { styles, overrides, res, native, variation, ratio, settings };
    const t = setTimeout(() => { supabase.from("songs").update({ studio_settings: st }).eq("id", song.id).then(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [song, loadedFor, styles, overrides, res, native, variation, ratio, settings]);
  async function ensureLyrics() {
    if (!song) return false;
    if ((song.lyrics_text ?? "") === lyrics.trim()) return true;
    const { error } = await supabase.from("songs").update({ lyrics_text: lyrics.trim() || null }).eq("id", song.id);
    if (error) { setMsg(error.message); return false; }
    setSong({ ...song, lyrics_text: lyrics.trim() || null }); return true;
  }
  async function upload(f: File | undefined) {
    if (!f) return;
    const mime = await sniffAudio(f);
    if (!mime) return setMsg(`«${f.name}» no parece un MP3 o WAV válido.`);
    if (f.size > MAX_UPLOAD_BYTES) return setMsg(`La canción supera ${MAX_UPLOAD_BYTES / 1048576} MB.`);
    setBusy(true); setMsg(`Subiendo «${f.name}» (${(f.size / 1048576).toFixed(1)} MB)…`);
    try {
      const { data: s } = await supabase.auth.getSession();
      const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
      if (!ws || !s.session) throw new Error("Sesión no válida.");
      const path = `${ws.id}/songs/${crypto.randomUUID()}.${mime === "audio/mpeg" ? "mp3" : "wav"}`;
      const up = await supabase.storage.from("originals").upload(path, f, { contentType: mime });
      if (up.error) throw new Error(up.error.message);
      const { data, error } = await supabase.from("songs").insert({ workspace_id: ws.id, title: newTitle.trim() || f.name.replace(/\.[^.]+$/, ""), artist: newArtist.trim() || null, storage_path: path, mime, bytes: f.size, created_by: s.session.user.id }).select("id,title,artist,storage_path,lyrics_text").single();
      if (error) { await supabase.storage.from("originals").remove([path]); throw new Error(error.message); }
      setMsg(null); setNewTitle(""); setNewArtist(""); await loadSongs(); choose(data as Song);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al subir."); }
    finally { setBusy(false); }
  }

  const selectedCol = cols?.find((c) => c.id === collection) ?? null;
  const plan = useMemo(() => { try { return planVariants(n, styles, bgMode === "collection" ? ["coleccion"] : colors, seed); } catch (e) { return { error: (e as Error).message } as const; } }, [n, styles, colors, bgMode, seed]);
  const lyricLines = useMemo(() => parseLyrics(lyrics), [lyrics]);
  const sampleLine = lyricLines[0]?.text.split(" ").slice(0, 6).join(" ") || "bajo la luna de abril";
  const previewStyle = styles[0]?.startsWith("custom:") ? myStyles?.find((x) => `custom:${x.id}` === styles[0])?.style ?? PRESETS.Letra : PRESETS[styles[0] ?? "Letra"] ?? PRESETS.Letra;
  const blockReason = !song ? "Elige una canción." : "error" in plan ? plan.error : bgMode === "collection" && !selectedCol?.items.length ? "La colección elegida está vacía: añade vídeos o fotos." : null;

  async function generate() {
    if (!song || blockReason || busy) return;
    setBusy(true); setMsg(null);
    if ((song.lyrics_text ?? "") !== lyrics) {
      const { error } = await supabase.from("songs").update({ lyrics_text: lyrics.trim() || null }).eq("id", song.id);
      if (error) { setBusy(false); return setMsg(error.message); }
      setSong({ ...song, lyrics_text: lyrics.trim() || null });
    }
    const params = { n, styles, backgrounds: colors, seed, ratio, start: start || 0, end: end || null, collection_id: bgMode === "collection" ? collection : null, settings: { ...settings, textScale }, look_overrides: overrides, res, native, variation };
    const { data, error } = await supabase.rpc("request_lyrics", { p_song: song.id, p_params: params, p_key: crypto.randomUUID() });
    setBusy(false);
    if (error) return setMsg(error.message);
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    setMsg(`Generando ${n} vídeo${n === 1 ? "" : "s"}. Aparecerán abajo según estén listos.`); setOpenBatch(data as string); loadBatches(song);
  }
  /** Nuevo trabajo derivado de un vídeo ya hecho: mismos ajustes del lote de origen, con lo bloqueado intacto. */
  async function submitMore(v: LV, body: { n: number; lock: MoreLock; swap?: number[] }, label: string) {
    if (!song || busy) return;
    const src = batches.find((b) => b.id === openBatch);
    if (!src) return setMsg("No encuentro el lote de origen.");
    setBusy(true); setMsg(null);
    const pool = (a: string[] | undefined, b: string[]) => [...new Set([...(a ?? []), ...b])];
    const params = { ...src.params, n: body.n, seed: Math.floor(Math.random() * 99999) + 1, styles: pool(src.params.styles, [v.params.style]), backgrounds: pool(src.params.backgrounds, colors), more: { from_video: v.id, lock: body.lock, ...(body.swap ? { swap: body.swap } : {}) } };
    const { data, error } = await supabase.rpc("request_lyrics", { p_song: song.id, p_params: params, p_key: crypto.randomUUID() });
    setBusy(false);
    if (error) return setMsg(error.message);
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    setMsg(label); setMoreFor(null); setOpenBatch(data as string); loadBatches(song);
  }
  const activeBatch = batches.find((b) => !["done", "failed", "cancelled"].includes(b.status));
  useEffect(() => {
    if (!song || (!activeBatch && !openBatch)) return;
    const tick = () => { loadBatches(song); if (openBatch) loadVideos(openBatch); };
    tick(); if (!activeBatch) return;
    const i = setInterval(tick, 4000); return () => clearInterval(i);
  }, [song, activeBatch?.id, openBatch, loadBatches, loadVideos]); // eslint-disable-line react-hooks/exhaustive-deps
  async function importLyrics(f: File | undefined) { if (f) setLyrics(parseLyrics(await f.text()).map((l) => l.text).join("\n")); }
  async function download(v: LV) {
    const r = await downloadMp4("renders", v.storage_path!, `${song?.title ?? "letra"}-${v.variant}.mp4`); if (!r.ok) alert(r.error);
  }
  const set = (p: Partial<BgSettings>) => setSettings((s) => ({ ...s, ...p }));
  const banded = settings.frame === "band" && bgMode === "collection" && ratio !== "16:9";
  const cssFilter = FILTERS.find((f) => f[0] === settings.filter)?.[2] ?? "none";

  return (
    <main className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl leading-tight md:text-4xl">Lyric Studio</h1><p className="mt-2 text-[var(--muted)]">Tu canción, con la letra sincronizada, en tantas versiones como necesites.</p></div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Canciones */}
        <aside className="space-y-3 lg:col-start-1 lg:row-start-1">
          <div className="card p-4">
            <h2 className="text-lg">Canciones</h2>
            <div className="mt-3 grid gap-2 text-sm">
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Título (opcional)" className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5" />
              <input value={newArtist} onChange={(e) => setNewArtist(e.target.value)} placeholder="Artista (opcional)" className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5" />
              <label className={`cursor-pointer rounded-full bg-[var(--accent)] px-3 py-2 text-center font-medium text-white ${busy ? "opacity-50" : ""}`}>{busy ? "Subiendo…" : "Subir canción (MP3 o WAV)"}
                <input type="file" accept="audio/*,.mp3,.wav" className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
            </div>
            {msg && !song && <p role="status" aria-live="polite" className="mt-2 text-sm">{msg}</p>}
            <ul className="mt-3 flex flex-wrap gap-2">
              {songs?.map((s) => (
                <li key={s.id}><button onClick={() => choose(s)} aria-current={song?.id === s.id} className={`max-w-56 rounded-xl border px-3 py-2 text-left ${song?.id === s.id ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "hairline hover:bg-[var(--hover)]"}`}>
                  <span className="block truncate font-medium">{s.title}</span><span className={`block truncate text-xs ${song?.id === s.id ? "text-[var(--accent-ink)]/70" : "text-[var(--muted)]"}`}>{s.artist ?? "Sin artista"}{s.lyrics_text ? ", con letra" : ""}</span>
                </button></li>
              ))}
            </ul>
            {songs?.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">Sube tu primera canción.</p>}
          </div>
        </aside>

        {/* Pasos */}
        <div className="space-y-5 lg:col-start-1 lg:row-start-2">
          {!song ? (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                {[["Canciones", songs?.length ?? "·"], ["Vídeos listos", recent?.length ?? "·"], ["Formatos", LYRIC_STYLES.length + (myStyles?.length ?? 0)]].map(([l, v]) => <div key={l as string} className="rounded-3xl bg-[var(--surface)] p-4"><div className="font-display text-3xl tnum">{v}</div><div className="text-sm text-[var(--muted)]">{l}</div></div>)}
              </div>
              <section aria-labelledby="fm" className="card p-5">
                <h2 id="fm" className="text-xl">Formatos más usados</h2><p className="mb-3 text-sm text-[var(--muted)]">Letra sobre una banda de vídeo centrada. Elige uno al abrir una canción.</p>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{LYRIC_STYLES.slice(0, 3).map((k) => <li key={k} className="overflow-hidden rounded-2xl bg-black"><div className="relative mx-auto aspect-[9/16] max-h-56 overflow-hidden"><div className="absolute inset-x-0 top-1/2 aspect-video -translate-y-1/2 bg-[#4d6b8a]" /><div className="absolute inset-x-0 top-1/2 -translate-y-1/2"><LyricSample style={PRESETS[k]} text="still do" scale={0.2} step={step} /></div></div><p className="bg-white px-3 py-2 text-sm">{k}</p></li>)}</ul>
              </section>
              <section aria-labelledby="rv" className="card p-5">
                <div className="mb-3 flex items-center justify-between"><h2 id="rv" className="text-xl">Vídeos recientes</h2><a href="/app/brand-kits?tab=lyrics" className="text-sm text-[var(--muted)] underline">Ver todos</a></div>
                {!recent ? <div className="skeleton h-40" /> : !recent.length ? <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">Aún no has generado vídeos. Sube una canción para empezar.</p> : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{recent.map((v) => <li key={v.id}>{v.url && <video src={v.url} controls preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-black object-cover" />}<p className="mt-1 truncate text-xs">{v.song} · #{v.variant}</p></li>)}</ul>}
              </section>
              {!!songs?.length && <p className="text-sm text-[var(--muted)]">Elige una canción de la izquierda o sube una nueva.</p>}
            </div>
          ) : (<>
            <Step n={1} title={`${song.title}: elige el tramo`}>
              {audioUrl ? <RangePicker songId={song.id} audioUrl={audioUrl} start={start} end={end} onChange={(a, b) => { setStart(a); setEnd(b); }} /> : <div className="skeleton h-28" />}
            </Step>
            <Step n={2} title="Letra y sincronización">
              <div role="tablist" aria-label="Sincronización" className="mb-3 inline-flex rounded-full bg-[var(--hover)] p-1 text-sm">
                {([["auto", "Automática"], ["manual", "Manual por pulsación"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={syncTab === k} onClick={() => setSyncTab(k)} className={`rounded-full px-4 py-1.5 ${syncTab === k ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{l}</button>)}
              </div>
              {syncTab === "manual" && audioUrl ? <TapSync songId={song.id} audioUrl={audioUrl} lyrics={lyrics} ensureLyrics={ensureLyrics} from={start} /> : <>
              <div className="mb-2 flex justify-end"><label className="cursor-pointer rounded-full border border-[var(--border)] px-3 py-1 text-sm">Importar TXT, LRC, SRT o VTT<input type="file" accept=".txt,.lrc,.srt,.vtt,text/plain" className="sr-only" onChange={(e) => importLyrics(e.target.files?.[0])} /></label></div>
              <textarea rows={7} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Pega la letra, un verso por línea. Si la dejas vacía se transcribe el canto, que es menos fiable con música." className="w-full rounded-2xl border border-[var(--border)] px-4 py-3 text-sm" />
              <p className="mt-1 text-xs text-[var(--muted)]">{lyricLines.length} versos. Se respeta tu texto y sus repeticiones; la alineación automática calcula los tiempos. Sin letra, el canto se transcribe (menos fiable con instrumental). Si tienes una sincronización manual guardada para esta letra, tiene prioridad.</p></>}
            </Step>
            <Step n={3} title="Estilo de letra">
              {!!kits.length && <label className="mb-4 block text-sm">Cargar un estilo guardado<select defaultValue="" onChange={(e) => e.target.value && loadKit(e.target.value)} className="mt-1 block w-full rounded-full border border-[var(--border)] bg-white px-3 py-2 sm:w-80"><option value="">Elige un kit con estilo de letra…</option>{kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select><span className="mt-1 block text-xs text-[var(--muted)]">Carga el look o el preset de letra y el formato del kit. Puedes ajustarlo después sin cambiar el kit.</span></label>}
              <h3 className="mb-1 text-base font-medium">Resultados de referencia</h3>
              <p className="mb-3 text-xs text-[var(--muted)]">Tres tratamientos completos: encuadre, tipografía, aparición de la letra y acabado. La vista previa usa el mismo motor que el vídeo final.</p>
              <ul className="mb-5 grid gap-3 sm:grid-cols-3">
                {LOOK_IDS.map((id) => { const k = `look:${id}`; const on = styles.includes(k); const lk = resolveLook(id, overrides[id] ?? {}); return (
                  <li key={id} className={`overflow-hidden rounded-2xl border-2 ${on ? "border-[var(--ink)]" : "border-[var(--border)]"}`}>
                    <div className="bg-black"><LookPreview look={lk} ratio={native ? lk.canvas.ratio : ratio} words={sampleWords()} len={7} label={`Vista previa animada: ${lk.name}`} /></div>
                    <div className="p-3"><div className="font-medium">{lk.name}</div><p className="mt-0.5 text-xs text-[var(--muted)]">{lk.description}</p>
                      <button onClick={() => setStyles(on ? styles.filter((x) => x !== k) : [k, ...styles.filter((x) => x !== k)])} aria-pressed={on} className={`btn mt-2 w-full !py-1.5 !text-xs ${on ? "btn-primary" : "btn-ghost"}`}>{on ? "Seleccionado" : "Usar este estilo"}</button></div>
                  </li>); })}
              </ul>
              {activeLook && activeLookId && (
                <details className="mb-5 rounded-2xl bg-[var(--surface)] p-4 text-sm">
                  <summary className="cursor-pointer font-medium">Ajustes avanzados de «{activeLook.name}»</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {([
                      ["Posición horizontal", activeLook.text.x, 0, 0.5, 0.01, (v: number) => setOv(activeLookId, { text: { x: v } })],
                      ["Posición vertical", activeLook.text.y, 0.1, 0.9, 0.01, (v: number) => setOv(activeLookId, { text: { y: v } })],
                      ["Tamaño de letra", activeLook.text.size, 0.05, 0.28, 0.005, (v: number) => setOv(activeLookId, { text: { size: v } })],
                      ["Espacio entre palabras (em)", activeLook.text.wordGap, 0.3, 3, 0.1, (v: number) => setOv(activeLookId, { text: { wordGap: v } })],
                      ["Retención al cerrar frase (s)", activeLook.flow.hold, 0, 2, 0.05, (v: number) => setOv(activeLookId, { flow: { hold: v } })],
                      ["Fundido de entrada (s)", activeLook.flow.fadeIn, 0, 0.4, 0.02, (v: number) => setOv(activeLookId, { flow: { fadeIn: v } })],
                      ["Centro vertical de la imagen", activeLook.image.cy, 0.2, 0.8, 0.005, (v: number) => setOv(activeLookId, { image: { cy: v } })],
                      ["Zoom de la imagen", activeLook.image.zoom, 1, 1.6, 0.01, (v: number) => setOv(activeLookId, { image: { zoom: v } })],
                      ["Grano", activeLook.treatment.grain, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { grain: v } })],
                      ["Suavidad", activeLook.treatment.soften, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { soften: v } })],
                      ["Desaturación", activeLook.treatment.desaturate, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { desaturate: v } })],
                      ["Aberración cromática", activeLook.treatment.aberration, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { aberration: v } })],
                      ["Inestabilidad", activeLook.treatment.instability, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { instability: v } })],
                      ["Viñeta", activeLook.treatment.vignette, 0, 1, 0.05, (v: number) => setOv(activeLookId, { treatment: { vignette: v } })],
                    ] as [string, number, number, number, number, (v: number) => void][]).map(([l, v, a, b, st, fn]) => (
                      <label key={l} className="rounded-xl bg-white px-3 py-2">{l} <span className="tnum float-right">{v.toFixed(2)}</span><input type="range" min={a} max={b} step={st} value={v} onChange={(e) => fn(Number(e.target.value))} className="w-full" /></label>))}
                    <label className="rounded-xl bg-white px-3 py-2">Revelado<select value={activeLook.flow.reveal} onChange={(e) => setOv(activeLookId, { flow: { reveal: e.target.value as "word" } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1"><option value="word">Palabra a palabra (se acumulan)</option><option value="group">Por grupos</option><option value="phrase">Frase completa</option></select></label>
                    <label className="rounded-xl bg-white px-3 py-2">Líneas máximas<select value={activeLook.text.maxLines} onChange={(e) => setOv(activeLookId, { text: { maxLines: Number(e.target.value) } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1">{[1, 2, 3].map((x) => <option key={x}>{x}</option>)}</select></label>
                    <label className="rounded-xl bg-white px-3 py-2">Cambios de plano<select value={activeLook.montage.cut} onChange={(e) => setOv(activeLookId, { montage: { cut: e.target.value as "phrase" } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1"><option value="phrase">En cambios de frase de la letra</option><option value="beat">Al ritmo (beats)</option><option value="interval">Intervalo fijo</option></select></label>
                    {activeLook.montage.cut === "beat" && <>
                      <label className="rounded-xl bg-white px-3 py-2">Intensidad<select value={activeLook.montage.intensity ?? "medium"} onChange={(e) => setOv(activeLookId, { montage: { intensity: e.target.value as "soft" } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1"><option value="soft">Suave (planos largos)</option><option value="medium">Media</option><option value="dynamic">Dinámica (planos cortos)</option></select></label>
                      <label className="rounded-xl bg-white px-3 py-2">Cortar cada<select value={activeLook.montage.beatEvery ?? 0} onChange={(e) => setOv(activeLookId, { montage: { beatEvery: Number(e.target.value) as 0 } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1"><option value={0}>Automático según intensidad</option><option value={1}>Cada beat</option><option value={2}>Cada 2 beats</option><option value={4}>Cada 4 beats</option><option value={8}>Cada 8 beats</option></select></label>
                      <BeatAnalysis audioUrl={audioUrl} start={start} end={end} enabled intensity={activeLook.montage.intensity ?? "medium"} />
                    </>}
                    <label className="rounded-xl bg-white px-3 py-2">Peso<select value={activeLook.text.weight} onChange={(e) => setOv(activeLookId, { text: { weight: Number(e.target.value) as 400 } })} className="mt-1 block w-full rounded-full border border-[var(--border)] px-2 py-1"><option value={400}>Regular</option><option value={700}>Negrita</option></select></label>
                  </div>
                  <div className="mt-3 flex gap-2"><button onClick={() => setOverrides((o) => { const c = { ...o }; delete c[activeLookId]; return c; })} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Restablecer valores del estilo</button></div>
                  <p className="mt-2 text-xs text-[var(--muted)]">Los cambios de plano «en frases» se alinean con la letra, no con el beat. El grano y la aberración se ven en el vídeo final; la vista previa los aproxima.</p>
                </details>)}
              <h3 className="mb-2 text-base font-medium">Otros estilos</h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[...LYRIC_STYLES.map((k) => ({ key: k, label: k, st: PRESETS[k] })), ...(myStyles ?? []).map((x) => ({ key: `custom:${x.id}`, label: x.name, st: x.style }))].map(({ key: k, label, st }) => {
                  const on = styles.includes(k);
                  return (
                    <li key={k}><button onClick={() => setStyles(on ? styles.filter((x) => x !== k) : [...styles, k])} aria-pressed={on} className={`w-full overflow-hidden rounded-2xl border-2 text-left ${on ? "border-[var(--ink)]" : "border-transparent"}`}>
                      <span className="grid h-24 place-items-center bg-[#1b1b1b]"><LyricSample style={st} text="bajo la luna" scale={0.26} step={step} /></span>
                      <span className="flex items-center justify-between px-3 py-2 text-sm"><span className="truncate">{label}</span><span aria-hidden>{on ? "✓" : ""}</span></span>
                    </button></li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-[var(--muted)]">Si eliges varios, se reparten entre los vídeos. Crea los tuyos en <a href="/app/style-studio" className="underline">Style Studio</a>.</p>
            </Step>
            <Step n={4} title="Fondo">
              <div role="tablist" className="mb-3 inline-flex rounded-full bg-[var(--hover)] p-1 text-sm">
                {([["solid", "Color sólido"], ["collection", "Colecciones"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={bgMode === k} onClick={() => setBgMode(k)} className={`rounded-full px-4 py-1.5 ${bgMode === k ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{l}</button>))}
              </div>
              {bgMode === "solid" ? (
                <div className="flex flex-wrap gap-2">{COLORS.map((c) => (
                  <button key={c} aria-pressed={colors.includes(c)} aria-label={`Color ${c}`} onClick={() => setColors(colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c])} className={`h-11 w-11 rounded-full border-2 ${colors.includes(c) ? "border-[var(--ink)] ring-2 ring-white ring-inset" : "border-[var(--border)]"}`} style={{ background: c }} />))}
                  <label className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border-2 border-dashed border-[var(--border)] text-lg" title="Otro color">+<input type="color" className="sr-only" onChange={(e) => !colors.includes(e.target.value.toUpperCase()) && setColors([...colors, e.target.value.toUpperCase()])} /></label>
                </div>
              ) : <CollectionsPicker selected={collection} onSelect={setCollection} cols={cols} reload={reloadCols} />}
            </Step>
            <Step n={5} title="Ajustes">
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <fieldset className="rounded-2xl bg-[var(--surface)] px-4 py-3 sm:col-span-2"><legend className="sr-only">Encuadre del fondo</legend>Encuadre del fondo
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">{([["band", "Banda centrada", "Vídeo en banda 16:9 sobre lienzo negro, con la letra encima. Es el formato más usado."], ["full", "Pantalla completa", "El fondo ocupa todo el encuadre."]] as const).map(([k, l, d]) => (
                    <button key={k} onClick={() => set({ frame: k })} aria-pressed={settings.frame === k} className={`rounded-2xl border-2 p-3 text-left ${settings.frame === k ? "border-[var(--ink)] bg-white" : "border-transparent bg-white/60"}`}><span className="flex items-center gap-3"><span className="relative grid h-14 w-8 shrink-0 place-items-center overflow-hidden rounded bg-black">{k === "band" ? <span className="h-[34%] w-full bg-[#5b7a99]" /> : <span className="h-full w-full bg-[#5b7a99]" />}</span><span><span className="block font-medium">{l}</span><span className="block text-xs text-[var(--muted)]">{d}</span></span></span></button>))}</div>
                </fieldset>
                <label className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface)] px-4 py-3">Alternar clips de fondo <input type="checkbox" checked={settings.sequence} onChange={(e) => set({ sequence: e.target.checked })} /></label>
                <label className={`rounded-2xl bg-[var(--surface)] px-4 py-3 ${settings.sequence ? "" : "opacity-50"}`}>Cambiar cada <span className="tnum">{settings.interval} s</span>
                  <input type="range" min={3} max={15} step={1} value={settings.interval} disabled={!settings.sequence} onChange={(e) => set({ interval: Number(e.target.value) })} className="w-full" /></label>
                <label className="rounded-2xl bg-[var(--surface)] px-4 py-3">Oscurecer fondo <span className="tnum">{Math.round(settings.dim * 100)} %</span><input type="range" min={0} max={0.8} step={0.05} value={settings.dim} onChange={(e) => set({ dim: Number(e.target.value) })} className="w-full" /></label>
                <label className="rounded-2xl bg-[var(--surface)] px-4 py-3">Barras de cine <span className="tnum">{Math.round(settings.bars * 100)} %</span><input type="range" min={0} max={0.4} step={0.02} value={settings.bars} onChange={(e) => set({ bars: Number(e.target.value) })} className="w-full" /></label>
                <label className="rounded-2xl bg-[var(--surface)] px-4 py-3">Tamaño del texto <span className="tnum">{textScale.toFixed(2)}×</span><input type="range" min={0.7} max={1.5} step={0.05} value={textScale} onChange={(e) => setTextScale(Number(e.target.value))} className="w-full" /></label>
                <fieldset className="rounded-2xl bg-[var(--surface)] px-4 py-3"><legend className="sr-only">Filtro</legend>Filtro
                  <div className="mt-2 flex flex-wrap gap-1">{FILTERS.map(([k, l]) => (
                    <button key={k} onClick={() => set({ filter: k })} aria-pressed={settings.filter === k} className={`rounded-full px-3 py-1 text-xs ${settings.filter === k ? "bg-[var(--ink)] text-white" : "bg-white"}`}>{l}</button>))}</div>
                </fieldset>
              </div>
              {settings.dim > 0.6 && <p className="mt-2 text-xs">Con más de 60 % el fondo apenas se verá.</p>}
            </Step>
            <Step n={6} title="Cuántos vídeos">
              <div className="flex flex-wrap items-end gap-4 text-sm">
                <label>Vídeos<input type="number" min={1} max={200} value={n} onChange={(e) => setN(Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))))} className="font-display mt-1 block w-24 rounded-2xl border border-[var(--border)] px-3 py-2 text-2xl tnum" /></label>
                <label>Formato<select value={ratio} onChange={(e) => setRatio(e.target.value as typeof ratio)} className="mt-1 block rounded-full border border-[var(--border)] bg-white px-3 py-2"><option value="9:16">Vertical 9:16</option><option value="4:5">Retrato 4:5</option><option value="1:1">Cuadrado 1:1</option><option value="16:9">Horizontal 16:9</option><option value="4:3">Clásico 4:3</option></select></label>
                <label>Resolución<select value={res} onChange={(e) => setRes(Number(e.target.value) as 1080)} className="mt-1 block rounded-full border border-[var(--border)] bg-white px-3 py-2"><option value={1080}>1080p</option><option value={720}>720p</option></select></label>
                {activeLook && <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} />Formato original del estilo ({activeLook.canvas.ratio})</label>}
                {activeLook && <label>Variación entre vídeos<input type="range" min={0} max={1} step={0.1} value={variation} onChange={(e) => setVariation(Number(e.target.value))} className="mt-2 block w-32" /></label>}
                <label>Variación<span className="mt-1 flex gap-1"><input type="number" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 1))} className="tnum w-20 rounded-full border border-[var(--border)] px-3 py-2" /><button onClick={() => setSeed(Math.floor(Math.random() * 99999) + 1)} className="rounded-full border border-[var(--border)] px-3">Otra</button></span></label>
              </div>
              {!("error" in plan) && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer">Plan: {plan.variants.length} vídeos{plan.repeats ? `, ${plan.repeats} repiten estilo y fondo` : ", todos distintos"}</summary>
                  <ol className="mt-2 max-h-40 overflow-auto rounded-2xl bg-[var(--surface)] p-3 tnum">{plan.variants.map((v) => <li key={v.index}>{v.index}. {styleLabel(v.style)}, {v.background === "coleccion" ? `${selectedCol?.name ?? "colección"} (orden ${v.seed % 1000 + 1})` : v.background}</li>)}</ol>
                </details>)}
              <button onClick={generate} disabled={busy || !!blockReason} className="font-display mt-4 w-full rounded-full bg-[var(--accent)] px-6 py-4 text-xl text-white disabled:opacity-40">Generar {n} vídeo{n === 1 ? "" : "s"}</button>
              <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--muted)]">{blockReason ?? msg}</p>
            </Step>
          </>)}
        </div>

        {/* Vista previa y resultados */}
        <aside aria-label="Previsualización y exportación" className="card space-y-4 p-5 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          {activeLook ? (
            <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[22px] bg-black"><LookPreview look={activeLook} ratio={native ? activeLook.canvas.ratio : ratio} words={sampleWords(lyricLines.slice(0, 3).map((l) => l.text).join(" ") || undefined)} len={8} media={bgMode === "collection" && selectedCol?.items[0]?.url ? { url: selectedCol.items[0].url!, kind: selectedCol.items[0].kind } : null} label={`Vista previa del vídeo: ${activeLook.name}`} /></div>
          ) : (
          <div className={`relative mx-auto w-full max-w-[300px] overflow-hidden rounded-[22px] bg-black ${ratio === "16:9" ? "aspect-video" : ratio === "1:1" ? "aspect-square" : ratio === "4:5" ? "aspect-[4/5]" : "aspect-[9/16]"}`} aria-label="Vista previa aproximada">
            <div className={`absolute inset-x-0 overflow-hidden ${banded ? "top-1/2 -translate-y-1/2" : "inset-y-0"}`} style={banded ? { aspectRatio: "16 / 9" } : undefined}>
              {bgMode === "collection" && selectedCol?.items[0] ? <Thumb item={selectedCol.items[0]} className="absolute inset-0 h-full w-full" /> : <div className="absolute inset-0" style={{ background: colors[0] ?? "#111" }} />}
              <div className="absolute inset-0" style={{ backdropFilter: cssFilter, WebkitBackdropFilter: cssFilter }} />
              <div className="absolute inset-0 bg-black" style={{ opacity: settings.dim }} />
            </div>
            {settings.bars > 0 && !banded && <><div className="absolute inset-x-0 top-0 bg-black" style={{ height: `${settings.bars * 50}%` }} /><div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${settings.bars * 50}%` }} /></>}
            <div className="absolute inset-x-0" style={{ top: `${previewStyle.y * 100}%`, transform: "translateY(-50%)" }}><LyricSample style={{ ...previewStyle, fontSize: previewStyle.fontSize * textScale }} text={sampleLine} scale={0.27} step={step} /></div>
          </div>)}
          <p className="text-center text-xs text-[var(--muted)]">Vista previa aproximada. El vídeo final usa la misma fuente, letra y tiempos.</p>

        </aside>
      </div>
      {song && (
        <section aria-labelledby="res-h" className="mt-8 card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="res-h" className="text-2xl">Resultados</h2>
            {openBatch && videos.some((v) => v.status === "ready" && v.url) && <button onClick={async () => { for (const v of videos.filter((x) => x.status === "ready" && x.storage_path)) { await download(v); await new Promise((r) => setTimeout(r, 900)); } }} className="btn btn-primary !py-1.5 !text-xs">Descargar todos</button>}
          </div>
          {!batches.length && <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">Tus vídeos aparecerán aquí según estén listos. Puedes cerrar la página: el trabajo sigue en segundo plano.</p>}
          {!!batches.length && <div role="tablist" aria-label="Lotes" className="mt-3 flex gap-2 overflow-x-auto pb-1">{batches.map((b) => (
            <button key={b.id} role="tab" aria-selected={openBatch === b.id} onClick={() => { setOpenBatch(b.id); loadVideos(b.id); }} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${openBatch === b.id ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--border)] hover:bg-[var(--hover)]"}`}>
              <span className="tnum">{new Date(b.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {b.params.n}</span> <span className="opacity-70">{STAGE[b.status] ?? b.status}</span></button>))}</div>}
          {openBatch && (() => { const b = batches.find((x) => x.id === openBatch); const ready = videos.filter((v) => v.status === "ready").length, total = (b?.params.n ?? videos.length) || 1; return (<>
            {b?.error_message && <p role="alert" className="mt-3 rounded-xl bg-[var(--surface)] p-3 text-sm">{b.error_message}</p>}
            <div className="mt-3 flex items-center gap-3 text-sm"><span className="tnum">{ready} de {total} listos</span><div className="h-1.5 max-w-xs flex-1 rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[var(--ink)] transition-all" style={{ width: `${Math.min(100, (ready / total) * 100)}%` }} /></div></div>
            <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">{videos.map((v) => (
              <li key={v.id} className="overflow-hidden rounded-2xl border border-[var(--border)]">
                {v.url ? <video src={v.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full bg-black object-contain" /> : <div className="grid aspect-[9/16] place-items-center bg-[var(--ink)] text-sm text-white/80"><span className="pulse !bg-white" aria-hidden />Creando…</div>}
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="min-w-0 truncate"><span className="tnum text-[var(--muted)]">#{v.variant}</span> {styleLabel(v.params.style)}</span>{v.url && <button onClick={() => download(v)} className="btn btn-ghost !px-2.5 !py-1 !text-xs">Descargar</button>}</div>
                {v.url && <div className="flex gap-1.5 border-t border-[var(--border)] px-3 py-2"><button onClick={() => { setMoreFor(moreFor?.id === v.id ? null : v); setSwapShot(0); }} aria-expanded={moreFor?.id === v.id} className="btn btn-ghost !px-2.5 !py-1 !text-xs">Más versiones</button></div>}
              </li>))}</ul>
            {moreFor && (() => { const v = moreFor, shots = v.params.shots ?? [], canSwap = !!v.params.look && shots.length > 0 && !!shots[0].src, collection = !!v.params.collection_id; const copy = moreIsCopy(moreLock); const t = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`; return (
              <div role="region" aria-label={`Más versiones del vídeo ${v.variant}`} className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
                <div className="flex items-start justify-between gap-3"><h3 className="text-lg">Más versiones como la #{v.variant}</h3><button onClick={() => setMoreFor(null)} className="btn btn-ghost !px-2.5 !py-1 !text-xs">Cerrar</button></div>
                <p className="mt-1 text-[var(--muted)]">Se mantienen siempre el audio, el tramo y la letra. Marca lo que quieres conservar; lo demás cambia.</p>
                <fieldset className="mt-3 flex flex-wrap gap-2"><legend className="sr-only">Elementos bloqueados</legend>
                  {([["style", "Estilo"], ["background", collection ? "Colección de fondo" : "Color de fondo"], ["shots", "Planos y cortes"]] as const).map(([k, l]) => (
                    <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 ${moreLock[k] ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--border)] bg-white"}`}><input type="checkbox" className="sr-only" checked={moreLock[k]} onChange={(e) => setMoreLock({ ...moreLock, [k]: e.target.checked })} />{moreLock[k] ? "Fijo" : "Cambia"}: {l}</label>))}
                </fieldset>
                {copy && <p role="alert" className="mt-2">Con todo fijo saldría una copia. Deja libre al menos una cosa.</p>}
                {!v.params.look && moreLock.shots === false && <p className="mt-2 text-[var(--muted)]">Este estilo no usa planos: solo cambian estilo, fondo y variación.</p>}
                <div className="mt-3 flex flex-wrap items-end gap-3"><label>Cuántas<input type="number" min={1} max={10} value={moreN} onChange={(e) => setMoreN(Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1))))} className="tnum mt-1 block w-20 rounded-full border border-[var(--border)] bg-white px-3 py-2" /></label>
                  <button disabled={copy || busy} onClick={() => submitMore(v, { n: moreN, lock: moreLock }, `Creando ${moreN} versión${moreN === 1 ? "" : "es"} como la #${v.variant}.`)} className="btn btn-primary disabled:opacity-40">Crear {moreN} versión{moreN === 1 ? "" : "es"}</button></div>
                {canSwap && <div className="mt-4 border-t border-[var(--border)] pt-3"><h4 className="font-medium">Cambiar un plano</h4><p className="text-[var(--muted)]">Rehace este vídeo con otro clip en un solo plano; el resto queda igual.</p>
                  <div className="mt-2 flex flex-wrap items-end gap-2"><label>Plano<select value={swapShot} onChange={(e) => setSwapShot(Number(e.target.value))} className="mt-1 block rounded-full border border-[var(--border)] bg-white px-3 py-2">{shots.map((x, i) => <option key={i} value={i}>{i + 1} · {t(x.start)} ({x.dur.toFixed(1)} s)</option>)}</select></label>
                    <button disabled={busy} onClick={() => submitMore(v, { n: 1, lock: { style: true, background: true, shots: true }, swap: [swapShot] }, `Cambiando el plano ${swapShot + 1} de la #${v.variant}.`)} className="btn btn-ghost">Cambiar este plano</button>
                    <button disabled={busy} onClick={() => submitMore(v, { n: 1, lock: { style: true, background: true, shots: true }, swap: [0] }, `Probando otro inicio para la #${v.variant}.`)} className="btn btn-ghost">Probar otro inicio</button></div></div>}
                {!canSwap && !!v.params.look && <p className="mt-3 text-[var(--muted)]">Para cambiar planos sueltos hace falta generar de nuevo este vídeo: los hechos antes de esta función no guardan qué clip usa cada plano.</p>}
              </div>); })()}
          </>); })()}
        </section>
      )}
    </main>
  );
}
