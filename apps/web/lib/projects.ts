"use client";
import { supabase, MAX_UPLOAD_BYTES } from "./supabase";

export const OK_MIME = ["video/mp4", "video/quicktime", "video/webm"];
export const STAGE: Record<string, string> = { queued: "En cola", validating: "Validando", extracting: "Extrayendo audio", transcribing: "Transcribiendo", selecting: "Seleccionando momentos", tracking: "Reencuadrando", rendering: "Renderizando", done: "Listo", failed: "Fallido", cancelled: "Cancelado" };
export const MODE_LABEL: Record<string, string> = { clips: "Clips", captions: "Subtítulos", reframe: "Reencuadre", social: "Social", broll: "B-roll" };
export type ProjectMode = "clips" | "captions" | "reframe" | "social" | "broll";

export function validateFile(f: File): string | null {
  if (!OK_MIME.includes(f.type) && !/\.(mp4|mov|webm)$/i.test(f.name)) return "Formato no válido. Usa MP4, MOV o WebM.";
  if (f.size > MAX_UPLOAD_BYTES) return `El archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el límite actual es ${MAX_UPLOAD_BYTES / 1048576} MB (plan gratuito de almacenamiento).`;
  return null;
}

/** Duración real leída del propio archivo en el navegador (sin subirlo). */
export function probeDuration(f: File): Promise<number | null> {
  return new Promise((res) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(f);
    const done = (d: number | null) => { URL.revokeObjectURL(url); res(d); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}
export const MIN_SOURCE_SECONDS = 15;
/** Modos que procesan el vídeo entero (un único clip) en vez de buscar momentos. */
export const WHOLE_VIDEO_MAX_SECONDS = 600;

/** Fotograma de portada del vídeo (JPEG) generado en el navegador. */
export function makeThumb(f: File): Promise<Blob | null> {
  return new Promise((res) => {
    const v = document.createElement("video"); const url = URL.createObjectURL(f);
    const end = (b: Blob | null) => { URL.revokeObjectURL(url); res(b); };
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    v.onerror = () => end(null);
    v.onloadeddata = () => { v.currentTime = Math.min(1.5, (v.duration || 3) / 3); };
    v.onseeked = () => {
      try {
        const w = 480, h = Math.max(1, Math.round((w * v.videoHeight) / Math.max(1, v.videoWidth)));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, w, h);
        c.toBlob((b) => end(b), "image/jpeg", 0.8);
      } catch { end(null); }
    };
    setTimeout(() => end(null), 8000);
  });
}

export type CreateArgs = { file: File; name: string; brief: string; briefData?: unknown; count: number; mode?: ProjectMode; maxSeconds?: number; rangeStart?: number; rangeEnd?: number; onStep: (s: string) => void };

/** Crea fuente → sube el vídeo (y su portada) → crea proyecto. Devuelve el id del proyecto. */
export async function createProject(a: CreateArgs): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
  a.onStep("Preparando tu espacio…");
  const { data: ws, error: e1 } = await supabase.from("workspaces").select("id").limit(1).single();
  if (e1 || !ws) throw new Error("No se encontró tu espacio de trabajo.");
  const srcId = crypto.randomUUID();
  const thumb = await makeThumb(a.file);
  const thumbPath = thumb ? `${ws.id}/${srcId}/thumb.jpg` : null;
  const mime = OK_MIME.includes(a.file.type) ? a.file.type : /\.mov$/i.test(a.file.name) ? "video/quicktime" : /\.webm$/i.test(a.file.name) ? "video/webm" : "video/mp4";
  const { error: e2 } = await supabase.from("sources").insert({
    id: srcId, workspace_id: ws.id, kind: "upload", mime, bytes: a.file.size, created_by: uid, thumb_path: thumbPath,
    range_start_ms: a.rangeStart != null && a.rangeEnd ? Math.round(a.rangeStart * 1000) : null, range_end_ms: a.rangeStart != null && a.rangeEnd ? Math.round(a.rangeEnd * 1000) : null,
  });
  if (e2) throw new Error(e2.message ?? "No se pudo crear la fuente.");
  a.onStep("Subiendo vídeo…");
  const { error: e3 } = await supabase.storage.from("originals").upload(`${ws.id}/${srcId}/original`, a.file, { contentType: mime, upsert: false });
  if (e3) throw new Error(`Subida fallida: ${e3.message}`);
  if (thumb && thumbPath) await supabase.storage.from("originals").upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
  a.onStep("Creando proyecto…");
  const { data: prj, error: e4 } = await supabase.from("projects").insert({
    workspace_id: ws.id, source_id: srcId, name: a.name.trim() || a.file.name.replace(/\.[^.]+$/, ""), created_by: uid,
    project_brief: a.brief.trim() || null, brief_data: a.briefData ?? null, clip_count: a.count, mode: a.mode ?? "clips",
    ...(a.maxSeconds ? { max_seconds: a.maxSeconds, target_seconds: Math.min(60, a.maxSeconds) } : {}),
  }).select("id").single();
  if (e4 || !prj) throw new Error(e4?.message ?? "No se pudo crear el proyecto.");
  return prj.id;
}

/** Sube una canción (MP3/WAV validado por contenido) y devuelve su id. */
export async function sniffAudio(f: File): Promise<"audio/wav" | "audio/mpeg" | null> {
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const str = (x: number, z: number) => String.fromCharCode(...b.slice(x, z));
  if (str(0, 4) === "RIFF" && str(8, 12) === "WAVE") return "audio/wav";
  if (str(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}
export async function uploadSong(f: File, title: string, artist: string, onStep: (s: string) => void): Promise<string> {
  const mime = await sniffAudio(f);
  if (!mime) throw new Error(`«${f.name}» no parece un MP3 o WAV válido.`);
  if (f.size > MAX_UPLOAD_BYTES) throw new Error(`La canción supera ${MAX_UPLOAD_BYTES / 1048576} MB.`);
  onStep(`Subiendo «${f.name}» (${(f.size / 1048576).toFixed(1)} MB)…`);
  const { data: s } = await supabase.auth.getSession();
  const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
  if (!ws || !s.session) throw new Error("Sesión no válida.");
  const path = `${ws.id}/songs/${crypto.randomUUID()}.${mime === "audio/mpeg" ? "mp3" : "wav"}`;
  const up = await supabase.storage.from("originals").upload(path, f, { contentType: mime });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase.from("songs").insert({ workspace_id: ws.id, title: title.trim() || f.name.replace(/\.[^.]+$/, ""), artist: artist.trim() || null, storage_path: path, mime, bytes: f.size, created_by: s.session.user.id }).select("id").single();
  if (error) { await supabase.storage.from("originals").remove([path]); throw new Error(error.message); }
  return data.id;
}
