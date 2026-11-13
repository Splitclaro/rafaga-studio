// Etapas de análisis: prepare (audio) · transcribe (trozos en paralelo bajo el limitador de Groq) · scenes (escenas + energía) ·
// speakers (Deepgram o, sin él, hablante activo visual marcado «necesita revisión»). `proxy` vive en validate.ts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqTranscribe, AiError, transcribe as deepgramTranscribe } from "@rafaga/providers";
import type { TWord } from "@rafaga/selection";
import { StageError, type StageCtx, type StageImpl, type StageRow } from "./registry.ts";
import { GroqLimiter, limitsFromEnv } from "../groqlimits.ts";

export const CHUNK_S = 600, OVERLAP_S = 2;
export interface Chunk { index: number; start: number; end: number }

/** Trozos de ≤600 s que se solapan 2 s y cubren [from, to] sin huecos. */
export function planChunks(total: number, from = 0, chunk = CHUNK_S, overlap = OVERLAP_S): Chunk[] {
  const out: Chunk[] = []; const stride = chunk - overlap;
  for (let s = from, i = 0; s < total; s += stride, i++) { out.push({ index: i, start: s, end: Math.min(total, s + chunk) }); if (s + chunk >= total) break; }
  return out;
}

/** Une los trozos (palabras con tiempos relativos al trozo → globales). En el solape manda el trozo anterior hasta su mitad. */
export function mergeChunks(parts: { chunk: Chunk; words: TWord[] }[], overlap = OVERLAP_S): TWord[] {
  const out: TWord[] = [];
  const sorted = [...parts].sort((a, b) => a.chunk.index - b.chunk.index);
  sorted.forEach((p, i) => {
    const cutIn = i === 0 ? -Infinity : p.chunk.start + overlap / 2;                       // lo anterior al punto medio del solape ya lo dio el trozo previo
    const cutOut = i === sorted.length - 1 ? Infinity : p.chunk.end - overlap / 2;
    for (const w of p.words) {
      const g = { ...w, start: +(w.start + p.chunk.start).toFixed(3), end: +(w.end + p.chunk.start).toFixed(3) };
      if (g.start >= cutIn && g.start < cutOut) out.push(g);
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

const dirOf = (ctx: StageCtx, source: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", source); mkdirSync(d, { recursive: true }); return d; };
interface SourceInfo { id: string; workspace_id: string; storage_path: string; bytes: number; duration_ms: number | null; has_audio: boolean | null }
export async function mezzaninePath(ctx: StageCtx, source: string): Promise<{ file: string; info: SourceInfo }> {
  const info = await ctx.rpc<SourceInfo>("source_info", { p_source: source });
  if (!info) throw new StageError("not_found", "La fuente no existe");
  const file = join(dirOf(ctx, source), "mezzanine.mp4");
  if (!existsSync(file)) { if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker"); await ctx.r2.download(info.storage_path, file); }
  return { file, info };
}
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const range = (row: StageRow) => ({ start: Number(row.params.range_start_s ?? (row.params.range_start_ms != null ? Number(row.params.range_start_ms) / 1000 : 0)), end: row.params.range_end_s != null ? Number(row.params.range_end_s) : row.params.range_end_ms != null ? Number(row.params.range_end_ms) / 1000 : null });

const prepare: StageImpl = {
  inputs: (_c, row) => ({ stage: "prepare", source: row.params.source_id, range: range(row) }),
  async run(ctx, row) {
    const source = String(row.params.source_id), { file, info } = await mezzaninePath(ctx, source);
    if (info.has_audio === false) return { output: { duration_s: (info.duration_ms ?? 0) / 1000, no_audio: true } };
    const r = range(row), out = join(dirOf(ctx, source), "audio.ogg");
    const args = ["-y", "-v", "error", ...(r.start ? ["-ss", String(r.start)] : []), ...(r.end != null ? ["-t", String(r.end - r.start)] : []), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", out];
    const p = spawnSync("ffmpeg", args, { encoding: "utf8" });
    if (p.status !== 0) throw new StageError("prepare_failed", `ffmpeg: ${p.stderr?.slice(-200)}`);
    return { output: { audio_sha256: sha(out), bytes: statSync(out).size, duration_s: (r.end ?? (info.duration_ms ?? 0) / 1000) - r.start, no_audio: false } };
  },
};

export interface AsrDeps { transcribeChunk?: (audio: Uint8Array, chunk: Chunk) => Promise<{ words: TWord[]; language: string | null }>; limiter?: GroqLimiter }
const asrModel = (ctx: StageCtx) => ctx.componentVersions.asr_model ?? "whisper-large-v3-turbo";

const transcribe: StageImpl = {
  async inputs(ctx, row) {
    const source = String(row.params.source_id), f = join(dirOf(ctx, source), "audio.ogg");
    return { stage: "transcribe", analysis: row.params.analysis_id ?? null, audio_sha256: existsSync(f) ? sha(f) : String(row.params.audio_sha256 ?? ""), asr_model: asrModel(ctx), language: row.params.language ?? "auto", range: range(row) };
  },
  async run(ctx, row) {
    const source = String(row.params.source_id), dir = dirOf(ctx, source), audio = join(dir, "audio.ogg");
    if (!existsSync(audio)) return { output: { words: 0, language: null, no_audio: true } };
    const cfg = aiConfig(ctx.env ?? process.env), deps = (ctx.deps ?? {}) as AsrDeps;
    const limiter = deps.limiter ?? new GroqLimiter(limitsFromEnv(ctx.env ?? process.env));
    const total = Number(row.params.duration_s ?? 0) || Number((spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio], { encoding: "utf8" }).stdout || "0").trim());
    const chunks = planChunks(total), parts: { chunk: Chunk; words: TWord[] }[] = []; let language: string | null = null, waitMs = 0;
    const lang = String(row.params.language ?? "auto") as "auto" | "es" | "en";
    const call = deps.transcribeChunk ?? (async (a: Uint8Array, c: Chunk) => {
      const r = await groqTranscribe(a, "audio/ogg", cfg, { language: lang, fetchImpl: ctx.fetch });
      void c; return { words: r.words, language: r.language };
    });
    const slice = (c: Chunk): Uint8Array => {
      if (chunks.length === 1) return readFileSync(audio);
      const out = join(dir, `chunk${c.index}.ogg`);
      const p = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(c.start), "-t", String(c.end - c.start), "-i", audio, "-c:a", "libopus", "-b:a", "24k", "-ac", "1", "-ar", "16000", out], { encoding: "utf8" });
      if (p.status !== 0) throw new StageError("prepare_failed", `ffmpeg: ${p.stderr?.slice(-200)}`);
      return readFileSync(out);
    };
    // Trozos en paralelo (máx. 3), cada petición bajo el limitador; un 429 retrasa lo siguiente.
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const c = chunks[next++];
        waitMs += await limiter.wait("stt", Math.ceil(c.end - c.start));
        try { const r = await call(slice(c), c); parts.push({ chunk: c, words: r.words }); language ??= r.language; }
        catch (e) { if (e instanceof AiError && e.status === 429) { limiter.on429(e.retryAfter ?? 20); next = Math.min(next, c.index); throw new StageError("rate_limited", "Groq pidió esperar"); } throw e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
    const words = mergeChunks(parts);
    if (!words.length && total > 5) throw new StageError("transcription_failed", "La transcripción no devolvió palabras");
    if (!row.params.analysis_id) throw new StageError("bad_params", "Falta analysis_id para guardar la transcripción");
    const transcriptId = await ctx.rpc<string>("save_transcript", { p_analysis: row.params.analysis_id, p_words: words, p_language: language, p_model: asrModel(ctx) });
    return { output: { words: words.length, language, chunks: chunks.length, wait_ms: waitMs, asr_calls: parts.length, transcript_id: transcriptId } };
  },
};

export interface Energy { t: number; rms: number }
export function sceneSignals(file: string): { scenes: number[]; audio_signals: { t: number; kind: string; score: number }[] } {
  const sc = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-an", "-vf", "scdet=threshold=10:sc_pass=1,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const scenes = [...(sc.stdout ?? "").matchAll(/lavfi\.scd\.time=([0-9.]+)/g)].map((m) => +m[1]);
  const au = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const lv = [...(au.stdout ?? "").matchAll(/pts_time:([0-9.]+)\s+lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-inf)/g)].map((m) => ({ t: +m[1], db: m[2] === "-inf" ? -90 : +m[2] }));
  const audio_signals = lv.filter((x, i) => i > 0 && x.db - lv[i - 1].db >= 10).slice(0, 200).map((x) => ({ t: x.t, kind: "energy_rise", score: +(Math.min(1, (x.db + 60) / 60)).toFixed(2) }));
  return { scenes, audio_signals };
}

const scenes: StageImpl = {
  inputs: (_c, row) => ({ stage: "scenes", source: row.params.source_id, v: 1 }),
  async run(ctx, row) {
    const { file } = await mezzaninePath(ctx, String(row.params.source_id));
    const r = sceneSignals(file);
    if (row.params.analysis_id) {
      await ctx.rpc("save_analysis_part", { p_analysis: row.params.analysis_id, p_part: "scenes", p_data: r.scenes });
      await ctx.rpc("save_analysis_part", { p_analysis: row.params.analysis_id, p_part: "audio_signals", p_data: r.audio_signals });
    }
    return { output: { scenes: r.scenes.length, audio_signals: r.audio_signals.length, cuts: r.scenes.slice(0, 100) } };
  },
};

/** Hablante activo visual (sin diarización): agrupa las caras por posición y toma la mayor en cada muestra. Es una estimación → needs_review. */
export interface FaceSampleLite { t: number; faces: { cx: number; cy: number; w: number; h: number; s: number }[] }
export function visualSpeakers(samples: FaceSampleLite[]): { speakers: { id: number; x: number }[]; runs: { speaker: number; start: number; end: number }[] } {
  const xs = samples.flatMap((s) => s.faces.map((f) => f.cx)).sort((a, b) => a - b);
  if (!xs.length) return { speakers: [], runs: [] };
  const split = xs.length > 4 && xs.at(-1)! - xs[0] > 0.3 ? (xs[0] + xs.at(-1)!) / 2 : Infinity;
  const clusters = [xs.filter((x) => x < split), xs.filter((x) => x >= split)].filter((c) => c.length).map((c, i) => ({ id: i, x: +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(3) }));
  const of = (cx: number) => (cx < split ? clusters[0].id : clusters[clusters.length - 1].id);
  const runs: { speaker: number; start: number; end: number }[] = [];
  for (const s of samples) {
    if (!s.faces.length) continue;
    const big = [...s.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0], sp = of(big.cx), last = runs.at(-1);
    if (last && last.speaker === sp && s.t - last.end < 1.5) last.end = s.t; else runs.push({ speaker: sp, start: s.t, end: s.t });
  }
  return { speakers: clusters, runs };
}

export interface SpeakerDeps { deepgram?: (audio: Uint8Array, key: string) => Promise<{ words: TWord[] }>; faces?: (file: string) => Promise<FaceSampleLite[]> }
const speakers: StageImpl = {
  inputs: (ctx, row) => ({ stage: "speakers", source: row.params.source_id, dg: !!(ctx.env ?? process.env).DEEPGRAM_API_KEY, v: 1 }),
  async run(ctx, row) {
    const source = String(row.params.source_id), dir = dirOf(ctx, source), audio = join(dir, "audio.ogg"), deps = (ctx.deps ?? {}) as SpeakerDeps;
    const key = (ctx.env ?? process.env).DEEPGRAM_API_KEY;
    if (key && existsSync(audio)) {
      try {
        const dg = deps.deepgram ?? (async (a: Uint8Array, k: string) => deepgramTranscribe(a, "audio/ogg", k, "auto"));
        const r = await dg(readFileSync(audio), key);
        const sp = new Map<number, number>(); for (const w of r.words) if (typeof (w as { speaker?: number }).speaker === "number") sp.set((w as { speaker: number }).speaker, (sp.get((w as { speaker: number }).speaker) ?? 0) + 1);
        const ids = [...sp.keys()].sort();
        if (row.params.analysis_id) await ctx.rpc("save_analysis_part", { p_analysis: row.params.analysis_id, p_part: "speakers", p_data: ids.map((id) => ({ id, method: "deepgram", words: sp.get(id) })) });
        return { output: { method: "deepgram", speakers: ids, needs_review: false } };
      } catch (e) { const st = (e as { status?: number }).status; if (st !== 402 && st !== 401 && st !== 403) throw e; ctx.log("Deepgram sin crédito: hablante activo visual"); }
    }
    const { file } = await mezzaninePath(ctx, source);
    const detect = deps.faces ?? (async (f: string) => { const { scanFaces } = await import("../reframe.ts"); return scanFaces(f, 0, 600, 2).samples; });
    const v = visualSpeakers(await detect(file));
    if (row.params.analysis_id) await ctx.rpc("save_analysis_part", { p_analysis: row.params.analysis_id, p_part: "speakers", p_data: v.speakers.map((s) => ({ ...s, method: "visual_largest_face", needs_review: true })) });
    return { output: { method: "visual_largest_face", speakers: v.speakers.map((s) => s.id), runs: v.runs.length, needs_review: true } };
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { prepare, transcribe, scenes, speakers };
