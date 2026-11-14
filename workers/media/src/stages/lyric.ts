// Etapas de Lyric Studio v2. Paso 2: `song_validate` (canción subida con el cargador compartido → audio de trabajo + sonoridad).
// `lyric_sync` y `media_split` se añaden en sus pasos; mientras no estén, `loadStage` responde `not_implemented`.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqTranscribe, AiError } from "@rafaga/providers";
import { DEMO_SONG, DEMO_AUDIO_EXPR, parseLyrics, alignWithAnchors, transcriptionProposal, toSrtLyrics, toVttLyrics, toLrc, toLrcEnhanced, toAssKaraoke, toTxtLyrics, type AsrWord, type SyncWord } from "@rafaga/lyrics";
import { GroqLimiter, limitsFromEnv } from "../groqlimits.ts";
import { randomUUID } from "node:crypto";
import { mezzaninePath } from "./analysis.ts";
import { lyricAss, lyricRenderArgs, lyricFrameSize, validateLyricComposition } from "@rafaga/composition";
import { StageError, type StageCtx, type StageImpl, type StageResult } from "./registry.ts";

export const SONG_MAX_BYTES = 62914560, SONG_MAX_S = 600;
export type AudioKind = "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg";

/** Tipo de audio por la cabecera (no por la extensión ni el mime declarado). */
export function audioKind(h: Uint8Array): AudioKind | null {
  const s = (a: number, b: number) => String.fromCharCode(...h.subarray(a, b));
  if (h.length < 4) return null;
  if (s(0, 4) === "fLaC") return "flac";
  if (s(0, 4) === "OggS") return "ogg";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "wav";
  if (s(4, 8) === "ftyp") return "m4a";
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return "aac";             // ADTS: 0xFFF1 / 0xFFF9 (capa 00)
  if (s(0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return "mp3";
  return null;
}

interface SongRef { song_id: string; workspace_id: string; source_id: string; key: string; mime: string; bytes: number; demo: boolean; title: string; project_id: string | null }
interface Probe { streams?: { codec_type: string; codec_name?: string; sample_rate?: string; channels?: number; disposition?: { attached_pic?: number } }[]; format?: { duration?: string } }

const probe = (file: string): Probe | null => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout) as Probe; } catch { return null; }
};
/** Sonoridad integrada (EBU R128) en LUFS; null si es silencio o no se pudo medir. */
export function integratedLufs(file: string): number | null {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
  const m = [...(r.stderr ?? "").matchAll(/I:\s+(-?[\d.]+|-inf)\s+LUFS/g)].at(-1);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

const songValidate: StageImpl = {
  inputs: (_c, row) => ({ stage: "song_validate", source: row.params.source_id, v: 1 }),
  async run(ctx: StageCtx, row) {
    const source = String(row.params.source_id);
    const song = await ctx.rpc<SongRef | null>("song_by_source", { p_source: source });
    if (!song) throw new StageError("not_found", "La canción no existe");
    const fail = async (code: string, msg: string): Promise<never> => {
      await ctx.rpc("finish_song_validate", { p_song: song.song_id, p_status: "failed", p_bytes: null, p_duration_ms: null, p_sample_rate: null, p_channels: null, p_lufs: null, p_codec: null, p_lyrics: null, p_error: code });
      throw new StageError(code, msg);
    };
    const demo = row.params.demo === true;
    if (!demo && Number(song.bytes) > SONG_MAX_BYTES) return fail("too_large", "La canción supera los 60 MiB.");          // antes de descargar nada
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const dir = join(ctx.tmpDir ?? "/tmp/rafaga", `song-${source}`); mkdirSync(dir, { recursive: true });
    const file = join(dir, "original"), opus = join(dir, "audio.opus");
    try {
      if (demo) {                                                           // demo: el audio se sintetiza (sin binarios en el repositorio) y se sube a la clave del original
        const m4a = join(dir, "demo.m4a"), g = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", DEMO_AUDIO_EXPR, "-c:a", "aac", "-b:a", "96k", m4a], { encoding: "utf8" });
        if (g.status !== 0) throw new StageError("demo_failed", `ffmpeg: ${g.stderr?.slice(-200)}`);
        writeFileSync(file, readFileSync(m4a)); rmSync(m4a, { force: true }); await ctx.r2.upload(song.key, file, "audio/mp4");
      } else await ctx.r2.download(song.key, file);
      if (statSync(file).size > SONG_MAX_BYTES) return fail("too_large", "La canción supera los 60 MiB.");
      if (!audioKind(readFileSync(file).subarray(0, 64))) return fail("unsupported_file", "El archivo no es un audio compatible (MP3, WAV, M4A, AAC, FLAC u OGG).");
      const p = probe(file);
      if (!p) return fail("unsupported_file", "No se pudo leer el archivo: está dañado o no es audio.");
      if (p.streams?.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic)) return fail("unsupported_file", "El archivo tiene vídeo: sube solo el audio de la canción.");
      const a = p.streams?.find((s) => s.codec_type === "audio");
      if (!a) return fail("unsupported_file", "El archivo no tiene pista de audio.");
      const dur = Number(p.format?.duration ?? 0);
      if (dur > SONG_MAX_S) return fail("too_long", "La canción dura más de 10 minutos.");
      const lufs = integratedLufs(file);
      const enc = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", opus], { encoding: "utf8" });
      if (enc.status !== 0) return fail("unsupported_file", `No se pudo preparar el audio: ${enc.stderr?.slice(-120)}`);
      const key = `${song.workspace_id}/${source}/audio.opus`;
      await ctx.r2.upload(key, opus, "audio/ogg");
      await ctx.rpc("record_object", { p_ws: song.workspace_id, p_key: key, p_bytes: statSync(opus).size, p_kind: "audio", p_project: song.project_id, p_source: source, p_render: null, p_expires_at: null });
      await ctx.rpc("finish_song_validate", { p_song: song.song_id, p_status: "ready", p_bytes: demo ? statSync(file).size : null, p_duration_ms: Math.round(dur * 1000), p_sample_rate: Number(a.sample_rate ?? 0) || null,
        p_channels: a.channels ?? null, p_lufs: lufs, p_codec: a.codec_name ?? null, p_lyrics: demo ? DEMO_SONG.lyrics : null, p_error: null });
      if (demo) await ctx.rpc("save_song_alignment", { p_song: song.song_id, p_base_revision: null, p_words: DEMO_SONG.words, p_kind: "manual", p_flags: [] });   // revisión 1 manual, sin ASR
      return { output: { duration_s: +dur.toFixed(2), sample_rate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0, lufs, codec: a.codec_name ?? null, key } };
    } finally { rmSync(file, { force: true }); rmSync(opus, { force: true }); }
  },
};

