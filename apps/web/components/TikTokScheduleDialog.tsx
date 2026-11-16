"use client";
// Programar UNA publicación de TikTok desde el calendario: vídeo exportado, cuenta, fecha y hora, texto (con IA) y origen de la música.
// Usa la misma API que la pantalla de TikTok (/api/publish): la base de datos aplica tope diario, duplicados y pausa.
import { useState } from "react";
import Icon from "./Icon";
import ClipThumb from "./ui/ClipThumb";
import { supabase } from "../lib/supabase";
import { zonedToUtc, ZONES } from "../lib/tz";
import { DEFAULT_PROFILE, type AccountProfile, type Copy } from "../lib/tiktokplan";

export type TtAccount = { id: string; alias: string | null; account_label: string | null; status: string; profile: AccountProfile };
export type TtVideo = { id: string; title: string; clipId?: string };
const MUSIC: [string, string][] = [["", "Elige el origen de la música…"], ["own", "Música propia"], ["licensed", "Con licencia"], ["free", "Libre de derechos"], ["risk", "Comercial: asumo el riesgo"]];
const PRIVACY: Record<string, string> = { SELF_ONLY: "Solo yo (privado)", MUTUAL_FOLLOW_FRIENDS: "Amigos", FOLLOWER_OF_CREATOR: "Seguidores", PUBLIC_TO_EVERYONE: "Público" };
const songOf = (t: string) => t.replace(/\s·\s#\d+$/, "").trim();
async function api(path: string, body: unknown, idem?: string) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}`, ...(idem ? { "Idempotency-Key": idem } : {}) }, body: JSON.stringify(body) });
  return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default function TikTokScheduleDialog({ accounts, videos, day, tz, onClose, onDone }: { accounts: TtAccount[]; videos: TtVideo[]; day: string; tz: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [video, setVideo] = useState(videos[0]?.id ?? ""), [account, setAccount] = useState(accounts[0]?.id ?? ""), [date, setDate] = useState(day), [zone, setZone] = useState(accounts[0]?.profile?.tz || tz);
  const [time, setTime] = useState((accounts[0]?.profile?.slots ?? DEFAULT_PROFILE.slots)[0] ?? "19:00"), [caption, setCaption] = useState(""), [music, setMusic] = useState(""), [privacy, setPrivacy] = useState<string>(accounts[0]?.profile?.privacy ?? DEFAULT_PROFILE.privacy);
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const acc = accounts.find((a) => a.id === account), vid = videos.find((v) => v.id === video);
  const pickAccount = (id: string) => { setAccount(id); const a = accounts.find((x) => x.id === id); if (a) { setZone(a.profile?.tz || tz); setPrivacy(a.profile?.privacy ?? DEFAULT_PROFILE.privacy); setTime((a.profile?.slots ?? DEFAULT_PROFILE.slots)[0] ?? time); } };
  let when: Date | null = null; try { when = zonedToUtc(`${date}T${time}`, zone).utc; } catch { when = null; }

  async function writeCopy() {
    if (!vid || !acc) return; setBusy("copy"); setErr(null);
    const r = await api("/api/tiktok/copy", { account_name: acc.alias || acc.account_label || "TikTok", profile: acc.profile ?? {}, songs: [{ title: songOf(vid.title) }] });
    setBusy(null);
    if (!r.ok) return setErr(r.j.error?.message ?? "No se pudo generar el texto.");
    const c = (r.j.copies as Copy[])[0]; if (c) setCaption(c.description); setNote((r.j.note as string) ?? (c?.source === "ia" ? "Texto generado con IA: revísalo antes de programar." : null));
  }
  async function schedule(now: boolean) {
    setErr(null);
    if (!vid || !acc) return setErr("Elige un vídeo y una cuenta.");
    if (!music) return setErr("Indica el origen de la música: es obligatorio.");
    if (!now && (!when || when.getTime() < Date.now() + 60_000)) return setErr("Elige una fecha y hora futuras.");
    setBusy("go");
    const title = songOf(vid.title).slice(0, 100) || "Vídeo";
    const r = await api("/api/publish", { export_id: vid.id, platform: "tiktok", connection_id: acc.id, music_origin: music, title, description: caption.trim() || title, privacy, ...(now ? {} : { scheduled_at: when!.toISOString() }) }, `cal-${crypto.randomUUID()}`);
    setBusy(null);
    if (!r.ok) return setErr(r.j.error?.message ?? "No se pudo programar.");
    onDone(now ? "Publicación enviada a TikTok." : "Publicación programada en TikTok.");
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Programar en TikTok" className="fixed inset-0 z-40 grid place-items-center overflow-auto bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card-raised w-full min-w-0 max-w-xl overflow-hidden p-5">
        <div className="flex items-center justify-between"><h2 className="text-lg">Programar en TikTok</h2><button onClick={onClose} aria-label="Cerrar" className="btn btn-ghost !p-1.5"><Icon n="x" className="h-4 w-4" /></button></div>
        {!accounts.length ? <p className="mt-4 text-sm">No hay cuentas de TikTok conectadas. <a href="/app/tiktok" className="font-semibold text-[var(--accent-ink)] underline">Conecta una cuenta</a> para programar desde el calendario.</p>
          : !videos.length ? <p className="mt-4 text-sm">No hay vídeos exportados listos. Genera variantes en Lyric Studio o exporta un clip.</p> : (
          <div className="mt-4 grid min-w-0 gap-3 text-sm [&>*]:min-w-0">
            {videos.length > 1 ? <div><span className="block">Vídeo</span>
              <ul className="mt-1 flex max-h-44 gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Vídeo">{videos.map((v) => (
                <li key={v.id} className="shrink-0"><button type="button" role="radio" aria-checked={video === v.id} onClick={() => setVideo(v.id)} className={`relative block h-40 w-[90px] overflow-hidden rounded-xl bg-[var(--ink)] ${video === v.id ? "ring-2 ring-[var(--accent)]" : "opacity-80"}`} title={v.title}>
                  {v.clipId ? <ClipThumb clipId={v.clipId} renderId={v.id} className="h-full w-full" /> : null}</button></li>))}</ul></div>
              : vid?.clipId ? <div className="flex items-center gap-3"><span className="relative block h-28 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--ink)]"><ClipThumb clipId={vid.clipId} renderId={vid.id} className="h-full w-full" /></span><span className="text-xs text-[var(--muted)]">Este vídeo se publicará en la cuenta y a la hora que elijas.</span></div> : null}
            <label>Cuenta<select value={account} onChange={(e) => pickAccount(e.target.value)} className="input mt-1">{accounts.map((a) => <option key={a.id} value={a.id}>{a.alias || a.account_label}{a.profile?.paused ? " (en pausa)" : ""}</option>)}</select></label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><label>Fecha<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input mt-1" /></label><label>Hora<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input mt-1" /></label>
              <label>Zona horaria<select value={zone} onChange={(e) => setZone(e.target.value)} className="input mt-1">{[...new Set([zone, tz, ...ZONES])].map((t) => <option key={t}>{t}</option>)}</select></label></div>
            <label>Texto de la publicación<textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={2200} className="input mt-1" placeholder="Título - Artista #hashtags" /></label>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={writeCopy} disabled={busy === "copy"} className="btn btn-ghost !min-h-9"><Icon n="wand" className="h-4 w-4" />{busy === "copy" ? "Escribiendo…" : "Escribir el texto con IA"}</button><span className="tnum text-xs text-[var(--muted)]">{caption.length} / 2200</span></div>
            {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><label>Origen de la música<select value={music} onChange={(e) => setMusic(e.target.value)} className="input mt-1">{MUSIC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Privacidad<select value={privacy} onChange={(e) => setPrivacy(e.target.value)} className="input mt-1">{Object.entries(PRIVACY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
            <p className="text-xs text-[var(--muted)]">Mientras la app de TikTok no esté auditada, TikTok publica en privado aunque elijas otra privacidad.</p>
            {err && <p role="alert" className="rounded-lg bg-[var(--surface)] p-2 text-xs">⚠ {err}</p>}
            <div className="flex flex-wrap gap-2"><button onClick={() => schedule(false)} disabled={!!busy} className="btn btn-primary">{busy === "go" ? "Enviando…" : "Programar"}</button><button onClick={() => schedule(true)} disabled={!!busy} className="btn btn-ghost">Publicar ahora</button><button onClick={onClose} className="btn btn-ghost">Cancelar</button></div>
          </div>)}
      </div>
    </div>
  );
}
