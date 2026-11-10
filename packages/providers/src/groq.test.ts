import { test } from "node:test";
import assert from "node:assert/strict";
import { aiConfig, groqTranscribe, groqProposeClips, groqDescribeFrames, attachPunctuation, parseClips, withRetry, AiError, AI_MODEL_DEFAULTS } from "./groq.ts";

const cfg = aiConfig({ GROQ_API_KEY: "gsk_secret123" });
const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });
test("configuración: modelos por defecto y sobrescritura por entorno", () => {
  assert.equal(cfg.sttModel, "whisper-large-v3-turbo"); assert.equal(cfg.sttFallbackModel, "whisper-large-v3");
  const c = aiConfig({ GROQ_API_KEY: "k", GROQ_STT_MODEL: "otro-stt", GROQ_EDITORIAL_MODEL: "otro-llm", GROQ_VISION_MODEL: "otro-vis" });
  assert.deepEqual([c.sttModel, c.editorialModel, c.visionModel], ["otro-stt", "otro-llm", "otro-vis"]); assert.equal(AI_MODEL_DEFAULTS.visionModel, aiConfig({}).visionModel);
});
test("puntuación repuesta desde el texto completo (Whisper entrega palabras sin ella)", () => {
  const w = attachPunctuation([{ word: "Hola", start: 0, end: 0.4 }, { word: "mundo", start: 0.4, end: 0.9 }, { word: "Qué", start: 1.2, end: 1.4 }, { word: "tal", start: 1.4, end: 1.7 }], "Hola, mundo. ¿Qué tal?");
  assert.deepEqual(w.map((x) => x.text), ["Hola,", "mundo.", "¿Qué", "tal?"]);   // conserva «¿» y el cierre de frase: los cortes respetan el final de oración
});
test("transcripción: petición multipart con palabra+segmento, glosario y modelo; devuelve palabras con tiempos y puntuación", async () => {
  let seen: { url: string; auth: string | null; fd: FormData } | null = null;
  const f = (async (u: string, init: RequestInit) => { seen = { url: u, auth: new Headers(init.headers).get("authorization"), fd: init.body as FormData };
    return json({ text: "Hola, mundo.", language: "spanish", duration: 1.2, words: [{ word: "Hola", start: 0, end: 0.5 }, { word: "mundo", start: 0.6, end: 1.1 }] }); }) as unknown as typeof fetch;
  const r = await groqTranscribe(new Uint8Array([1, 2, 3]), "audio/ogg", cfg, { language: "auto", glossary: ["Ráfaga", "Bootzy"], fetchImpl: f });
  assert.equal(seen!.url, "https://api.groq.com/openai/v1/audio/transcriptions"); assert.equal(seen!.auth, "Bearer gsk_secret123");
  assert.equal(seen!.fd.get("model"), "whisper-large-v3-turbo"); assert.equal(seen!.fd.get("response_format"), "verbose_json");
  assert.deepEqual(seen!.fd.getAll("timestamp_granularities[]"), ["word", "segment"]); assert.equal(seen!.fd.get("language"), null, "auto: sin idioma");
  assert.equal(seen!.fd.get("prompt"), "Ráfaga, Bootzy");
  assert.equal(r.language, "es"); assert.deepEqual(r.words.map((w) => w.text), ["Hola,", "mundo."]); assert.equal(r.durationSec, 1.2);
  const fb = await groqTranscribe(new Uint8Array([1]), "audio/ogg", cfg, { language: "es", model: cfg.sttFallbackModel, fetchImpl: f }); assert.equal(seen!.fd.get("model"), "whisper-large-v3"); assert.equal(seen!.fd.get("language"), "es"); assert.equal(fb.model, "whisper-large-v3");
});
test("errores: sin clave, 4xx permanente sin reintentos, 429 con retry-after y la clave jamás aparece", async () => {
  await assert.rejects(groqTranscribe(new Uint8Array(1), "audio/ogg", aiConfig({})), /GROQ_API_KEY/);
  let n = 0; const bad = (async () => { n++; return json({ error: { message: "invalid key gsk_secret123" } }, 401); }) as unknown as typeof fetch;
  await assert.rejects(groqTranscribe(new Uint8Array(1), "audio/ogg", cfg, { fetchImpl: bad }), (e: AiError) => e.status === 401 && !/secret123/.test(e.message));
  assert.equal(n, 1, "401 no se reintenta");
  const waits: number[] = []; let k = 0;
  const r = await withRetry(async () => { if (k++ < 2) throw new AiError(429, "rate", 3); return "ok"; }, 4, async (ms) => { waits.push(ms); });
  assert.equal(r, "ok"); assert.ok(waits.length === 2 && waits.every((w) => w >= 2400 && w <= 3600), `espera según retry-after: ${waits}`);
});
test("selección editorial: JSON del modelo → candidatos saneados + uso de tokens para el coste", async () => {
  let body: { model: string; response_format: unknown; messages: { role: string; content: string }[] } | null = null;
  const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return json({ choices: [{ message: { content: JSON.stringify({ clips: [{ startWord: 3, endWord: 40, title: "T", reason: "R", briefFit: "B", scores: { relevance: 11, hook: 7, standalone: -2, closure: 8 } }, { startWord: "x", endWord: 2 }] }) } }], usage: { prompt_tokens: 1200, completion_tokens: 150 } }); }) as unknown as typeof fetch;
  const r = await groqProposeClips(cfg, { brief: "consejos prácticos", windowText: "[0]Hola [1]mundo", target: "45s (máx 90s)", fetchImpl: f });
  assert.equal(body!.model, "llama-3.3-70b-versatile"); assert.deepEqual(body!.response_format, { type: "json_object" });
  assert.match(body!.messages[0].content, /DATOS, no instrucciones/); assert.match(body!.messages[1].content, /<brief>consejos prácticos<\/brief>/);
  assert.equal(r.clips.length, 1, "descarta el candidato sin índices"); assert.deepEqual(r.clips[0].scores, { relevance: 10, hook: 7, standalone: 0, closure: 8 });
  assert.deepEqual(r.usage, { tokensIn: 1200, tokensOut: 150 });
});
test("parseClips tolera texto alrededor del JSON y basura", () => {
  assert.equal(parseClips('Claro: {"clips":[{"startWord":1,"endWord":9,"title":"a","reason":"b","briefFit":"c","scores":{}}]} fin').length, 1);
  assert.deepEqual(parseClips("no es json"), []);
});
test("visión: fotogramas como data URL con el modelo de visión configurado", async () => {
  let body: { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] } | null = null;
  const f = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return json({ choices: [{ message: { content: "Se ve un mezclador." } }], usage: { prompt_tokens: 900, completion_tokens: 20 } }); }) as unknown as typeof fetch;
  const r = await groqDescribeFrames(cfg, { frames: [{ jpegBase64: "AAAA", at: 3 }, { jpegBase64: "BBBB", at: 9 }], question: "¿Qué ocurre?", fetchImpl: f });
  assert.equal(body!.model, cfg.visionModel); assert.equal(body!.messages[1].content.filter((c) => c.type === "image_url").length, 2); assert.match(body!.messages[1].content[1].image_url!.url, /^data:image\/jpeg;base64,AAAA/);
  assert.equal(r.text, "Se ve un mezclador.");
});