// ───────── lyric_sync ─────────
interface SyncCtx { song_id: string; workspace_id: string; audio_key: string; lyrics_text: string | null; language: string | null; duration_ms: number | null; asr: AsrWord[] | null; latest: { revision: number; kind: string; words: SyncWord[] } | null }
export interface SyncDeps { transcribe?: (audio: Uint8Array, language: string) => Promise<{ words: AsrWord[] }>; limiter?: GroqLimiter }

const lyricSync: StageImpl = {
  async inputs(ctx, row) {
    const c = await ctx.rpc<SyncCtx | null>("lyric_sync_context", { p_song: row.params.song_id, p_model: row.params.model });
    // `latest_revision` hace que una re-sincronización tras editar a mano no se sirva de la caché del runner
    return { stage: "lyric_sync", song_id: row.params.song_id, mode: row.params.mode, model: row.params.model, hints: row.params.hints ?? [], latest_revision: c?.latest?.revision ?? null, lyrics: c?.lyrics_text ?? null, v: 1 };
  },
  async run(ctx, row) {
    const song = String(row.params.song_id), model = String(row.params.model ?? "whisper-large-v3-turbo"), mode = String(row.params.mode);
    const c = await ctx.rpc<SyncCtx | null>("lyric_sync_context", { p_song: song, p_model: model });
    if (!c) throw new StageError("not_found", "La canción no existe");
    if (mode === "align" && !(c.lyrics_text ?? "").trim()) throw new StageError("lyrics_required", "Falta la letra para alinear");
    const minutes = Math.max(0.01, Math.round(((c.duration_ms ?? 0) / 60000) * 100) / 100);
    let asr = c.asr, called = false;
    if (!asr) {
      if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
      const dir = join(ctx.tmpDir ?? "/tmp/rafaga", `sync-${song}`); mkdirSync(dir, { recursive: true });
      const file = join(dir, "audio.opus");
      try {
        await ctx.r2.download(c.audio_key, file);
        const audio = new Uint8Array(readFileSync(file)), deps = (ctx.deps ?? {}) as SyncDeps, env = ctx.env ?? process.env;
        const limiter = deps.limiter ?? new GroqLimiter(limitsFromEnv(env));
        await limiter.wait("stt", Math.ceil((c.duration_ms ?? 0) / 1000));
        try {
          const lang = c.language && c.language !== "auto" ? c.language : "auto";
          const r = deps.transcribe ? await deps.transcribe(audio, lang) : await groqTranscribe(audio, "audio/ogg", aiConfig(env), { language: lang, fetchImpl: ctx.fetch });
          asr = r.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
        } catch (e) {
          if (e instanceof AiError && e.status === 429) { limiter.on429(e.retryAfter ?? 20); throw new StageError("rate_limited", "Groq pidió esperar"); }
          throw e;
        }
        called = true;
        await ctx.rpc("save_song_asr", { p_song: song, p_model: model, p_words: asr });
      } finally { rmSync(file, { force: true }); }
    }
    let revision: number | null = null, extras = 0, instrumentals = 0;
    if (mode === "transcribe") {
      const p = transcriptionProposal(asr);                                   // no toca songs.lyrics_text
      revision = ((await ctx.rpc<{ revision: number }>("save_song_alignment", { p_song: song, p_base_revision: null, p_words: p.words, p_kind: "proposal", p_flags: [] })) ?? {}).revision ?? null;
    } else {
      const anchors = c.latest && c.latest.kind !== "proposal" ? c.latest.words : undefined;
      const r = alignWithAnchors(parseLyrics(c.lyrics_text ?? ""), asr, { anchors, hints: Array.isArray(row.params.hints) ? (row.params.hints as never) : undefined });
      extras = r.extras.length; instrumentals = r.instrumentals.length;
      const flags = [...r.extras.map((e) => ({ type: "extra", ...e })), ...r.instrumentals.map((i) => ({ type: "instrumental", ...i }))];
      revision = ((await ctx.rpc<{ revision: number }>("save_song_alignment", { p_song: song, p_base_revision: null, p_words: r.words, p_kind: "aligned", p_flags: flags })) ?? {}).revision ?? null;
    }
    return { output: { revision, asr_called: called, extras, instrumentals }, units_actual: called ? minutes : 0 };
  },
};

