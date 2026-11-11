"use client";
import { supabase } from "./supabase";

/** Nombre de archivo seguro y con extensión: nunca vacío ni sin `.mp4`. */
export function fileName(name: string, ext = "mp4"): string {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "clip";
  return `${base}.${ext}`;
}
/** ¿Empieza como un MP4/MOV real? (caja `ftyp` en los bytes 4–8). Detecta respuestas de error o archivos truncados. */
export function looksLikeMp4(head: Uint8Array): boolean {
  return head.length >= 12 && String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp";
}

/** Descarga un archivo de Storage como Blob, comprueba que es un MP4 válido y lo guarda con el nombre dado (siempre `.mp4`).
 *  No depende de la cabecera Content-Disposition del servidor, que algunos navegadores ignoran. */
export async function downloadMp4(bucket: string, path: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return { ok: false, error: "No se pudo preparar la descarga. Vuelve a abrir el proyecto e inténtalo de nuevo." };
  let res: Response;
  try { res = await fetch(data.signedUrl); } catch { return { ok: false, error: "Se cortó la conexión durante la descarga. Inténtalo de nuevo." }; }
  if (!res.ok) return { ok: false, error: `El servidor respondió ${res.status}. Si el enlace caducó, vuelve a pulsar Descargar.` };
  const buf = await res.arrayBuffer();
  if (!looksLikeMp4(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)))) return { ok: false, error: "El archivo recibido no es un vídeo MP4 válido. Vuelve a exportar el clip." };
  const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
  const a = document.createElement("a"); a.href = url; a.download = fileName(name); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { ok: true };
}
