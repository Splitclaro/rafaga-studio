// Etapas de entrada: validate (contenido real, límites, idioma, miniatura) · mezzanine (copia de trabajo 1080p y borrado del
// original) · proxy (copia ligera de 720p para el navegador). Las tres reciben el contexto por inyección (R2, fetch, tmpDir).
import { spawnSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqTranscribe } from "@rafaga/providers";
import { StageError, type StageCtx, type StageImpl, type StageRow } from "./registry.ts";
import { extractThumb } from "../thumb.ts";

export const MAX_SECONDS = 3600, MAX_BYTES = 4294967296;
export interface Probe {
  container: string; duration: number; bytes: number; width: number; height: number; fps: number; avgFps: number; vcodec: string;
  audioTracks: number; acodec: string | null; rotation: number; vfr: boolean; dataTracks: number;
}
export type ValidationStatus = "ok" | "unsupported" | "needs_conversion";
export interface ValidationResult {
  status: ValidationStatus; reason?: string; message?: string; warnings: string[]; modes_available: string[]; subtitles: boolean;
  duration_s: number; width: number; height: number; fps: number; audio_tracks: number; ignored_data_tracks: number;
  rotation: number; vfr: boolean; language: string | null; conversion: string[];
}

const frac = (s: string | undefined) => { const [a, b] = (s ?? "0/1").split("/").map(Number); return b ? a / b : a || 0; };

/** Bytes mágicos: MP4/MOV (`ftyp`/`moov`/`mdat`/`wide`), Matroska/WebM (EBML) o AVI. */
export function sniffContainer(head: Uint8Array): "mp4" | "mkv" | "avi" | null {
  const s = (a: number, n: number) => String.fromCharCode(...head.subarray(a, a + n));
  if (head.length >= 12 && ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(s(4, 4))) return "mp4";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "mkv";
  if (head.length >= 12 && s(0, 4) === "RIFF" && s(8, 4) === "AVI ") return "avi";
  return null;
}
export function readHead(path: string, n = 32): Uint8Array {
  const fd = openSync(path, "r"); try { const b = Buffer.alloc(n); const r = readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { closeSync(fd); }
}

export function probeFile(path: string): Probe | null {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (r.status !== 0) return null;
  let j: { format?: { format_name?: string; duration?: string; size?: string }; streams?: Record<string, unknown>[] };
  try { j = JSON.parse(r.stdout); } catch { return null; }
  const st = j.streams ?? [], v = st.find((s) => s.codec_type === "video" && !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic) as Record<string, unknown> | undefined;
  if (!v) return null;
  const audio = st.filter((s) => s.codec_type === "audio");
  const sd = (v.side_data_list as { rotation?: number }[] | undefined)?.find((x) => x.rotation != null);
  const rot = (((Number(sd?.rotation ?? (v.tags as { rotate?: string } | undefined)?.rotate ?? 0) % 360) + 360) % 360);
  const fps = frac(v.r_frame_rate as string), avg = frac(v.avg_frame_rate as string);
  return {
    container: String(j.format?.format_name ?? ""), duration: Number(j.format?.duration ?? v.duration ?? 0), bytes: Number(j.format?.size ?? statSync(path).size),
    width: Number(v.width ?? 0), height: Number(v.height ?? 0), fps: fps || avg, avgFps: avg || fps, vcodec: String(v.codec_name ?? ""),
    audioTracks: audio.length, acodec: audio[0] ? String(audio[0].codec_name) : null, rotation: rot,
    vfr: fps > 0 && avg > 0 && Math.abs(fps - avg) / fps > 0.02, dataTracks: st.filter((s) => s.codec_type === "data").length,
  };
}

const FIX: Record<string, string> = {
  corrupt_file: "El archivo está dañado o incompleto. Vuelve a exportarlo desde tu editor y súbelo de nuevo.",
  unsupported_container: "Formato no compatible. Conviértelo a MP4 (H.264 + AAC) o MOV y vuelve a subirlo.",
  too_long: "Dura más de 60 minutos. Divídelo en partes más cortas o recorta el tramo que necesitas.",
  too_large: "Pesa más de 4 GB. Exporta una versión más ligera (por ejemplo 1080p a 10 Mbps).",
};

export function validateProbe(p: Probe | null, head: Uint8Array, bytes: number, language: string | null): ValidationResult {
  const base = { warnings: [] as string[], modes_available: ["auto", "tema", "preguntas", "educativo", "historia", "destacados", "manual"], subtitles: true, duration_s: 0, width: 0, height: 0, fps: 0, audio_tracks: 0, ignored_data_tracks: 0, rotation: 0, vfr: false, language, conversion: [] as string[] };
  const bad = (reason: string): ValidationResult => ({ ...base, status: "unsupported", reason, message: FIX[reason] });
  if (bytes > MAX_BYTES) return bad("too_large");
  if (!sniffContainer(head)) return bad("unsupported_container");
  if (!p) return bad("corrupt_file");
  const r: ValidationResult = { ...base, duration_s: +p.duration.toFixed(3), width: p.width, height: p.height, fps: +p.fps.toFixed(3), audio_tracks: p.audioTracks, ignored_data_tracks: p.dataTracks, rotation: p.rotation, vfr: p.vfr, status: "ok" };
  if (p.duration > MAX_SECONDS) return { ...r, ...bad("too_long"), duration_s: r.duration_s };
  if (p.duration <= 0) return bad("corrupt_file");
  if (p.audioTracks === 0) { r.warnings.push("no_audio"); r.modes_available = ["manual", "destacados"]; r.subtitles = false; }
  if (p.rotation === 90 || p.rotation === 270) r.conversion.push("rotation");
  if (p.vfr) r.conversion.push("vfr");
  if (r.conversion.length) r.status = "needs_conversion";
  return r;
}

const workDir = (ctx: StageCtx, source: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", source); mkdirSync(d, { recursive: true }); return d; };
interface SourceInfo { id: string; workspace_id: string; storage_path: string; bytes: number; parts: number; mime: string | null; status: string; duration_ms: number | null; has_audio: boolean | null }
const info = (ctx: StageCtx, source: string) => ctx.rpc<SourceInfo>("source_info", { p_source: source });
const partKey = (key: string, i: number) => `${key}.part${String(i).padStart(3, "0")}`;

/** Deja el original (único o por partes) en `<tmp>/<source>/original`; reutiliza lo ya descargado. */
async function fetchSource(ctx: StageCtx, s: SourceInfo): Promise<string> {
  const dir = workDir(ctx, s.id), dest = join(dir, "original");
  if (existsSync(dest) && statSync(dest).size === Number(s.bytes)) return dest;
  if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
  if (s.parts > 0) {
    const out = createWriteStream(dest);
    for (let i = 0; i < s.parts; i++) {
      const p = join(dir, `p${i}`); await ctx.r2.download(partKey(s.storage_path, i), p);
      await new Promise<void>((res, rej) => { out.write(readFileSync(p), (e) => (e ? rej(e) : res())); }); rmSync(p, { force: true });
    }
    await new Promise<void>((res) => out.end(res));
  } else await ctx.r2.download(s.storage_path, dest);
  return dest;
}

function sampleLanguage(file: string, dir: string): Uint8Array | null {
  const out = join(dir, "sample.ogg");
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", "0", "-t", "30", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", out], { encoding: "utf8" });
  return r.status === 0 && existsSync(out) ? readFileSync(out) : null;
}