// ───────── media_split: «Crear desde vídeo» (proponer segmentos en cambios de escena y cortarlos sin audio) ─────────
export interface Segment { start_ms: number; end_ms: number }
/** Segmentos de duración ≈ `target` entre `min` y `max`, que empiezan y terminan en un corte de escena o en un extremo del intervalo. */
export function planSegments(cuts: number[], startS: number, endS: number, target: number, min = 1.5, max = target * 1.5): Segment[] {
  const marks = [startS, ...cuts.filter((c) => c > startS + 1e-6 && c < endS - 1e-6), endS].sort((a, b) => a - b), out: Segment[] = [];
  let i = 0;
  while (i < marks.length - 1 && out.length < 60) {
    let best = -1;
    for (let j = i + 1; j < marks.length; j++) { const d = marks[j] - marks[i]; if (d > max + 1e-6) break; if (d >= min - 1e-6 && (best < 0 || Math.abs(d - target) < Math.abs(marks[best] - marks[i] - target) - 1e-9)) best = j; }
    if (best < 0) {                                                       // sin corte en [min, max]: se corta a la duración objetivo dentro del plano
      const e = Math.min(marks[i] + target, endS); if (e - marks[i] < min - 1e-6) break;
      out.push({ start_ms: Math.round(marks[i] * 1000), end_ms: Math.round(e * 1000) }); marks.splice(i + 1, 0, e); i++; continue;
    }
    out.push({ start_ms: Math.round(marks[i] * 1000), end_ms: Math.round(marks[best] * 1000) }); i = best;
  }
  return out;
}
const sceneCuts = (file: string, startS: number, endS: number): number[] => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(startS), "-t", String(endS - startS), "-i", file, "-an", "-vf", "scdet=threshold=10,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  return [...(r.stdout + r.stderr).matchAll(/lavfi\.scd\.time=([\d.]+)/g)].map((m) => +m[1] + startS);
};
const mediaProbe = (file: string) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}") as { streams?: { codec_type: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === "video");
  return { duration: Number(j.format?.duration ?? 0), width: v?.width ?? 0, height: v?.height ?? 0, hasAudio: !!j.streams?.some((s) => s.codec_type === "audio") };
};

