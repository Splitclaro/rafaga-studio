// Planificador de publicaciones de TikTok y textos (copys) por cuenta. Funciones puras: sin red, sin reloj implícito.
// Los valores por defecto salen del estudio de referentes públicos (docs/recon/tiktok-referentes.md): 1–3 publicaciones al día,
// copy corto «título + artista + 4–6 hashtags» y un hashtag de identidad fijo por cuenta. Son orientativos, no una garantía.
import { zonedToUtc } from "./tz.ts";

export interface AccountProfile {
  tone?: string;                 // «energía», «emoción y dedicatorias»…
  language?: string;             // «es»
  hashtags?: string[];           // fijos de la cuenta, con o sin «#»
  hashtag_count?: number;        // total de hashtags por texto (4–6 recomendado)
  slots?: string[];              // horas locales «HH:MM»
  tz?: string;                   // zona IANA de esas horas
  daily_cap?: number;            // tope por día (1–30)
  privacy?: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "PUBLIC_TO_EVERYONE";
  paused?: boolean;
  emoji?: string;                // emoji de marca opcional
  bio?: string;                  // descripción de la cuenta para orientar a la IA
}
export const DEFAULT_PROFILE: Required<Pick<AccountProfile, "slots" | "tz" | "daily_cap" | "hashtag_count" | "privacy" | "language">> = { slots: ["13:00", "19:00", "21:30"], tz: "Europe/Madrid", daily_cap: 3, hashtag_count: 5, privacy: "SELF_ONLY", language: "es" };
/** Perfiles sugeridos para las cuentas del propietario (editables en pantalla). */
export const SUGGESTED_PROFILES: Record<string, AccountProfile> = {
  "Punto de Perreo": { tone: "energía, fiesta y perreo; frases cortas que invitan a poner la canción en repeat", hashtags: ["puntodeperreo", "reggaeton", "perreo"], emoji: "🔥", bio: "Punto de Perreo 🔥 | Tu próximo tema en repeat. 🔊" },
  "Te Lo Dedico": { tone: "emoción y dedicatorias; frases que alguien querría enviar a otra persona", hashtags: ["telodedico", "paradedicar", "musicaconletra"], emoji: "⭐", bio: "Te Lo Dedico ⭐ | Lo que no sabes decir, aquí suena. Canciones para dedicar y sentir." },
};

export const cleanTag = (t: string) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
export const withHash = (tags: string[]) => [...new Set(tags.map(cleanTag).filter(Boolean))].map((t) => `#${t}`);

// ───────── Textos ─────────
export interface SongInfo { title: string; artist?: string | null; genre?: string | null; line?: string | null }
export interface Copy { title: string; description: string; hashtags: string[]; source: "ia" | "plantilla" }
const MAX_CAPTION = 2200;
/** Une texto y hashtags sin pasar del límite de TikTok (2.200); recorta hashtags antes que el texto. */
export function composeCaption(text: string, hashtags: string[]): string {
  const tags = withHash(hashtags); let out = `${text.trim()} ${tags.join(" ")}`.trim();
  while (out.length > MAX_CAPTION && tags.length) { tags.pop(); out = `${text.trim()} ${tags.join(" ")}`.trim(); }
  return out.slice(0, MAX_CAPTION);
}
/** Texto sin IA: título + artista + hashtags de identidad, de género y de alcance (como las cuentas de referencia). */
export function templateCopy(song: SongInfo, p: AccountProfile = {}, variant = 0): Copy {
  const emoji = p.emoji ? ` ${p.emoji}` : "";
  const name = song.artist ? `${song.title} - ${song.artist}` : song.title;
  const hooks = ["", " 🎧", " 🔊", " 💭"];
  const text = `${name}${emoji}${hooks[variant % hooks.length]}`;
  const reach = ["musica", "parati", "viral", "videolyrics", "letras"];
  const tags = [...(p.hashtags ?? []), ...(song.genre ? [song.genre] : []), ...(song.artist ? [song.artist.split(/[,&]/)[0]] : []), ...reach];
  const n = Math.max(3, Math.min(8, p.hashtag_count ?? DEFAULT_PROFILE.hashtag_count));
  const picked = withHash(tags).slice(0, n);
  return { title: name.slice(0, 100), description: composeCaption(text, picked), hashtags: picked, source: "plantilla" };
}
export function copyPrompt(songs: SongInfo[], p: AccountProfile, accountName: string) {
  const system = "Eres redactor de TikTok para cuentas de videolyrics. Responde SOLO con JSON válido.";
  const user = `Cuenta: «${accountName}». ${p.bio ? `Descripción: ${p.bio}. ` : ""}Tono: ${p.tone ?? "cercano y breve"}. Idioma: ${p.language ?? "es"}.
Hashtags fijos de la cuenta (inclúyelos): ${(p.hashtags ?? []).map((h) => "#" + cleanTag(h)).join(" ") || "ninguno"}.
Para cada canción escribe un texto corto (máximo 90 caracteres, sin inventar datos sobre la canción ni el artista, puede llevar 1 emoji) y ${p.hashtag_count ?? DEFAULT_PROFILE.hashtag_count} hashtags en total (identidad + género/artista + alcance).
Canciones: ${JSON.stringify(songs.map((s, i) => ({ i, titulo: s.title, artista: s.artist ?? null, genero: s.genre ?? null, frase: s.line ?? null })))}
Formato exacto: {"items":[{"i":0,"text":"...","hashtags":["tag1","tag2"]}]}`;
  return { system, user };
}
/** Valida y normaliza la respuesta del modelo; lo que falle vuelve a la plantilla (nunca texto vacío). */
export function parseCopy(raw: string, songs: SongInfo[], p: AccountProfile): Copy[] {
  let items: { i?: number; text?: string; hashtags?: string[] }[] = [];
  try { const m = /\{[\s\S]*\}/.exec(raw); items = (JSON.parse(m ? m[0] : raw) as { items?: typeof items }).items ?? []; } catch { items = []; }
  return songs.map((s, k) => {
    const it = items.find((x) => x.i === k), text = typeof it?.text === "string" ? it.text.replace(/\s+/g, " ").trim().slice(0, 150) : "";
    if (!text) return templateCopy(s, p, k);
    const own = Array.isArray(it?.hashtags) ? it!.hashtags!.filter((h) => typeof h === "string") : [];
    const tags = withHash([...(p.hashtags ?? []), ...own]).slice(0, Math.max(3, Math.min(8, p.hashtag_count ?? DEFAULT_PROFILE.hashtag_count)));
    return { title: (s.artist ? `${s.title} - ${s.artist}` : s.title).slice(0, 100), description: composeCaption(text, tags), hashtags: tags, source: "ia" as const };
  });
}

