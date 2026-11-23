"use client";
// Editor de vídeos (v3) · recorrido de una canción: Audio → Letras → Estilo → Render (fuente pública P6).
// El borrador se guarda solo (save_lyric_project) y la letra en revisiones (LyricSyncEditor): recargar abre el mismo paso y estado.
// Vista previa y render usan el mismo motor (lyricSceneAt / lyricAss) → ≤1 fotograma.
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { validateCaptionStyle, validateLyricComposition, planLyricVariants, type LyricComposition } from "@rafaga/composition";
import type { SyncWord } from "@rafaga/lyrics";
import Icon from "../../../../components/Icon";
import LyricSyncEditor from "../../../../components/LyricSyncEditor";
import LyricPreview from "../../../../components/LyricPreview";
import LyricSettings from "../../../../components/LyricSettings";
import LyricResults from "../../../../components/LyricResults";
import CollectionsPicker, { useCollections } from "../../../../components/Collections";
import { TRENDING_STYLES } from "../../../../lib/trendingstyles";
import { withCta, withFixedTitle, withFades, CTA_MAX_SECONDS } from "../../../../lib/lyrictexts";
import { STEPS, STEP_LABEL, draftToComposition, compositionToPatch, stepAllowed, wordsInRange, parseClock, formatClock, setRange, type Step, type DraftRow } from "../../../../lib/editordraft";
import { supabase } from "../../../../lib/supabase";
import { token } from "../../../../lib/songupload";

type Song = { id: string; title: string; status: "pending" | "ready" | "failed"; duration_ms: number | null; lyrics_text: string | null };
type Save = "idle" | "saving" | "saved" | "error";
const SPEEDS = [1, 0.5, 0.25] as const;