const mediaSplit: StageImpl = {
  inputs: (_c, row) => ({ stage: "media_split", params: row.params, v: 1 }),
  async run(ctx, row) {
    const p = row.params as { mode: "propose" | "cut"; source_id: string; collection_id: string; length_s?: number; min_s?: number; max_s?: number; start_ms?: number; end_ms?: number; segments?: Segment[]; cut_mode?: "rapido" | "exacto" };
    const { file, info } = await mezzaninePath(ctx, p.source_id);
    if (p.mode === "propose") {
      const a = (p.start_ms ?? 0) / 1000, b = (p.end_ms ?? info.duration_ms ?? 0) / 1000, length = Number(p.length_s ?? 5);
      const segments = planSegments(sceneCuts(file, a, b), a, b, length, p.min_s ?? 1.5, p.max_s ?? length * 1.5);
      return { output: { segments, count: segments.length } };
    }
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const c = await ctx.rpc<{ workspace_id: string; created_by: string | null } | null>("media_split_context", { p_source: p.source_id });
    if (!c) throw new StageError("not_found", "La fuente no existe");
    const dir = join(ctx.tmpDir ?? "/tmp/rafaga", `split-${p.source_id}`); mkdirSync(dir, { recursive: true });
    const ids: string[] = [];
    for (const seg of p.segments ?? []) {
      const id = randomUUID(), out = join(dir, `${id}.mp4`), len = (seg.end_ms - seg.start_ms) / 1000;
      const args = p.cut_mode === "exacto"
        ? ["-y", "-v", "error", "-ss", String(seg.start_ms / 1000), "-i", file, "-t", String(len), "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", out]
        : ["-y", "-v", "error", "-ss", String(seg.start_ms / 1000), "-i", file, "-t", String(len), "-map", "0:v:0", "-c", "copy", "-an", "-movflags", "+faststart", out];
      const r = spawnSync("ffmpeg", args, { encoding: "utf8" }); if (r.status !== 0) throw new StageError("cut_failed", `ffmpeg: ${r.stderr?.slice(-200)}`);
      const m = mediaProbe(out), key = `${c.workspace_id}/media/${id}.mp4`;
      if (m.hasAudio) throw new StageError("cut_failed", "El recorte conserva audio");
      await ctx.r2.upload(key, out, "video/mp4");
      await ctx.rpc("add_split_item", { p_collection: p.collection_id, p_source: p.source_id, p_item: id, p_start_ms: seg.start_ms, p_end_ms: seg.end_ms, p_cut_mode: p.cut_mode, p_key: key, p_bytes: statSync(out).size, p_duration_ms: Math.round(m.duration * 1000), p_width: m.width, p_height: m.height, p_created_by: c.created_by });
      rmSync(out, { force: true }); ids.push(id);
    }
    return { output: { items: ids.length, item_ids: ids } };
  },
};

