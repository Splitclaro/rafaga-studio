"use client";
import { useCallback, useEffect, useState } from "react";
import { PRESETS, validateStyle, type SubtitleStyle } from "@rafaga/composition";
import { supabase } from "./supabase";

export type SavedStyle = { id: string; name: string; style: SubtitleStyle };

/** Estilos propios del workspace (Style Studio) con estilos base. */
export function useTextStyles() {
  const [saved, setSaved] = useState<SavedStyle[] | null>(null);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("text_styles").select("id,name,style").order("created_at");
    setSaved((data ?? []).map((r) => ({ id: r.id, name: r.name, style: validateStyle(r.style) })));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { saved, reload, base: PRESETS };
}
