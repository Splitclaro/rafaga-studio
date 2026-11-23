// Línea de tiempo del Editor de vídeo avanzado (Ráfaga v3). Fuentes públicas: P1 (capas, medios propios, textos, exportación por tamaños),
// P3 (dividir, quitar silencios, ajustar entre clips), P7 (línea de tiempo multicapa, Full HD).
// Un solo modelo para la vista previa (`timelineAt`) y para el render (`timelineFfmpegArgs` + `timelineAss`): mismo orden, mismos cortes.

import { retimeWords, mergeCuts, type Cut } from "./cuts.ts";
import { groupWords, type Word } from "./subtitles.ts";

export const TL_ASPECTS = { "9:16": { width: 1080, height: 1920 }, "16:9": { width: 1920, height: 1080 }, "4:5": { width: 1080, height: 1350 }, "1:1": { width: 1080, height: 1080 } } as const;
export type TlAspect = keyof typeof TL_ASPECTS;
export type MediaRef = { kind: "source" | "media_item" | "song"; id: string; name?: string; media?: "video" | "image" | "audio"; duration?: number };
export type VideoItem = { id: string; src: MediaRef; at: number; in: number; out: number; volume: number; fit: "fill" | "fit" };
export type AudioItem = { id: string; src: MediaRef; at: number; in: number; out: number; volume: number };
export type TextItem = { id: string; at: number; dur: number; text: string; size: "S" | "M" | "L"; color: string; y: number };
export type Track = { id: string; kind: "video"; items: VideoItem[] } | { id: string; kind: "audio"; items: AudioItem[] } | { id: string; kind: "text"; items: TextItem[] };
export interface TimelineDoc { v: 1; tracks: Track[] }

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const id = (v: unknown, d: string) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : d);
const ref = (v: unknown): MediaRef | null => {
  const o = (v ?? {}) as Record<string, unknown>;
  if (!["source", "media_item", "song"].includes(o.kind as string) || typeof o.id !== "string" || !/^[0-9a-zA-Z_-]{1,64}$/.test(o.id)) return null;
  return { kind: o.kind as MediaRef["kind"], id: o.id, ...(typeof o.name === "string" ? { name: o.name.slice(0, 120) } : {}), ...(["video", "image", "audio"].includes(o.media as string) ? { media: o.media as MediaRef["media"] } : {}), ...(typeof o.duration === "number" && o.duration > 0 ? { duration: o.duration } : {}) };
};

export const emptyTimeline = (): TimelineDoc => ({ v: 1, tracks: [{ id: "v1", kind: "video", items: [] }, { id: "t1", kind: "text", items: [] }, { id: "a1", kind: "audio", items: [] }] });

/** Normaliza un documento recibido (de la base o del navegador): descarta lo inválido, ordena por tiempo y evita solapes dentro de una pista. */
export function validateTimeline(raw: unknown): TimelineDoc {
  const o = (raw ?? {}) as { tracks?: unknown[] };
  if (!Array.isArray(o.tracks) || !o.tracks.length) return emptyTimeline();
  const tracks: Track[] = [];
  for (const [ti, t0] of o.tracks.slice(0, 12).entries()) {
    const t = (t0 ?? {}) as { id?: unknown; kind?: unknown; items?: unknown[] }, tid = id(t.id, `t${ti}`), items = Array.isArray(t.items) ? t.items.slice(0, 500) : [];
    if (t.kind === "video" || t.kind === "audio") {
      const list = items.map((x, i) => { const it = (x ?? {}) as Record<string, unknown>, s = ref(it.src); if (!s) return null;
        const inn = num(it.in, 0, 36000, 0), out = num(it.out, inn + 0.04, 36000, inn + 1);
        const base = { id: id(it.id, `${tid}-${i}`), src: s, at: r3(num(it.at, 0, 36000, 0)), in: r3(inn), out: r3(out), volume: num(it.volume, 0, 2, 1) };
        return t.kind === "video" ? { ...base, fit: it.fit === "fit" ? "fit" as const : "fill" as const } : base; }).filter((x): x is VideoItem => !!x);
      tracks.push({ id: tid, kind: t.kind, items: noOverlap(list) } as Track);
    } else if (t.kind === "text") {
      const list = items.map((x, i) => { const it = (x ?? {}) as Record<string, unknown>; if (typeof it.text !== "string" || !it.text.trim()) return null;
        return { id: id(it.id, `${tid}-${i}`), at: r3(num(it.at, 0, 36000, 0)), dur: r3(num(it.dur, 0.1, 36000, 2)), text: it.text.slice(0, 300), size: (["S", "M", "L"].includes(it.size as string) ? it.size : "M") as TextItem["size"],
          color: typeof it.color === "string" && /^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color.toUpperCase() : "#FFFFFF", y: num(it.y, 0.05, 0.95, 0.8) }; }).filter((x): x is TextItem => !!x)
        .sort((a, b) => a.at - b.at);
      tracks.push({ id: tid, kind: "text", items: list });
    }
  }
  return { v: 1, tracks: tracks.length ? tracks : emptyTimeline().tracks };
}

