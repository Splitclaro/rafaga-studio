// Obtención del vídeo original en el worker, venga de donde venga:
//  · archivo único en Storage (`<ws>/<src>/original`),
//  · subida por partes (`original.part000`, `.part001`…; supera el límite de 50 MB por archivo del plan Free),
// Caché en disco por fuente durante la vida del worker caliente: el segundo trabajo de la misma fuente no vuelve a descargar.
import { existsSync, mkdirSync, openSync, writeSync, closeSync, renameSync, linkSync, copyFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PART_BYTES = 45 * 1024 * 1024;
export const partName = (base: string, i: number) => `${base}.part${String(i).padStart(3, "0")}`;
const CACHE = join(tmpdir(), "rafaga-src-cache");
const KEEP = 3;

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
  const { data: src } = await sb.from("sources").select("parts").eq("id", srcId).maybeSingle();
  const tmp = `${cached}.tmp`;
  rmSync(tmp, { force: true });
  if (src?.parts && src.parts > 0) {
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

/** Ventana de vista previa para el editor cuando el original va por partes (el navegador no puede reproducir trozos):
 *  el tramo del clip ± `pad` s a resolución baja, con inicio rápido. Devuelve el desfase (s) del primer fotograma. */
export const PREVIEW_PAD = 90;
export function previewArgs(inp: string, out: string, start: number, end: number, srcDur: number, o: { pad?: number; height?: number } = {}): { args: string[]; offset: number } {
  const pad = o.pad ?? PREVIEW_PAD, h = o.height ?? 540;
  const offset = Math.max(0, start - pad), stop = Math.min(srcDur || end + pad, end + pad);
  return { offset, args: ["-y", "-v", "error", "-ss", offset.toFixed(3), "-i", inp, "-t", (stop - offset).toFixed(3), "-vf", `scale=-2:${h}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", h <= 360 ? "32" : "28", "-c:a", "aac", "-b:a", h <= 360 ? "64k" : "96k", "-movflags", "+faststart", out] };
}
