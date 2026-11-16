"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import { zonedToUtc, utcToLocalInput, localZone, ZONES } from "../../../lib/tz";
import { PUBLISH_TARGETS } from "../../../lib/platforms";
import TikTokScheduleDialog, { type TtAccount, type TtVideo } from "../../../components/TikTokScheduleDialog";

type Pub = { id: string; render_id?: string; music_origin?: string | null; privacy?: string; state: string; scheduled_at: string | null; created_at: string; title: string; description: string | null; connection_id: string | null; error_message: string | null };
const PUB_STATE: Record<string, string> = { scheduled: "Programada", queued: "En cola", uploading: "Subiendo", processing: "Procesando", published: "Publicada", private_pending_review: "Borrador en tu bandeja de TikTok", requiere_auditoria: "Requiere auditoría", failed: "Falló", cancelled: "Cancelada" };

type Post = { id: string; title: string; caption: string | null; hashtags: string | null; targets: string[]; clip_id: string | null; lyric_video_id: string | null; scheduled_at: string; timezone: string; status: string };
type Asset = { id: string; label: string; kind: "clip" | "lyric" };
type Form = { id?: string; title: string; caption: string; hashtags: string; targets: string[]; date: string; time: string; tz: string; asset: string; status: "draft" | "planned" };
type View = "month" | "week" | "list" | "draft" | "done";
const STATUS: Record<string, string> = { draft: "Borrador", planned: "Planificada", done: "Publicada", cancelled: "Cancelada" };
const LIMITS: Record<string, number> = { X: 280, TikTok: 2200, Instagram: 2200, YouTube: 100, LinkedIn: 3000, Facebook: 63206 };
const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; };

