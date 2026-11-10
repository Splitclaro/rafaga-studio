// Transcripción con proveedor configurable. Se transcribe UNA vez por fuente; cambiar el brief, el estilo o pedir traducciones reutiliza el resultado guardado.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribe, groqTranscribe, aiConfig, sttLine, type Line, type Tariffs, type AiConfig } from "@rafaga/providers";
import type { TWord } from "@rafaga/selection";

export interface AsrOut { language: string | null; words: TWord[]; provider: string; model: string; seconds: number; lines: Line[]; fallbackNote?: string }
const GROQ_MAX_BYTES = 24 * 1024 * 1024;   // el nivel gratuito admite 25 MB por archivo

function chunks(file: string, durationSec: number, dir: string): { path: string; offset: number }[] {
  const seg = 1800, out: { path: string; offset: number }[] = [];
  for (let t = 0, i = 0; t < durationSec; t += seg, i++) {
    const p = join(dir, `chunk${i}.ogg`);
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-t", String(seg + 1), "-i", file, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", p]);
    if (r.status !== 0) throw new Error("No se pudo trocear el audio.");
    out.push({ path: p, offset: t });
  }
  return out;
}

/**
 * Orden de proveedores: ASR_PROVIDER=groq (con GROQ_API_KEY) → Groq con respaldo en Deepgram; en otro caso Deepgram.
 * Los fragmentos difíciles pueden repetirse con `sttFallbackModel` (large-v3) si el modelo turbo no devuelve palabras.
 */
export async function transcribeAuto(audioPath: string, durationSec: number, o: { language: "auto" | "es" | "en"; dgKey: string; cfg?: AiConfig; provider?: string; tariffs: Tariffs; glossary?: string[] }): Promise<AsrOut> {
  const cfg = o.cfg ?? aiConfig(process.env), provider = (o.provider ?? process.env.ASR_PROVIDER ?? "deepgram").toLowerCase();
  const viaDeepgram = async (note?: string): Promise<AsrOut> => {
    const r = await transcribe(readFileSync(audioPath), "audio/ogg", o.dgKey, o.language);
    return { language: r.language, words: r.words, provider: "deepgram", model: "nova-3", seconds: durationSec, lines: [sttLine(o.tariffs, "deepgram", "nova-3", durationSec)], fallbackNote: note };
  };
  if (provider !== "groq" || !cfg.key) return viaDeepgram();
  try {
    const size = readFileSync(audioPath).length, dir = mkdtempSync(join(tmpdir(), "asr-"));
    try {
      const parts = size <= GROQ_MAX_BYTES ? [{ path: audioPath, offset: 0 }] : chunks(audioPath, durationSec, dir);
      const words: TWord[] = []; let language: string | null = null; const lines: Line[] = [];
      let model = cfg.sttModel, lastEnd = -1;
      for (const p of parts) {
        let r = await groqTranscribe(readFileSync(p.path), "audio/ogg", cfg, { language: o.language, glossary: o.glossary });
        if (!r.words.length && r.durationSec > 20) { r = await groqTranscribe(readFileSync(p.path), "audio/ogg", cfg, { language: o.language, glossary: o.glossary, model: cfg.sttFallbackModel }); model = cfg.sttFallbackModel; }   // fragmento difícil: modelo mayor
        language ??= r.language;
        lines.push(sttLine(o.tariffs, "groq", r.model, r.durationSec));
        for (const w of r.words) { const s = w.start + p.offset; if (s <= lastEnd) continue; words.push({ ...w, start: +s.toFixed(3), end: +(w.end + p.offset).toFixed(3) }); lastEnd = w.end + p.offset; }   // el solape entre trozos no duplica palabras
      }
      return { language, words, provider: "groq", model, seconds: durationSec, lines };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } catch (e) {
    if (!o.dgKey) throw e;   // sin respaldo posible
    return viaDeepgram(`Groq falló (${(e as Error).message.slice(0, 120)}): se usó Deepgram.`);
  }
}
