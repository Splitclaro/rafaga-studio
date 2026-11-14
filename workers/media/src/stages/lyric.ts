// Etapas de Lyric Studio v2. Paso 2: `song_validate` (canción subida con el cargador compartido → audio de trabajo + sonoridad).
// `lyric_sync` y `media_split` se añaden en sus pasos; mientras no estén, `loadStage` responde `not_implemented`.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqTranscribe, AiError } from "@rafaga/providers";
import { parseLyrics, alignWithAnchors, transcriptionProposal, type AsrWord, type SyncWord } from "@rafaga/lyrics";
import { GroqLimiter, limitsFromEnv } from "../groqlimits.ts";
import { StageError, type StageCtx, type StageImpl } from "./registry.ts";

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
    if (row.params.demo) throw new StageError("not_implemented", "La demo se prepara en el paso 17");
    if (Number(song.bytes) > SONG_MAX_BYTES) return fail("too_large", "La canción supera los 60 MiB.");          // antes de descargar nada
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const dir = join(ctx.tmpDir ?? "/tmp/rafaga", `song-${source}`); mkdirSync(dir, { recursive: true });
    const file = join(dir, "original"), opus = join(dir, "audio.opus");
    try {
      await ctx.r2.download(song.key, file);
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
      await ctx.rpc("finish_song_validate", { p_song: song.song_id, p_status: "ready", p_bytes: null, p_duration_ms: Math.round(dur * 1000), p_sample_rate: Number(a.sample_rate ?? 0) || null,
        p_channels: a.channels ?? null, p_lufs: lufs, p_codec: a.codec_name ?? null, p_lyrics: null, p_error: null });
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

export const STAGE_IMPLS: Record<string, StageImpl> = { song_validate: songValidate, lyric_sync: lyricSync };