export default function Calendario() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(new Date());
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewTz] = useState(localZone());
  const [pubs, setPubs] = useState<Pub[]>([]), [accounts, setAccounts] = useState<TtAccount[]>([]), [videos, setVideos] = useState<TtVideo[]>([]), [tt, setTt] = useState<string | null>(null), [openPub, setOpenPub] = useState<Pub | null>(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: rs }, { data: lv }] = await Promise.all([
      supabase.from("scheduled_posts").select("id,title,caption,hashtags,targets,clip_id,lyric_video_id,scheduled_at,timezone,status").order("scheduled_at"),
      supabase.from("renders").select("clip_id,ratio,clip_version,created_at").eq("status", "ready").order("created_at", { ascending: false }).limit(60),
      supabase.from("lyric_videos").select("id,variant,song_id,created_at").eq("status", "ready").order("created_at", { ascending: false }).limit(60),
    ]);
    setPosts((p ?? []) as Post[]);
    const ids = [...new Set((rs ?? []).map((r) => r.clip_id))];
    const [{ data: cs }, { data: so }] = await Promise.all([ids.length ? supabase.from("clips").select("id,title").in("id", ids) : { data: [] }, supabase.from("songs").select("id,title")]);
    const ct = new Map((cs ?? []).map((c) => [c.id, c.title])), st = new Map((so ?? []).map((s) => [s.id, s.title]));
    // Publicaciones reales de TikTok (programadas, en curso y hechas), cuentas conectadas y vídeos exportados listos para programar desde aquí.
    const { data: s } = await supabase.auth.getSession();
    const [{ data: pb }, { data: vr }, acc] = await Promise.all([
      supabase.from("publications").select("id,render_id,music_origin,privacy,state,scheduled_at,created_at,title,description,connection_id,error_message").eq("platform", "tiktok").order("created_at", { ascending: false }).limit(300),
      supabase.from("renders").select("id,created_at,clip_id,clips!inner(title)").eq("kind", "mp4").eq("status", "ready").not("storage_path", "is", null).order("created_at", { ascending: false }).limit(100),
      fetch("/api/tiktok", { headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).then((r) => (r.ok ? r.json() : { accounts: [] })).catch(() => ({ accounts: [] })),
    ]);
    setPubs((pb ?? []) as Pub[]); setAccounts(((acc.accounts ?? []) as TtAccount[]).filter((a) => a.status === "connected"));
    setVideos(((vr ?? []) as unknown as { id: string; clip_id: string; clips: { title: string } }[]).map((r) => ({ id: r.id, title: r.clips.title, clipId: r.clip_id })));
    setAssets([...ids.map((id) => ({ id, label: `Clip · ${ct.get(id) ?? "sin título"}`, kind: "clip" as const })), ...(lv ?? []).map((v) => ({ id: v.id, label: `Letra · ${st.get(v.song_id) ?? "canción"} #${v.variant}`, kind: "lyric" as const }))]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => { const m = new Map<string, Post[]>(); for (const p of posts ?? []) { const k = utcToLocalInput(p.scheduled_at, viewTz).slice(0, 10); m.set(k, [...(m.get(k) ?? []), p]); } return m; }, [posts, viewTz]);

  const pubAt = (p: Pub) => p.scheduled_at ?? p.created_at;
  const pubsByDay = useMemo(() => { const m = new Map<string, Pub[]>(); for (const p of pubs) { if (p.state === "cancelled") continue; const k = utcToLocalInput(pubAt(p), viewTz).slice(0, 10); m.set(k, [...(m.get(k) ?? []), p]); } return m; }, [pubs, viewTz]);
  const accName = (id: string | null) => { const a = accounts.find((x) => x.id === id); return a ? a.alias || a.account_label || "TikTok" : "TikTok"; };
  async function cancelPub(p: Pub) {
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(`/api/publish/${p.id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}`, "Content-Type": "application/json", "Idempotency-Key": `c-${p.id}-${Date.now()}` }, body: "{}" });
    setMsg(r.ok ? "Publicación cancelada." : "Esta publicación ya no se puede cancelar."); setOpenPub(null); load();
  }
  /** Reintentar: cancela la publicación fallida o bloqueada y crea otra con los mismos datos (la base de datos no admite dos activas del mismo vídeo en la cuenta). */
  async function retryPub(p: Pub) {
    if (!p.render_id || !p.connection_id) return setMsg("Faltan datos para reintentar: prográmala de nuevo.");
    const { data: s } = await supabase.auth.getSession(), H = { Authorization: `Bearer ${s.session?.access_token ?? ""}`, "Content-Type": "application/json" };
    await fetch(`/api/publish/${p.id}/cancel`, { method: "POST", headers: { ...H, "Idempotency-Key": `c-${p.id}-${Date.now()}` }, body: "{}" });
    const r = await fetch("/api/publish", { method: "POST", headers: { ...H, "Idempotency-Key": `retry-${p.id}-${Date.now()}` }, body: JSON.stringify({ export_id: p.render_id, platform: "tiktok", connection_id: p.connection_id, music_origin: p.music_origin ?? "risk", title: p.title.slice(0, 100), description: p.description ?? p.title, privacy: p.privacy ?? "SELF_ONLY" }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Publicación reenviada a TikTok." : (j?.error?.message ?? "No se pudo reintentar.")); setOpenPub(null); load();
  }
  function newPost(day?: string) { setForm({ title: "", caption: "", hashtags: "", targets: [], date: day ?? ymd(new Date()), time: "10:00", tz: viewTz, asset: "", status: "planned" }); setMsg(null); }
  function edit(p: Post) {
    const local = utcToLocalInput(p.scheduled_at, p.timezone);
    setForm({ id: p.id, title: p.title, caption: p.caption ?? "", hashtags: p.hashtags ?? "", targets: p.targets, date: local.slice(0, 10), time: local.slice(11, 16), tz: p.timezone, asset: p.clip_id ? `clip:${p.clip_id}` : p.lyric_video_id ? `lyric:${p.lyric_video_id}` : "", status: p.status === "draft" ? "draft" : "planned" });
    setMsg(null);
  }
  const z = form ? zonedToUtc(`${form.date}T${form.time}`, form.tz) : null;
  const warnings = form ? [
    ...(!z?.exists ? [`A las ${form.time} no existe en ${form.tz} ese día por el cambio de hora: se usará la hora siguiente.`] : []),
    ...(z?.ambiguous ? [`A las ${form.time} ocurre dos veces ese día en ${form.tz} (cambio de hora): se usará la primera.`] : []),
    ...form.targets.filter((t) => LIMITS[t] && (form.caption.length + (form.hashtags ? form.hashtags.length + 1 : 0)) > LIMITS[t]).map((t) => `El texto supera el límite orientativo de ${t} (${LIMITS[t]} caracteres).`),
    ...(form.hashtags && !/^(\s*#[\p{L}\p{N}_]+\s*)+$/u.test(form.hashtags) ? ["Los hashtags deben empezar por # y separarse con espacios."] : []),
    ...(z && z.utc.getTime() < Date.now() && form.status === "planned" ? ["La fecha ya ha pasado."] : []),
  ] : [];

  async function save() {
    if (!form || !z) return;
    if (!form.title.trim()) return setMsg("Ponle un título.");
    const [kind, aid] = form.asset ? form.asset.split(":") : ["", ""];
    const row = { title: form.title.trim(), caption: form.caption.trim() || null, hashtags: form.hashtags.trim() || null, targets: form.targets, scheduled_at: z.utc.toISOString(), timezone: form.tz, status: form.status };
    if (form.id) {
      const { error } = await supabase.from("scheduled_posts").update(row).eq("id", form.id); if (error) return setMsg(error.message);
    } else {
      const { data: s } = await supabase.auth.getSession(); const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
      const { error } = await supabase.from("scheduled_posts").insert({ ...row, workspace_id: ws?.id, created_by: s.session?.user.id, clip_id: kind === "clip" ? aid : null, lyric_video_id: kind === "lyric" ? aid : null });
      if (error) return setMsg(error.message);
    }
    setForm(null); setMsg(form.id ? "Cambios guardados." : "Publicación añadida al calendario."); load();
  }
  async function setStatus(p: Post, status: "done" | "cancelled" | "planned") { const { error } = await supabase.from("scheduled_posts").update({ status }).eq("id", p.id); if (error) return setMsg(error.message); load(); }
  async function del(p: Post) { if (!confirm(`¿Borrar «${p.title}»?`)) return; await supabase.from("scheduled_posts").delete().eq("id", p.id); load(); }

  const Chip = ({ p }: { p: Post }) => (
    <button onClick={() => edit(p)} className={`block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] hairline ${p.status === "cancelled" ? "line-through opacity-50" : p.status === "done" ? "bg-[var(--hover)]" : "bg-white"}`} title={`${p.title} · ${new Date(p.scheduled_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`}>
      <span className="mono">{utcToLocalInput(p.scheduled_at, viewTz).slice(11, 16)}</span> {p.title}</button>);

  const PubChip = ({ p }: { p: Pub }) => (
    <button onClick={() => setOpenPub(p)} className={`block w-full truncate rounded-md border border-[var(--accent)] px-1.5 py-0.5 text-left text-[11px] ${p.state === "failed" ? "bg-[#FFF1F1]" : p.state === "published" ? "bg-[var(--hover)]" : "bg-[var(--accent-soft)]"}`} title={`TikTok · ${accName(p.connection_id)} · ${PUB_STATE[p.state] ?? p.state} · ${p.title}`}>
      <span className="mono">{utcToLocalInput(pubAt(p), viewTz).slice(11, 16)}</span> ♪ {accName(p.connection_id)} · {p.title}</button>);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => { const d = startOfWeek(cursor); d.setDate(d.getDate() + i); return d; }) : Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });
  const shift = (n: number) => { const d = new Date(cursor); if (view === "week") d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n); setCursor(d); };
  const title = view === "week" ? `Semana del ${days[0].toLocaleDateString("es", { day: "numeric", month: "long" })}` : cursor.toLocaleDateString("es", { month: "long", year: "numeric" });
  const upcoming = (posts ?? []).filter((p) => view === "draft" ? p.status === "draft" : view === "done" ? p.status === "done" : p.status !== "cancelled");

  return (
    <main className="mx-auto max-w-[1240px] px-4 pb-20 pt-8 md:px-10">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Calendario</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Planifica y programa tus publicaciones. Las de TikTok se publican solas en la cuenta elegida a la hora programada; el resto de redes son recordatorios para subirlas tú.</p></div>
        <div className="flex flex-wrap gap-2"><Link href="/app/automatizaciones" className="btn btn-ghost">Automatizaciones</Link><Link href="/app/analitica" className="btn btn-ghost">Analítica</Link><button onClick={() => newPost()} className="btn btn-ghost"><Icon n="plus" className="h-4 w-4" />Nueva nota de publicación</button><button onClick={() => setTt(ymd(new Date()))} className="btn btn-primary"><Icon n="plus" className="h-4 w-4" />Programar en TikTok</button></div>
      </header>
      <section aria-label="Cuentas de TikTok" className="mb-5 card p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Cuentas de TikTok</span><Link href="/app/tiktok" className="font-semibold text-[var(--accent-ink)]">Gestionar cuentas y lotes</Link></div>
        {accounts.length ? <ul className="mt-2 flex flex-wrap gap-2">{accounts.map((a) => { const n = pubs.filter((p) => p.connection_id === a.id && p.state === "scheduled").length; return <li key={a.id} className="chip">{a.alias || a.account_label}{a.profile?.paused ? " · en pausa" : ""} · {n} programada{n === 1 ? "" : "s"}</li>; })}</ul>
          : <p className="mt-2 text-[var(--muted)]">Aún no hay cuentas conectadas. Conéctalas en TikTok para programar desde el calendario (hasta 5).</p>}
      </section>
      {msg && <p role="status" aria-live="polite" className="card mb-4 p-3 text-sm">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Vista" className="inline-flex rounded-xl border hairline bg-[var(--surface)] p-1 text-sm">
          {([["month", "Calendario"], ["week", "Semana"], ["list", "Lista"], ["draft", "Borradores"], ["done", "Publicadas"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1 ${view === k ? "bg-white shadow-[var(--shadow-1)] ring-1 ring-[var(--border)]" : "text-[var(--muted)]"}`}>{l}</button>)}</div>
        {(view === "month" || view === "week") && (<div className="flex items-center gap-1"><button onClick={() => shift(-1)} className="btn btn-ghost !px-2.5 !py-1.5" aria-label="Anterior"><Icon n="chevL" className="h-4 w-4" /></button><button onClick={() => setCursor(new Date())} className="btn btn-ghost !py-1.5">Hoy</button><button onClick={() => shift(1)} className="btn btn-ghost !px-2.5 !py-1.5" aria-label="Siguiente"><Icon n="chevR" className="h-4 w-4" /></button><span className="ml-2 text-lg capitalize">{title}</span></div>)}
        <span className="mono ml-auto text-xs text-[var(--muted)]">Horas en {viewTz}</span>
      </div>

      {(view === "list" || view === "done") && pubs.filter((p) => (view === "done" ? p.state === "published" : p.state !== "cancelled")).length > 0 && (
        <ul aria-label="Publicaciones de TikTok" className="mb-4 divide-y hairline rounded-2xl border hairline bg-white">{pubs.filter((p) => (view === "done" ? p.state === "published" : p.state !== "cancelled")).sort((a, b) => pubAt(a).localeCompare(pubAt(b))).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="mono w-40 shrink-0">{new Date(pubAt(p)).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0 flex-1"><span className="font-medium">{p.title}</span><span className="block truncate text-xs text-[var(--muted)]">TikTok · {accName(p.connection_id)}{p.error_message ? ` · ${p.error_message}` : ""}</span></span>
            <span className="chip !py-0.5">{PUB_STATE[p.state] ?? p.state}</span>
            <span className="flex gap-2 text-xs"><button className="underline" onClick={() => setOpenPub(p)}>Ver</button>{["scheduled", "queued", "failed", "requiere_auditoria"].includes(p.state) && <button className="underline" onClick={() => cancelPub(p)}>Cancelar</button>}</span></li>))}</ul>)}
      {posts === null ? <div className="skeleton h-96" /> : (view === "list" || view === "draft" || view === "done") ? (
        upcoming.length ? (
          <ul className="divide-y hairline rounded-2xl border hairline bg-white">{upcoming.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="mono w-40 shrink-0">{new Date(p.scheduled_at).toLocaleString("es", { timeZone: p.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="min-w-0 flex-1"><span className="font-medium">{p.title}</span><span className="block truncate text-xs text-[var(--muted)]">{p.targets.join(", ") || "Sin destinos"} · {p.timezone}</span></span>
              <span className="chip !py-0.5">{STATUS[p.status]}</span>
              <span className="flex gap-2 text-xs"><button className="underline" onClick={() => edit(p)}>Editar</button>{p.status !== "done" && <button className="underline" onClick={() => setStatus(p, "done")}>Marcar publicada</button>}{p.status !== "cancelled" && <button className="underline" onClick={() => setStatus(p, "cancelled")}>Cancelar</button>}<button className="underline" onClick={() => del(p)}>Borrar</button></span></li>))}</ul>
        ) : <div className="card border-dashed p-10 text-center"><Icon n="calendar" className="mx-auto h-8 w-8" /><p className="mt-3 font-medium">No hay publicaciones planificadas</p><button onClick={() => newPost()} className="btn btn-primary mt-4">Planificar la primera</button></div>
      ) : (
        <div className="overflow-hidden rounded-2xl border hairline bg-white">
          <div className="grid grid-cols-7 border-b hairline bg-[var(--surface)] text-center text-xs text-[var(--muted)]">{DOW.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7">{days.map((d, i) => {
            const k = ymd(d), items = byDay.get(k) ?? [], other = view === "month" && d.getMonth() !== cursor.getMonth(), today = k === ymd(new Date());
            return (<div key={i} className={`min-h-[${view === "week" ? 260 : 96}px] border-b border-r hairline p-1.5 ${other ? "bg-[var(--surface)] text-[var(--muted)]" : ""}`} style={{ minHeight: view === "week" ? 260 : 96 }}>
              <button onClick={() => newPost(k)} className={`mb-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${today ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--hover)]"}`} aria-label={`Añadir el ${d.toLocaleDateString("es", { day: "numeric", month: "long" })}`}>{d.getDate()}</button>
              <div className="space-y-1">{(pubsByDay.get(k) ?? []).slice(0, view === "week" ? 12 : 3).map((p) => <PubChip key={p.id} p={p} />)}{items.slice(0, view === "week" ? 12 : 3).map((p) => <Chip key={p.id} p={p} />)}{(items.length + (pubsByDay.get(k)?.length ?? 0)) > 3 && view === "month" && <button onClick={() => setView("list")} className="text-[11px] underline">ver todo</button>}
                {!other && k >= ymd(new Date()) && <button onClick={() => setTt(k)} className="text-[11px] text-[var(--muted)] underline" aria-label={`Programar en TikTok el ${d.toLocaleDateString("es", { day: "numeric", month: "long" })}`}>+ TikTok</button>}</div></div>);
          })}</div>
        </div>
      )}

      {tt && <TikTokScheduleDialog accounts={accounts} videos={videos} day={tt} tz={viewTz} onClose={() => setTt(null)} onDone={(m) => { setTt(null); setMsg(m); load(); }} />}
      {openPub && (
        <div role="dialog" aria-modal="true" aria-label="Publicación de TikTok" className="fixed inset-0 z-40 grid place-items-center overflow-auto bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setOpenPub(null)}>
          <div className="card-raised w-full max-w-lg p-5 text-sm">
            <div className="flex items-center justify-between"><h2 className="text-lg">{openPub.title}</h2><button onClick={() => setOpenPub(null)} aria-label="Cerrar" className="btn btn-ghost !p-1.5"><Icon n="x" className="h-4 w-4" /></button></div>
            <p className="mt-2">TikTok · {accName(openPub.connection_id)} · <span className="chip !py-0.5">{PUB_STATE[openPub.state] ?? openPub.state}</span></p>
            <p className="mono mt-1 text-xs text-[var(--muted)]">{new Date(pubAt(openPub)).toLocaleString("es", { dateStyle: "full", timeStyle: "short" })}</p>
            {openPub.description && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--surface)] p-3">{openPub.description}</p>}
            {openPub.error_message && <p role="alert" className="mt-2 text-xs">⚠ {openPub.error_message}</p>}
            <div className="mt-4 flex gap-2">{["failed", "requiere_auditoria"].includes(openPub.state) && <button onClick={() => retryPub(openPub)} className="btn btn-primary">Reintentar</button>}{["scheduled", "queued", "failed", "requiere_auditoria"].includes(openPub.state) && <button onClick={() => cancelPub(openPub)} className="btn btn-ghost">Cancelar publicación</button>}<button onClick={() => setOpenPub(null)} className="btn btn-ghost">Cerrar</button></div>
            {openPub.state === "scheduled" && <p className="mt-2 text-xs text-[var(--muted)]">Para cambiar la hora o el texto, cancélala y prográmala de nuevo.</p>}
          </div>
        </div>)}
      {form && (
        <div role="dialog" aria-modal="true" aria-label="Publicación" className="fixed inset-0 z-40 grid place-items-center overflow-auto bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="card-raised w-full max-w-xl p-5">
            <div className="flex items-center justify-between"><h2 className="text-lg">{form.id ? "Editar publicación" : "Nueva publicación"}</h2><button onClick={() => setForm(null)} aria-label="Cerrar" className="btn btn-ghost !p-1.5"><Icon n="x" className="h-4 w-4" /></button></div>
            <div className="mt-4 grid gap-3 text-sm">
              <label>Título<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input mt-1" maxLength={150} autoFocus /></label>
              <label>Texto de la publicación<textarea value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} rows={3} maxLength={2200} className="input mt-1" /></label>
              <label>Hashtags<input value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} placeholder="#emprender #ventas" className="input mt-1" /></label>
              <fieldset><legend className="mb-1">Destinos</legend><div className="flex flex-wrap gap-1.5">{PUBLISH_TARGETS.map((t) => <button type="button" key={t} className="chip" aria-pressed={form.targets.includes(t)} onClick={() => setForm({ ...form, targets: form.targets.includes(t) ? form.targets.filter((x) => x !== t) : [...form.targets, t] })}>{t}</button>)}</div></fieldset>
              <div className="grid grid-cols-3 gap-2"><label>Fecha<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input mt-1" /></label><label>Hora<input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="input mt-1" /></label>
                <label>Zona horaria<select value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} className="input mt-1">{[...new Set([viewTz, ...ZONES])].map((t) => <option key={t}>{t}</option>)}</select></label></div>
              {z && <p className="mono text-xs text-[var(--muted)]">UTC: {z.utc.toISOString().replace(".000Z", "Z")}</p>}
              {!form.id && <label>Adjuntar clip o vídeo con letra<select value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} className="input mt-1"><option value="">Sin adjunto</option>{assets.map((a) => <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>{a.label}</option>)}</select></label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.status === "draft"} onChange={(e) => setForm({ ...form, status: e.target.checked ? "draft" : "planned" })} />Guardar como borrador</label>
              {warnings.map((w) => <p key={w} role="alert" className="rounded-lg bg-[var(--surface)] p-2 text-xs">⚠ {w}</p>)}
            </div>
            <div className="mt-4 flex gap-2"><button onClick={save} className="btn btn-primary">{form.id ? "Guardar cambios" : "Añadir al calendario"}</button><button onClick={() => setForm(null)} className="btn btn-ghost">Cancelar</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