const validate: StageImpl = {
  inputs: (_ctx, row) => ({ stage: "validate", source: row.params.source_id }),
  async run(ctx, row) {
    const source = String(row.params.source_id), s = await info(ctx, source);
    if (!s) throw new StageError("not_found", "La fuente no existe");
    const file = await fetchSource(ctx, s), dir = workDir(ctx, source);
    const probe = probeFile(file);
    let language: string | null = null;
    const cfg = aiConfig(ctx.env ?? process.env);
    if (probe && probe.audioTracks > 0 && cfg.key && sniffContainer(readHead(file))) {
      const audio = sampleLanguage(file, dir);
      if (audio) { try { language = (await groqTranscribe(audio, "audio/ogg", cfg, { fetchImpl: ctx.fetch })).language; } catch (e) { ctx.log(`idioma: ${(e as Error).message}`); } }
    }
    const res = validateProbe(probe, readHead(file), Number(s.bytes), language);
    if (res.status === "unsupported") throw Object.assign(new StageError(res.reason!, res.message), { output: res });
    let thumbPath: string | null = null;
    if (probe && ctx.r2) {
      const jpg = join(dir, "thumb.jpg"); extractThumb(file, jpg);
      thumbPath = `${s.workspace_id}/${s.id}/thumb.jpg`;
      await ctx.r2.upload(thumbPath, jpg, "image/jpeg");
      await ctx.rpc("record_object", { p_ws: s.workspace_id, p_key: thumbPath, p_bytes: statSync(jpg).size, p_kind: "thumb", p_project: null, p_source: s.id, p_render: null, p_expires_at: null });
    }
    await ctx.rpc("set_source_ready", { p_source: s.id, p_status: "uploaded", p_duration_ms: Math.round(res.duration_s * 1000), p_width: res.width, p_height: res.height, p_has_audio: res.audio_tracks > 0, p_storage_path: null, p_thumb_path: thumbPath });
    return { output: { ...res } as unknown as Record<string, unknown> };
  },
};

/** Argumentos de ffmpeg de la copia de trabajo: 1080p máx., H.264 High ~6 Mbps VBV, AAC 192k, clave cada 1 s, moov delante. */
export function mezzanineArgs(inp: string, out: string, p: Probe): string[] {
  const fps = p.vfr ? Math.max(1, Math.round(p.avgFps)) : null;
  return ["-y", "-v", "error", "-i", inp, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(1080,ih)'",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-b:v", "6M", "-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*1)", ...(fps ? ["-fps_mode", "cfr", "-r", String(fps)] : []),
    "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-map_metadata", "-1", "-movflags", "+faststart", out];
}

