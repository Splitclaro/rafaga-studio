"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIEF_MAX, MAX_UPLOAD_BYTES } from "../../../lib/supabase";

const OK_MIME = ["video/mp4", "video/quicktime", "video/webm"];

export default function NewProject() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => (data.session ? setUid(data.session.user.id) : router.replace("/login")));
  }, [router]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !uid || !file) return;
    if (!OK_MIME.includes(file.type)) return setMsg("Formato no válido. Usa MP4, MOV o WebM.");
    if (file.size > MAX_UPLOAD_BYTES) return setMsg(`El archivo supera el límite actual de ${MAX_UPLOAD_BYTES / 1048576} MB (plan gratuito de almacenamiento).`);
    setBusy(true); setMsg("Preparando…");
    try {
      const { data: ws, error: e1 } = await supabase.from("workspaces").select("id").limit(1).single();
      if (e1 || !ws) throw new Error("No se encontró tu espacio de trabajo.");
      const { data: src, error: e2 } = await supabase.from("sources").insert({ workspace_id: ws.id, kind: "upload", mime: file.type, bytes: file.size, created_by: uid }).select("id").single();
      if (e2 || !src) throw new Error(e2?.message ?? "No se pudo crear la fuente.");
      setMsg("Subiendo vídeo…");
      const path = `${ws.id}/${src.id}/original`;
      const { error: e3 } = await supabase.storage.from("originals").upload(path, file, { contentType: file.type, upsert: false });
      if (e3) throw new Error(`Subida fallida: ${e3.message}`);
      const { data: prj, error: e4 } = await supabase.from("projects").insert({
        workspace_id: ws.id, source_id: src.id, name: name || file.name, created_by: uid,
        project_brief: brief.trim() || null, clip_count: count,
      }).select("id").single();
      if (e4 || !prj) throw new Error(e4?.message ?? "No se pudo crear el proyecto.");
      router.replace(`/app/p/${prj.id}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Nuevo proyecto</h1>
      <form onSubmit={create} className="space-y-5">
        <label className="block text-sm">Vídeo (MP4, MOV o WebM, hasta 50 MB por ahora)
          <input type="file" accept="video/mp4,video/quicktime,video/webm" required className="mt-1 block w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="block text-sm">Nombre (opcional)
          <input className="mt-1 w-full rounded bg-[var(--surface)] px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block">
          <span className="text-base font-medium">¿De qué trata el proyecto y qué clips necesitas?</span>
          <span className="mt-1 block text-sm text-[var(--muted)]">Describe el tema, a quién te diriges y qué momentos quieres destacar. Puedes dejarlo vacío para detectar automáticamente.</span>
          <textarea rows={5} maxLength={BRIEF_MAX} className="mt-2 w-full rounded bg-[var(--surface)] px-3 py-2" placeholder="Es un podcast sobre emprender. Quiero consejos prácticos para principiantes, tono directo y clips sobre errores al vender. Evita la parte de patrocinadores." value={brief} onChange={(e) => setBrief(e.target.value)} />
          <span className="tnum text-xs text-[var(--muted)]">{brief.length}/{BRIEF_MAX}</span>
        </label>
        <label className="block text-sm">Número de clips: {count}
          <input type="range" min={3} max={10} value={count} className="w-full" onChange={(e) => setCount(Number(e.target.value))} /></label>
        <button disabled={busy || !file} className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-[#101216] disabled:opacity-60">{busy ? "Subiendo…" : "Crear proyecto"}</button>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-[var(--muted)]">{msg}</p>
      </form>
    </main>
  );
}
