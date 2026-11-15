import { supabase } from "./supabase";

/** Elimina un proyecto del todo (archivos y filas). Pide confirmación explícita; devuelve un mensaje de error o null. */
export async function deleteProjectForever(id: string, name: string): Promise<string | null | "cancelled"> {
  if (!confirm(`¿Eliminar «${name}» definitivamente?\n\nSe borran el vídeo original, los clips, las exportaciones y la transcripción. No se puede deshacer.`)) return "cancelled";
  const { error } = await supabase.rpc("delete_project_now", { p_project: id });
  return error ? error.message : null;
}
