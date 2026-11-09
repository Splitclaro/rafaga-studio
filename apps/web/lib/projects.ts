"use client";
import { supabase, MAX_UPLOAD_BYTES } from "./supabase";

export const OK_MIME = ["video/mp4", "video/quicktime", "video/webm"];
export const STAGE: Record<string, string> = { queued: "En cola", validating: "Validando", extracting: "Extrayendo audio", transcribing: "Transcribiendo", selecting: "Seleccionando momentos", tracking: "Reencuadrando", rendering: "Renderizando", done: "Listo", failed: "Fallido", cancelled: "Cancelado" };

export function validateFile(f: File): string | null {
  if (!OK_MIME.includes(f.type)) return "Formato no válido. Usa MP4, MOV o WebM.";
  if (f.size > MAX_UPLOAD_BYTES) return `El archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el límite actual es ${MAX_UPLOAD_BYTES / 1048576} MB (plan gratuito de almacenamiento).`;
  return null;
}

/** Crea fuente → sube el vídeo → crea proyecto con el brief. Devuelve el id del proyecto. */
export async function createProject(a: { file: File; name: string; brief: string; count: number; onStep: (s: string) => void }): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
  a.onStep("Preparando tu espacio…");
  const { data: ws, error: e1 } = await supabase.from("workspaces").select("id").limit(1).single();
  if (e1 || !ws) throw new Error("No se encontró tu espacio de trabajo.");
  const { data: src, error: e2 } = await supabase.from("sources").insert({ workspace_id: ws.id, kind: "upload", mime: a.file.type, bytes: a.file.size, created_by: uid }).select("id").single();
  if (e2 || !src) throw new Error(e2?.message ?? "No se pudo crear la fuente.");
  a.onStep("Subiendo vídeo…");
  const { error: e3 } = await supabase.storage.from("originals").upload(`${ws.id}/${src.id}/original`, a.file, { contentType: a.file.type, upsert: false });
  if (e3) throw new Error(`Subida fallida: ${e3.message}`);
  a.onStep("Creando proyecto…");
  const { data: prj, error: e4 } = await supabase.from("projects").insert({ workspace_id: ws.id, source_id: src.id, name: a.name.trim() || a.file.name.replace(/\.[^.]+$/, ""), created_by: uid, project_brief: a.brief.trim() || null, clip_count: a.count }).select("id").single();
  if (e4 || !prj) throw new Error(e4?.message ?? "No se pudo crear el proyecto.");
  return prj.id;
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
