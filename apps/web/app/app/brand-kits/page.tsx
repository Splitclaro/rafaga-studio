"use client";
import { useState } from "react";
import { fontFamily, sniffFont } from "@rafaga/composition";
import { supabase } from "../../../lib/supabase";
import { useWorkspaceFonts } from "../../../lib/fonts";

const MAX = 5 * 1024 * 1024;

export default function BrandKits() {
  const { fonts, reload } = useWorkspaceFonts();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(f: File | undefined) {
    if (!f || busy) return;
    setMsg(null);
    if (f.size > MAX) return setMsg("La fuente supera 5 MB.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = sniffFont(bytes);
    if (!kind) return setMsg("Solo se admiten fuentes TTF u OTF (las que puede usar el render de vídeo).");
    const family = fontFamily(bytes);
    if (!family) return setMsg("No se pudo leer el nombre de la familia de esta fuente.");
    if (fonts?.some((x) => x.family === family)) return setMsg(`«${family}» ya está en tu workspace.`);
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const { data: ws } = await supabase.from("workspaces").select("id").limit(1).single();
      if (!ws || !s.session) throw new Error("Sesión no válida.");
      const path = `${ws.id}/fonts/${crypto.randomUUID()}.${kind}`;
      const up = await supabase.storage.from("brand-assets").upload(path, f, { contentType: kind === "otf" ? "font/otf" : "font/ttf" });
      if (up.error) throw new Error(up.error.message);
      const ins = await supabase.from("workspace_fonts").insert({ workspace_id: ws.id, family, storage_path: path, bytes: f.size, created_by: s.session.user.id });
      if (ins.error) { await supabase.storage.from("brand-assets").remove([path]); throw new Error(ins.error.message); }
      setMsg(`«${family}» añadida. Ya puedes elegirla en el editor de subtítulos.`);
      await reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al subir la fuente."); }
    finally { setBusy(false); }
  }
  async function remove(id: string, path: string, family: string) {
    if (!confirm(`¿Borrar la fuente «${family}»? Los clips que la usen no podrán exportarse hasta elegir otra.`)) return;
    await supabase.from("workspace_fonts").delete().eq("id", id);
    await supabase.storage.from("brand-assets").remove([path]);
    await reload();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-semibold">Brand kits</h1>
      <p className="mt-1 text-[var(--muted)]">Recursos de marca de tu workspace. Por ahora: fuentes propias. Logos, colores e intro/outro llegarán después.</p>
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Fuentes</h2>
          <label className={`cursor-pointer rounded-lg bg-[#111] px-4 py-2 text-sm font-medium text-white ${busy ? "opacity-50" : ""}`}>
            {busy ? "Subiendo…" : "Subir fuente (TTF/OTF)"}
            <input type="file" accept=".ttf,.otf,font/ttf,font/otf" className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Se guardan en privado y las usan tanto la vista previa como el MP4 exportado. Sube solo fuentes cuya licencia te permita usarlas en vídeo y web.</p>
        {msg && <p role="status" aria-live="polite" className="mt-3 text-sm">{msg}</p>}
        <ul className="mt-4 space-y-2">
          <li className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white px-3 py-2">
            <span><span className="text-lg" style={{ fontFamily: "Arial" }}>Arial · Ñandú bailó</span> <span className="ml-2 text-xs text-[var(--muted)]">incluida</span></span>
          </li>
          {fonts?.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
              <span className="min-w-0 truncate"><span className="text-lg" style={{ fontFamily: `"${f.family}", Arial` }}>{f.family} · Ñandú bailó</span> <span className="ml-2 text-xs text-[var(--muted)] tnum">{Math.round(f.bytes / 1024)} KB</span></span>
              <button onClick={() => remove(f.id, f.storage_path, f.family)} className="shrink-0 text-sm underline">Borrar</button>
            </li>
          ))}
        </ul>
        {fonts === null && <p className="mt-3 text-sm text-[var(--muted)]">Cargando…</p>}
      </section>
    </main>
  );
}