const len = (x: { in: number; out: number }) => x.out - x.in;
function noOverlap<T extends { at: number; in: number; out: number }>(items: T[]): T[] {
  const s = [...items].sort((a, b) => a.at - b.at); let end = 0;
  return s.map((x) => { const at = Math.max(x.at, end); end = at + len(x); return { ...x, at: r3(at) }; });
}

export function timelineDuration(d: TimelineDoc): number {
  let e = 0;
  for (const t of d.tracks) for (const it of t.items as (VideoItem | AudioItem | TextItem)[]) e = Math.max(e, it.at + ("dur" in it ? it.dur : len(it)));
  return r3(e);
}

/** Añade un medio al final de su pista (o en `at`). */
export function addMedia(d: TimelineDoc, trackKind: "video" | "audio", src: MediaRef, o: { at?: number; in?: number; out?: number; itemId: string }): TimelineDoc {
  const tr = d.tracks.find((t) => t.kind === trackKind); if (!tr) return d;
  const end = Math.max(0, ...(tr.items as (VideoItem | AudioItem)[]).map((x) => x.at + len(x)));
  const inn = o.in ?? 0, out = o.out ?? inn + (src.duration ?? 5);
  const item = trackKind === "video" ? { id: o.itemId, src, at: o.at ?? end, in: inn, out, volume: 1, fit: "fill" as const } : { id: o.itemId, src, at: o.at ?? end, in: inn, out, volume: 1 };
  return validateTimeline({ ...d, tracks: d.tracks.map((t) => (t === tr ? { ...t, items: [...t.items, item] } : t)) });
}

export function addText(d: TimelineDoc, o: { at: number; dur: number; text: string; itemId: string }): TimelineDoc {
  return validateTimeline({ ...d, tracks: d.tracks.map((t) => (t.kind === "text" ? { ...t, items: [...t.items, { id: o.itemId, at: o.at, dur: o.dur, text: o.text, size: "M", color: "#FFFFFF", y: 0.8 }] } : t)) });
}

/** Divide el elemento que pasa por `t` (segundos de la línea de tiempo) en dos. */
export function splitAt(d: TimelineDoc, itemId: string, t: number, newId: string): TimelineDoc {
  return { ...d, tracks: d.tracks.map((tr) => {
    if (tr.kind === "text") return { ...tr, items: tr.items.flatMap((x) => (x.id !== itemId || t <= x.at || t >= x.at + x.dur ? [x] : [{ ...x, dur: r3(t - x.at) }, { ...x, id: newId, at: r3(t), dur: r3(x.at + x.dur - t) }])) };
    const items = (tr.items as (VideoItem | AudioItem)[]).flatMap((x) => { if (x.id !== itemId || t <= x.at || t >= x.at + len(x)) return [x]; const cut = r3(x.in + (t - x.at)); return [{ ...x, out: cut }, { ...x, id: newId, at: r3(t), in: cut }]; });
    return { ...tr, items } as Track;
  }) };
}