// ───────── Horarios ─────────
export interface PlanItem { id: string; account?: string }               // account = conexión fijada; si falta, se reparte
export interface PlanAccount { id: string; name: string; profile: AccountProfile; already?: string[] }   // already = instantes ISO ya ocupados (publicaciones existentes)
export interface Placed { item: string; account: string; at: string; localDay: string }
/** Pseudoaleatorio estable (mulberry32) para que el mismo lote dé siempre el mismo plan. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const validSlot = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/**
 * Reparte los vídeos entre las cuentas (round-robin, un vídeo NUNCA en dos cuentas) y les asigna huecos: por día, las horas de la cuenta
 * con una variación de ±`jitterMin` minutos, sin pasar de su tope diario, sin repetir instante y sin huecos pasados (mínimo `leadMin` desde ahora).
 * Las cuentas en pausa no reciben nada. Devuelve también lo que no cupo en `horizonDays` (nunca se descarta en silencio).
 */
export function planSchedule(items: PlanItem[], accounts: PlanAccount[], o: { now: Date; startDay?: string; horizonDays?: number; jitterMin?: number; leadMin?: number; seed?: number }):
  { placed: Placed[]; unplaced: string[]; skipped: { account: string; reason: "paused" }[] } {
  const horizon = o.horizonDays ?? 30, jitter = o.jitterMin ?? 12, lead = o.leadMin ?? 10, rnd = rng(o.seed ?? 1);
  const active = accounts.filter((a) => !a.profile.paused), skipped = accounts.filter((a) => a.profile.paused).map((a) => ({ account: a.id, reason: "paused" as const }));
  const queues = new Map<string, string[]>(active.map((a) => [a.id, [] as string[]]));
  let rr = 0;
  for (const it of items) {
    const fixed = it.account && queues.has(it.account) ? it.account : null;
    if (it.account && !fixed) continue;            // cuenta fijada pero en pausa/inexistente: queda sin colocar
    const target = fixed ?? (active.length ? active[rr++ % active.length].id : null);
    if (target) queues.get(target)!.push(it.id);
  }
  const placed: Placed[] = [];
  const earliest = o.now.getTime() + lead * 60000;
  for (const a of active) {
    const q = queues.get(a.id)!; if (!q.length) continue;
    const tz = a.profile.tz || DEFAULT_PROFILE.tz, slots = (a.profile.slots?.filter(validSlot).length ? a.profile.slots.filter(validSlot) : DEFAULT_PROFILE.slots).slice().sort();
    const cap = Math.max(1, Math.min(30, a.profile.daily_cap ?? DEFAULT_PROFILE.daily_cap));
    const taken = new Set((a.already ?? []).map((x) => new Date(x).getTime()));
    const perDay = new Map<string, number>(); for (const t of taken) { const k = ymd(new Date(t)); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
    let day = o.startDay ?? ymd(o.now);
    for (let d = 0; d < horizon && q.length; d++, day = addDays(day, 1)) {
      let used = perDay.get(day) ?? 0;
      for (const s of slots) {
        if (!q.length || used >= cap) break;
        const base = zonedToUtc(`${day}T${s}`, tz).utc.getTime(), at = base + Math.round((rnd() * 2 - 1) * jitter) * 60000;
        if (at < earliest || taken.has(at)) continue;
        taken.add(at); used++; perDay.set(day, used);
        placed.push({ item: q.shift()!, account: a.id, at: new Date(at).toISOString(), localDay: day });
      }
    }
  }
  const done = new Set(placed.map((p) => p.item));
  return { placed: placed.sort((x, y) => x.at.localeCompare(y.at)), unplaced: items.map((i) => i.id).filter((id) => !done.has(id)), skipped };
}
