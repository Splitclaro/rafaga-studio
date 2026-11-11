// GroqCloud (API compatible con OpenAI) — una sola integración en el servidor para toda la plataforma.
// Los identificadores de modelo se configuran por entorno; NO se han verificado contra la cuenta real (sin clave en este entorno).
import type { TWord, RawCandidate } from "@rafaga/selection";
import { CANDIDATE_TOOL, SYSTEM_PROMPT } from "@rafaga/selection";

export interface AiConfig { key: string; baseUrl: string; sttModel: string; sttFallbackModel: string; editorialModel: string; visionModel: string }
export const AI_MODEL_DEFAULTS = { sttModel: "whisper-large-v3-turbo", sttFallbackModel: "whisper-large-v3", editorialModel: "openai/gpt-oss-120b", visionModel: "meta-llama/llama-4-scout-17b-16e-instruct" } as const;
export function aiConfig(env: Record<string, string | undefined>): AiConfig {
  return { key: /^\s*PEGAR/i.test(env.GROQ_API_KEY ?? "") ? "" : (env.GROQ_API_KEY || "").trim(),   // un valor provisional («PEGAR_AQUI…») no cuenta como clave
    baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",   // «||»: una variable vacía del workflow cuenta como no definida
    sttModel: env.GROQ_STT_MODEL || AI_MODEL_DEFAULTS.sttModel, sttFallbackModel: env.GROQ_STT_FALLBACK_MODEL || AI_MODEL_DEFAULTS.sttFallbackModel,
    editorialModel: env.GROQ_EDITORIAL_MODEL || AI_MODEL_DEFAULTS.editorialModel, visionModel: env.GROQ_VISION_MODEL || AI_MODEL_DEFAULTS.visionModel };
}
type Fetch = typeof fetch;
export class AiError extends Error { status: number; retryAfter?: number; constructor(status: number, message: string, retryAfter?: number) { super(message); this.status = status; this.retryAfter = retryAfter; } }
async function fail(r: Response, who: string): Promise<never> {
  const body = (await r.text()).replace(/gsk_[\w-]+/g, "gsk_…").slice(0, 300);
  throw new AiError(r.status, `${who} ${r.status}: ${body}`, Number(r.headers.get("retry-after")) || undefined);
}
/** Reintenta 429/5xx respetando retry-after; los errores permanentes (4xx) no se reintentan. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e; const st = (e as AiError).status;
      if (st && st < 500 && st !== 429) throw e;
      await sleep(((e as AiError).retryAfter ? (e as AiError).retryAfter! * 1000 : Math.min(20000, 1000 * 2 ** i)) * (0.8 + Math.random() * 0.4));
    }
  }
  throw last;
}

const LANG: Record<string, string> = { spanish: "es", english: "en", catalan: "ca", galician: "gl", french: "fr", portuguese: "pt", italian: "it", german: "de", basque: "eu" };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]/g, "");
/** Whisper entrega las palabras sin puntuación: se repone desde el texto completo para que los cortes respeten el fin de frase. */
export function attachPunctuation(words: { word: string; start: number; end: number }[], text: string): TWord[] {
  const toks = text.split(/\s+/).filter(Boolean); let j = 0;
  return words.map((w) => {
    const nw = norm(w.word); let out = w.word.trim();
    for (let k = j; k < Math.min(toks.length, j + 4); k++) if (norm(toks[k]) === nw && nw) { out = toks[k]; j = k + 1; break; }
    return { text: out, start: w.start, end: w.end };
  });
}

export interface SttResult { language: string | null; words: TWord[]; durationSec: number; model: string; text: string }
export async function groqTranscribe(audio: Uint8Array, mime: string, cfg: AiConfig, o: { language?: "auto" | "es" | "en" | string; model?: string; glossary?: string[]; fetchImpl?: Fetch } = {}): Promise<SttResult> {
  if (!cfg.key) throw new AiError(0, "GROQ_API_KEY no configurada");
  const model = o.model ?? cfg.sttModel, f = o.fetchImpl ?? fetch;
  return withRetry(async () => {
    const fd = new FormData();
    fd.append("file", new Blob([audio as BlobPart], { type: mime }), mime.includes("ogg") ? "audio.ogg" : "audio.bin");
    fd.append("model", model); fd.append("response_format", "verbose_json"); fd.append("temperature", "0");
    fd.append("timestamp_granularities[]", "word"); fd.append("timestamp_granularities[]", "segment");
    if (o.language && o.language !== "auto") fd.append("language", o.language);
    if (o.glossary?.length) fd.append("prompt", o.glossary.join(", ").slice(0, 800));   // glosario del proyecto: nombres propios y términos
    const r = await f(`${cfg.baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${cfg.key}` }, body: fd });
    if (!r.ok) await fail(r, "Groq STT");
    const j = (await r.json()) as { text?: string; language?: string; duration?: number; words?: { word: string; start: number; end: number }[] };
    const words = attachPunctuation(j.words ?? [], j.text ?? "");
    return { language: j.language ? LANG[j.language.toLowerCase()] ?? j.language.slice(0, 2).toLowerCase() : null, words, durationSec: j.duration ?? (words.at(-1)?.end ?? 0), model, text: j.text ?? "" };
  });
}

