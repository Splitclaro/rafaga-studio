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
import { TRENDING_STYLES } from "../lib/trendingstyles";
import CollectionsPicker, { useCollections } from "./Collections";
import LyricPreview from "./LyricPreview";
import LyricLibrary from "./LyricLibrary";
import LyricSettings from "./LyricSettings";
import LyricResults from "./LyricResults";
import { validateCaptionStyle, validateLyricComposition, switchLyricMode, planLyricVariants, surpriseCaption, type LyricComposition } from "@rafaga/composition";

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

const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg" };
/** Algunos navegadores no informan el tipo de .m4a/.flac/.ogg: se reconoce también por la extensión. */
const audioMime = (f: File) => (f.type.startsWith("audio/") ? f.type : AUDIO_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? "");
async function sha256Hex(f: File) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export default function LyricStudioV2() {
  const [songs, setSongs] = useState<Song[] | null>(null), [ev, setEv] = useState<UploadEvent | null>(null), [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [mode, setMode] = useState<Record<string, string>>({});
  const [wsId, setWsId] = useState<string | null>(null);
  useEffect(() => { void supabase.from("workspace_members").select("workspace_id").limit(1).then(({ data }) => setWsId(data?.[0]?.workspace_id ?? null)); }, []);
  const [projectId, setProjectId] = useState<string | null>(null), [nVar, setNVar] = useState(3), [res, setRes] = useState<720 | 1080>(720), [outFmt, setOutFmt] = useState<LyricComposition["aspect"]>("9:16");
  const [auto, setAuto] = useState<Record<string, "syncing" | "ready" | "failed">>({}), [activeSong, setActiveSong] = useState<Song | null>(null), seen = useRef<Set<string>>(new Set()), opened = useRef(false);
  const { cols, reload: reloadCols } = useCollections(), [selCol, setSelCol] = useState<string | null>(null);
  const [lyricsDraft, setLyricsDraft] = useState<Record<string, string>>({});
  const [locks, setLocks] = useState({ song_range: true, lyrics_sync: true, style: false, background: true, format: true }), [batch, setBatch] = useState<{ export_ids: string[]; generation_id: string; batch_id?: string } | null>(null);
  const [comp, setComp] = useState<LyricComposition | null>(null);
  // Cola de varias canciones (como Escalium: cada audio es su propio vídeo): subida en serie, sincronización automática de cada una y generación del lote para todas.
  type Q = { name: string; state: "waiting" | "uploading" | "done" | "error"; note?: string };
  type Bt = { export_ids: string[]; generation_id: string; batch_id?: string };
  const [genBusy, setGenBusy] = useState(false), [uq, setUq] = useState<Q[]>([]), [batches, setBatches] = useState<Record<string, Bt>>({}), [rst, setRst] = useState<Record<string, string>>({}), [genAll, setGenAll] = useState<string | null>(null);
  const projects = useRef<Record<string, string>>({});
  const [editing, setEditing] = useState<{ song: Song; url: string; revision: number | null; words: SyncWord[] } | null>(null);
  const ctl = useRef<{ cancel: () => Promise<void> } | null>(null);
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

  const load = useCallback(async () => {
    const { data } = await supabase.from("songs").select("id,title,artist,status,duration_ms,error_code,created_at,lyrics_text").not("source_id", "is", null).order("created_at", { ascending: false });
    setSongs((data ?? []) as Song[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const s = songs?.find((x) => x.status === "ready" && !seen.current.has(x.id)); if (s) void autoSync(s); }, [songs]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!songs?.some((s) => s.status === "pending")) return; const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [songs, load]);

  async function upload(f0: File): Promise<boolean> {
    setMsg(null); setEv(null);
    const mime = audioMime(f0), f = mime && mime !== f0.type ? new File([f0], f0.name, { type: mime }) : f0;
    if (!mime) { setMsg("Sube un archivo de audio: MP3, WAV, M4A, AAC, FLAC u OGG."); return false; }
    if (f.size > MAX_SONG) { setMsg(`La canción pesa ${fmt(f.size)}. El máximo es 60 MB: expórtala en MP3 o M4A.`); return false; }
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
      await load(); return true;
    } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  }
  /** Varias canciones a la vez: se suben una tras otra (hasta 10) y cada una sigue sola: validar → sincronizar. */
  async function uploadMany(list: File[]) {
    const files = list.filter((f) => audioMime(f)).slice(0, 10);
    if (!files.length) return setMsg("Sube archivos de audio: MP3, WAV, M4A, AAC, FLAC u OGG.");
    if (files.length === 1) return void (await upload(files[0]));
    setUq(files.map((f) => ({ name: f.name, state: "waiting" as const })));
    for (const [i, f] of files.entries()) {
      setUq((q) => q.map((x, k) => (k === i ? { ...x, state: "uploading" } : x)));
      const ok = await upload(f);
      setUq((q) => q.map((x, k) => (k === i ? { ...x, state: ok ? "done" : "error", note: ok ? undefined : "No se pudo subir" } : x)));
    }
    setMsg(`${files.length} canciones en la cola: se validan y sincronizan solas.`);
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
    setMsg(txt ? "Letra guardada. Sincronizando automáticamente…" : "Letra borrada: se transcribirá la canción."); setLyricsDraft((d) => { const n = { ...d }; delete n[s.id]; return n; }); await load(); void autoSync({ ...s, lyrics_text: txt || null }, true);
  }
  const alignment = async (s: Song) => { const t = await token(); const a = await fetch(`/api/lyrics/songs/${s.id}/alignment`, { headers: { Authorization: `Bearer ${t}` } }); return a.ok ? await a.json().catch(() => ({})) as { words?: SyncWord[]; revision?: number | null } : {}; };
  /** Sincronización automática sin intervención: pide la alineación (con la letra pegada o transcribiendo), espera a que haya una revisión nueva y abre el estudio. */
  async function autoSync(s: Song, force = false) {
    if (!force && seen.current.has(s.id)) return; seen.current.add(s.id);
    const b0 = await alignment(s), before = b0.revision ?? null, sig = (w?: SyncWord[]) => (w ?? []).map((x) => `${x.text}${x.start.toFixed(2)}`).join("|");
    if (!force && before != null) { setAuto((a) => ({ ...a, [s.id]: "ready" })); if (!opened.current) { opened.current = true; await edit(s, false); } return; }   // ya sincronizada: no se repite
    if (!force) { /* primera vez: se sincroniza ahora */ }   // ya sincronizada: no se repite
    setAuto((a) => ({ ...a, [s.id]: "syncing" }));
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    const r = await fetch(`/api/lyrics/songs/${s.id}/sync`, { method: "POST", headers: { ...H, "Idempotency-Key": `sync-${s.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ mode: s.lyrics_text?.trim() ? "align" : "transcribe" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setAuto((a) => ({ ...a, [s.id]: "failed" })); setMsg(j?.error?.message ?? "No se pudo sincronizar automáticamente."); return; }
    for (let i = 0; i < 90; i++) {   // hasta ~6 min
      await new Promise((res) => setTimeout(res, 4000));
      const a = await alignment(s);
      if (a.words?.length && ((a.revision ?? 0) !== (before ?? -1) || sig(a.words) !== sig(b0.words))) { setAuto((x) => ({ ...x, [s.id]: "ready" })); opened.current = true; await edit(s, false); return; }
    }
    setAuto((a) => ({ ...a, [s.id]: "failed" })); setMsg("La sincronización tarda más de lo normal. Puedes reintentarla o ajustarla a mano.");
  }
  async function edit(s: Song, openEditor = true) {
    const t = await token(), H = { Authorization: `Bearer ${t}` };
    const [a, u] = await Promise.all([fetch(`/api/lyrics/songs/${s.id}/alignment`, { headers: H }), fetch(`/api/lyrics/songs/${s.id}/audio`, { headers: H })]);
    const aj = await a.json().catch(() => ({})), uj = await u.json().catch(() => ({}));
    if (!u.ok) return setMsg(uj?.error?.message ?? "No se pudo abrir el audio.");
    if (!aj.words?.length) return setMsg("Todavía no hay sincronización: se está preparando.");
    setActiveSong(s); if (openEditor) setEditing({ song: s, url: uj.url, revision: aj.revision ?? null, words: aj.words }); else setEditing(null);
    const ws = (aj.words as SyncWord[]); setComp(validateLyricComposition({ aspect: "9:16", range: { start: Math.max(0, Math.floor((ws[0]?.start ?? 0) - 1)), end: Math.max(Math.floor((ws[0]?.start ?? 0)) + 5, Math.min(Math.floor((ws[0]?.start ?? 0)) + 45, Math.ceil(ws.at(-1)?.end ?? 30))) }, words: ws.map((w) => ({ text: w.text, start: w.start, end: w.end, line: w.line })) }));
  }
  const rangeOf = (ws: SyncWord[]) => ({ start: Math.max(0, Math.floor((ws[0]?.start ?? 0) - 1)), end: Math.max(Math.floor((ws[0]?.start ?? 0)) + 5, Math.min(Math.floor((ws[0]?.start ?? 0)) + 45, Math.ceil(ws.at(-1)?.end ?? 30))) });
  async function ensureProject(s: Song, H: Record<string, string>, m: string) {
    if (projects.current[s.id]) return projects.current[s.id];
    const r = await fetch("/api/lyrics/projects", { method: "POST", headers: H, body: JSON.stringify({ song_id: s.id, mode: m }) }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? "No se pudo crear la pieza."); projects.current[s.id] = j.project_id as string; return j.project_id as string;
  }
  /** Genera el lote (N variantes con fondos distintos) para TODAS las canciones sincronizadas, con el estilo, formato y fondos actuales. */
  async function generateAllSongs() {
    if (!comp) return setMsg("Abre una canción para elegir el estilo antes de generar el lote.");
    if (genAll) return;
    const targets = (songs ?? []).filter((x) => x.status === "ready" && auto[x.id] === "ready" && !batches[x.id]); if (!targets.length) return setMsg("No hay canciones sincronizadas pendientes de generar.");
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    const bgItems = (cols?.find((c) => c.id === selCol)?.items ?? []).map((it) => ({ ref: `sb:originals/${it.storage_path}`, kind: (it.kind === "photo" ? "image" : "video") as "image" | "video" }));
    let done = 0; const failed: string[] = [];
    for (const [i, s] of targets.entries()) {
      setGenAll(`Generando ${i + 1} de ${targets.length}: ${s.title}`);
      try {
        const ws = ((await alignment(s)).words ?? []) as SyncWord[]; if (!ws.length) throw new Error("sin sincronización");
        const pid = await ensureProject(s, H, comp.mode);
        const rot = bgItems.length ? bgItems.map((_, k) => bgItems[(k + i * nVar) % bgItems.length]) : bgItems;   // cada canción empieza en un fondo distinto
        const base = validateLyricComposition({ ...comp, res, aspect: outFmt, range: rangeOf(ws), words: ws.map((w) => ({ text: w.text, start: w.start, end: w.end, line: w.line })) });
        const variants = planLyricVariants(base, nVar, rot.length ? { ...locks, background: false } : locks, { styles: Array.from({ length: nVar }, (_, k) => surpriseCaption(base.seed * 1000 + k)), ...(rot.length ? { collections: rot.map((b) => [b]) } : {}) });
        const r = await fetch(`/api/lyrics/projects/${pid}/variants`, { method: "POST", headers: { ...H, "Idempotency-Key": `var-${crypto.randomUUID()}` }, body: JSON.stringify({ variants, zip: true }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message ?? "no se pudo generar");
        setBatches((b) => ({ ...b, [s.id]: { export_ids: j.export_ids, generation_id: j.generation_id, batch_id: j.batch_id } })); done++;
      } catch (e) { failed.push(`${s.title}: ${(e as Error).message}`); }
    }
    setGenAll(null); setMsg(`${done} de ${targets.length} canciones en marcha (${nVar} variantes cada una). No consume unidades.${failed.length ? ` Fallaron: ${failed.join(" · ")}` : ""}`);
  }
  async function deleteSong(s: Song) {
    if (!confirm(`¿Borrar «${s.title}» y todos sus vídeos? No se puede deshacer.`)) return;
    const { error } = await supabase.rpc("delete_song", { p_song: s.id }); if (error) return setMsg("No se pudo borrar la canción.");
    delete projects.current[s.id]; setBatches((b) => { const n = { ...b }; delete n[s.id]; return n; }); if (activeSong?.id === s.id) { setActiveSong(null); setBatch(null); }
    setMsg(`«${s.title}» borrada.`); await load();
  }
  function showSong(s: Song) { const b = batches[s.id]; if (!b) return; setBatch(b); setProjectId(projects.current[s.id] ?? null); setActiveSong(s); }
  useEffect(() => {   // estado de las exportaciones de todos los lotes mientras haya alguna sin terminar
    const ids = Object.values(batches).flatMap((b) => b.export_ids); if (!ids.length) return; let stop = false;
    const tick = async () => { const { data } = await supabase.from("renders").select("id,status").in("id", ids); if (stop) return; setRst(Object.fromEntries((data ?? []).map((r) => [r.id as string, r.status as string])));
      if ((data ?? []).every((r) => r.status === "ready" || r.status === "failed")) clearInterval(iv); };
    const iv = setInterval(() => void tick(), 5000); void tick(); return () => { stop = true; clearInterval(iv); };
  }, [batches]);
  /** Planifica N variantes con candados y las envía: 1 generación, N clips y un lote de exportaciones MP4. */
  async function generate() {
    if (genBusy) return; setGenBusy(true);
    try { await generateOnce(); } finally { setGenBusy(false); }   // un solo envío a la vez: evita lotes duplicados por doble clic
  }
  async function generateOnce() {
    if (!comp) return setMsg("Abre una canción con «Editar sincronización» para generar variantes.");
    let pid = projectId;
    const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
    if (!pid && (activeSong ?? editing?.song)) { const r = await fetch("/api/lyrics/projects", { method: "POST", headers: H, body: JSON.stringify({ song_id: (activeSong ?? editing!.song).id, mode: comp.mode }) }); const j = await r.json().catch(() => ({})); if (!r.ok) return setMsg(j?.error?.message ?? "No se pudo crear la pieza."); pid = j.project_id; setProjectId(pid); if (pid) projects.current[(activeSong ?? editing!.song).id] = pid; }
    // Fondos: la colección elegida reparte un fondo distinto a cada variante (imágenes o vídeos; los vídeos se repiten en bucle).
    const bgItems = (cols?.find((c) => c.id === selCol)?.items ?? []).map((it) => ({ ref: `sb:originals/${it.storage_path}`, kind: (it.kind === "photo" ? "image" : "video") as "image" | "video" }));
    const base = { ...comp, res, aspect: outFmt }, variants = planLyricVariants(base, nVar, bgItems.length ? { ...locks, background: false } : locks, { styles: Array.from({ length: nVar }, (_, i) => surpriseCaption(base.seed * 1000 + i)), ...(bgItems.length ? { collections: bgItems.map((b) => [b]) } : {}) });
    const r = await fetch(`/api/lyrics/projects/${pid}/variants`, { method: "POST", headers: { ...H, "Idempotency-Key": `var-${crypto.randomUUID()}` }, body: JSON.stringify({ variants, zip: true }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) return setMsg(j?.error?.message ?? "No se pudieron generar las variantes.");
    setBatch({ export_ids: j.export_ids, generation_id: j.generation_id, batch_id: j.batch_id }); { const sid = (activeSong ?? editing?.song)?.id; if (sid) setBatches((b) => ({ ...b, [sid]: { export_ids: j.export_ids, generation_id: j.generation_id, batch_id: j.batch_id } })); } setMsg(`Generando ${variants.length} variantes. No consume unidades.`);
  }
  async function createPiece(s: Song) {
    const t = await token(), m = mode[s.id] ?? "letra";
    const r = await fetch("/api/lyrics/projects", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ song_id: s.id, mode: m }) });
    const j = await r.json().catch(() => ({})); setMsg(r.ok ? `Pieza creada en modo ${m}.` : (j?.error?.message ?? "No se pudo crear la pieza."));
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header><h1 className="text-3xl font-extrabold">Lyric Studio</h1><p className="mt-1 text-[var(--muted)]">Sube una canción y crea vídeos con su letra en movimiento.</p></header>
      <ol aria-label="Cómo funciona" className="flex flex-wrap gap-2.5">
        {([["1", "Sube la canción", "upload", "violet"], ["2", "Ajusta la letra", "type", "blue"], ["3", "Elige el estilo y crea", "wand", "mint"]] as const).map(([n, t, ic, tone]) => (
          <li key={n} className={`tag tag-${tone}`}><span className="tag-ico"><Icon n={ic} className="h-4 w-4" /></span><span className="tnum opacity-60">{n}</span>{t}</li>))}
      </ol>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
      <section className="card p-4" aria-label="Subir una canción">
        <label htmlFor="song-file" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void uploadMany(Array.from(e.dataTransfer.files)); }} className={`grid cursor-pointer place-items-center rounded-[20px] border-2 border-dashed border-[#C9D6EC] p-7 text-center ${busy ? "pointer-events-none opacity-60" : "hover:border-[var(--accent)]"}`} style={{ background: "var(--grad-soft)" }}>
          <span aria-hidden className="ico-tile grad !h-14 !w-14 !rounded-[18px]"><Icon n="music" className="h-6 w-6" /></span>
          <span className="mt-3 font-display text-lg font-bold text-[var(--ink)]">Subir canciones</span>
          <span className="text-sm text-[var(--muted)]">MP3, WAV, M4A, AAC, FLAC u OGG · hasta 60 MB y 10 minutos · puedes soltar hasta 10 a la vez, cada una será su propio vídeo</span>
          <span className="btn btn-primary mt-3"><Icon n="upload" className="h-4 w-4" />Elegir archivo</span>
        </label>
        <input id="song-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus" multiple disabled={busy} className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void uploadMany(fs); }} />
        {ev && busy && <div className="mt-3 text-sm" aria-live="polite"><div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full" style={{ background: "var(--grad)", width: `${Math.round((100 * ev.bytesSent) / Math.max(1, ev.totalBytes))}%` }} /></div>
          <p className="tnum mt-1 text-xs text-[var(--muted)]">{fmt(ev.bytesSent)} de {fmt(ev.totalBytes)}</p>
          <button className="btn btn-ghost mt-2 !min-h-9" onClick={() => void ctl.current?.cancel().then(() => { setBusy(false); setMsg("Subida cancelada. No se ha guardado nada."); })}>Cancelar</button></div>}
        {msg && <p role="status" className="mt-3 text-sm">{msg}</p>}
      </section>
      {((songs?.length ?? 0) > 1 || uq.length > 0) && (() => {
        const stateOf = (x: Song) => { const b = batches[x.id];
          if (b) { const st = b.export_ids.map((id) => rst[id]); const ok = st.filter((v) => v === "ready").length, bad = st.filter((v) => v === "failed").length; return bad + ok === b.export_ids.length ? `Listo · ${ok}/${b.export_ids.length}${bad ? ` (${bad} fallaron)` : ""}` : `Generando · ${ok}/${b.export_ids.length}`; }
          if (x.status === "pending") return "Validando…"; if (x.status === "failed") return "Error en el archivo";
          return auto[x.id] === "syncing" ? "Sincronizando…" : auto[x.id] === "failed" ? "Falló la sincronización" : auto[x.id] === "ready" ? "Lista para generar" : "Comprobando…"; };
        const pending = (songs ?? []).filter((x) => x.status === "ready" && auto[x.id] === "ready" && !batches[x.id]).length;
        return (
          <section className="card space-y-3 p-4 text-sm" aria-label="Cola de canciones">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-base font-bold">Cola de canciones</h2>
              <button className="btn btn-primary !min-h-9" disabled={!comp || !pending || !!genAll} onClick={() => void generateAllSongs()}><Icon n="wand" className="h-4 w-4" />Generar {nVar} variantes para {pending || "las"} {pending === 1 ? "canción lista" : "canciones listas"}</button></div>
            {!comp && pending > 0 && <p className="text-xs text-[var(--muted)]">Abre una canción para elegir el estilo, el formato y los fondos: se aplicarán a todas.</p>}
            {genAll && <p role="status" aria-live="polite" className="flex items-center gap-2 text-[var(--muted)]"><span className="ring-run" aria-hidden />{genAll}</p>}
            {uq.length > 0 && <ul className="space-y-1" aria-label="Subidas">{uq.map((q, i) => <li key={i} className="flex justify-between gap-2 text-xs"><span className="truncate">{q.name}</span><span className="shrink-0 text-[var(--muted)]">{q.state === "waiting" ? "En espera" : q.state === "uploading" ? "Subiendo…" : q.state === "done" ? "Subida" : (q.note ?? "Error")}</span></li>)}</ul>}
            <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]" aria-label="Estado por canción">{(songs ?? []).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate font-medium">{x.title}</span><span className="chip !py-0.5 text-xs">{stateOf(x)}</span>
                {batches[x.id] && <button className="text-xs font-semibold text-[var(--accent-ink)] underline" onClick={() => showSong(x)}>Ver resultados</button>}
                <button className="text-xs underline" onClick={() => void deleteSong(x)}>Borrar</button></li>))}</ul>
          </section>); })()}
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
                    <span className="text-xs text-[var(--muted)]">Al guardar la letra se sincroniza sola.</span></div></div>
                <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="mb-1.5 flex items-center gap-2 font-semibold"><span className="tag tag-blue !px-2 !py-0.5 !text-xs">2</span>La sincronización es automática</p>
                  {auto[s.id] === "syncing" ? <p role="status" className="flex items-center gap-2 text-[var(--muted)]"><span className="ring-run" aria-hidden />Sincronizando la letra con la canción… en cuanto termine se abre el estudio. No tienes que hacer nada.</p>
                    : auto[s.id] === "failed" ? <p role="alert" className="text-[var(--danger)]">No se pudo sincronizar. <button className="underline" onClick={() => void autoSync(s, true)}>Reintentar</button></p>
                    : auto[s.id] === "ready" ? <p className="status status-ok">Letra sincronizada</p> : <p className="text-[var(--muted)]">Comprobando la sincronización…</p>}
                  <details className="mt-2 text-xs text-[var(--muted)]"><summary className="cursor-pointer">Ajustar a mano (opcional)</summary>
                    <div className="mt-2 flex flex-wrap gap-2"><button className="btn btn-ghost !min-h-9" onClick={() => void autoSync(s, true)}><Icon n="wand" className="h-4 w-4" />Volver a sincronizar</button>
                      <button className="btn btn-ghost !min-h-9" onClick={() => void edit(s)}><Icon n="clock" className="h-4 w-4" />Ajustar palabra a palabra</button></div>
                    <p className="mt-1.5">A mano: suena la canción, mantén la barra espaciadora mientras se dice cada palabra y suéltala al acabar.</p></details></div>
                <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="mb-1.5 flex items-center gap-2 font-semibold"><span className="tag tag-mint !px-2 !py-0.5 !text-xs">3</span>El estudio se abre solo; aquí puedes reabrirlo</p>
                  <div className="flex flex-wrap items-center gap-2"><select aria-label="Modo de la pieza" className="input !min-h-9 !w-auto" value={mode[s.id] ?? "letra"} onChange={(e) => setMode((m) => ({ ...m, [s.id]: e.target.value }))}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <button className="btn btn-primary !min-h-9" onClick={() => void edit(s)}><Icon n="play" className="h-4 w-4" />Abrir en el estudio</button></div></div></>}
            </li>))}</ul>}
      </section>
      {editing && <LyricSyncEditor songId={editing.song.id} audioUrl={editing.url} lyrics={editing.song.lyrics_text ?? editing.words.map((w) => w.text).join(" ")} revision={editing.revision} words={editing.words} onSaved={() => void load()} />}
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
      {comp && <section className="card space-y-3 p-4 text-sm" aria-label="Estilo del texto">
        <h2 className="font-display text-base font-bold">Estilo del texto</h2>
        <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" aria-label="Estilos populares">{TRENDING_STYLES.map((t) => (
          <li key={t.id}><button type="button" title={t.name} aria-pressed={comp.preset === t.preset && JSON.stringify(comp.style) === JSON.stringify(validateCaptionStyle(t.style))} onClick={() => setComp(validateLyricComposition({ ...comp, preset: t.preset, style: validateCaptionStyle({ ...t.style, color: comp.style.color }) }))}
            className="chip w-full !justify-center truncate" style={{ fontFamily: `'${validateCaptionStyle(t.style).font}', Inter, sans-serif`, fontWeight: validateCaptionStyle(t.style).weight }}>{t.name}</button></li>))}</ul>
        <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">Color del texto <input type="color" value={comp.style.color} onChange={(e) => setComp(validateLyricComposition({ ...comp, style: validateCaptionStyle({ ...comp.style, color: e.target.value }) }))} aria-label="Color del texto" /></label>
          <a href="/app/style-studio" className="font-semibold text-[var(--accent-ink)]">Más ajustes de estilo →</a></div>
      </section>}
      <section className="card space-y-3 p-4 text-sm" aria-label="Fondos de los vídeos">
        <h2 className="font-display text-base font-bold">Fondos de tus vídeos</h2>
        <p className="text-[var(--muted)]">Sube imágenes o vídeos cortos a una colección y elígela: <b>cada variante usa un fondo distinto</b> (hasta 10 vídeos de la misma canción). Los vídeos se repiten en bucle.</p>
        <CollectionsPicker selected={selCol} onSelect={setSelCol} cols={cols} reload={reloadCols} />
        {selCol && (() => { const n = cols?.find((c) => c.id === selCol)?.items.length ?? 0; return <p role="status" className={n < nVar ? "text-[var(--warn)]" : "text-[var(--ok)]"}>{n === 0 ? "La colección está vacía: sube al menos una imagen o vídeo." : n < nVar ? `Tienes ${n} fondo${n === 1 ? "" : "s"} para ${nVar} variantes: se repetirán. Sube ${nVar - n} más para que todas sean distintas.` : `${n} fondos: cada una de las ${nVar} variantes tendrá el suyo.`}</p>; })()}
        <div className="rounded-2xl bg-[var(--surface)] p-3"><p className="flex items-center gap-2 font-semibold"><span className="tag tag-violet !px-2 !py-0.5 !text-xs">Google Flow</span>Genera fondos con IA</p>
          <p className="mt-1 text-[var(--muted)]">Flow no ofrece conexión directa para otras apps (solo la web y, de pago, la API de Gemini). Genera allí imágenes o vídeos cortos, descárgalos y súbelos a una colección de arriba.</p>
          <a href="https://labs.google/fx/tools/flow" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold text-[var(--accent-ink)]">Abrir Google Flow →</a></div>
      </section>
      {comp && <LyricSettings composition={comp} onChange={setComp} />}
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-20">
      {comp ? <LyricPreview composition={comp} onChange={setComp} /> : <div className="card grid min-h-[320px] place-items-center p-6 text-center text-sm text-[var(--muted)]"><div><span aria-hidden className="ico-tile grad mx-auto !h-12 !w-12"><Icon n="play" className="h-5 w-5" /></span><p className="mt-3 font-display text-base font-bold text-[var(--ink)]">Aquí verás tu vídeo</p><p>Sube la canción, pega la letra, sincronízala y pulsa «Abrir en el estudio».</p></div></div>}
      {comp && <section className="card space-y-2 p-4 text-sm" aria-label="Generar variantes">
        <h2 className="font-semibold">Generar N variantes</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label>Variantes<input type="number" min={1} max={10} className="ml-1 w-16 rounded border hairline px-1" value={nVar} onChange={(e) => setNVar(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <label>Resolución<select className="ml-1 rounded border hairline px-1" value={res} onChange={(e) => setRes(Number(e.target.value) as 720 | 1080)}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
          <label>Formato<select className="ml-1 rounded border hairline px-1" value={outFmt} onChange={(e) => setOutFmt(e.target.value as LyricComposition["aspect"])}>{["9:16", "1:1", "4:5", "16:9"].map((a) => <option key={a}>{a}</option>)}</select></label>
        </div>
        <fieldset className="flex flex-wrap gap-3 text-xs"><legend className="mb-1 text-[var(--muted)]">Mantener igual en todas</legend>{([["song_range", "Canción y tramo"], ["lyrics_sync", "Letra y sincronización"], ["style", "Estilo"], ["background", "Fondo"], ["format", "Formato"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={locks[k]} onChange={(e) => setLocks({ ...locks, [k]: e.target.checked })} />{l}</label>)}</fieldset>
        <button className="btn btn-primary !min-h-9" disabled={genBusy} onClick={() => void generate()}>{genBusy ? "Enviando…" : `Generar ${nVar} variantes`}</button>
      </section>}
      {batch && <LyricResults exportIds={batch.export_ids} generationId={batch.generation_id} batchId={batch.batch_id} projectId={projectId ?? undefined} />}
        </div>
      </div>
      <LyricLibrary workspaceId={wsId} />
    </main>
  );
}
