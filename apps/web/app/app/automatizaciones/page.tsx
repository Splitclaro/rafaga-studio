"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../../components/Icon";
import { supabase } from "../../../lib/supabase";
import OpsStatus from "../../../components/OpsStatus";

type Rule = { id: string; name: string; feed_url: string; review_first: boolean; clip_count: number; brief: string | null; daily_limit: number; active: boolean; cursor_published: string | null; last_checked_at: string | null; last_error: string | null };
type Run = { id: string; rule_id: string; entry_title: string | null; entry_url: string | null; status: string; detail: string | null; project_id: string | null; created_at: string };
const blank = { name: "", feed_url: "", review_first: true, clip_count: 5, brief: "", daily_limit: 3 };
const RUN: Record<string, string> = { queued: "En proceso", imported: "Importada", skipped: "Omitida", failed: "Fallida" };
const ago = (d: string | null) => { if (!d) return "nunca"; const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };

export default function Automatizaciones() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank & { id?: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: r }, { data: u }] = await Promise.all([
      supabase.from("automation_rules").select("id,name,feed_url,review_first,clip_count,brief,daily_limit,active,cursor_published,last_checked_at,last_error").order("created_at", { ascending: false }),
      supabase.from("automation_runs").select("id,rule_id,entry_title,entry_url,status,detail,project_id,created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    setRules((r ?? []) as Rule[]); setRuns((u ?? []) as Run[]);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return setMsg("Ponle un nombre a la regla.");
    if (!/^https:\/\/[^\s]+$/i.test(form.feed_url.trim())) return setMsg("La URL del feed debe empezar por https://");
    const row = { name: form.name.trim(), feed_url: form.feed_url.trim(), review_first: form.review_first, clip_count: form.clip_count, brief: form.brief.trim() || null, daily_limit: form.daily_limit };
    if (form.id) {
      const { error } = await supabase.from("automation_rules").update(row).eq("id", form.id);
      if (error) return setMsg(error.message);
    } else {
      const { data: s } = await supabase.auth.getSession(); const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
      const { error } = await supabase.from("automation_rules").insert({ ...row, workspace_id: ws?.id, created_by: s.session?.user.id });
      if (error) return setMsg(error.message);
    }
    setForm(null); setMsg(form.id ? "Regla actualizada." : "Regla creada en pausa. Actívala cuando quieras que empiece a vigilar el feed."); load();
  }
  async function toggle(r: Rule) {
    const { error } = await supabase.from("automation_rules").update({ active: !r.active }).eq("id", r.id);
    if (error) return setMsg(error.message);
    setMsg(r.active ? "Regla en pausa." : "Regla activa. Solo se procesarán entradas publicadas a partir de ahora."); load();
  }
  async function check(r: Rule) {
    setBusy(r.id); setMsg(null);
    const { error } = await supabase.rpc("request_automation_check", { p_rule: r.id });
    if (error) { setBusy(null); return setMsg(error.message); }
    const { data: s } = await supabase.auth.getSession();
    fetch("/api/wake", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } }).catch(() => {});
    setMsg("Comprobación solicitada. El resultado aparece en el historial en cuanto el worker la procese."); setBusy(null);
  }
  async function remove(r: Rule) {
    if (!confirm(`¿Borrar la regla «${r.name}»? Los proyectos ya creados se conservan.`)) return;
    const { error } = await supabase.from("automation_rules").delete().eq("id", r.id); if (error) return setMsg(error.message); load();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Automatizaciones</h1><p className="mt-1 max-w-2xl text-[var(--muted)]">Vigila un feed RSS con tus vídeos y crea los clips de cada entrada nueva sin que tengas que subirla.</p></div>
        <button onClick={() => { setForm({ ...blank }); setMsg(null); }} className="btn btn-primary"><Icon n="plus" className="h-4 w-4" />Nueva regla</button>
      </header>
      {msg && <p role="status" aria-live="polite" className="card mb-4 p-3 text-sm">{msg}</p>}

      <section className="card mb-6 grid gap-4 p-5 text-sm sm:grid-cols-3">
        {[["rss", "Feed con vídeo", "Un RSS (https) cuyas entradas incluyan el vídeo directo (enclosure MP4, MOV o WebM). No admite páginas de YouTube."], ["clock", "Solo lo nuevo", "Al activar una regla se toma un punto de partida: no se procesa el histórico, solo entradas publicadas después."], ["check", "Sin duplicados", "Cada entrada se procesa una sola vez, con límite diario y registro de todo lo que ocurre."]].map(([i, t, d]) => (
          <div key={t} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border hairline"><Icon n={i} className="h-4 w-4" /></span><div><div className="font-medium">{t}</div><p className="text-[var(--muted)]">{d}</p></div></div>))}
      </section>

      {form && (
        <section className="card-raised mb-6 p-5" aria-label="Regla">
          <h2 className="text-lg">{form.id ? "Editar regla" : "Nueva regla"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input mt-1" placeholder="Mi podcast semanal" maxLength={80} /></label>
            <label className="text-sm">URL del feed (https)<input value={form.feed_url} onChange={(e) => setForm({ ...form, feed_url: e.target.value })} className="input mono mt-1" placeholder="https://midominio.com/feed.xml" /></label>
            <label className="text-sm sm:col-span-2">¿Qué clips necesitas de cada entrada? (opcional)<textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} rows={2} maxLength={2000} className="input mt-1" placeholder="Consejos prácticos para principiantes. Evita los patrocinadores." /></label>
            <label className="text-sm">Clips por entrada · <span className="mono">{form.clip_count}</span><input type="range" min={3} max={10} value={form.clip_count} onChange={(e) => setForm({ ...form, clip_count: Number(e.target.value) })} className="mt-2 w-full" /></label>
            <label className="text-sm">Límite diario · <span className="mono">{form.daily_limit} entradas</span><input type="range" min={1} max={20} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} className="mt-2 w-full" /></label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.review_first} onChange={(e) => setForm({ ...form, review_first: e.target.checked })} className="mt-1" /><span><span className="font-medium">Avisarme para revisar</span><span className="block text-[var(--muted)]">Recibes una notificación cuando haya clips listos. En ningún caso se publica nada en redes automáticamente.</span></span></label>
          </div>
          <div className="mt-4 flex gap-2"><button onClick={save} className="btn btn-primary">{form.id ? "Guardar cambios" : "Crear regla"}</button><button onClick={() => setForm(null)} className="btn btn-ghost">Cancelar</button></div>
        </section>
      )}

      {rules === null && <div className="skeleton h-32" />}
      {rules?.length === 0 && !form && (
        <div className="card border-dashed p-10 text-center"><Icon n="bolt" className="mx-auto h-8 w-8" /><p className="mt-3 font-medium">Aún no tienes reglas</p><p className="mt-1 text-[var(--muted)]">Crea una con la URL de tu feed y activa cuando estés listo.</p><button onClick={() => setForm({ ...blank })} className="btn btn-primary mt-4">Crear la primera regla</button></div>
      )}
      <ul className="space-y-3">
        {rules?.map((r) => {
          const rr = runs.filter((x) => x.rule_id === r.id);
          return (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`chip !py-0.5`}>{r.active ? <><span className="pulse" aria-hidden />Activa</> : "En pausa"}</span>
                <h3 className="min-w-0 flex-1 truncate text-base">{r.name}</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => toggle(r)} className="btn btn-ghost !px-3 !py-1.5 !text-xs">{r.active ? "Pausar" : "Activar"}</button>
                  <button onClick={() => check(r)} disabled={busy === r.id} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Comprobar ahora</button>
                  <button onClick={() => { setForm({ id: r.id, name: r.name, feed_url: r.feed_url, review_first: r.review_first, clip_count: r.clip_count, brief: r.brief ?? "", daily_limit: r.daily_limit }); setMsg(null); }} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Editar</button>
                  <button onClick={() => remove(r)} className="btn btn-ghost !px-3 !py-1.5 !text-xs">Borrar</button>
                </div>
              </div>
              <div className="mono mt-2 truncate text-xs text-[var(--muted)]">{r.feed_url}</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]"><span>Última comprobación: {ago(r.last_checked_at)}</span><span>{r.clip_count} clips por entrada</span><span>Máx. {r.daily_limit}/día</span>{r.active && r.cursor_published && <span>Solo entradas posteriores al {new Date(r.cursor_published).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}</div>
              {r.last_error && <p role="alert" className="mt-2 rounded-lg bg-[var(--surface)] p-2 text-sm">⚠ {r.last_error}</p>}
              <button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="mt-3 flex items-center gap-1 text-sm underline underline-offset-4"><Icon n={open === r.id ? "chevD" : "chevR"} className="h-3.5 w-3.5" />Historial <span className="mono text-[var(--muted)]">{rr.length}</span></button>
              {open === r.id && (rr.length ? (
                <ul className="mt-2 divide-y hairline rounded-xl border hairline">{rr.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"><span className="chip !py-0.5">{x.status === "queued" && <span className="pulse" aria-hidden />}{RUN[x.status] ?? x.status}</span>
                    <span className="min-w-0 flex-1 truncate">{x.entry_title ?? x.entry_url}</span><span className="text-xs text-[var(--muted)]">{x.detail}</span>
                    <span className="mono text-xs text-[var(--muted)]">{new Date(x.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {x.project_id && <Link href={`/app/p/${x.project_id}`} className="underline">Abrir</Link>}</li>))}</ul>
              ) : <p className="mt-2 text-sm text-[var(--muted)]">Todavía no se ha procesado ninguna entrada.</p>)}
            </li>
          );
        })}
      </ul>
      <div className="mt-6"><OpsStatus /></div>
      <p className="mt-2 text-xs text-[var(--muted)]">Los vídeos importados están limitados a 50 MB por archivo (límite del plan gratuito de almacenamiento).</p>
    </main>
  );
}