/** Quita un elemento; con `close` cierra el hueco moviendo los siguientes de esa pista. */
export function removeItem(d: TimelineDoc, itemId: string, close = true): TimelineDoc {
  return { ...d, tracks: d.tracks.map((tr) => {
    const gone = (tr.items as (VideoItem | AudioItem | TextItem)[]).find((x) => x.id === itemId); if (!gone) return tr;
    const g = "dur" in gone ? gone.dur : len(gone), rest = (tr.items as (VideoItem | AudioItem | TextItem)[]).filter((x) => x.id !== itemId);
    return { ...tr, items: close ? rest.map((x) => (x.at > gone.at ? { ...x, at: r3(x.at - g) } : x)) : rest } as Track;
  }) };
}

/** Recorta inicio o fin de un vídeo/audio (en segundos de la fuente). */
export function trimItem(d: TimelineDoc, itemId: string, p: { in?: number; out?: number }): TimelineDoc {
  return validateTimeline({ ...d, tracks: d.tracks.map((tr) => (tr.kind === "text" ? tr : { ...tr, items: (tr.items as (VideoItem | AudioItem)[]).map((x) => (x.id === itemId ? { ...x, in: p.in ?? x.in, out: p.out ?? x.out } : x)) })) });
}

/** Mueve un elemento a otra posición dentro de su pista de vídeo (orden de planos), recolocándolos uno tras otro. */
export function reorder(d: TimelineDoc, itemId: string, toIndex: number): TimelineDoc {
  return { ...d, tracks: d.tracks.map((tr) => {
    if (tr.kind !== "video") return tr;
    const list = [...tr.items].sort((a, b) => a.at - b.at), i = list.findIndex((x) => x.id === itemId); if (i < 0) return tr;
    const [x] = list.splice(i, 1); list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, x);
    let at = 0; return { ...tr, items: list.map((y) => { const z = { ...y, at: r3(at) }; at += len(y); return z; }) };
  }) };
}

export function updateText(d: TimelineDoc, itemId: string, p: Partial<Omit<TextItem, "id">>): TimelineDoc {
  return validateTimeline({ ...d, tracks: d.tracks.map((tr) => (tr.kind === "text" ? { ...tr, items: tr.items.map((x) => (x.id === itemId ? { ...x, ...p } : x)) } : tr)) });
}

/** Lo que se ve y se oye en el instante `t`: plano de vídeo de la pista superior con contenido, su tiempo de fuente y los textos activos. */
export function timelineAt(d: TimelineDoc, t: number): { video: (VideoItem & { srcTime: number }) | null; texts: TextItem[]; audio: (AudioItem & { srcTime: number })[] } {
  let video: (VideoItem & { srcTime: number }) | null = null;
  for (const tr of d.tracks) if (tr.kind === "video" && !video) { const x = tr.items.find((y) => t >= y.at && t < y.at + len(y)); if (x) video = { ...x, srcTime: r3(x.in + t - x.at) }; }
  const texts = d.tracks.flatMap((tr) => (tr.kind === "text" ? tr.items.filter((x) => t >= x.at && t < x.at + x.dur) : []));
  const audio = d.tracks.flatMap((tr) => (tr.kind === "audio" ? tr.items.filter((x) => t >= x.at && t < x.at + len(x)).map((x) => ({ ...x, srcTime: r3(x.in + t - x.at) })) : []));
  return { video, texts, audio };
}

