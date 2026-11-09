"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type WsFont = { id: string; family: string; storage_path: string; bytes: number; created_at: string };

/** Carga las fuentes propias del workspace y las registra en el navegador (misma fuente que usa el render). */
export function useWorkspaceFonts() {
  const [fonts, setFonts] = useState<WsFont[] | null>(null);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("workspace_fonts").select("id,family,storage_path,bytes,created_at").order("created_at");
    const list = (data ?? []) as WsFont[];
    await Promise.all(list.map(async (f) => {
      if ([...document.fonts].some((x) => x.family === f.family)) return;
      const { data: s } = await supabase.storage.from("brand-assets").createSignedUrl(f.storage_path, 3600);
      if (!s?.signedUrl) return;
      try { const ff = new FontFace(f.family, `url(${s.signedUrl})`); await ff.load(); document.fonts.add(ff); } catch { /* fuente inválida: se mostrará sin muestra */ }
    }));
    setFonts(list);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { fonts, reload };
}
