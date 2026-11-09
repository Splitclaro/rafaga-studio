"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import { zonedToUtc, utcToLocalInput, localZone, ZONES } from "../../../lib/tz";
import { PUBLISH_TARGETS } from "../../../lib/platforms";

type Post = { id: string; title: string; caption: string | null; hashtags: string | null; targets: string[]; clip_id: string | null; lyric_video_id: string | null; scheduled_at: string; timezone: string; status: string };
type Asset = { id: string; label: string; kind: "clip" | "lyric" };
type Form = { id?: string; title: string; caption: string; hashtags: string; targets: string[]; date: string; time: string; tz: string; asset: string; status: "draft" | "planned" };
type View = "month" | "week" | "list";
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
    setAssets([...ids.map((id) => ({ id, label: `Clip · ${ct.get(id) ?? "sin título"}`, kind: "clip" as const })), ...(lv ?? []).map((v) => ({ id: v.id, label: `Letra · ${st.get(v.song_id) ?? "canción"} #${v.variant}`, kind: "lyric" as const }))]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => { const m = new Map<string, Post[]>(); for (const p of posts ?? []) { const k = utcToLocalInput(p.scheduled_at, viewTz).slice(0, 10); m.set(k, [...(m.get(k) ?? []), p]); } return m; }, [posts, viewTz]);

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

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => { const d = startOfWeek(cursor); d.setDate(d.getDate() + i); return d; }) : Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });
  const shift = (n: number) => { const d = new Date(cursor); if (view === "week") d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n); setCursor(d); };
  const title = view === "week" ? `Semana del ${days[0].toLocaleDateString("es", { day: "numeric", month: "long" })}` : cursor.toLocaleDateString("es", { month: "long", year: "numeric" });
  const upcoming = (posts ?? []).filter((p) => p.status !== "cancelled");

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Calendario</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Planifica cuándo y dónde publicar cada clip. Por ahora el calendario es un planificador: la publicación automática en redes llegará con las conexiones.</p></div>
        <button onClick={() => newPost()} className="btn btn-primary"><Icon n="plus" className="h-4 w-4" />Nueva publicación</button>
      </header>
      {msg && <p role="status" aria-live="polite" className="card mb-4 p-3 text-sm">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Vista" className="inline-flex rounded-xl border hairline bg-[var(--surface)] p-1 text-sm">
          {([["month", "Mes"], ["week", "Semana"], ["list", "Lista"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-lg px-3 py-1 ${view === k ? "bg-white shadow-[var(--shadow-1)] ring-1 ring-[var(--border)]" : "text-[var(--muted)]"}`}>{l}</button>)}</div>
        {view !== "list" && (<div className="flex items-center gap-1"><button onClick={() => shift(-1)} className="btn btn-ghost !px-2.5 !py-1.5" aria-label="Anterior"><Icon n="chevL" className="h-4 w-4" /></button><button onClick={() => setCursor(new Date())} className="btn btn-ghost !py-1.5">Hoy</button><button onClick={() => shift(1)} className="btn btn-ghost !px-2.5 !py-1.5" aria-label="Siguiente"><Icon n="chevR" className="h-4 w-4" /></button><span className="ml-2 text-lg capitalize">{title}</span></div>)}
        <span className="mono ml-auto text-xs text-[var(--muted)]">Horas en {viewTz}</span>
      </div>

      {posts === null ? <div className="skeleton h-96" /> : view === "list" ? (
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
              <button onClick={() => newPost(k)} className={`mb-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${today ? "bg-[#111] text-white" : "hover:bg-[var(--hover)]"}`} aria-label={`Añadir el ${d.toLocaleDateString("es", { day: "numeric", month: "long" })}`}>{d.getDate()}</button>
              <div className="space-y-1">{items.slice(0, view === "week" ? 12 : 3).map((p) => <Chip key={p.id} p={p} />)}{items.length > 3 && view === "month" && <button onClick={() => setView("list")} className="text-[11px] underline">+{items.length - 3} más</button>}</div></div>);
          })}</div>
        </div>
      )}

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