export interface ChatUsage { tokensIn: number; tokensOut: number }
export async function groqChat(cfg: AiConfig, o: { model?: string; system: string; user: string | unknown[]; json?: boolean; maxTokens?: number; fetchImpl?: Fetch }): Promise<{ text: string; usage: ChatUsage; model: string }> {
  if (!cfg.key) throw new AiError(0, "GROQ_API_KEY no configurada");
  const model = o.model ?? cfg.editorialModel, f = o.fetchImpl ?? fetch;
  return withRetry(async () => {
    const r = await f(`${cfg.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.2, max_completion_tokens: o.maxTokens ?? 4000, ...(o.json ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "system", content: o.system }, { role: "user", content: o.user }] }) });
    if (!r.ok) await fail(r, "Groq chat");
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: j.choices?.[0]?.message?.content ?? "", usage: { tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 }, model };
  });
}

const clamp = (v: unknown) => Math.max(0, Math.min(10, Number(v) || 0));
export function parseClips(text: string): RawCandidate[] {
  let j: unknown; try { j = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; } }
  const arr = (j as { clips?: unknown[] } | null)?.clips; if (!Array.isArray(arr)) return [];
  return arr.flatMap((c) => { const x = c as Record<string, unknown>, s = (x.scores ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(x.startWord) || !Number.isInteger(x.endWord)) return [];
    return [{ startWord: x.startWord as number, endWord: x.endWord as number, title: String(x.title ?? "").slice(0, 120), reason: String(x.reason ?? "").slice(0, 400), briefFit: String(x.briefFit ?? "").slice(0, 300), excluded: x.excluded === true, scores: { relevance: clamp(s.relevance), hook: clamp(s.hook), standalone: clamp(s.standalone), closure: clamp(s.closure) } }]; });
}
/** Selección editorial con Groq: mismo prompt, esquema y validación contra el transcript real que con cualquier otro modelo. */
export async function groqProposeClips(cfg: AiConfig, a: { brief: string | null; windowText: string; target: string; fetchImpl?: Fetch }): Promise<{ clips: RawCandidate[]; usage: ChatUsage; model: string }> {
  const system = `${SYSTEM_PROMPT}\nResponde SOLO con un objeto JSON con este esquema: ${JSON.stringify(CANDIDATE_TOOL.input_schema)}`;
  const user = `<brief>${a.brief?.trim() || "(sin encargo: elige los mejores momentos autónomos)"}</brief>\nDuración objetivo: ${a.target}.\n<transcript>${a.windowText}</transcript>`;
  const r = await groqChat(cfg, { system, user, json: true, fetchImpl: a.fetchImpl });
  return { clips: parseClips(r.text), usage: r.usage, model: r.model };
}
/** Interpretación visual de fotogramas de UN candidato (coste controlado: pocos fotogramas, solo cuando el texto no basta). */
export async function groqDescribeFrames(cfg: AiConfig, a: { frames: { jpegBase64: string; at: number }[]; question: string; fetchImpl?: Fetch }): Promise<{ text: string; usage: ChatUsage; model: string }> {
  const content: unknown[] = [{ type: "text", text: `${a.question}\nLos fotogramas están en segundos: ${a.frames.map((f) => f.at.toFixed(1)).join(", ")}. Describe solo lo que se ve.` }, ...a.frames.slice(0, 5).map((f) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.jpegBase64}` } }))];
  return groqChat(cfg, { model: cfg.visionModel, system: "Eres un editor de vídeo. Describe con precisión lo observable en los fotogramas; no inventes.", user: content, fetchImpl: a.fetchImpl });
}
