import type { TWord, RawCandidate } from "@rafaga/selection";
import { CANDIDATE_TOOL, SYSTEM_PROMPT } from "@rafaga/selection";

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const status = (e as { status?: number }).status;
      if (status && status < 500 && status !== 429) throw e; // errores permanentes no se reintentan
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** i) * (0.5 + Math.random())));
    }
  }
  throw last;
}
const httpErr = async (r: Response, who: string) => Object.assign(new Error(`${who} ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });

export interface Transcript { language: string | null; words: TWord[] }

/** Deepgram prerecorded (verificado: POST /v1/listen, Authorization: Token, nova-3, smart_format, detect_language). */
export async function transcribe(audio: Uint8Array, mime: string, key: string, language: "auto" | "es" | "en"): Promise<Transcript> {
  const qs = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true" });
  if (language === "auto") qs.set("detect_language", "true"); else qs.set("language", language);
  return retry(async () => {
    const r = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": mime }, body: new Blob([audio as BlobPart]) });
    if (!r.ok) throw await httpErr(r, "Deepgram");
    const j = (await r.json()) as { results: { channels: { detected_language?: string; alternatives: { words: { word: string; punctuated_word?: string; start: number; end: number }[] }[] }[] } };
    const ch = j.results.channels[0];
    const words = ch.alternatives[0].words.map((w) => ({ text: (w.punctuated_word ?? w.word).trim(), start: w.start, end: w.end }));
    return { language: ch.detected_language ?? (language === "auto" ? null : language), words };
  });
}

/** Anthropic Messages con tool_choice forzado (verificado en la documentación). */
export async function proposeClips(args: { key: string; model: string; brief: string | null; windowText: string; target: string }): Promise<RawCandidate[]> {
  const user = `<brief>${args.brief?.trim() || "(sin encargo: selección editorial general)"}</brief>\nObjetivo de duración: ${args.target}.\n<transcript>${args.windowText}</transcript>`;
  return retry(async () => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": args.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: args.model, max_tokens: 4096, system: SYSTEM_PROMPT, messages: [{ role: "user", content: user }], tools: [CANDIDATE_TOOL], tool_choice: { type: "tool", name: CANDIDATE_TOOL.name } }),
    });
    if (!r.ok) throw await httpErr(r, "Anthropic");
    const j = (await r.json()) as { content: { type: string; input?: { clips?: RawCandidate[] } }[] };
    const block = j.content.find((b) => b.type === "tool_use");
    return Array.isArray(block?.input?.clips) ? block!.input!.clips! : [];
  });
}

export * from "./net.ts";
export * from "./hls.ts";
export * from "./hlsconcat.ts";
