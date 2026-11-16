"use client";
// TikTok: varias cuentas conectadas desde Ráfaga, textos con IA por cuenta y programación de lotes con los vídeos elegidos en la app.
// La publicación real depende de la app de TikTok for Developers del propietario: sin auditoría, TikTok solo permite publicaciones privadas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { pkce, randomState } from "@rafaga/providers/oauth";
import { planSchedule, SUGGESTED_PROFILES, DEFAULT_PROFILE, type AccountProfile, type PlanAccount, type Copy } from "../lib/tiktokplan";
import { utcToLocalInput, zonedToUtc, ZONES } from "../lib/tz";

type Account = { id: string; alias: string | null; account_label: string | null; status: string; last_error: string | null; profile: AccountProfile };
type Video = { id: string; title: string; created_at: string };
type Queue = { id: string; state: string; scheduled_at: string | null; title: string; connection_id: string | null; error_message: string | null };
type Row = { render: string; title: string; account: string; at: string; caption: string; source: Copy["source"]; result?: string };
const STATE: Record<string, string> = { scheduled: "Programada", queued: "En cola", uploading: "Subiendo", processing: "Procesando", published: "Publicada", private_pending_review: "Borrador en tu bandeja de TikTok", requiere_auditoria: "Requiere auditoría de TikTok", failed: "Falló", cancelled: "Cancelada" };
const MUSIC: [string, string][] = [["", "Elige el origen de la música…"], ["own", "Música propia"], ["licensed", "Con licencia"], ["free", "Libre de derechos"], ["risk", "Comercial: asumo el riesgo"]];
const PRIVACY: Record<string, string> = { SELF_ONLY: "Solo yo (privado)", MUTUAL_FOLLOW_FRIENDS: "Amigos", FOLLOWER_OF_CREATOR: "Seguidores", PUBLIC_TO_EVERYONE: "Público" };
const songOf = (t: string) => t.replace(/\s·\s#\d+$/, "").trim();

async function api(path: string, init: RequestInit & { idem?: string } = {}) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}`, ...(init.idem ? { "Idempotency-Key": init.idem } : {}) } });
  return { ok: r.ok, status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default function TikTokStudio() {
  const [accounts, setAccounts] = useState<Account[] | null>(null), [videos, setVideos] = useState<Video[]>([]), [queue, setQueue] = useState<Queue[]>([]);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [alias, setAlias] = useState("");
  const [pickV, setPickV] = useState<Set<string>>(new Set()), [pickA, setPickA] = useState<Set<string>>(new Set()), [music, setMusic] = useState(""), [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const a = await api("/api/tiktok");
    setAccounts(a.ok ? (a.j.accounts as Account[]) : []);
    const [{ data: rs }, { data: ps }] = await Promise.all([
      supabase.from("renders").select("id,created_at,clips!inner(title)").eq("kind", "mp4").eq("status", "ready").not("storage_path", "is", null).order("created_at", { ascending: false }).limit(80),
      supabase.from("publications").select("id,state,scheduled_at,title,connection_id,error_message").eq("platform", "tiktok").order("scheduled_at", { ascending: true, nullsFirst: false }).limit(100),
    ]);
    setVideos(((rs ?? []) as unknown as { id: string; created_at: string; clips: { title: string } }[]).map((r) => ({ id: r.id, title: r.clips.title, created_at: r.created_at })));
    setQueue((ps ?? []) as Queue[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const nameOf = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.alias || a.account_label || "Cuenta"])), [accounts]);
  const connected = (accounts ?? []).filter((a) => a.status === "connected");

  async function connect() {
    setBusy("connect"); setMsg(null);
    const { verifier, challenge } = await pkce(), state = randomState();
    try { sessionStorage.setItem("rafaga.oauth", JSON.stringify({ state, verifier, capability: "publish_tiktok", alias: alias.trim(), back: "/app/tiktok" })); } catch { setBusy(null); return setMsg("Tu navegador bloquea el almacenamiento de sesión: no se puede completar la conexión."); }
    const r = await api("/api/oauth/start", { method: "POST", body: JSON.stringify({ capability: "publish_tiktok", state, challenge }) });
    setBusy(null);
    if (!r.ok) return setMsg((r.j.message as string) ?? "No se pudo iniciar la conexión.");
    window.location.assign(r.j.url as string);
  }
  async function saveProfile(a: Account, alias2: string, p: AccountProfile) {
    setBusy(a.id); const r = await api(`/api/tiktok/${a.id}`, { method: "PATCH", body: JSON.stringify({ alias: alias2, profile: p }) }); setBusy(null);
    setMsg(r.ok ? "Perfil guardado." : (r.j.error?.message ?? "No se pudo guardar.")); void load();
  }
  async function disconnect(a: Account) {
    if (!confirm(`¿Desconectar «${a.alias || a.account_label}»? Se revoca el acceso en TikTok y se cancelan sus publicaciones programadas.`)) return;
    setBusy(a.id); const r = await api(`/api/tiktok/${a.id}/disconnect`, { method: "POST", body: "{}" }); setBusy(null);
    setMsg(r.ok ? "Cuenta desconectada." : (r.j.error?.message ?? "No se pudo desconectar.")); void load();
  }

  async function plan() {
    setMsg(null); setNotes([]);
    const vids = videos.filter((v) => pickV.has(v.id)), accs = connected.filter((a) => pickA.has(a.id));
    if (!vids.length || !accs.length) return setMsg("Elige al menos un vídeo y una cuenta.");
    if (!music) return setMsg("Indica el origen de la música: es obligatorio para programar.");
    setBusy("plan");
    const already = new Map<string, string[]>(); for (const p of queue) if (p.connection_id && p.scheduled_at && !["cancelled", "failed"].includes(p.state)) already.set(p.connection_id, [...(already.get(p.connection_id) ?? []), p.scheduled_at]);
    const pa: PlanAccount[] = accs.map((a) => ({ id: a.id, name: a.alias || a.account_label || "Cuenta", profile: a.profile ?? {}, already: already.get(a.id) }));
    const out = planSchedule(vids.map((v) => ({ id: v.id })), pa, { now: new Date(), seed: Date.now() % 100000 });
    const nn: string[] = [];
    if (out.unplaced.length) nn.push(`${out.unplaced.length} vídeo(s) no caben en los próximos 30 días con los topes de las cuentas: amplía franjas o sube el tope diario.`);
    for (const s of out.skipped) nn.push(`«${nameOf.get(s.account)}» está en pausa: no recibe vídeos.`);
    const rs: Row[] = [];
    for (const a of pa) {
      const mine = out.placed.filter((p) => p.account === a.id); if (!mine.length) continue;
      const songs = mine.map((p) => ({ title: songOf(vids.find((v) => v.id === p.item)!.title) }));
      const c = await api("/api/tiktok/copy", { method: "POST", body: JSON.stringify({ account_name: a.name, profile: a.profile, songs }) });
      if (c.j.note) nn.push(`${a.name}: ${c.j.note as string}`);
      const copies = (c.ok ? c.j.copies : []) as Copy[];
      mine.forEach((p, i) => rs.push({ render: p.item, title: copies[i]?.title ?? songs[i].title, account: a.id, at: p.at, caption: copies[i]?.description ?? songs[i].title, source: copies[i]?.source ?? "plantilla" }));
    }
    setRows(rs.sort((x, y) => x.at.localeCompare(y.at))); setNotes(nn); setBusy(null);
  }
  const edit = (i: number, patch: Partial<Row>) => setRows((r) => (r ?? []).map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function schedule() {
    if (!rows?.length) return;
    setBusy("schedule"); let ok = 0;
    const next = [...rows];
    for (const [i, r] of next.entries()) {
      if (r.result === "ok") { ok++; continue; }
      const acc = accounts?.find((a) => a.id === r.account);
      const res = await api("/api/publish", { method: "POST", idem: `tt-${r.render}-${r.account}`.slice(0, 120), body: JSON.stringify({ export_id: r.render, platform: "tiktok", connection_id: r.account, music_origin: music, title: r.title.slice(0, 100), description: r.caption, privacy: acc?.profile?.privacy ?? DEFAULT_PROFILE.privacy, scheduled_at: r.at }) });
      next[i] = { ...r, result: res.ok ? "ok" : (res.j.error?.message ?? "No se pudo programar.") }; if (res.ok) ok++;
    }
    setRows(next); setBusy(null); setMsg(`${ok} de ${next.length} programadas.`); void load();
  }
  async function cancel(id: string) { setBusy(id); await api(`/api/publish/${id}/cancel`, { method: "POST", idem: `c-${id}-${Date.now()}`, body: "{}" }); setBusy(null); void load(); }

  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 md:px-8">
      <h1 className="text-3xl">TikTok</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Conecta varias cuentas, genera los textos con IA y programa los vídeos que elijas. Mientras la app de TikTok no esté auditada, TikTok solo permite publicar en privado.</p>
      {msg && <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--hover)] px-3 py-2 text-sm">{msg}</p>}

      <section aria-label="Cuentas" className="mt-6">
        <h2 className="text-lg">Cuentas</h2>
        <div className="card mt-2 flex flex-wrap items-end gap-2 p-3">
          <label className="min-w-0 flex-1 text-sm">Nombre en Ráfaga<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Punto de Perreo" maxLength={60} className="mt-1 w-full rounded-full border border-[var(--border)] bg-white px-4 py-2" /></label>
          <button onClick={connect} disabled={busy === "connect" || (accounts?.length ?? 0) >= 5} className="btn btn-primary">Conectar cuenta de TikTok</button>
          <span className="tnum text-xs text-[var(--muted)]">{accounts?.length ?? 0} de 5 cuentas</span>
          <p className="w-full text-xs text-[var(--muted)]">Antes de conectar, abre TikTok en este navegador con la cuenta que quieres añadir: TikTok conecta la sesión que esté abierta.</p>
        </div>
        {accounts === null && <p className="mt-3 text-sm text-[var(--muted)]">Cargando…</p>}
        {accounts?.length === 0 && <p className="mt-3 rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">Aún no hay cuentas. Conecta la primera para empezar.</p>}
        <ul className="mt-3 space-y-3">{accounts?.map((a) => <AccountCard key={a.id} a={a} busy={busy === a.id} onSave={saveProfile} onDisconnect={disconnect} />)}</ul>
      </section>

      <section aria-label="Programar lote" className="mt-10">
        <h2 className="text-lg">Programar un lote</h2>
        <p className="text-sm text-[var(--muted)]">Elige los vídeos y las cuentas. Cada vídeo va a una sola cuenta; los horarios respetan las franjas y el tope diario de cada una.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="card p-3"><h3 className="text-sm font-semibold">Vídeos listos ({pickV.size})</h3>
            {!videos.length && <p className="mt-2 text-sm text-[var(--muted)]">No hay exportaciones MP4 listas. Genera variantes en Lyric Studio.</p>}
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto">{videos.map((v) => <li key={v.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pickV.has(v.id)} onChange={() => setPickV((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })} /><span className="truncate">{v.title}</span></label></li>)}</ul></div>
          <div className="card p-3"><h3 className="text-sm font-semibold">Cuentas ({pickA.size})</h3>
            {!connected.length && <p className="mt-2 text-sm text-[var(--muted)]">Conecta una cuenta para poder programar.</p>}
            <ul className="mt-2 space-y-1">{connected.map((a) => <li key={a.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pickA.has(a.id)} onChange={() => setPickA((s) => { const n = new Set(s); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />{a.alias || a.account_label}{a.profile?.paused ? " (en pausa)" : ""}</label></li>)}</ul>
            <label className="mt-3 block text-sm">Origen de la música<select value={music} onChange={(e) => setMusic(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2">{MUSIC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <p className="mt-1 text-xs text-[var(--muted)]">Una canción comercial puede silenciarse o retirarse en TikTok. Declararlo es obligatorio y queda registrado.</p>
          </div>
        </div>
        <button onClick={plan} disabled={busy === "plan"} className="btn btn-primary mt-3">{busy === "plan" ? "Preparando…" : "Proponer horarios y textos"}</button>
        {notes.map((n) => <p key={n} className="mt-2 text-sm text-[var(--muted)]">{n}</p>)}
        {rows && (
          <div className="mt-4">
            <ul className="space-y-3">{rows.map((r, i) => (
              <li key={r.render + r.account} className="card p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><strong className="min-w-0 truncate">{r.title}</strong><span className="chip !py-0.5 text-xs">{nameOf.get(r.account)}</span><span className="chip !py-0.5 text-xs">{r.source === "ia" ? "Texto con IA" : "Texto de plantilla"}</span>
                  <input type="datetime-local" value={utcToLocalInput(r.at, accounts?.find((a) => a.id === r.account)?.profile?.tz || DEFAULT_PROFILE.tz)} onChange={(e) => { const tz = accounts?.find((a) => a.id === r.account)?.profile?.tz || DEFAULT_PROFILE.tz; try { edit(i, { at: zonedToUtc(e.target.value, tz).utc.toISOString() }); } catch { /* fecha incompleta */ } }} className="ml-auto rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs" aria-label="Fecha y hora" /></div>
                <textarea value={r.caption} onChange={(e) => edit(i, { caption: e.target.value })} rows={2} maxLength={2200} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm" aria-label="Texto de la publicación" />
                {r.result && <p className="mt-1 text-xs">{r.result === "ok" ? "Programada." : r.result}</p>}
              </li>))}</ul>
            <button onClick={schedule} disabled={busy === "schedule"} className="btn btn-primary mt-3">{busy === "schedule" ? "Programando…" : `Programar ${rows.length} publicaciones`}</button>
          </div>)}
      </section>

      <section aria-label="Cola" className="mt-10">
        <h2 className="text-lg">Cola de publicaciones</h2>
        {!queue.length && <p className="mt-2 text-sm text-[var(--muted)]">Todavía no hay publicaciones de TikTok.</p>}
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">{queue.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{p.title}</span><span className="text-xs text-[var(--muted)]">{p.connection_id ? nameOf.get(p.connection_id) ?? "Cuenta desconectada" : ""}</span>
            <span className="tnum text-xs">{p.scheduled_at ? new Date(p.scheduled_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span><span className="chip !py-0.5 text-xs">{STATE[p.state] ?? p.state}</span>
            {["scheduled", "queued", "failed", "requiere_auditoria"].includes(p.state) && <button onClick={() => cancel(p.id)} disabled={busy === p.id} className="text-xs underline">Cancelar</button>}
            {p.error_message && <span className="w-full text-xs text-[var(--muted)]">{p.error_message}</span>}</li>))}</ul>
      </section>
    </main>
  );
}

function AccountCard({ a, busy, onSave, onDisconnect }: { a: Account; busy: boolean; onSave: (a: Account, alias: string, p: AccountProfile) => void; onDisconnect: (a: Account) => void }) {
  const [alias, setAlias] = useState(a.alias ?? ""), [p, setP] = useState<AccountProfile>(a.profile ?? {});
  const set = (patch: Partial<AccountProfile>) => setP((x) => ({ ...x, ...patch }));
  const suggestion = Object.keys(SUGGESTED_PROFILES).find((k) => (a.alias ?? "").toLowerCase().includes(k.toLowerCase()));
  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-base">{a.alias || a.account_label || "Cuenta"}</h3><span className="text-xs text-[var(--muted)]">{a.account_label}</span>
        <span className="chip !py-0.5 text-xs">{a.status === "connected" ? (p.paused ? "En pausa" : "Conectada") : "Vuelve a conectar"}</span></div>
      {a.last_error && <p className="mt-1 text-xs text-[var(--muted)]">{a.last_error}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-sm">Perfil de contenido</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs">Nombre<input value={alias} onChange={(e) => setAlias(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Tono para la IA<input value={p.tone ?? ""} onChange={(e) => set({ tone: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Hashtags fijos (separados por comas)<input value={(p.hashtags ?? []).join(", ")} onChange={(e) => set({ hashtags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Horas de publicación (HH:MM, separadas por comas)<input value={(p.slots ?? DEFAULT_PROFILE.slots).join(", ")} onChange={(e) => set({ slots: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Zona horaria<select value={p.tz ?? DEFAULT_PROFILE.tz} onChange={(e) => set({ tz: e.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm">{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label>
          <label className="text-xs">Máximo por día<input type="number" min={1} max={30} value={p.daily_cap ?? DEFAULT_PROFILE.daily_cap} onChange={(e) => set({ daily_cap: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm" /></label>
          <label className="text-xs">Privacidad por defecto<select value={p.privacy ?? DEFAULT_PROFILE.privacy} onChange={(e) => set({ privacy: e.target.value as AccountProfile["privacy"] })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm">{Object.entries(PRIVACY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.paused} onChange={(e) => set({ paused: e.target.checked })} />Pausar esta cuenta</label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestion && <button type="button" onClick={() => setP((x) => ({ ...SUGGESTED_PROFILES[suggestion], ...x, tone: SUGGESTED_PROFILES[suggestion].tone, hashtags: SUGGESTED_PROFILES[suggestion].hashtags, emoji: SUGGESTED_PROFILES[suggestion].emoji, bio: SUGGESTED_PROFILES[suggestion].bio }))} className="btn btn-ghost !py-1.5 !text-xs">Usar perfil sugerido de «{suggestion}»</button>}
          <button onClick={() => onSave(a, alias, p)} disabled={busy} className="btn btn-primary !py-1.5 !text-xs">Guardar perfil</button>
          <button onClick={() => onDisconnect(a)} disabled={busy} className="btn btn-ghost !py-1.5 !text-xs">Desconectar</button>
        </div>
      </details>
    </li>
  );
}