// ───────── Render de variantes de letra (lo llama `render` de export.ts cuando la composición es de tipo lyric) ─────────
export interface LyricItem { render_id: string; workspace_id: string; clip_id: string; version: number; kind: string; composition: unknown; source_id: string; title: string }
/** Hash perceptivo (aHash 8×8 en gris → 16 hex) del primer fotograma. */
export function firstFrameHash(file: string): string {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=8:8:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
  const px = r.stdout; if (r.status !== 0 || px.length < 64) throw new Error("No se pudo calcular el hash del primer fotograma");
  const mean = px.reduce((a, b) => a + b, 0) / 64; let hex = "";
  for (let i = 0; i < 64; i += 4) hex += ([0, 1, 2, 3].reduce((n, k) => (n << 1) | (px[i + k] > mean ? 1 : 0), 0)).toString(16);
  return hex;
}
export async function renderLyricItem(ctx: StageCtx, it: LyricItem, o: { key: string; dir: string; fail: (code: string, msg: string) => Promise<never> }): Promise<StageResult> {
  if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
  const c = validateLyricComposition(it.composition), r2 = ctx.r2;
  if (it.kind !== "mp4") {                                                  // formatos de texto: palabras de la composición relativas al tramo
    const words: SyncWord[] = c.words.filter((w) => w.end > c.range.start && w.start < c.range.end).map((w) => ({ text: w.text, start: Math.max(0, +(w.start - c.range.start).toFixed(3)), end: Math.min(c.duration, +(w.end - c.range.start).toFixed(3)), line: w.line, occurrence: 1, manual: false, confidence: 1, origin: "manual", flags: [] }));
    const make: Record<string, () => string> = { srt: () => toSrtLyrics(words), vtt: () => toVttLyrics(words), lrc: () => toLrc(words, { title: it.title }), lrc_word: () => toLrcEnhanced(words, { title: it.title }), ass: () => toAssKaraoke(words), txt: () => toTxtLyrics(words) };
    const MIME: Record<string, string> = { srt: "application/x-subrip", vtt: "text/vtt", lrc: "text/plain", lrc_word: "text/plain", ass: "text/x-ssa", txt: "text/plain" };
    if (!make[it.kind]) return o.fail("render_failed", `Formato no admitido para letra: ${it.kind}`);
    if (!words.length) return o.fail("render_failed", "La pieza no tiene letra en ese tramo");
    const file = join(o.dir, `lyrics.${it.kind}`); writeFileSync(file, make[it.kind]());
    await r2.upload(o.key, file, MIME[it.kind]);
    await ctx.rpc("finish_render", { p_render: it.render_id, p_status: "ready", p_path: o.key, p_probe: null, p_bytes: statSync(file).size, p_duration_ms: Math.round(c.duration * 1000), p_width: null, p_height: null, p_error: null });
    return { output: { key: o.key, kind: it.kind, words: words.length } };
  }
  const song = await ctx.rpc<{ key: string } | null>("song_by_source", { p_source: it.source_id });
  if (!song) return o.fail("render_failed", "La canción de esta pieza ya no existe");
  const get = async (key: string, name: string) => { const p = join(o.dir, name); await r2.download(key, p); return p; };
  const audio = await get(song.key, "song"), items: string[] = [];
  for (const [i, b] of c.background.items.entries()) items.push(await get(b.ref, `bg${i}`));          // un fondo que falta rompe SOLO esta variante
  const coverFront = c.cover?.front ? await get(c.cover.front, "cover-front") : undefined, coverBack = c.cover?.back ? await get(c.cover.back, "cover-back") : undefined;
  const ass = join(o.dir, "lyric.ass"), out = join(o.dir, "out.mp4"), fontsDir = (ctx.env ?? process.env).LYRIC_FONTS_DIR ?? new URL("../../../../apps/web/public/fonts/caption", import.meta.url).pathname;
  writeFileSync(ass, lyricAss(c));
  const r = spawnSync("ffmpeg", lyricRenderArgs(c, { audio, items, coverFront, coverBack, ass, fontsDir, out }), { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) return o.fail("render_failed", `ffmpeg: ${(r.stderr ?? "").slice(-300)}`);
  const pr = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,pix_fmt:format=duration", "-of", "json", out], { encoding: "utf8" });
  const j = JSON.parse(pr.stdout || "{}") as { streams?: { width: number; height: number; codec_name: string; pix_fmt: string }[]; format?: { duration?: string } }, v = j.streams?.[0], size = lyricFrameSize(c);
  if (!v || v.codec_name !== "h264" || v.pix_fmt !== "yuv420p" || v.width !== size.width || v.height !== size.height) return o.fail("render_failed", "El MP4 resultante no es H.264/yuv420p del tamaño esperado");
  const ahash = firstFrameHash(out), dur = Number(j.format?.duration ?? c.duration);
  await r2.upload(o.key, out, "video/mp4");
  await ctx.rpc("finish_render", { p_render: it.render_id, p_status: "ready", p_path: o.key, p_probe: { codec: v.codec_name, pix_fmt: v.pix_fmt, width: v.width, height: v.height, duration_s: dur, ahash }, p_bytes: statSync(out).size, p_duration_ms: Math.round(dur * 1000), p_width: v.width, p_height: v.height, p_error: null });
  return { output: { key: o.key, kind: "mp4", width: v.width, height: v.height, ahash } };
}

export const STAGE_IMPLS: Record<string, StageImpl> = { song_validate: songValidate, lyric_sync: lyricSync, media_split: mediaSplit };
