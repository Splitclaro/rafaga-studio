"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseLyrics, planVariants } from "@rafaga/lyrics";
import { PRESETS } from "@rafaga/composition";
import { supabase, MAX_UPLOAD_BYTES } from "../../../lib/supabase";
import { STAGE } from "../../../lib/projects";

type Song = { id: string; title: string; artist: string | null; language: string; storage_path: string; lyrics_text: string | null; created_at: string };
type Batch = { id: string; status: string; error_message: string | null; params: { n: number }; created_at: string; metrics: Record<string, number | string> | null };
type LV = { id: string; variant: number; status: string; storage_path: string | null; params: { style: string; background: string }; url?: string };
const AUDIO = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"];
const BG_DEFAULT = ["#111111", "#1E3A8A", "#7F1D1D", "#14532D", "#F5F5F5"];

export default function LyricStudio() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [start, setStart] = useState(0), [end, setEnd] = useState(0);
  const [n, setN] = useState(5);
  const [styles, setStyles] = useState<string[]>(["Impacto", "Karaoke"]);
  const [bgs, setBgs] = useState<string[]>(["#111111", "#1E3A8A"]);
  const [ratio, setRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [seed, setSeed] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [videos, setVideos] = useState<LV[]>([]);

  const loadSongs = useCallback(async () => {
    const { data } = await supabase.from("songs").select("id,title,artist,language,storage_path,lyrics_text,created_at").order("created_at", { ascending: false });
    setSongs((data ?? []) as Song[]);
  }, []);
  useEffect(() => { loadSongs(); }, [loadSongs]);

  const loadBatches = useCallback(async (s: Song) => {
    const { data } = await supabase.from("jobs").select("id,status,error_message,params,created_at,metrics").eq("kind", "lyrics").contains("params", { song_id: s.id }).order("created_at", { ascending: false }).limit(20);
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
    setAudioUrl((await supabase.storage.from("originals").createSignedUrl(s.storage_path, 3600)).data?.signedUrl ?? "");
    loadBatches(s);
  }

  async function upload(f: File | undefined, title: string, artist: string) {
    if (!f) return;
    if (!AUDIO.includes(f.type)) return setMsg("Formato no admitido: sube MP3 o WAV.");
    if (f.size > MAX_UPLOAD_BYTES) return setMsg(`La canción supera ${MAX_UPLOAD_BYTES / 1048576} MB.`);
    setBusy(true); setMsg("Subiendo canción…");
    try {
      const { data: s } = await supabase.auth.getSession();
      const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
      if (!ws || !s.session) throw new Error("Sesión no válida.");
      const path = `${ws.id}/songs/${crypto.randomUUID()}.${f.type === "audio/mpeg" ? "mp3" : "wav"}`;
      const up = await supabase.storage.from("originals").upload(path, f, { contentType: f.type });
      if (up.error) throw new Error(up.error.message);
      const { data, error } = await supabase.from("songs").insert({ workspace_id: ws.id, title: title.trim() || f.name.replace(/\.[^.]+$/, ""), artist: artist.trim() || null, storage_path: path, mime: f.type, bytes: f.size, created_by: s.session.user.id }).select("id,title,artist,language,storage_path,lyrics_text,created_at").single();
      if (error) throw new Error(error.message);
      setMsg(null); await loadSongs(); choose(data as Song);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al subir."); }
    finally { setBusy(false); }
  }

  const plan = useMemo(() => { try { return planVariants(n, styles, bgs, seed); } catch (e) { return { error: (e as Error).message } as const; } }, [n, styles, bgs, seed]);
  const lyricLines = useMemo(() => parseLyrics(lyrics), [lyrics]);

  async function generate() {
    if (!song || "error" in plan || busy) return;
    setBusy(true); setMsg(null);
    if ((song.lyrics_text ?? "") !== lyrics) {
      const { error } = await supabase.from("songs").update({ lyrics_text: lyrics.trim() || null }).eq("id", song.id);
      if (error) { setBusy(false); return setMsg(error.message); }
      setSong({ ...song, lyrics_text: lyrics.trim() || null });
    }
    const params = { n, styles, backgrounds: bgs, seed, ratio, start: start || 0, end: end || null };
    const { data, error } = await supabase.rpc("request_lyrics", { p_song: song.id, p_params: params, p_key: crypto.randomUUID() });
    setBusy(false);
    if (error) return setMsg(error.message);
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    setMsg(`Lote de ${n} vídeo(s) en cola.`); setOpenBatch(data as string); loadBatches(song);
  }

  // Refresco mientras haya un lote activo
  const activeBatch = batches.find((b) => !["done", "failed", "cancelled"].includes(b.status));
  useEffect(() => {
    if (!song || (!activeBatch && !openBatch)) return;
    const tick = () => { loadBatches(song); if (openBatch) loadVideos(openBatch); };
    tick(); if (!activeBatch) return;
    const i = setInterval(tick, 4000); return () => clearInterval(i);
  }, [song, activeBatch?.id, openBatch, loadBatches, loadVideos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function importLyrics(f: File | undefined) { if (f) setLyrics(parseLyrics(await f.text()).map((l) => l.text).join("\n")); }
  async function download(v: LV) {
    const { data } = await supabase.storage.from("renders").createSignedUrl(v.storage_path!, 300, { download: `${song?.title ?? "lyric"}-${v.variant}.mp4` });
    if (data?.signedUrl) window.location.href = data.signedUrl;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">Lyric Studio</h1>
      <p className="mt-1 text-[var(--muted)]">Sube una canción, aporta la letra (o deja que se transcriba), elige estilos y fondos e indica cuántos vídeos necesitas.</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="font-medium">Canciones</h2>
          <UploadSong busy={busy} onUpload={upload} />
          {songs === null && <p className="mt-3 text-sm text-[var(--muted)]">Cargando…</p>}
          {songs?.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">Aún no hay canciones.</p>}
          <ul className="mt-3 space-y-1">
            {songs?.map((s) => (
              <li key={s.id}><button onClick={() => choose(s)} aria-current={song?.id === s.id} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${song?.id === s.id ? "bg-black/[0.06] font-medium" : "hover:bg-[var(--hover)]"}`}>
                <div className="truncate">{s.title}</div><div className="truncate text-xs text-[var(--muted)]">{s.artist ?? "Sin artista"} · {s.lyrics_text ? "con letra" : "sin letra"}</div>
              </button></li>
            ))}
          </ul>
        </aside>

        {!song ? (
          <section className="grid place-items-center rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-[var(--muted)]">Elige o sube una canción para empezar.</section>
        ) : (
          <section className="grid gap-5">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="font-medium">{song.title}</h2>
              <audio controls src={audioUrl} className="mt-2 w-full" />
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <label>Desde (s) <input type="number" min={0} step={0.5} value={start} onChange={(e) => setStart(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1 tnum" /></label>
                <label>Hasta (s, 0 = final) <input type="number" min={0} step={0.5} value={end} onChange={(e) => setEnd(Number(e.target.value))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1 tnum" /></label>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">Letra</h2>
                <label className="cursor-pointer rounded border border-[var(--border)] bg-white px-3 py-1 text-sm">Importar TXT/LRC/SRT/VTT<input type="file" accept=".txt,.lrc,.srt,.vtt,text/plain" className="sr-only" onChange={(e) => importLyrics(e.target.files?.[0])} /></label>
              </div>
              <textarea rows={8} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Pega la letra, una línea por verso. Si la dejas vacía, se transcribe el canto (menos fiable con instrumental)." className="mt-2 w-full rounded border border-[var(--border)] bg-white px-3 py-2 text-sm" />
              <p className="text-xs text-[var(--muted)]">{lyricLines.length} líneas. Con letra aportada se respeta tu texto y solo se calculan los tiempos; las palabras sin pareja en el audio se interpolan y se marcan.</p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <h2 className="font-medium">Variantes</h2>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label>Número de vídeos <input type="number" min={1} max={200} value={n} onChange={(e) => setN(Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1 tnum" /></label>
                <label>Formato
                  <select value={ratio} onChange={(e) => setRatio(e.target.value as typeof ratio)} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1"><option>9:16</option><option>1:1</option><option>16:9</option></select></label>
                <fieldset><legend>Estilos</legend>
                  <div className="mt-1 flex flex-wrap gap-2">{Object.keys(PRESETS).map((p) => (
                    <label key={p} className="flex items-center gap-1 rounded border border-[var(--border)] bg-white px-2 py-1"><input type="checkbox" checked={styles.includes(p)} onChange={(e) => setStyles(e.target.checked ? [...styles, p] : styles.filter((x) => x !== p))} />{p}</label>))}</div></fieldset>
                <fieldset><legend>Fondos (color sólido)</legend>
                  <div className="mt-1 flex flex-wrap gap-2">{BG_DEFAULT.map((c) => (
                    <button key={c} type="button" aria-pressed={bgs.includes(c)} onClick={() => setBgs(bgs.includes(c) ? bgs.filter((x) => x !== c) : [...bgs, c])} className={`h-8 w-8 rounded border-2 ${bgs.includes(c) ? "border-[#111]" : "border-[var(--border)]"}`} style={{ background: c }} title={c}>{bgs.includes(c) ? <span className="text-xs mix-blend-difference text-white">✓</span> : null}</button>))}</div></fieldset>
                <label>Semilla <span className="flex gap-2"><input type="number" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 1))} className="mt-1 w-full rounded border border-[var(--border)] bg-white px-2 py-1 tnum" /><button type="button" onClick={() => setSeed(Math.floor(Math.random() * 99999) + 1)} className="mt-1 shrink-0 rounded border border-[var(--border)] bg-white px-2">Nueva</button></span></label>
              </div>
              {"error" in plan ? <p role="alert" className="mt-3">⚠ {plan.error}</p> : (
                <details className="mt-3">
                  <summary className="cursor-pointer">Plan: {plan.variants.length} vídeos · {plan.distinct} combinaciones distintas{plan.repeats ? ` · ${plan.repeats} repiten estilo y fondo (solo cambia la semilla)` : ""}</summary>
                  <ol className="mt-2 max-h-48 overflow-auto rounded border border-[var(--border)] bg-white p-2 tnum">{plan.variants.map((v) => <li key={v.index}>{v.index}. {v.style} · <span className="inline-block h-3 w-3 align-middle" style={{ background: v.background }} /> {v.background}</li>)}</ol>
                </details>
              )}
              {"error" in plan || !plan.repeats ? null : <p className="mt-2 text-xs">⚠ Hay más vídeos que combinaciones distintas. Añade estilos o fondos si no quieres repeticiones.</p>}
              <button onClick={generate} disabled={busy || "error" in plan} className="mt-4 rounded-lg bg-[#111] px-5 py-2.5 font-medium text-white disabled:opacity-50">Generar {n} vídeo{n === 1 ? "" : "s"}</button>
              {msg && <p role="status" aria-live="polite" className="mt-2">{msg}</p>}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <h2 className="font-medium">Lotes</h2>
              {!batches.length && <p className="mt-2 text-[var(--muted)]">Aún no hay lotes para esta canción.</p>}
              <ul className="mt-2 space-y-1">{batches.map((b) => (
                <li key={b.id}><button onClick={() => { setOpenBatch(b.id); loadVideos(b.id); }} className={`flex w-full justify-between rounded px-2 py-1 text-left ${openBatch === b.id ? "bg-black/[0.06]" : "hover:bg-[var(--hover)]"}`}>
                  <span className="tnum">{new Date(b.created_at).toLocaleString("es")} · {b.params.n} vídeos</span><span>{STAGE[b.status] ?? b.status}{b.error_message ? ` · ${b.error_message}` : ""}</span></button></li>))}</ul>
              {openBatch && (<>
                <p className="mt-3 tnum">{videos.filter((v) => v.status === "ready").length} de {batches.find((b) => b.id === openBatch)?.params.n ?? "?"} listos</p>
                <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{videos.map((v) => (
                  <li key={v.id} className="rounded-lg border border-[var(--border)] bg-white p-2">
                    {v.url ? <video src={v.url} controls preload="metadata" className={`w-full rounded bg-black ${ratio === "16:9" ? "aspect-video" : ratio === "1:1" ? "aspect-square" : "aspect-[9/16]"}`} /> : <div className="grid aspect-[9/16] place-items-center rounded bg-black/80 text-white">Renderizando…</div>}
                    <div className="mt-1 flex items-center justify-between text-xs"><span>#{v.variant} · {v.params.style} · {v.params.background}</span>{v.url && <button onClick={() => download(v)} className="underline">Descargar</button>}</div>
                  </li>))}</ul>
              </>)}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function UploadSong({ busy, onUpload }: { busy: boolean; onUpload: (f: File | undefined, title: string, artist: string) => void }) {
  const [title, setTitle] = useState(""), [artist, setArtist] = useState("");
  return (
    <div className="mt-3 grid gap-2 text-sm">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (opcional)" className="rounded border border-[var(--border)] bg-white px-2 py-1" />
      <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista (opcional)" className="rounded border border-[var(--border)] bg-white px-2 py-1" />
      <label className={`cursor-pointer rounded-lg bg-[#111] px-3 py-2 text-center font-medium text-white ${busy ? "opacity-50" : ""}`}>{busy ? "Subiendo…" : "Subir canción (MP3/WAV)"}
        <input type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" className="sr-only" disabled={busy} onChange={(e) => { onUpload(e.target.files?.[0], title, artist); e.target.value = ""; }} /></label>
    </div>
  );
}
