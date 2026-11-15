"use client";
// Lyric Studio v2 · Mis canciones: subir con el cargador compartido, ver el estado de validación y crear piezas.
// Flujo de subida: sesión (/api/uploads) → registrar canción (/api/lyrics/songs) → subir partes (runUpload) → completar.
// Si registrar falla, se cancela la sesión para no dejar una subida huérfana.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { httpApi, localResumeStore, runUpload, type UploadEvent } from "../lib/uploader";
import type { SyncWord } from "@rafaga/lyrics";
import LyricSyncEditor from "./LyricSyncEditor";
import Icon from "./Icon";
import LyricPreview from "./LyricPreview";
import LyricLibrary from "./LyricLibrary";
import LyricSettings from "./LyricSettings";
import LyricResults from "./LyricResults";
import { validateLyricComposition, switchLyricMode, planLyricVariants, surpriseCaption, type LyricComposition } from "@rafaga/composition";

const MAX_SONG = 62914560;
type Song = { id: string; lyrics_text?: string | null; title: string; artist: string | null; status: "pending" | "ready" | "failed"; duration_ms: number | null; error_code: string | null; created_at: string };
const ERR: Record<string, string> = {
  too_long: "La canción dura más de 10 minutos. Recórtala y súbela de nuevo.",
  too_large: "La canción pesa más de 60 MiB. Expórtala en MP3 o M4A y súbela de nuevo.",
  unsupported_file: "El archivo no es un audio compatible o trae vídeo. Sube MP3, WAV, M4A, AAC, FLAC u OGG.",
};
const MODES = [["letra", "Letra"], ["texto", "Texto"], ["portada", "Portada"]] as const;
const dur = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}` : "—");
const fmt = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function sha256Hex(f: File) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export default function LyricStudioV2() {
  const [songs, setSongs] = useState<Song[] | null>(null), [ev, setEv] = useState<UploadEvent | null>(null), [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [mode, setMode] = useState<Record<string, string>>({});
  const [wsId, setWsId] = useState<string | null>(null);
  useEffect(() => { void supabase.from("workspace_members").select("workspace_id").limit(1).then(({ data }) => setWsId(data?.[0]?.workspace_id ?? null)); }, []);
  const [projectId, setProjectId] = useState<string | null>(null), [nVar, setNVar] = useState(3), [res, setRes] = useState<720 | 1080>(720), [outFmt, setOutFmt] = useState<LyricComposition["aspect"]>("9:16");
  const [lyricsDraft, setLyricsDraft] = useState<Record<string, string>>({});
  const [locks, setLocks] = useState({ song_range: true, lyrics_sync: true, style: false, background: true, format: true }), [batch, setBatch] = useState<{ export_ids: string[]; generation_id: string; batch_id?: string } | null>(null);
  const [comp, setComp] = useState<LyricComposition | null>(null);
  const [editing, setEditing] = useState<{ song: Song; url: string; revision: number | null; words: SyncWord[] } | null>(null);
  const ctl = useRef<{ cancel: () => Promise<void> } | null>(null);
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

  const load = useCallback(async () => {
    const { data } = await supabase.from("songs").select("id,title,artist,status,duration_ms,error_code,created_at,lyrics_text").not("source_id", "is", null).order("created_at", { ascending: false });
    setSongs((data ?? []) as Song[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!songs?.some((s) => s.status === "pending")) return; const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [songs, load]);

  async function upload(f: File) {
    setMsg(null); setEv(null);
    if (!f.type.startsWith("audio/")) return setMsg("Sube un archivo de audio: MP3, WAV, M4A, AAC, FLAC u OGG.");
    if (f.size > MAX_SONG) return setMsg(`La canción pesa ${fmt(f.size)}. El máximo es 60 MB: expórtala en MP3 o M4A.`);
    setBusy(true);
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    let uploadId = "";
    try {
      const title = f.name.replace(/\.[^.]+$/, "");
      const s = await fetch("/api/uploads", { method: "POST", headers: { ...H, "Idempotency-Key": `lyr-${crypto.randomUUID()}` }, body: JSON.stringify({ name: title, bytes: f.size, mime: f.type, force: true }) });
      const sj = await s.json(); if (!s.ok) throw new Error(sj?.error?.message ?? "No se pudo empezar la subida.");
      uploadId = sj.upload_id;
      const r = await fetch("/api/lyrics/songs", { method: "POST", headers: H, body: JSON.stringify({ upload_id: uploadId, title }) });
      if (!r.ok) { await fetch(`/api/uploads/${uploadId}`, { method: "DELETE", headers: H }).catch(() => {}); const rj = await r.json().catch(() => ({})); throw new Error(rj?.error?.message ?? "No se pudo registrar la canción."); }
      const hash = await sha256Hex(f);
      const up = runUpload({ uploadId, file: f, api: httpApi(t), store: localResumeStore, sha256: async () => hash, onEvent: setEv });
      ctl.current = up; await up.promise; ctl.current = null;
      setMsg("Canción subida. Se está validando; en unos segundos podrás crear una pieza.");
      await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  /** Pide la sincronización (cuesta 1 unidad por minuto solo si hay que transcribir) y abre el editor con la última revisión. */
  async function sync(s: Song) {
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    const r = await fetch(`/api/lyrics/songs/${s.id}/sync`, { method: "POST", headers: { ...H, "Idempotency-Key": `sync-${s.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ mode: s.lyrics_text?.trim() ? "align" : "transcribe" }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.cached ? "Sincronizando con la transcripción guardada (sin coste)." : `Sincronizando. Se reservan ${j.units_reserved} unidades; lo no usado se devuelve.`) : (j?.error?.message ?? "No se pudo sincronizar."));
  }
  async function saveLyrics(s: Song) {
    const txt = (lyricsDraft[s.id] ?? "").replace(/\r/g, "").trim();
    const { error } = await supabase.from("songs").update({ lyrics_text: txt || null }).eq("id", s.id);
    if (error) { setMsg("No se pudo guardar la letra."); return; }
    setMsg(txt ? "Letra guardada. Ahora sincronízala con la canción." : "Letra borrada: se transcribirá la canción."); setLyricsDraft((d) => { const n = { ...d }; delete n[s.id]; return n; }); await load();
  }
  async function edit(s: Song) {
    const t = await token(), H = { Authorization: `Bearer ${t}` };
    const [a, u] = await Promise.all([fetch(`/api/lyrics/songs/${s.id}/alignment`, { headers: H }), fetch(`/api/lyrics/songs/${s.id}/audio`, { headers: H })]);
    const aj = await a.json().catch(() => ({})), uj = await u.json().catch(() => ({}));
    if (!u.ok) return setMsg(uj?.error?.message ?? "No se pudo abrir el audio.");
    if (!aj.words?.length) return setMsg("Todavía no hay sincronización. Pulsa «Sincronizar» y espera unos segundos.");
    setEditing({ song: s, url: uj.url, revision: aj.revision ?? null, words: aj.words });
    const ws = (aj.words as SyncWord[]); setComp(validateLyricComposition({ aspect: "9:16", range: { start: 0, end: Math.max(5, Math.min(30, ws.at(-1)?.end ?? 30)) }, words: ws.map((w) => ({ text: w.text, start: w.start, end: w.end, line: w.line })) }));
  }
  /** Planifica N variantes con candados y las envía: 1 generación, N clips y un lote de exportaciones MP4. */
  async function generate() {
    if (!comp) return setMsg("Abre una canción con «Editar sincronización» para generar variantes.");
    let pid = projectId;
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    if (!pid && editing) { const r = await fetch("/api/lyrics/projects", { method: "POST", headers: H, body: JSON.stringify({ song_id: editing.song.id, mode: comp.mode }) }); const j = await r.json().catch(() => ({})); if (!r.ok) return setMsg(j?.error?.message ?? "No se pudo crear la pieza."); pid = j.project_id; setProjectId(pid); }
    const base = { ...comp, res, aspect: outFmt }, variants = planLyricVariants(base, nVar, locks, { styles: Array.from({ length: nVar }, (_, i) => surpriseCaption(base.seed * 1000 + i)) });
    const r = await fetch(`/api/lyrics/projects/${pid}/variants`, { method: "POST", headers: { ...H, "Idempotency-Key": `var-${crypto.randomUUID()}` }, body: JSON.stringify({ variants, zip: true }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) return setMsg(j?.error?.message ?? "No se pudieron generar las variantes.");
    setBatch({ export_ids: j.export_ids, generation_id: j.generation_id, batch_id: j.batch_id }); setMsg(`Generando ${variants.length} variantes. No consume unidades.`);
  }
  async function createPiece(s: Song) {
    const t = await token(), m = mode[s.id] ?? "letra";
    const r = await fetch("/api/lyrics/projects", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ song_id: s.id, mode: m }) });
    const j = await r.json().catch(() => ({})); setMsg(r.ok ? `Pieza creada en modo ${m}.` : (j?.error?.message ?? "No se pudo crear la pieza."));
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header><h1 className="text-3xl font-extrabold">Lyric Studio</h1><p className="mt-1 text-[var(--muted)]">Sube una canción y crea vídeos con su letra en movimiento.</p></header>
      <ol aria-label="Cómo funciona" className="flex flex-wrap gap-2.5">
        {([["1", "Sube la canción", "upload", "violet"], ["2", "Ajusta la letra", "type", "blue"], ["3", "Elige el estilo y crea", "wand", "mint"]] as const).map(([n, t, ic, tone]) => (
          <li key={n} className={`tag tag-${tone}`}><span className="tag-ico"><Icon n={ic} className="h-4 w-4" /></span><span className="tnum opacity-60">{n}</span>{t}</li>))}
      </ol>
      <section className="card p-4" aria-label="Subir una canción">
        <label htmlFor="song-file" className={`grid cursor-pointer place-items-center rounded-[20px] border-2 border-dashed border-[#C9D6EC] p-7 text-center ${busy ? "pointer-events-none opacity-60" : "hover:border-[var(--accent)]"}`} style={{ background: "var(--grad-soft)" }}>
          <span aria-hidden className="ico-tile grad !h-14 !w-14 !rounded-[18px]"><Icon n="music" className="h-6 w-6" /></span>
          <span className="mt-3 font-display text-lg font-bold text-[var(--ink)]">Subir una canción</span>
          <span className="text-sm text-[var(--muted)]">MP3, WAV, M4A, AAC, FLAC u OGG · hasta 60 MB y 10 minutos</span>
          <span className="btn btn-primary mt-3"><Icon n="upload" className="h-4 w-4" />Elegir archivo</span>
        </label>
        <input id="song-file" type="file" accept="audio/*" disabled={busy} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        {ev && busy && <div className="mt-3 text-sm" aria-live="polite"><div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full" style={{ background: "var(--grad)", width: `${Math.round((100 * ev.bytesSent) / Math.max(1, ev.totalBytes))}%` }} /></div>
          <p className="tnum mt-1 text-xs text-[var(--muted)]">{fmt(ev.bytesSent)} de {fmt(ev.totalBytes)}</p>
          <button className="btn btn-ghost mt-2 !min-h-9" onClick={() => void ctl.current?.cancel().then(() => { setBusy(false); setMsg("Subida cancelada. No se ha guardado nada."); })}>Cancelar</button></div>}
        {msg && <p role="status" className="mt-3 text-sm">{msg}</p>}
      </section>
      <section aria-label="Canciones">
        {songs === null ? <p className="text-sm text-[var(--muted)]">Cargando canciones…</p> : !songs.length ? <p className="card p-4 text-sm text-[var(--muted)]">Aún no hay canciones. Sube la primera para empezar.</p> :
          <ul className="space-y-2">{songs.map((s) => (
            <li key={s.id} className="card space-y-4 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3"><span aria-hidden className="ico-tile grad"><Icon n="music" className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-display text-base font-bold">{s.title}{s.artist ? ` · ${s.artist}` : ""}</p>
                  <p className="text-xs text-[var(--muted)]">{s.status === "pending" ? "Validando…" : s.status === "ready" ? `Lista · ${dur(s.duration_ms)}` : (ERR[s.error_code ?? ""] ?? "No se pudo validar el archivo.")}</p></div>
                {s.status === "ready" && (s.lyrics_text?.trim() ? <span className="status status-ok">Letra guardada · {s.lyrics_text.split("\n").filter((l) => l.trim()).length} líneas</span> : <span className="chip">Sin letra todavía</span>)}</div>
              {s.status === "ready" && <>
                <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="mb-1.5 flex items-center gap-2 font-semibold"><span className="tag tag-violet !px-2 !py-0.5 !text-xs">1</span>Pega la letra <span className="font-normal text-[var(--muted)]">(cada línea se muestra por separado; si la dejas vacía se transcribe la canción)</span></p>
                  <textarea aria-label="Letra de la canción" rows={5} maxLength={20000} className="input !min-h-0" placeholder={"Estoy contando días\nPara volver a verte…"} value={lyricsDraft[s.id] ?? s.lyrics_text ?? ""} onChange={(e) => setLyricsDraft((d) => ({ ...d, [s.id]: e.target.value }))} />
                  <div className="mt-2 flex flex-wrap items-center gap-2"><button className="btn btn-ghost !min-h-9" disabled={(lyricsDraft[s.id] ?? s.lyrics_text ?? "") === (s.lyrics_text ?? "")} onClick={() => void saveLyrics(s)}><Icon n="check" className="h-4 w-4" />Guardar letra</button>
                    <span className="text-xs text-[var(--muted)]">Al cambiar la letra hay que volver a sincronizar.</span></div></div>
                <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="mb-1.5 flex items-center gap-2 font-semibold"><span className="tag tag-blue !px-2 !py-0.5 !text-xs">2</span>Sincroniza la letra con la canción</p>
                  <div className="flex flex-wrap gap-2"><button className="btn btn-primary !min-h-9" onClick={() => void sync(s)}><Icon n="wand" className="h-4 w-4" />Sincronizar automáticamente</button>
                    <button className="btn btn-ghost !min-h-9" onClick={() => void edit(s)}><Icon n="clock" className="h-4 w-4" />Sincronizar a mano o ajustar</button></div>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">A mano: suena la canción, mantén la barra espaciadora mientras se dice cada palabra y suéltala al acabar.</p></div>
                <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="mb-1.5 flex items-center gap-2 font-semibold"><span className="tag tag-mint !px-2 !py-0.5 !text-xs">3</span>Crea la pieza</p>
                  <div className="flex flex-wrap items-center gap-2"><select aria-label="Modo de la pieza" className="input !min-h-9 !w-auto" value={mode[s.id] ?? "letra"} onChange={(e) => setMode((m) => ({ ...m, [s.id]: e.target.value }))}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <button className="btn btn-primary !min-h-9" onClick={() => void createPiece(s)}><Icon n="play" className="h-4 w-4" />Crear pieza</button></div></div></>}
            </li>))}</ul>}
      </section>
      {comp && <section className="card space-y-2 p-3 text-sm" aria-label="Modo de la pieza">
        <div role="radiogroup" aria-label="Modo" className="flex gap-2">{([["letra", "Letra"], ["texto", "Texto"], ["portada", "Portada"]] as const).map(([m, l]) => <button key={m} role="radio" aria-checked={comp.mode === m} className={`rounded-full border px-3 py-1 text-xs ${comp.mode === m ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "hairline"}`} onClick={() => setComp(switchLyricMode(comp, m))}>{l}</button>)}</div>
        <p className="text-xs text-[var(--muted)]">Cambiar de modo conserva la letra, el estilo y los fondos.</p>
        {comp.mode === "texto" && <div className="grid gap-2 sm:grid-cols-3"><input className="rounded-lg border hairline px-2 py-1.5 sm:col-span-3" placeholder="Mensaje" maxLength={200} value={comp.message?.text ?? ""} onChange={(e) => setComp({ ...comp, message: { text: e.target.value, start: comp.message?.start ?? 0, end: comp.message?.end ?? 5 } })} aria-label="Mensaje" />
          <label className="text-xs">Desde (s)<input type="number" min={0} className="ml-1 w-20 rounded border hairline px-1" value={comp.message?.start ?? 0} onChange={(e) => setComp({ ...comp, message: { text: comp.message?.text ?? "", start: Number(e.target.value), end: comp.message?.end ?? 5 } })} /></label>
          <label className="text-xs">Hasta (s)<input type="number" min={1} className="ml-1 w-20 rounded border hairline px-1" value={comp.message?.end ?? 5} onChange={(e) => setComp({ ...comp, message: { text: comp.message?.text ?? "", start: comp.message?.start ?? 0, end: Number(e.target.value) } })} /></label></div>}
        {comp.mode === "portada" && <div className="grid gap-2 sm:grid-cols-2"><input className="rounded-lg border hairline px-2 py-1.5" placeholder="Título" maxLength={120} value={comp.cover?.title ?? ""} onChange={(e) => setComp({ ...comp, cover: { ...comp.cover, title: e.target.value } })} aria-label="Título" />
          <input className="rounded-lg border hairline px-2 py-1.5" placeholder="Artista" maxLength={120} value={comp.cover?.artist ?? ""} onChange={(e) => setComp({ ...comp, cover: { title: comp.cover?.title ?? "", ...comp.cover, artist: e.target.value } })} aria-label="Artista" /></div>}
        <input className="w-full rounded-lg border hairline px-2 py-1.5" placeholder="Gancho (opcional, franja superior)" maxLength={120} value={comp.hook?.text ?? ""} onChange={(e) => setComp({ ...comp, hook: e.target.value ? { text: e.target.value, dur: comp.hook?.dur ?? 3, start: comp.hook?.start } : null })} aria-label="Gancho" />
      </section>}
      {comp && <LyricPreview composition={comp} onChange={setComp} />}
      {comp && <LyricSettings composition={comp} onChange={setComp} />}
      {comp && <section className="card space-y-2 p-4 text-sm" aria-label="Generar variantes">
        <h2 className="font-semibold">Generar N variantes</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label>Variantes<input type="number" min={1} max={10} className="ml-1 w-16 rounded border hairline px-1" value={nVar} onChange={(e) => setNVar(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <label>Resolución<select className="ml-1 rounded border hairline px-1" value={res} onChange={(e) => setRes(Number(e.target.value) as 720 | 1080)}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
          <label>Formato<select className="ml-1 rounded border hairline px-1" value={outFmt} onChange={(e) => setOutFmt(e.target.value as LyricComposition["aspect"])}>{["9:16", "1:1", "4:5", "16:9"].map((a) => <option key={a}>{a}</option>)}</select></label>
        </div>
        <fieldset className="flex flex-wrap gap-3 text-xs"><legend className="mb-1 text-[var(--muted)]">Mantener igual en todas</legend>{([["song_range", "Canción y tramo"], ["lyrics_sync", "Letra y sincronización"], ["style", "Estilo"], ["background", "Fondo"], ["format", "Formato"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={locks[k]} onChange={(e) => setLocks({ ...locks, [k]: e.target.checked })} />{l}</label>)}</fieldset>
        <button className="btn btn-primary !min-h-9" onClick={() => void generate()}>Generar {nVar} variantes</button>
      </section>}
      {batch && <LyricResults exportIds={batch.export_ids} generationId={batch.generation_id} batchId={batch.batch_id} projectId={projectId ?? undefined} />}
      <LyricLibrary workspaceId={wsId} />
      {editing && <LyricSyncEditor songId={editing.song.id} audioUrl={editing.url} lyrics={editing.song.lyrics_text ?? editing.words.map((w) => w.text).join(" ")} revision={editing.revision} words={editing.words} onSaved={() => void load()} />}
    </main>
  );
}