export default function EditorFlow({ params }: { params: Promise<{ songId: string }> }) {
  const { songId } = use(params);
  const router = useRouter(), qs = useSearchParams();
  const step = (STEPS as readonly string[]).includes(qs.get("paso") ?? "") ? (qs.get("paso") as Step) : null;
  const [song, setSong] = useState<Song | null>(null), [audio, setAudio] = useState<string | null>(null), [words, setWords] = useState<SyncWord[] | null>(null), [revision, setRevision] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftRow | null>(null), [comp, setComp] = useState<LyricComposition | null>(null), [save, setSave] = useState<Save>("idle"), [err, setErr] = useState<string | null>(null), [syncing, setSyncing] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1), [cta, setCta] = useState({ text: "", secs: 4 }), [selCol, setSelCol] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ export_ids: string[]; generation_id: string; batch_id?: string } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null), first = useRef(true);
  const { cols, reload: reloadCols } = useCollections();
  const durationS = song?.duration_ms ? song.duration_ms / 1000 : null;
  const H = async () => ({ Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" });

  const loadAlignment = useCallback(async () => {
    const r = await fetch(`/api/lyrics/songs/${songId}/alignment`, { headers: await H() }); const j = r.ok ? await r.json().catch(() => ({})) : {};
    setWords((j.words as SyncWord[] | undefined) ?? []); setRevision((j.revision as number | null | undefined) ?? null); return (j.words as SyncWord[] | undefined) ?? [];
  }, [songId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga: canción, audio, letra y borrador (se crea uno si la canción aún no tiene).
  useEffect(() => { (async () => {
    const { data: s, error } = await supabase.from("songs").select("id,title,status,duration_ms,lyrics_text").eq("id", songId).single();
    if (error || !s) return setErr("No encontramos esta canción. Puede que se haya borrado.");
    setSong(s as Song);
    if (s.status !== "ready") return;
    const u = await fetch(`/api/lyrics/songs/${songId}/audio`, { headers: await H() }); const uj = await u.json().catch(() => ({})); if (u.ok) setAudio(uj.url);
    await loadAlignment();
    let { data: d } = await supabase.from("lyric_projects").select("*").eq("song_id", songId).order("updated_at", { ascending: false }).limit(1);
    if (!d?.length) {
      const r = await fetch("/api/lyrics/projects", { method: "POST", headers: await H(), body: JSON.stringify({ song_id: songId, mode: "letra" }) });
      if (!r.ok) return setErr("No se pudo crear el borrador. Vuelve a intentarlo.");
      ({ data: d } = await supabase.from("lyric_projects").select("*").eq("song_id", songId).limit(1));
    }
    const row = (d?.[0] ?? null) as (DraftRow & { collection_ids?: string[] }) | null; setDraft(row); if (row?.collection_ids?.[0]) setSelCol(row.collection_ids[0]);
  })(); }, [songId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras la canción se valida, se consulta cada 4 s.
  useEffect(() => { if (song?.status !== "pending") return; const t = setInterval(async () => { const { data } = await supabase.from("songs").select("status").eq("id", songId).single(); if (data?.status !== "pending") location.reload(); }, 4000); return () => clearInterval(t); }, [song?.status, songId]);

  // Composición a partir del borrador y la letra.
  useEffect(() => { if (draft && words && !comp) { const c = draftToComposition(draft, words.map((w) => ({ text: w.text, start: w.start, end: w.end, line: w.line })), durationS); setComp(c); if (c.message?.text) setCta({ text: c.message.text, secs: Math.round(c.range.end - c.message.start) || 4 }); } }, [draft, words, comp, durationS]);

  // Sin letra todavía: se pide la sincronización una vez y se espera la revisión.
  const askSync = useCallback(async () => {
    if (!song || syncing) return; setSyncing(true); setErr(null);
    const r = await fetch(`/api/lyrics/songs/${song.id}/sync`, { method: "POST", headers: { ...(await H()), "Idempotency-Key": `sync-${song.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ mode: song.lyrics_text?.trim() ? "align" : "transcribe" }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setSyncing(false); return setErr(j?.error?.message ?? "No se pudo preparar la letra."); }
    for (let i = 0; i < 90; i++) { await new Promise((res) => setTimeout(res, 4000)); const w = await loadAlignment(); if (w.length) { setSyncing(false); return; } }
    setSyncing(false); setErr("La letra tarda más de lo normal. Vuelve en unos minutos o reinténtalo.");
  }, [song, syncing, loadAlignment]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (song?.status === "ready" && words && !words.length && !syncing) void askSync(); }, [song?.status, words]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardado automático (0,8 s tras el último cambio) con estado visible.
  useEffect(() => {
    if (!comp || !draft) return; if (first.current) { first.current = false; return; }
    setSave("saving");
    const t = setTimeout(async () => {
      const r = await fetch(`/api/lyrics/projects/${draft.project_id}`, { method: "PUT", headers: await H(), body: JSON.stringify({ ...compositionToPatch(comp), collection_ids: selCol ? [selCol] : [] }) });
      setSave(r.ok ? "saved" : "error");
    }, 800);
    return () => clearTimeout(t);
  }, [comp, selCol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (player.current) player.current.playbackRate = speed; }, [speed, audio]);
  const inRange = useMemo(() => (comp && words ? wordsInRange(words, comp.range) : 0), [comp, words]);
  const gate = (s: Step) => stepAllowed(s, { hasSong: song?.status === "ready", hasWords: !!words?.length, wordsInRange: inRange });
  const go = (s: Step) => { if (gate(s).ok) router.replace(`/app/editor/${songId}?paso=${s}`); };
  const current: Step = step && gate(step).ok ? step : "audio";
  const update = (f: (c: LyricComposition) => LyricComposition) => setComp((c) => (c ? f(c) : c));

  async function render() {
    if (!comp || !draft || busy) return; setBusy(true); setMsg(null);
    const items = (cols?.find((c) => c.id === selCol)?.items ?? []).map((it) => ({ ref: `sb:originals/${it.storage_path}`, kind: (it.kind === "photo" ? "image" : "video") as "image" | "video" }));
    const base = validateLyricComposition(withFixedTitle(cta.text.trim() ? withCta(comp, cta.text, cta.secs) : comp, (comp.hook?.dur ?? 0) >= comp.duration - 0.01));
    const n = Math.min(10, Math.max(1, items.length));   // un vídeo por fondo elegido
    const variants = planLyricVariants(base, n, { song_range: true, lyrics_sync: true, style: true, background: !items.length, format: true }, items.length ? { collections: items.map((b) => [b]) } : {});
    const r = await fetch(`/api/lyrics/projects/${draft.project_id}/variants`, { method: "POST", headers: { ...(await H()), "Idempotency-Key": `ed-${crypto.randomUUID()}` }, body: JSON.stringify({ variants, zip: n > 1 }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) return setMsg(j?.error?.message ?? "No se pudo empezar el render. No se ha consumido nada.");
    setBatch({ export_ids: j.export_ids, generation_id: j.generation_id, batch_id: j.batch_id ?? undefined });
    setMsg(`Renderizando ${n} vídeo${n === 1 ? "" : "s"}. Puedes cerrar la pestaña: aparecerán en Vídeos creados.`);
  }

  if (err && !song) return <main className="mx-auto max-w-3xl p-6"><p role="alert" className="card p-4">{err} <Link href="/app/editor" className="underline">Volver al Editor de vídeos</Link></p></main>;
  if (!song) return <main className="mx-auto max-w-6xl p-6"><div className="skeleton h-40" aria-busy="true" /></main>;
  const saveLabel = save === "saving" ? "Guardando…" : save === "saved" ? "Guardado" : save === "error" ? "No se pudo guardar" : "";
  const field = "w-28 rounded-lg border hairline bg-white px-2 py-1.5 text-sm tnum";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 md:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><Link href="/app/editor" className="text-sm text-[var(--muted)]">← Vídeos creados</Link><h1 className="truncate text-2xl">{song.title}</h1></div>
        <span role="status" aria-live="polite" className={`text-sm ${save === "error" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{saveLabel}</span>
      </div>
      <nav aria-label="Pasos" className="mb-6"><ol className="grid grid-cols-4 gap-2">{STEPS.map((s, i) => { const g = gate(s); return (
        <li key={s}><button type="button" onClick={() => go(s)} disabled={!g.ok} title={g.why} aria-current={current === s ? "step" : undefined}
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${current === s ? "border-[var(--accent)] bg-white font-semibold" : "hairline"} disabled:opacity-50`}>
          <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-xs">{i + 1}</span>{STEP_LABEL[s]}</button></li>); })}</ol></nav>

      {song.status === "pending" && <p role="status" className="card p-4">Estamos comprobando el archivo. En unos segundos podrás elegir el tramo.</p>}
      {song.status === "failed" && <p role="alert" className="card p-4">No pudimos leer esta canción. Sube otra versión ({`MP3 o M4A`}) desde <Link href="/app/editor" className="underline">Editor de vídeos</Link>.</p>}
      {err && song.status === "ready" && <p role="alert" className="card mb-4 p-4 text-sm">{err} {!words?.length && <button className="underline" onClick={() => void askSync()}>Reintentar</button>}</p>}

      {song.status === "ready" && comp && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
          <div className="min-w-0 space-y-4">
            {current === "audio" && <section aria-labelledby="h-audio" className="card space-y-4 p-4">
              <h2 id="h-audio" className="text-lg">Elige el tramo de la canción</h2>
              {audio ? <audio ref={player} src={audio} controls preload="metadata" className="w-full" onLoadedMetadata={() => { if (player.current) player.current.playbackRate = speed; }} /> : <div className="skeleton h-10" />}
              <div className="flex flex-wrap items-end gap-3">
                {(["start", "end"] as const).map((k) => (
                  <label key={k} className="text-sm"><span className="mb-1 block text-xs text-[var(--muted)]">{k === "start" ? "Inicio" : "Fin"}</span>
                    <input key={`${k}-${comp.range[k]}`} className={field} defaultValue={formatClock(comp.range[k])} aria-label={k === "start" ? "Inicio del tramo" : "Fin del tramo"}
                      onBlur={(e) => { const v = parseClock(e.target.value); if (Number.isNaN(v)) { e.target.value = formatClock(comp.range[k]); return; } update((c) => validateLyricComposition({ ...c, range: setRange(c.range, { [k]: v }, durationS) })); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>))}
                <span className="text-sm"><span className="mb-1 block text-xs text-[var(--muted)]">Duración</span><span className="tnum">{(comp.range.end - comp.range.start).toFixed(1)} s</span></span>
                <button type="button" className="btn btn-ghost !min-h-9" onClick={() => { const p = player.current; if (!p) return; p.currentTime = comp.range.start; void p.play(); const stop = () => { if (p.currentTime >= comp.range.end) { p.pause(); p.removeEventListener("timeupdate", stop); } }; p.addEventListener("timeupdate", stop); }}><Icon n="play" className="h-4 w-4" />Escuchar el tramo</button>
              </div>
              <input type="range" min={0} max={durationS ?? comp.range.end} step={0.1} value={comp.range.start} aria-label="Mover el tramo" className="w-full"
                onChange={(e) => { const s = Number(e.target.value), len = comp.range.end - comp.range.start; update((c) => validateLyricComposition({ ...c, range: setRange(c.range, { start: s, end: s + len }, durationS) })); }} />
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">Velocidad de escucha<select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])} className="rounded-lg border hairline px-2 py-1">{SPEEDS.map((s) => <option key={s} value={s}>{String(s).replace(".", ",")}×</option>)}</select></label>
                <label className="flex items-center gap-2">Entrada suave (s)<input type="number" min={0} max={5} step={0.5} className="w-16 rounded-lg border hairline px-2 py-1" value={comp.settings.fadeIn} onChange={(e) => update((c) => withFades(c, Number(e.target.value), c.settings.fadeOut))} /></label>
                <label className="flex items-center gap-2">Salida suave (s)<input type="number" min={0} max={5} step={0.5} className="w-16 rounded-lg border hairline px-2 py-1" value={comp.settings.fadeOut} onChange={(e) => update((c) => withFades(c, c.settings.fadeIn, Number(e.target.value)))} /></label>
              </div>
              <p className="text-xs text-[var(--muted)]">La velocidad solo cambia cómo lo escuchas aquí; el vídeo usa la canción a velocidad normal. {words?.length ? `${inRange} palabras en este tramo.` : syncing ? "Preparando la letra…" : ""}</p>
              <button type="button" className="btn btn-primary" disabled={!gate("letras").ok} title={gate("letras").why} onClick={() => go("letras")}>Continuar a letras</button>
            </section>}

            {current === "letras" && words && audio && <section aria-labelledby="h-letras" className="space-y-3">
              <h2 id="h-letras" className="text-lg">Corrige la letra y su sincronía</h2>
              <p className="text-sm text-[var(--muted)]">Cambia cualquier palabra y ajusta cuándo suena. Los cambios se guardan como una revisión y se pueden deshacer.</p>
              <LyricSyncEditor songId={songId} audioUrl={audio} lyrics={song.lyrics_text ?? words.map((w) => w.text).join(" ")} revision={revision} words={words}
                onSaved={async () => { const w = await loadAlignment(); update((c) => validateLyricComposition({ ...c, words: w.map((x) => ({ text: x.text, start: x.start, end: x.end, line: x.line })) })); }} />
              <div className="flex gap-2"><button type="button" className="btn btn-ghost" onClick={() => go("audio")}>Volver a audio</button><button type="button" className="btn btn-primary" onClick={() => go("estilo")}>Continuar a estilo</button></div>
            </section>}

            {current === "estilo" && <section aria-labelledby="h-estilo" className="space-y-4">
              <h2 id="h-estilo" className="text-lg">Elige el fondo y el estilo</h2>
              <div className="card space-y-3 p-4 text-sm"><h3 className="font-semibold">Fondos</h3>
                <p className="text-[var(--muted)]">Elige una colección con tus vídeos o fotos. Se crea un vídeo por cada fondo (hasta 10). Sin fondo, el vídeo usa un color.</p>
                <CollectionsPicker selected={selCol} onSelect={setSelCol} cols={cols} reload={reloadCols} /></div>
              <div className="card space-y-3 p-4 text-sm"><h3 className="font-semibold">Estilo de la letra</h3>
                <ul className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Estilos de letra">{TRENDING_STYLES.map((t) => (
                  <li key={t.id}><button type="button" aria-pressed={comp.preset === t.preset && JSON.stringify(comp.style) === JSON.stringify(validateCaptionStyle(t.style))} className="chip w-full !justify-center truncate"
                    onClick={() => update((c) => validateLyricComposition({ ...c, preset: t.preset, style: validateCaptionStyle({ ...t.style, color: c.style.color }) }))}>{t.name}</button></li>))}</ul>
                <label className="flex items-center gap-2">Color del texto<input type="color" value={comp.style.color} onChange={(e) => update((c) => validateLyricComposition({ ...c, style: validateCaptionStyle({ ...c.style, color: e.target.value }) }))} /></label></div>
              <LyricSettings composition={comp} onChange={(c) => setComp(c)} />
              <div className="card grid gap-2 p-4 text-sm sm:grid-cols-3"><h3 className="font-semibold sm:col-span-3">Textos</h3>
                <input className="rounded-lg border hairline px-2 py-1.5 sm:col-span-2" placeholder="Título (opcional)" maxLength={120} aria-label="Título" value={comp.hook?.text ?? ""} onChange={(e) => update((c) => ({ ...c, hook: e.target.value ? { text: e.target.value, dur: c.hook?.dur ?? 3, start: c.hook?.start } : null }))} />
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!comp.hook} checked={!!comp.hook && comp.hook.dur >= comp.duration - 0.01} onChange={(e) => update((c) => withFixedTitle(c, e.target.checked))} />Todo el vídeo</label>
                <input className="rounded-lg border hairline px-2 py-1.5 sm:col-span-2" placeholder="Llamada a la acción final (opcional)" maxLength={200} aria-label="Llamada a la acción final" value={cta.text} onChange={(e) => { setCta({ ...cta, text: e.target.value }); update((c) => withCta(c, e.target.value, cta.secs)); }} />
                <label className="text-xs">Últimos (s)<input type="number" min={1} max={CTA_MAX_SECONDS} className="ml-1 w-14 rounded border hairline px-1" value={cta.secs} onChange={(e) => { const v = Math.min(CTA_MAX_SECONDS, Math.max(1, Number(e.target.value) || 4)); setCta({ ...cta, secs: v }); if (cta.text.trim()) update((c) => withCta(c, cta.text, v)); }} /></label></div>
              <div className="flex gap-2"><button type="button" className="btn btn-ghost" onClick={() => go("letras")}>Volver a letras</button><button type="button" className="btn btn-primary" disabled={!gate("render").ok} title={gate("render").why} onClick={() => go("render")}>Continuar a render</button></div>
            </section>}

            {current === "render" && <section aria-labelledby="h-render" className="card space-y-4 p-4 text-sm">
              <h2 id="h-render" className="text-lg">Renderiza tu vídeo</h2>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">Calidad<select value={comp.res} onChange={(e) => update((c) => validateLyricComposition({ ...c, res: Number(e.target.value) as 720 | 1080 }))} className="rounded-lg border hairline px-2 py-1"><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
                <label className="flex items-center gap-2">Formato<select value={comp.aspect} onChange={(e) => update((c) => validateLyricComposition({ ...c, aspect: e.target.value as LyricComposition["aspect"] }))} className="rounded-lg border hairline px-2 py-1">{(["9:16", "4:5", "1:1", "16:9"] as const).map((a) => <option key={a}>{a}</option>)}</select></label>
              </div>
              <p className="text-[var(--muted)]">{(() => { const n = cols?.find((c) => c.id === selCol)?.items.length ?? 0; return n ? `Se crearán ${Math.min(10, n)} vídeos, uno por fondo de la colección.` : "Se creará 1 vídeo con fondo de color."; })()} Tramo {formatClock(comp.range.start)}–{formatClock(comp.range.end)}.</p>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-ghost" onClick={() => go("estilo")}>Volver a estilo</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void render()}>{busy ? "Enviando…" : "Crear vídeo"}</button></div>
              {msg && <p role="status">{msg}</p>}
              {batch && <LyricResults exportIds={batch.export_ids} generationId={batch.generation_id} batchId={batch.batch_id} projectId={draft?.project_id} />}
            </section>}
          </div>
          <aside aria-label="Vista previa" className="min-w-0 lg:sticky lg:top-20"><LyricPreview composition={comp} onChange={setComp} /></aside>
        </div>)}
      {song.status === "ready" && !comp && <div className="skeleton h-60" aria-busy="true" />}
    </main>
  );
}
