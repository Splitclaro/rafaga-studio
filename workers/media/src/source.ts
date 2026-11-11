// Obtención del vídeo original en el worker, venga de donde venga:
//  · archivo único en Storage (`<ws>/<src>/original`),
//  · subida por partes (`original.part000`, `.part001`…; supera el límite de 50 MB por archivo del plan Free),
//  · enlace de YouTube (`sources.kind = 'url'`), descargado con yt-dlp en el propio worker. No se guarda en Storage.
// Caché en disco por fuente durante la vida del worker caliente: el segundo trabajo de la misma fuente no vuelve a descargar.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeSync, closeSync, renameSync, linkSync, copyFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PART_BYTES = 45 * 1024 * 1024;
export const partName = (base: string, i: number) => `${base}.part${String(i).padStart(3, "0")}`;
const CACHE = join(tmpdir(), "rafaga-src-cache");
const KEEP = 3;

/** Argumentos de yt-dlp: MP4 hasta 1080p con audio; `section` descarga solo un tramo (segundos). */
export function ytdlpArgs(url: string, out: string, o: { section?: [number, number]; maxHeight?: number } = {}): string[] {
  const h = o.maxHeight ?? 1080;
  return [
    "--no-playlist", "--no-progress", "--no-warnings", "--js-runtimes", "node",
    "-f", `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
    "--merge-output-format", "mp4", "--remux-video", "mp4",
    ...(o.section ? ["--download-sections", `*${o.section[0].toFixed(2)}-${o.section[1].toFixed(2)}`, "--force-keyframes-at-cuts"] : []),
    "-o", out, url,
  ];
}

/** Traduce los fallos de yt-dlp a algo que la persona pueda resolver. `permanent` = no reintentar. */
export function ytdlpError(stderr: string): { message: string; permanent: boolean } {
  const s = stderr.toLowerCase();
  if (s.includes("sign in to confirm") || s.includes("not a bot")) return { message: "YouTube ha bloqueado la descarga desde nuestro servidor (verificación anti-bots). Sube el archivo del vídeo en su lugar.", permanent: false };
  if (s.includes("private video")) return { message: "El vídeo es privado: no se puede descargar. Hazlo público u oculto, o sube el archivo.", permanent: true };
  if (s.includes("members-only") || s.includes("join this channel")) return { message: "El vídeo es solo para miembros del canal: no se puede descargar.", permanent: true };
  if (s.includes("confirm your age") || s.includes("age-restricted")) return { message: "El vídeo tiene restricción de edad: YouTube no permite descargarlo sin sesión. Sube el archivo.", permanent: true };
  if (s.includes("is live") || s.includes("live event") || s.includes("premieres in")) return { message: "El vídeo es un directo o un estreno que aún no ha terminado. Vuelve a intentarlo cuando esté publicado.", permanent: true };
  if (s.includes("video unavailable") || s.includes("not available") || s.includes("has been removed")) return { message: "YouTube dice que el vídeo no está disponible (eliminado, bloqueado en la región o enlace incorrecto).", permanent: true };
  if (s.includes("copyright")) return { message: "YouTube ha retirado el vídeo por derechos de autor.", permanent: true };
  return { message: `No se pudo descargar el vídeo de YouTube: ${stderr.trim().split("\n").pop()?.slice(0, 200) ?? "error desconocido"}`, permanent: false };
}

export function ytdlp(url: string, out: string, o: { section?: [number, number]; maxHeight?: number } = {}) {
  const r = spawnSync("yt-dlp", ytdlpArgs(url, out, o), { encoding: "utf8", maxBuffer: 1 << 26, timeout: 40 * 60_000 });
  if (r.error) throw Object.assign(new Error(`yt-dlp no está disponible en el worker: ${r.error.message}`), { permanent: false });
  if (r.status !== 0 || !existsSync(out)) { const e = ytdlpError(r.stderr ?? ""); throw Object.assign(new Error(e.message), { permanent: e.permanent }); }
}

function evict() {
  try {
    const fs = readdirSync(CACHE).filter((f) => !f.endsWith(".tmp")).map((f) => ({ f, t: statSync(join(CACHE, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of fs.slice(KEEP)) rmSync(join(CACHE, x.f), { force: true });
  } catch { /* caché opcional */ }
}
const place = (from: string, to: string) => { try { linkSync(from, to); } catch { copyFileSync(from, to); } };

/** Deja en `dest` el vídeo original de la fuente cuyo path de Storage es `<ws>/<src>/original`. */
export async function fetchOriginal(sb: SupabaseClient, path: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  const srcId = path.split("/")[1];
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, srcId);
  if (existsSync(cached)) { place(cached, dest); return; }
  const { data: src } = await sb.from("sources").select("kind,parts,source_url").eq("id", srcId).maybeSingle();
  const tmp = `${cached}.tmp`;
  rmSync(tmp, { force: true });
  if (src?.kind === "url" && src.source_url) {
    ytdlp(src.source_url, tmp);
  } else if (src?.parts && src.parts > 0) {
    const fd = openSync(tmp, "w");
    try {
      for (let i = 0; i < src.parts; i++) {
        const d = await sb.storage.from("originals").download(partName(path, i));
        if (d.error || !d.data) throw new Error(`descarga de la parte ${i + 1}/${src.parts}: ${d.error?.message}`);
        writeSync(fd, Buffer.from(await d.data.arrayBuffer()));
      }
    } finally { closeSync(fd); }
  } else {
    const d = await sb.storage.from("originals").download(path);
    if (d.error || !d.data) throw new Error(`descarga: ${d.error?.message}`);
    const fd = openSync(tmp, "w"); try { writeSync(fd, Buffer.from(await d.data.arrayBuffer())); } finally { closeSync(fd); }
  }
  renameSync(tmp, cached);
  evict();
  place(cached, dest);
}
