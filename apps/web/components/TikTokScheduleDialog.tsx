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
  const [time, setTime] = useState((accounts[0]?.profile?.slots ?? DEFAULT_PROFILE.slots)[0] ?? "19:00"), [caption, setCaption] = useState(""), [music, setMusic] = useState(""), [privacy, setPrivacy] = useState<string>("");   // TikTok exige que la privacidad no tenga valor por defecto: la elige quien publica
  const [opts, setOpts] = useState({ comment: false, duet: false, stitch: false, commercial: false, own_brand: false, paid_partner: false });   // TikTok exige que empiecen desactivadas
  const setOpt = (k: keyof typeof opts, v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const acc = accounts.find((a) => a.id === account), vid = videos.find((v) => v.id === video);
  const pickAccount = (id: string) => { setAccount(id); const a = accounts.find((x) => x.id === id); if (a) { setZone(a.profile?.tz || tz); setTime((a.profile?.slots ?? DEFAULT_PROFILE.slots)[0] ?? time); } };
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
    if (!privacy) return setErr("Elige quién puede ver el vídeo.");
    if (!music) return setErr("Indica el origen de la música: es obligatorio.");
    if (opts.commercial && !opts.own_brand && !opts.paid_partner) return setErr("Indica si promocionas tu marca o a un tercero.");
    if (opts.commercial && privacy === "SELF_ONLY") return setErr("El contenido comercial no puede ser privado: elige otra privacidad.");
    if (!now && (!when || when.getTime() < Date.now() + 60_000)) return setErr("Elige una fecha y hora futuras.");
    setBusy("go");
    const title = songOf(vid.title).slice(0, 100) || "Vídeo";
    const r = await api("/api/publish", { export_id: vid.id, platform: "tiktok", connection_id: acc.id, music_origin: music, title, description: caption.trim() || title, privacy, options: opts, ...(now ? {} : { scheduled_at: when!.toISOString() }) }, `cal-${crypto.randomUUID()}`);
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
            <p className="text-xs text-[var(--muted)]">Se publicará como <strong className="text-[var(--ink)]">{acc?.account_label || acc?.alias || "tu cuenta"}</strong> en TikTok.</p>
            <label>Cuenta<select value={account} onChange={(e) => pickAccount(e.target.value)} className="input mt-1">{accounts.map((a) => <option key={a.id} value={a.id}>{a.alias || a.account_label}{a.profile?.paused ? " (en pausa)" : ""}</option>)}</select></label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><label>Fecha<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input mt-1" /></label><label>Hora<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input mt-1" /></label>
              <label>Zona horaria<select value={zone} onChange={(e) => setZone(e.target.value)} className="input mt-1">{[...new Set([zone, tz, ...ZONES])].map((t) => <option key={t}>{t}</option>)}</select></label></div>
            <label>Texto de la publicación<textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={2200} className="input mt-1" placeholder="Título - Artista #hashtags" /></label>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={writeCopy} disabled={busy === "copy"} className="btn btn-ghost !min-h-9"><Icon n="wand" className="h-4 w-4" />{busy === "copy" ? "Escribiendo…" : "Escribir el texto con IA"}</button><span className="tnum text-xs text-[var(--muted)]">{caption.length} / 2200</span></div>
            {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><label>Origen de la música<select value={music} onChange={(e) => setMusic(e.target.value)} className="input mt-1">{MUSIC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Privacidad<select value={privacy} onChange={(e) => setPrivacy(e.target.value)} className="input mt-1"><option value="">Elige quién puede ver el vídeo…</option>{Object.entries(PRIVACY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
            <fieldset className="grid gap-1.5"><legend className="mb-1">Interacción</legend>
              {([["comment", "Permitir comentarios"], ["duet", "Permitir dúos"], ["stitch", "Permitir stitch"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpt(k, e.target.checked)} />{l}</label>)}</fieldset>
            <fieldset className="grid gap-1.5"><legend className="mb-1">Divulgación de contenido</legend>
              <label className="flex items-center gap-2"><input type="checkbox" checked={opts.commercial} onChange={(e) => { setOpt("commercial", e.target.checked); if (!e.target.checked) { setOpt("own_brand", false); setOpt("paid_partner", false); } }} />Este vídeo promociona una marca, producto o servicio</label>
              {opts.commercial && <div className="ml-6 grid gap-1.5"><label className="flex items-center gap-2"><input type="checkbox" checked={opts.own_brand} onChange={(e) => setOpt("own_brand", e.target.checked)} />Tu marca (promocionas tu propio negocio)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={opts.paid_partner} onChange={(e) => setOpt("paid_partner", e.target.checked)} />Colaboración de pago (promocionas a un tercero)</label>
                <p className="text-xs text-[var(--muted)]">{opts.paid_partner ? "Tu vídeo se etiquetará como «Colaboración de pago»." : opts.own_brand ? "Tu vídeo se etiquetará como «Promocionando tu marca»." : "Elige al menos una opción."}</p></div>}</fieldset>
            <p className="text-xs text-[var(--muted)]">Al publicar aceptas la <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="underline">Confirmación de uso de música</a>{opts.commercial ? " y la " : ""}{opts.commercial && <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="underline">Política de contenido de marca</a>} de TikTok.</p>
            <p className="text-xs text-[var(--muted)]">Mientras la app de TikTok no esté auditada, TikTok publica en privado aunque elijas otra privacidad.</p>
            {err && <p role="alert" className="rounded-lg bg-[var(--surface)] p-2 text-xs">⚠ {err}</p>}
            <div className="flex flex-wrap gap-2"><button onClick={() => schedule(false)} disabled={!!busy} className="btn btn-primary">{busy === "go" ? "Enviando…" : "Programar"}</button><button onClick={() => schedule(true)} disabled={!!busy} className="btn btn-ghost">Publicar ahora</button><button onClick={onClose} className="btn btn-ghost">Cancelar</button></div>
          </div>)}
      </div>
    </div>
  );
}
