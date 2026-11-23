"use client";
// Subida de una canción para el Editor de vídeos: sesión (/api/uploads) → registrar (/api/lyrics/songs) → partes reanudables → completar.
// Si registrar falla se cancela la sesión para no dejar una subida huérfana. Mismo flujo que Lyric Studio v2.
import { supabase } from "./supabase";
import { httpApi, localResumeStore, runUpload, type UploadEvent } from "./uploader";

export const MAX_SONG_BYTES = 50 * 1024 * 1024;   // 50 MB (fuente pública P6)
export const SONG_FORMATS = "MP3, WAV, FLAC, AAC, OGG o M4A";
const EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg" };
export const audioMime = (f: File) => (f.type.startsWith("audio/") ? f.type : EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? "");
export function checkSong(f: File): string | null {
  if (!audioMime(f)) return `Sube un archivo de audio: ${SONG_FORMATS}.`;
  if (f.size > MAX_SONG_BYTES) return `La canción pesa ${(f.size / 1048576).toFixed(1)} MB. El máximo es 50 MB: expórtala en MP3 o M4A.`;
  return null;
}
async function sha256Hex(f: File) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";

/** Sube la canción y devuelve el id de la canción registrada. */
export async function uploadSong(f0: File, onEvent: (e: UploadEvent) => void, onCancelable?: (c: { cancel: () => Promise<void> }) => void): Promise<string> {
  const bad = checkSong(f0); if (bad) throw new Error(bad);
  const mime = audioMime(f0), f = mime !== f0.type ? new File([f0], f0.name, { type: mime }) : f0;
  const t = await token(), H = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, title = f.name.replace(/\.[^.]+$/, "");
  const s = await fetch("/api/uploads", { method: "POST", headers: { ...H, "Idempotency-Key": `ed-${crypto.randomUUID()}` }, body: JSON.stringify({ name: title, bytes: f.size, mime: f.type, force: true }) });
  const sj = await s.json().catch(() => ({})); if (!s.ok) throw new Error(sj?.error?.message ?? "No se pudo empezar la subida.");
  const r = await fetch("/api/lyrics/songs", { method: "POST", headers: H, body: JSON.stringify({ upload_id: sj.upload_id, title }) });
  const rj = await r.json().catch(() => ({}));
  if (!r.ok) { await fetch(`/api/uploads/${sj.upload_id}`, { method: "DELETE", headers: H }).catch(() => {}); throw new Error(rj?.error?.message ?? "No se pudo registrar la canción."); }
  const hash = await sha256Hex(f);
  const up = runUpload({ uploadId: sj.upload_id, file: f, api: httpApi(t), store: localResumeStore, sha256: async () => hash, onEvent });
  onCancelable?.(up); await up.promise;
  return rj.song_id as string;
}

/** Descarga de un render como archivo (attachment), no en una pestaña nueva. */
export async function downloadRender(id: string, name: string): Promise<string | null> {
  const r = await fetch(`/api/exports/${id}/url?download=1&name=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${await token()}` } });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) return j?.error?.message ?? "No se pudo preparar la descarga.";
  const a = document.createElement("a"); a.href = j.url; a.download = `${name}.mp4`; document.body.appendChild(a); a.click(); a.remove(); return null;
}