// ── Render ──
const assTime = (s: number) => { const cs = Math.max(0, Math.round(s * 100)), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
export const TEXT_SIZE = { S: 0.035, M: 0.05, L: 0.07 } as const;

/** Textos de la línea de tiempo como ASS (posición explícita: la vista previa usa los mismos valores). */
export function timelineAss(d: TimelineDoc, aspect: TlAspect, font = "Inter"): string {
  const { width: W, height: H } = TL_ASPECTS[aspect];
  const lines = d.tracks.flatMap((tr) => (tr.kind === "text" ? tr.items : [])).map((x) => {
    const fs = Math.round(TEXT_SIZE[x.size] * H), y = Math.round(x.y * H);
    return `Dialogue: 0,${assTime(x.at)},${assTime(x.at + x.dur)},T,,0,0,0,,{\\an5\\pos(${Math.round(W / 2)},${y})\\fs${fs}\\c${assColor(x.color)}}${x.text.replace(/\n/g, "\\N").replace(/[{}]/g, "")}`;
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: T,${font},60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,0,5,40,40,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join("\n")}\n`;
}

export interface TimelineIo { files: Record<string, string>; hasAudio: Record<string, boolean>; ass: string; fontsDir: string; out: string; fps?: number; scale?: number }
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Argumentos de ffmpeg para exportar la línea de tiempo: pista de vídeo principal en orden con huecos en negro, audio de los planos + pista de audio, textos ASS.
 * `files[src.id]` es la ruta local de cada medio; `hasAudio[src.id]` dice si trae sonido (las imágenes y los vídeos mudos no aportan audio). */
export function timelineFfmpegArgs(d: TimelineDoc, aspect: TlAspect, io: TimelineIo): string[] {
  const k = io.scale ?? 1, W = Math.round((TL_ASPECTS[aspect].width * k) / 2) * 2, H = Math.round((TL_ASPECTS[aspect].height * k) / 2) * 2, fps = io.fps ?? 30, D = Math.max(0.1, timelineDuration(d));
  const vt = d.tracks.find((t) => t.kind === "video") as { items: VideoItem[] } | undefined, at = d.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.items as AudioItem[]);
  const a = ["-y", "-v", "error"], chains: string[] = [], segs: string[] = [], mixes: string[] = []; let n = 0, t = 0;
  for (const x of [...(vt?.items ?? [])].sort((p, q) => p.at - q.at)) {
    if (x.at > t + 0.001) { chains.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${r3(x.at - t)},format=yuv420p,setsar=1[g${segs.length}]`); segs.push(`[g${segs.length}]`); }
    const f = io.files[x.src.id]; if (!f) throw new Error(`missing_media:${x.src.id}`);
    const img = x.src.media === "image";
    a.push(...(img ? ["-loop", "1", "-t", String(r3(len(x)))] : ["-ss", String(x.in), "-t", String(r3(len(x)))]), "-i", f);
    const fit = x.fit === "fit" ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black` : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    chains.push(`[${n}:v]${fit},setsar=1,fps=${fps},format=yuv420p,trim=duration=${r3(len(x))},setpts=PTS-STARTPTS[s${segs.length}]`); segs.push(`[s${segs.length}]`);
    if (!img && io.hasAudio[x.src.id] !== false) { chains.push(`[${n}:a]atrim=duration=${r3(len(x))},asetpts=PTS-STARTPTS,volume=${x.volume},adelay=${Math.round(x.at * 1000)}:all=1[m${mixes.length}]`); mixes.push(`[m${mixes.length}]`); }
    n++; t = x.at + len(x);
  }
  if (t < D - 0.001) { chains.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${r3(D - t)},format=yuv420p,setsar=1[g${segs.length}]`); segs.push(`[g${segs.length}]`); }
  for (const x of at) { const f = io.files[x.src.id]; if (!f) throw new Error(`missing_media:${x.src.id}`); a.push("-ss", String(x.in), "-t", String(r3(len(x))), "-i", f);
    chains.push(`[${n}:a]atrim=duration=${r3(len(x))},asetpts=PTS-STARTPTS,volume=${x.volume},adelay=${Math.round(x.at * 1000)}:all=1[m${mixes.length}]`); mixes.push(`[m${mixes.length}]`); n++; }
  chains.push(`${segs.join("")}concat=n=${segs.length}:v=1:a=0[cat]`);
  chains.push(`[cat]subtitles=${esc(io.ass)}:fontsdir=${esc(io.fontsDir)},format=yuv420p[v]`);
  chains.push(mixes.length ? `${mixes.join("")}amix=inputs=${mixes.length}:normalize=0:duration=longest,apad=whole_dur=${D},atrim=duration=${D}[aout]` : `anullsrc=r=48000:cl=stereo,atrim=duration=${D}[aout]`);
  return [...a, "-filter_complex", chains.join(";"), "-map", "[v]", "-map", "[aout]", "-t", String(D), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(fps), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", io.out];
}