/** moov antes de mdat (faststart): los átomos de primer nivel se leen del archivo. */
export function moovBeforeMdat(file: string): boolean {
  const buf = readFileSync(file); let o = 0, moov = -1, mdat = -1;
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o); const type = buf.toString("latin1", o + 4, o + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(o + 8)); if (size < 8) break;
    if (type === "moov" && moov < 0) moov = o; if (type === "mdat" && mdat < 0) mdat = o; o += size;
  }
  return moov >= 0 && mdat >= 0 && moov < mdat;
}

function keyframeGapMax(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file], { encoding: "utf8" });
  const t = r.stdout.trim().split("\n").map(Number).filter((x) => Number.isFinite(x));
  let gap = 0; for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]); return gap;
}

const mezzanine: StageImpl = {
  inputs: (_ctx, row) => ({ stage: "mezzanine", source: row.params.source_id, profile: "1080p-h264-6m-aac192-gop1s-v1" }),
  async run(ctx, row) {
    const source = String(row.params.source_id), s = await info(ctx, source);
    if (!s) throw new StageError("not_found", "La fuente no existe");
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const file = await fetchSource(ctx, s), dir = workDir(ctx, source), out = join(dir, "mezzanine.mp4");
    const src = probeFile(file);
    if (!src) throw new StageError("corrupt_file", FIX.corrupt_file);
    const r = spawnSync("ffmpeg", mezzanineArgs(file, out, src), { encoding: "utf8", maxBuffer: 1 << 24 });
    if (r.status !== 0) throw new StageError("transcode_failed", `ffmpeg: ${r.stderr?.slice(-200)}`);
    // Comprobación antes de borrar nada: duración a ≤1 fotograma y pistas presentes.
    const m = probeFile(out);
    const frame = 1 / Math.max(1, src.fps || 25);
    if (!m || m.vcodec !== "h264" || (src.audioTracks > 0 && m.audioTracks < 1) || Math.abs(m.duration - src.duration) > frame + 0.03)
      throw new StageError("mezzanine_check_failed", `La copia no coincide con el original (duración ${m?.duration ?? "?"} vs ${src.duration}); el original se conserva`);
    const key = `${s.workspace_id}/${s.id}/mezzanine.mp4`;
    await ctx.r2.upload(key, out, "video/mp4");
    await ctx.rpc("record_object", { p_ws: s.workspace_id, p_key: key, p_bytes: statSync(out).size, p_kind: "mezzanine", p_project: null, p_source: s.id, p_render: null, p_expires_at: null });
    const doomed = s.parts > 0 ? [s.storage_path, ...Array.from({ length: s.parts }, (_, i) => partKey(s.storage_path, i))] : [s.storage_path];
    await ctx.r2.remove(doomed);
    await ctx.rpc("mark_purged", { p_keys: doomed });
    await ctx.rpc("set_source_ready", { p_source: s.id, p_status: "validated", p_duration_ms: Math.round(m.duration * 1000), p_width: m.width, p_height: m.height, p_has_audio: m.audioTracks > 0, p_storage_path: key, p_thumb_path: null });
    return { output: { key, bytes: statSync(out).size, width: m.width, height: m.height, duration_s: +m.duration.toFixed(3), keyframe_gap_s: +keyframeGapMax(out).toFixed(2), faststart: moovBeforeMdat(out) } };
  },
};

const proxy: StageImpl = {
  inputs: (_ctx, row) => ({ stage: "proxy", source: row.params.source_id, profile: "720p-h264-2m-aac96-gop1s-v1" }),
  async run(ctx, row) {
    const source = String(row.params.source_id), s = await info(ctx, source);
    if (!s || !ctx.r2) throw new StageError(s ? "not_configured" : "not_found");
    const file = await fetchSource(ctx, s), out = join(workDir(ctx, source), "proxy.mp4");   // tras la mezzanine, storage_path ya es la mezzanine
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "2M", "-maxrate", "2M", "-bufsize", "4M", "-pix_fmt", "yuv420p",
      "-force_key_frames", "expr:gte(t,n_forced*1)", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", out], { encoding: "utf8", maxBuffer: 1 << 24 });
    if (r.status !== 0) throw new StageError("transcode_failed", `ffmpeg: ${r.stderr?.slice(-200)}`);
    const key = `${s.workspace_id}/${s.id}/proxy.mp4`;
    await ctx.r2.upload(key, out, "video/mp4");
    await ctx.rpc("record_object", { p_ws: s.workspace_id, p_key: key, p_bytes: statSync(out).size, p_kind: "proxy", p_project: null, p_source: s.id, p_render: null, p_expires_at: null });
    return { output: { key, bytes: statSync(out).size } };
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { validate, mezzanine, proxy };
void writeFileSync; void (null as unknown as StageRow);
