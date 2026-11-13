// Pide la exportación MP4 (con subtítulos) de la versión vigente de un clip y devuelve un mensaje para el usuario.
export async function requestClipExport(token: string, clipId: string, version: number, aspect?: string): Promise<{ ok: boolean; message: string }> {
  const r = await fetch("/api/exports", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `ex-${clipId}-${version}-${crypto.randomUUID()}` },
    body: JSON.stringify({ items: [{ clip_id: clipId, version, aspect: aspect ?? "9:16", burn_subtitles: true, kind: "mp4" }] }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, message: j.reused ? "Ya estaba exportado con estos ajustes." : "Exportación en marcha. La verás en Exportados." } : { ok: false, message: j.error?.message ?? "No se pudo iniciar la exportación." };
}