// ── Desde Autoclip ──
export interface ClipSpec { sourceId: string; fragments: { start: number; end: number }[]; cuts?: Cut[]; words: Word[]; aspect: TlAspect; title?: string; subtitles?: boolean; volume?: number; fit?: "fill" | "fit" }

/** Convierte un clip de Autoclip en un documento del editor avanzado conservando origen, intervalo, cortes, subtítulos y volumen:
 * un plano de vídeo por tramo no cortado (el audio va en el propio plano) y un texto por grupo de subtítulos, retemporizado con los cortes.
 * `words` son relativas al clip (como en CompositionV2.words), `cuts` también. */
export function clipToTimeline(c: ClipSpec): TimelineDoc {
  const doc = emptyTimeline(), frag = c.fragments.filter((f) => f.end > f.start);
  const total = frag.reduce((t, f) => t + (f.end - f.start), 0), cuts = mergeCuts(c.cuts ?? [], total);
  const kept: { a: number; b: number }[] = []; let pos = 0;
  for (const k of [...cuts, { s: total, e: total }]) { if (k.s - pos > 0.02) kept.push({ a: pos, b: k.s }); pos = k.e; }
  const items: VideoItem[] = []; let at = 0;
  for (const seg of kept) {
    let clipT = 0;
    for (const f of frag) {
      const fl = f.end - f.start, a = Math.max(seg.a, clipT), b = Math.min(seg.b, clipT + fl);
      if (b - a > 0.02) { items.push({ id: `c${items.length + 1}`, src: { kind: "source", id: c.sourceId, media: "video", name: c.title }, at: r3(at), in: r3(f.start + (a - clipT)), out: r3(f.start + (b - clipT)), volume: c.volume ?? 1, fit: c.fit ?? "fill" }); at += b - a; }
      clipT += fl;
    }
  }
  const texts: TextItem[] = c.subtitles === false ? [] : groupWords(retimeWords(c.words, cuts), { maxLines: 2, maxCharsPerLine: 28, maxWordsPerGroup: 5 })
    .map((g, i) => ({ id: `s${i + 1}`, at: r3(g.start), dur: r3(Math.max(0.2, g.end - g.start)), text: g.words.map((w) => w.text).join(" "), size: "M" as const, color: "#FFFFFF", y: 0.78 }));
  return validateTimeline({ ...doc, tracks: doc.tracks.map((t) => (t.kind === "video" ? { ...t, items } : t.kind === "text" ? { ...t, items: texts } : t)) });
}

/** Une varios proyectos uno tras otro (p. ej. varios clips de Autoclip): cada pista se desplaza al final de lo anterior; los ids se prefijan para no chocar. */
export function concatTimelines(docs: TimelineDoc[]): TimelineDoc {
  let off = 0; const out = emptyTimeline();
  docs.forEach((d, n) => {
    const dur = timelineDuration(d);
    for (const tr of d.tracks) {
      const dest = out.tracks.find((t) => t.kind === tr.kind); if (!dest) continue;
      (dest.items as (VideoItem | AudioItem | TextItem)[]).push(...(tr.items as (VideoItem | AudioItem | TextItem)[]).map((x) => ({ ...x, id: `k${n + 1}-${x.id}`, at: r3(x.at + off) })));
    }
    off += dur;
  });
  return validateTimeline(out);
}
