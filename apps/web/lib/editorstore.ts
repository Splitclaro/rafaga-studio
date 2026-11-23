"use client";
// Editor avanzado: proyectos (editor_projects por RPC con versión), resolución de medios y creación desde un clip de Autoclip.
import { clipToTimeline, concatTimelines, validateTimeline, emptyTimeline, type TimelineDoc, type TlAspect, type MediaRef, type CompositionV2 } from "@rafaga/composition";
import { supabase } from "./supabase";
import { r2Signed } from "./projects";
import { token } from "./songupload";

export type EditorProject = { id: string; name: string; aspect: TlAspect; doc: TimelineDoc; version: number; origin: Record<string, unknown> | null; updated_at: string };

export async function createProject(name: string, aspect: TlAspect, doc: TimelineDoc = emptyTimeline(), origin: Record<string, unknown> | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("create_editor_project", { p_name: name, p_aspect: aspect, p_doc: doc, p_origin: origin });
  if (error || !data) throw new Error("No se pudo crear el proyecto. Vuelve a intentarlo.");
  return data as string;
}
export async function loadProject(id: string): Promise<EditorProject | null> {
  const { data } = await supabase.from("editor_projects").select("id,name,aspect,doc,version,origin,updated_at").eq("id", id).maybeSingle();
  return data ? ({ ...data, doc: validateTimeline(data.doc) } as EditorProject) : null;
}
export type SaveResult = { ok: true; version: number } | { ok: false; conflict: true; current: number } | { ok: false; conflict: false };
export async function saveProject(id: string, base: number, p: { doc?: TimelineDoc; name?: string; aspect?: TlAspect }): Promise<SaveResult> {
  const { data, error } = await supabase.rpc("save_editor_project", { p_id: id, p_base_version: base, p_doc: p.doc ?? null, p_name: p.name ?? null, p_aspect: p.aspect ?? null });
  if (error) return { ok: false, conflict: false };
  const r = data as { conflict?: boolean; current_version?: number; version?: number };
  return r.conflict ? { ok: false, conflict: true, current: r.current_version ?? 0 } : { ok: true, version: r.version ?? base + 1 };
}
export async function deleteProject(id: string) { return !(await supabase.rpc("delete_editor_project", { p_id: id })).error; }

/** URL de lectura de un medio: fuentes de vídeo (R2), medios de colecciones (R2 o almacenamiento) y canciones (R2). */
export async function resolveMedia(ref: MediaRef): Promise<string> {
  const H = { Authorization: `Bearer ${await token()}` };
  if (ref.kind === "source") {   // el original se borra tras preparar el vídeo: el editor trabaja con la copia ligera (proxy 720p), con la misma línea de tiempo
    const r = await fetch(`/api/uploads/sources/${ref.id}/proxy`, { headers: H }), j = await r.json().catch(() => ({}));
    if (r.ok && j.url) return j.url as string;
    return r2Signed("get", ref.id);
  }
  if (ref.kind === "song") { const r = await fetch(`/api/lyrics/songs/${ref.id}/audio`, { headers: H }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error("audio"); return j.url as string; }
  const r = await fetch(`/api/lyrics/items/${ref.id}/url`, { headers: H }), j = await r.json().catch(() => ({}));
  if (r.ok && j.url) return j.url as string;
  const { data: it } = await supabase.from("media_items").select("storage_path").eq("id", ref.id).maybeSingle();
  const s = it ? await supabase.storage.from("originals").createSignedUrl(it.storage_path, 3600) : null;
  if (!s?.data?.signedUrl) throw new Error("medio");
  return s.data.signedUrl;
}

/** «Abrir en el editor avanzado» desde un clip de Autoclip: crea un proyecto con su origen, intervalo, cortes, subtítulos y volumen. */
async function clipDoc(clipId: string): Promise<{ doc: TimelineDoc; aspect: TlAspect; title: string; origin: Record<string, unknown> }> {
  const { data: c } = await supabase.from("clips").select("id,title,current_version,generation_id,project_id,candidate:clip_candidates(start_ms,end_ms)").eq("id", clipId).single();
  if (!c) throw new Error("No encontramos el clip.");
  const [{ data: v }, { data: g }, { data: p }] = await Promise.all([
    supabase.from("clip_versions").select("composition").eq("clip_id", clipId).eq("version", c.current_version).single(),
    supabase.from("generations").select("transcript_id").eq("id", c.generation_id).single(),
    supabase.from("projects").select("source_id").eq("id", c.project_id).single(),
  ]);
  if (!v || !p) throw new Error("No se pudo leer la versión del clip.");
  const comp = v.composition as CompositionV2 & { startSec?: number; endSec?: number; words?: { text: string; start: number; end: number }[] };
  const fragments = comp.fragments?.length ? comp.fragments : (() => { const cand = (Array.isArray(c.candidate) ? c.candidate[0] : c.candidate) as { start_ms: number; end_ms: number } | null; return cand ? [{ start: cand.start_ms / 1000, end: cand.end_ms / 1000 }] : []; })();
  if (!fragments.length) throw new Error("Este clip no tiene un intervalo definido.");
  const startS = fragments[0].start, endS = fragments.at(-1)!.end;
  const { data: tr } = comp.words?.length || !g ? { data: null } : await supabase.from("transcripts").select("words").eq("id", g.transcript_id).single();
  const words = comp.words?.length ? comp.words : ((tr?.words as { text: string; start: number; end: number }[] | undefined) ?? []).filter((w) => w.start >= startS && w.end <= endS + 0.05).map((w) => ({ ...w, start: +(w.start - startS).toFixed(3), end: +(w.end - startS).toFixed(3) }));
  const aspect = (["9:16", "16:9", "4:5", "1:1"].includes(comp.aspect) ? comp.aspect : "9:16") as TlAspect;
  const doc = clipToTimeline({ sourceId: p.source_id, fragments, cuts: comp.cuts, words, aspect, title: c.title, subtitles: comp.subtitles?.enabled !== false, volume: comp.audio?.muted ? 0 : (comp.audio?.volume ?? 1) });
  return { doc, aspect, title: c.title, origin: { kind: "autoclip", clip_id: clipId, project_id: c.project_id, source_id: p.source_id, fragments, cuts: comp.cuts ?? [], words: words.length } };
}

/** Abre uno o varios clips (en el orden dado) como un proyecto del editor avanzado. */
export async function openClipsInEditor(clipIds: string[]): Promise<string> {
  if (!clipIds.length || clipIds.length > 20) throw new Error("Elige entre 1 y 20 clips.");
  const parts = [] as Awaited<ReturnType<typeof clipDoc>>[]; for (const id of clipIds) parts.push(await clipDoc(id));
  if (parts.length === 1) return createProject(parts[0].title, parts[0].aspect, parts[0].doc, parts[0].origin);
  return createProject(`${parts[0].title} y ${parts.length - 1} más`, parts[0].aspect, concatTimelines(parts.map((x) => x.doc)), { kind: "autoclip", clips: clipIds, project_id: (parts[0].origin as { project_id?: string }).project_id });
}
