// Worker en GitHub Actions: reclama jobs `detect` de Supabase y ejecuta el pipeline real.
// Secretos requeridos (variables de entorno): SUPABASE_URL, SUPABASE_SECRET_KEY, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, buildComposition, retimeWords, ffmpegArgs, styleForRatio, renderFamily, groupsFrom, toSRT, toVTT, toTranscript, sanitizeLogo, type BrandLogo, validateStyle, SYSTEM_FONT, escapeFilterPath, PRESETS, RATIO_SIZE, type Composition, type Ratio, type Word } from "@rafaga/composition";
import { proposeClips, safeGet, groqProposeClips, aiConfig, llmLine, renderLine, storageLine, transferLine, loadTariffs, type Line, parseFeed, captureHls, concatWindow, type WindowOut } from "@rafaga/providers";
import { audioMomentsFromPcm } from "@rafaga/lyrics";
import { transcribeAuto } from "./asr.ts";
import { contextTail, freshCandidates, reserveLiveChunk, type Span } from "@rafaga/providers";
import { recordUsage, enforceQuota, loadLimits, loadUsage } from "./ledger.ts";
import { scanFaces, reframePath } from "./reframe.ts";
import { alignLyrics, lyricsFromAsr, parseLyrics, planVariants, lyricFfmpegArgs, sequenceFor, DEFAULT_BG, LOOKS, resolveLook, varyLook, layoutLyrics, layoutToAss, planShots, planShotsOnBeats, detectBeats, beatsReliable, type BeatResult, lookFfmpegArgs, canvasSize, LOOK_ENGINE_VERSION, type BgItem, type BgSettings, type TimedWord, type ShotItem, type DeepPartial, type LyricLook, planMore, restoreShots, swapShots, type MoreLock, type SavedShot, type VariantSpec } from "@rafaga/lyrics";
import { extractThumb } from "./thumb.ts";
import { fetchOriginal, previewArgs } from "./source.ts";
import { ZipBuilder } from "./zip.ts";
import { interpretBrief, refineBounds, padBounds, briefHash, RUBRIC_VERSION, validateCandidates, windows, transcriptText, lexicalCandidates, LEXICAL_VERSION, suggestTitle, normalizeBrief, composeBrief, lexicalBrief, BRIEF_VERSION, type TWord, type RawCandidate } from "@rafaga/selection";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Falta el secreto ${k}`); process.exit(2); } return v; };
const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const DG = process.env.DEEPGRAM_API_KEY ?? "", AN = process.env.ANTHROPIC_API_KEY ?? "";   // al menos un proveedor de transcripción: Deepgram o Groq
const AI = aiConfig(process.env), TARIFFS = loadTariffs(process.env.AI_TARIFFS);
if (!DG && !AI.key) throw new Error("Falta DEEPGRAM_API_KEY o GROQ_API_KEY");
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 28, encoding: "buffer" });
  if (r.status !== 0) throw new Error(`${cmd} falló (${r.status}): ${r.stderr.toString().slice(-400)}`);
  return r.stdout.toString();
};
const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => { if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message ?? "sin datos"}`); return r.data as NonNullable<T>; };

/** Descarga la fuente propia del workspace (si el estilo la usa) a un fontsdir para libass. */
async function fontsFor(ws: string, family: string, dir: string): Promise<string | undefined> {
  if (family === "Arial") return undefined;
  if (family === SYSTEM_FONT.family) {
    // Fuente del sistema (bucket público app-fonts): se cachea en el disco del worker.
    const cache = join(tmpdir(), "rafaga-system-fonts");
    if (!existsSync(join(cache, SYSTEM_FONT.ttf))) {
      const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/${SYSTEM_FONT.bucket}/${SYSTEM_FONT.ttf}`);
      if (!r.ok) throw new Error(`fuente del sistema no disponible (${r.status})`);
      mkdirSync(cache, { recursive: true }); writeFileSync(join(cache, SYSTEM_FONT.ttf), Buffer.from(await r.arrayBuffer()));
    }
    return cache;
  }
  const { data } = await sb.from("workspace_fonts").select("storage_path").eq("workspace_id", ws).eq("family", family).maybeSingle();
  if (!data) throw Object.assign(new Error(`La fuente «${family}» no está en este workspace.`), { permanent: true });
  const dl = await sb.storage.from("brand-assets").download(data.storage_path);
  if (dl.error || !dl.data) throw new Error(`descarga de fuente: ${dl.error?.message}`);
  const fd = join(dir, "fonts"); mkdirSync(fd, { recursive: true });
  writeFileSync(join(fd, "font" + (data.storage_path.endsWith(".otf") ? ".otf" : ".ttf")), Buffer.from(await dl.data.arrayBuffer()));
  return fd;
}

type Job = { id: string; kind: string; workspace_id: string; project_id: string | null; clip_id: string | null; attempts: number; params: { session_id?: string; rule_id?: string; manual?: boolean; version?: number; ratio?: Ratio; burn?: boolean; song_id?: string; n?: number; styles?: string[]; backgrounds?: string[]; seed?: number; start?: number; end?: number; collection_id?: string | null; settings?: Partial<BgSettings> & { textScale?: number }; res?: 1080 | 720; native?: boolean; variation?: number; look_overrides?: Record<string, DeepPartial<LyricLook>>; live?: { session_id: string; abs_start: number; skip_before: number; window_end_ms?: number }; more?: { from_video: string; lock: MoreLock; swap?: number[] } } };
const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  sb.from("jobs").update({ status, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra }).eq("id", id);

/** Vista previa del editor para originales por partes (ver source.ts). Un fallo aquí no rompe el clip. */
async function savePreview(ws: string, clipId: string, inp: string, start: number, end: number, dir: string, height?: number) {
  try {
    const dur = Number(JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", inp])).format.duration);
    const out = join(dir, `pv-${clipId}.mp4`); const { args, offset } = previewArgs(inp, out, start, end, dur, { height });
    sh("ffmpeg", args);
    const path = `${ws}/${clipId}/preview.mp4`;
    const up = await sb.storage.from("proxies").upload(path, readFileSync(out), { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await sb.from("clips").update({ preview_path: path, preview_offset: offset }).eq("id", clipId);
  } catch (e) { console.warn("vista previa", clipId, (e as Error).message); }
}

/** Modos de herramienta: el vídeo (o su tramo) entero como un único clip editable. */
type ProjectRow = { brief_data?: unknown; id: string; name: string; workspace_id: string; source_id: string; project_brief: string | null; max_seconds: number; mode: string };
async function processWhole(job: Job, project: ProjectRow, src: { id: string; range_start_ms: number | null; range_end_ms: number | null; parts?: number }, dir: string, path: string, words: TWord[], t0: number, m: Record<string, number | string>, transcriptId?: string) {
  await setStatus(job.id, "rendering");
  const inp = join(dir, "in");
  if (!existsSync(inp)) {
    await fetchOriginal(sb, path, inp);
  }
  const full = Number(JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", inp])).format.duration);
  const startSec = src.range_start_ms != null && src.range_end_ms ? src.range_start_ms / 1000 : 0;
  const endSec = src.range_end_ms ? Math.min(full, src.range_end_ms / 1000) : full;
  const len = endSec - startSec;
  if (len < 1) throw Object.assign(new Error("El tramo elegido es demasiado corto."), { permanent: true });
  if (len > 600) throw Object.assign(new Error("Esta herramienta procesa hasta 10 min de vídeo. Elige un tramo más corto o usa «Clips»."), { permanent: true });
  let trId = transcriptId;
  if (!trId) {
    const ex = (await sb.from("transcripts").select("id").eq("source_id", src.id).limit(1)).data?.[0];
    trId = ex?.id ?? ok(await sb.from("transcripts").insert({ workspace_id: project.workspace_id, source_id: src.id, language: null, words: [], asr_provider: "none", asr_model: "none" }).select("id").single(), "transcript").id;
  }
  const gen = ok(await sb.from("generations").insert({ workspace_id: project.workspace_id, project_id: project.id, transcript_id: trId, brief_snapshot: null, brief_sha256: briefHash(null), rubric_version: "whole-video", model: `herramienta-${project.mode}`, params: { mode: project.mode, startSec, endSec }, status: "running" }).select("id").single(), "generación");
  const cand = ok(await sb.from("clip_candidates").insert({ workspace_id: project.workspace_id, generation_id: gen.id, start_ms: Math.round(startSec * 1000), end_ms: Math.round(endSec * 1000), title: project.name, reason: `Vídeo completo (${project.mode})`, brief_fit: null, scores: { label: "sin puntuación: herramienta sobre el vídeo entero" } }).select("id").single(), "candidato");
  const clip = ok(await sb.from("clips").insert({ workspace_id: project.workspace_id, project_id: project.id, generation_id: gen.id, candidate_id: cand.id, title: project.name, title_source: "project" }).select("id").single(), "clip");
  const comp = { ...buildComposition({ words: words as Word[], startSec, endSec }), layout: (project.mode === "social" ? "fill" : "blur") as Composition["layout"], burnSubtitles: project.mode !== "reframe" };
  await sb.from("clip_versions").insert({ clip_id: clip.id, workspace_id: project.workspace_id, version: 1, composition: comp });
  const ass = join(dir, "w.ass"), out = join(dir, "w.mp4");
  writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: renderFamily(comp.style.fontName) }, RATIO_SIZE[comp.ratio]));
  const t1 = Date.now();
  sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out, fontsDir: await fontsFor(project.workspace_id, comp.style.fontName, dir) }));
  const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
  const rpath = `${project.workspace_id}/${clip.id}/v1-9x16.mp4`;
  const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
  if (up.error) throw new Error(`subida render: ${up.error.message}`);
  await sb.from("renders").insert({ workspace_id: project.workspace_id, clip_id: clip.id, clip_version: 1, ratio: "9:16", burn_subtitles: comp.burnSubtitles, spec_sha256: briefHash(JSON.stringify(comp)), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size } });
  await saveThumb(project.workspace_id, clip.id, out, dir);
  if (src.parts) await savePreview(project.workspace_id, clip.id, inp, startSec, endSec, dir, 360);
  await sb.from("generations").update({ status: "done" }).eq("id", gen.id);
  m.render_ms = Date.now() - t1; m.first_clip_ms = Date.now() - t0; m.all_clips_ms = Date.now() - t0; m.mode = project.mode;
  await setStatus(job.id, "done", { generation_id: gen.id, metrics: m });
  console.log("whole ok", job.id, project.mode, m);
}

async function processJob(job: Job) {
  const m: Record<string, number | string> = {};
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-"));
  try {
    const project = ok(await sb.from("projects").select("id,name,workspace_id,source_id,project_brief,brief_data,language,clip_count,target_seconds,max_seconds,deleted_at,mode").eq("id", job.project_id!).single(), "proyecto");
    if (project.deleted_at) return void (await setStatus(job.id, "cancelled"));
    const src = ok(await sb.from("sources").select("id,mime,range_start_ms,range_end_ms,kind,thumb_path,parts,storage_backend").eq("id", project.source_id).single(), "fuente");
    const path = `${project.workspace_id}/${src.id}/original`;

    if (project.mode === "reframe") return await processWhole(job, project, src, dir, path, [], t0, m);

    // 1) Transcript (reutilizado si ya existe: cambiar el brief no repite ASR)
    let tr = (await sb.from("transcripts").select("id,words,language").eq("source_id", src.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
    if (!tr) {
      await setStatus(job.id, "extracting");
      const inp = join(dir, "in"); await fetchOriginal(sb, path, inp);
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", inp]));
      const hasAudio = probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio");
      const durationMs = Math.round(Number(probe.format.duration) * 1000);
      const vs = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      await sb.from("sources").update({ status: hasAudio ? "validated" : "failed", duration_ms: durationMs, width: vs?.width, height: vs?.height, has_audio: hasAudio }).eq("id", src.id);
      if (!src.thumb_path) {   // enlace de YouTube: no hay portada subida desde el navegador
        try { const jpg = join(dir, "src.jpg"); extractThumb(inp, jpg); const tp = `${project.workspace_id}/${src.id}/thumb.jpg`;
          if (!(await sb.storage.from("originals").upload(tp, readFileSync(jpg), { contentType: "image/jpeg", upsert: true })).error) await sb.from("sources").update({ thumb_path: tp, bytes: statSync(inp).size }).eq("id", src.id); } catch { /* portada opcional */ }
      }
      if (!hasAudio) throw Object.assign(new Error("El vídeo no tiene pista de audio: no se puede seleccionar por voz."), { permanent: true });
      if (durationMs < 15000) throw Object.assign(new Error(`El vídeo dura ${(durationMs / 1000).toFixed(1)} s. Para buscar momentos hace falta al menos 15 s de contenido hablado.`), { permanent: true, code: "too_short" });
      const audio = join(dir, "a.ogg");
      sh("ffmpeg", ["-y", "-v", "error", "-i", inp, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", audio]);
      await setStatus(job.id, "transcribing");
      // Cuota previa: los minutos de ESTA fuente (o de su tramo) frente a los límites semanales y globales. Lo transcrito antes no vuelve a contar.
      const srcMin = (src.range_start_ms != null && src.range_end_ms ? (src.range_end_ms - src.range_start_ms) : durationMs) / 60000;
      const warn = await enforceQuota(sb, project.workspace_id, { sourceMinutes: srcMin, clips: Math.min(20, project.clip_count) });
      if (warn) m.quota_warning = warn;
      const t1 = Date.now();
      const res = await transcribeAuto(audio, durationMs / 1000, { language: project.language, dgKey: DG, tariffs: TARIFFS });
      m.asr_ms = Date.now() - t1; m.asr_provider = res.provider; m.asr_model = res.model; if (res.fallbackNote) m.asr_note = res.fallbackNote;
      await recordUsage(sb, { ws: project.workspace_id, projectId: project.id, jobId: job.id, lines: res.lines });
      m.speech_words = res.words.length;   // con poca voz (música, sesiones de DJ) se selecciona por energía del audio, no por texto
      tr = ok(await sb.from("transcripts").insert({ workspace_id: project.workspace_id, source_id: src.id, language: res.language, words: res.words, asr_provider: res.provider, asr_model: res.model }).select("id,words,language").single(), "transcript");
    } else m.asr_ms = 0; // reutilizado
    if (!tr) throw new Error("transcript no disponible");
    const rs = src.range_start_ms != null && src.range_end_ms ? src.range_start_ms / 1000 : null, re = src.range_end_ms ? src.range_end_ms / 1000 : null;
    const words = (tr.words as TWord[]).filter((w) => rs == null || re == null || (w.start >= rs && w.end <= re));
    const musicMode = words.length < 20;   // casi sin voz: sesión musical / DJ → selección por energía y transiciones
    if (musicMode && project.mode !== "clips" && !words.length) throw Object.assign(new Error("No hay habla en el tramo elegido."), { permanent: true, code: "no_speech_range" });
    if (project.mode !== "clips") return await processWhole(job, project, src, dir, path, words, t0, m, tr.id);

    // 2) Selección guiada por brief
    await setStatus(job.id, "selecting");
    const t2 = Date.now();
    // Brief: texto compuesto (para la IA y para guardar la versión usada) y versión léxica (solo objetivo, temas, personas y exclusiones)
    const bdata = normalizeBrief(project.brief_data);
    const brief = (bdata ? composeBrief(bdata) : (project.project_brief as string | null)) || null;
    const lexBrief = bdata ? lexicalBrief(bdata) : brief;
    // Criterio editorial: el encargo en lenguaje natural puede fijar cantidad, duración y exclusiones obligatorias
    const intent = interpretBrief(lexBrief);
    const wantCount = Math.min(20, intent.count ?? project.clip_count), minSec = intent.minSec ?? 12, maxSec = Math.max(minSec + 1, intent.maxSec ?? project.max_seconds);
    if (intent.clarify) m.clarify = intent.clarify;
    m.intent = JSON.stringify({ count: intent.count, minSec: intent.minSec, maxSec: intent.maxSec, kinds: intent.kinds, exclude: intent.exclude.length, soft: intent.soft.length, payoff: intent.wantsPayoff });
    let raw: RawCandidate[] = [];
    let selector = MODEL, fallbackReason: string | null = null;
    const llmLines: Line[] = [];
    try {
      const useGroq = !!AI.key && (process.env.LLM_PROVIDER === "groq" || !AN || process.env.LLM_PROVIDER !== "anthropic");   // con clave de Groq se usa Groq salvo que se pida Anthropic expresamente
      if (!useGroq && !AN) throw new Error("Sin proveedor de IA editorial configurado (ANTHROPIC_API_KEY o GROQ_API_KEY)");
      if (words.length >= 20) {
        let tIn = 0, tOut = 0;
        for (const w of windows(words, 600, 45)) {
          const target = `${project.target_seconds}s (máx ${project.max_seconds}s)`;
          if (useGroq) { const r = await groqProposeClips(AI, { brief, windowText: transcriptText(words, w.from, w.to), target }); raw.push(...r.clips); tIn += r.usage.tokensIn; tOut += r.usage.tokensOut; }
          else { raw.push(...(await proposeClips({ key: AN, model: MODEL, brief, windowText: transcriptText(words, w.from, w.to), target }))); tIn += Math.round(transcriptText(words, w.from, w.to).length / 4); tOut += 400; }
        }
        selector = useGroq ? `groq:${AI.editorialModel}` : MODEL;
        llmLines.push(llmLine(TARIFFS, useGroq ? "groq" : "anthropic", useGroq ? AI.editorialModel : MODEL, tIn, tOut, useGroq));   // Anthropic: tokens estimados (el cliente actual no devuelve el uso)
      }
    } catch (e) {
      // Respaldo sin IA, etiquetado: el usuario ve que la selección es léxica.
      fallbackReason = (e as Error).message.slice(0, 200);
      selector = LEXICAL_VERSION;
      raw = lexicalCandidates(words, lexBrief, { minSec, maxSec, count: wantCount });
    }
    m.selector = selector;
    // Entrada y salida con criterio: recupera la frase que da contexto, incluye la pregunta y deja oír el remate (también sobre lo que propone la IA)
    if (selector !== LEXICAL_VERSION) raw = raw.map((c) => { try { const r = refineBounds(words, c.startWord, c.endWord, { maxSec, wantsPayoff: intent.wantsPayoff, wantsQuestion: intent.wantsQuestion }); return { ...c, startWord: r.a, endWord: r.b, reason: r.changes.length ? `${c.reason} (${r.changes.join("; ")})` : c.reason }; } catch { return c; } });
    const v0 = validateCandidates(words, raw, { minSec, maxSec, count: wantCount, hasBrief: !!brief?.trim() });
    const rejected = v0.rejected;
    let accepted: (typeof v0.accepted[number])[] = v0.accepted.map((c) => ({ ...c, ...padBounds(words, c.startWord, c.endWord) }));
    if (job.params.live) {   // Directo: fuera lo que pertenece al contexto ya cubierto y lo ya entregado en la sesión (reconexiones incluidas)
      const lv = job.params.live;
      const { data: wins } = await sb.from("live_windows").select("project_id,abs_start").eq("session_id", lv.session_id);
      const delivered: Span[] = [];
      for (const w of wins ?? []) { if (!w.project_id || w.project_id === project.id) continue;
        const { data: cs } = await sb.from("clip_candidates").select("start_ms,end_ms,generations!inner(project_id)").eq("generations.project_id", w.project_id);
        for (const c of cs ?? []) delivered.push({ start: Number(w.abs_start) + c.start_ms / 1000, end: Number(w.abs_start) + c.end_ms / 1000 }); }
      const fr = freshCandidates(accepted.map((c) => ({ c, start: c.startSec, end: c.endSec })), { absStart: lv.abs_start, skipBefore: lv.skip_before, delivered });
      m.live_dropped = fr.dropped.map((d) => d.why).join(","); accepted = fr.fresh.map((x) => x.c);
    }
    if (musicMode) {   // Música / DJ: momentos por subidas de energía con su preparación (estimación a partir del volumen, no de la voz)
      const inpM = join(dir, "in");
      await fetchOriginal(sb, path, inpM);
      const off = rs ?? 0;
      const pcmR = spawnSync("ffmpeg", ["-v", "error", ...(rs != null ? ["-ss", String(rs)] : []), ...(re != null ? ["-t", String(re - (rs ?? 0))] : []), "-i", inpM, "-vn", "-ac", "1", "-ar", "4000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
      if (pcmR.status !== 0) throw new Error("No se pudo analizar el audio para buscar momentos musicales.");
      const b = pcmR.stdout as Buffer; const pcm = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
      const ms = audioMomentsFromPcm(pcm, 4000, { minSec: Math.max(15, intent.minSec ?? 15), maxSec: Math.min(60, maxSec), count: wantCount, prepSec: 8 });
      selector = "lexical-audio-energy-v1"; fallbackReason = null;
      accepted = ms.map((x, i) => ({ startWord: -1, endWord: -1, title: `${x.kind === "drop" ? "Entrada" : "Momento de máxima energía"} a los ${Math.floor((x.start + off) / 60)}:${String(Math.floor((x.start + off) % 60)).padStart(2, "0")}`,
        reason: `${x.why.join(". ")}. Estimación por volumen del audio.`, briefFit: "Sesión con poca voz: selección por energía", scores: { relevance: 5, hook: 7, standalone: 6, closure: 6 }, startSec: +(x.start + off).toFixed(2), endSec: +(x.end + off).toFixed(2), overall: x.score / 10 - i * 0.001 }));
      m.music = 1; m.moments = ms.length;
    }
    m.selection_ms = Date.now() - t2; m.raw = raw.length; m.accepted = accepted.length; m.rejected = rejected.length;

    const gen = ok(await sb.from("generations").insert({ workspace_id: project.workspace_id, project_id: project.id, transcript_id: tr.id, brief_snapshot: brief, brief_sha256: briefHash(brief), rubric_version: RUBRIC_VERSION, model: selector, params: { clip_count: project.clip_count, max_seconds: project.max_seconds, rejected, fallbackReason, brief_data: bdata, brief_version: BRIEF_VERSION }, status: "running" }).select("id").single(), "generación");

    // 3) Candidatos, clips y render (primer clip antes del lote)
    await setStatus(job.id, "rendering");
    const inp = join(dir, "in");
    if (!existsSync(inp)) {
      await fetchOriginal(sb, path, inp);
    }
    let firstClipMs = 0;
    const renderOne = async (i: number, c: (typeof accepted)[number]) => {
      const cand = ok(await sb.from("clip_candidates").insert({ workspace_id: project.workspace_id, generation_id: gen.id, start_ms: Math.round(c.startSec * 1000), end_ms: Math.round(c.endSec * 1000), title: c.title, reason: c.reason, brief_fit: c.briefFit, scores: { ...c.scores, overall: c.overall, label: "estimación editorial de IA" } }).select("id").single(), "candidato");
      const clip = ok(await sb.from("clips").insert({ workspace_id: project.workspace_id, project_id: project.id, generation_id: gen.id, candidate_id: cand.id, title: c.title, title_source: selector === LEXICAL_VERSION ? "lexical" : "ai" }).select("id").single(), "clip");
      const comp = buildComposition({ words: words as Word[], startSec: c.startSec, endSec: c.endSec });
      await sb.from("clip_versions").insert({ clip_id: clip.id, workspace_id: project.workspace_id, version: 1, composition: comp });
      const ass = join(dir, `c${i}.ass`), out = join(dir, `c${i}.mp4`);
      writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: renderFamily(comp.style.fontName) }, RATIO_SIZE[comp.ratio]));
      const t3 = Date.now();
      sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out, fontsDir: await fontsFor(project.workspace_id, comp.style.fontName, dir) }));
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
      const rpath = `${project.workspace_id}/${clip.id}/v1-9x16.mp4`;
      const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error(`subida render: ${up.error.message}`);
      await sb.from("renders").insert({ workspace_id: project.workspace_id, clip_id: clip.id, clip_version: 1, ratio: "9:16", burn_subtitles: true, spec_sha256: briefHash(JSON.stringify(comp)), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size, streams: probe.streams.map((s: { codec_name: string; width?: number; height?: number }) => [s.codec_name, s.width, s.height]) } });
      await saveThumb(project.workspace_id, clip.id, out, dir);
      if (src.parts > 0) await savePreview(project.workspace_id, clip.id, inp, c.startSec, c.endSec, dir);
      m[`render_ms_${i}`] = Date.now() - t3;
      if (i === 0) firstClipMs = Date.now() - t0;
        };
    const byValue = [...accepted].sort((x, y) => y.overall - x.overall);   // el mejor primero: es el que el usuario descargará antes
    if (byValue.length) await renderOne(0, byValue[0]);          // primer clip antes que el lote
    const rest = byValue.slice(1).map((c, k) => [k + 1, c] as const);
    for (let k = 0; k < rest.length; k += 2) await Promise.all(rest.slice(k, k + 2).map(([i, c]) => renderOne(i, c)));
    m.first_clip_ms = firstClipMs; m.all_clips_ms = Date.now() - t0;
    {   // Coste del lote: IA editorial (medido si el proveedor devuelve tokens), render (estimado por tiempo de worker), almacenamiento y descarga (estimados)
      const renderMs = Object.entries(m).filter(([k]) => k.startsWith("render_ms_")).reduce((a, [, v]) => a + Number(v), 0);
      const bytes = byValue.length * 20 * 1048576;   // ≈20 MB por clip de 40 s (medido en el benchmark)
      await recordUsage(sb, { ws: project.workspace_id, projectId: project.id, jobId: job.id, lines: [...llmLines, renderLine(TARIFFS, renderMs), storageLine(TARIFFS, bytes), transferLine(TARIFFS, bytes)] });
    }
    await sb.from("generations").update({ status: "done" }).eq("id", gen.id);
    await setStatus(job.id, "done", { generation_id: gen.id, metrics: m });
    console.log("job ok", job.id, m);
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("job fallo", job.id, err.message);
    // Permanente: no se reintenta. Transitorio: vuelve a la cola hasta 3 intentos (claim_job lo limita).
    await setStatus(job.id, err.permanent || job.attempts >= 3 ? "failed" : "queued", { error_code: (err as { code?: string }).code ?? (err.permanent ? "permanent" : "transient"), error_message: err.message.slice(0, 300), metrics: m });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Miniatura real del clip (mejor de 3 fotogramas) en renders/<ws>/<clip>/thumb.jpg. Un fallo aquí nunca rompe el clip. */
async function saveThumb(ws: string, clipId: string, videoPath: string, dir: string) {
  try {
    const jpg = join(dir, `thumb-${clipId}.jpg`);
    extractThumb(videoPath, jpg);
    const path = `${ws}/${clipId}/thumb.jpg`;
    const up = await sb.storage.from("renders").upload(path, readFileSync(jpg), { contentType: "image/jpeg", upsert: true });
    if (up.error) throw new Error(up.error.message);
    await sb.from("clips").update({ thumb_path: path }).eq("id", clipId);
  } catch (e) { console.error("miniatura:", (e as Error).message); }
}
/** Relleno de miniaturas para clips anteriores a esta función: pocos por pasada, sin bloquear trabajos. */
let lastThumbTick = 0;
async function tickThumbs() {
  if (Date.now() - lastThumbTick < 45_000) return; lastThumbTick = Date.now();
  const { data } = await sb.from("clips").select("id,workspace_id,renders!inner(storage_path,status,created_at)").is("thumb_path", null).eq("renders.status", "ready").order("created_at", { ascending: false }).limit(2);
  for (const c of (data ?? []) as unknown as { id: string; workspace_id: string; renders: { storage_path: string; created_at: string }[] }[]) {
    const dir = mkdtempSync(join(tmpdir(), "rafaga-t-"));
    try {
      const r = [...c.renders].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const d = await sb.storage.from("renders").download(r.storage_path);
      if (d.error || !d.data) continue;
      const vp = join(dir, "v.mp4"); writeFileSync(vp, Buffer.from(await d.data.arrayBuffer()));
      await saveThumb(c.workspace_id, c.id, vp, dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

/** Títulos sin IA anteriores a `suggestTitle`: se recalculan una vez por proceso y solo si el usuario no los ha editado. */
const titled = new Set<string>();
let lastTitleTick = 0;
async function tickTitles() {
  if (Date.now() - lastTitleTick < 60_000) return; lastTitleTick = Date.now();
  const { data } = await sb.from("clips").select("id,title,project_id,candidate:clip_candidates(start_ms,end_ms)").eq("title_source", "lexical").order("created_at", { ascending: false }).limit(20);
  let n = 0;
  for (const c of (data ?? []) as unknown as { id: string; title: string; project_id: string; candidate: { start_ms: number; end_ms: number } | null }[]) {
    if (n >= 3) break; if (titled.has(c.id) || !c.candidate) continue; titled.add(c.id);
    const pr = (await sb.from("projects").select("source_id,project_brief").eq("id", c.project_id).maybeSingle()).data;
    if (!pr) continue;
    const tr = (await sb.from("transcripts").select("words").eq("source_id", pr.source_id).limit(1).maybeSingle()).data;
    const ws = ((tr?.words ?? []) as TWord[]).filter((w) => w.end * 1000 > c.candidate!.start_ms && w.start * 1000 < c.candidate!.end_ms);
    if (!ws.length) continue;
    const t = suggestTitle(ws.map((w) => w.text).join(" "), pr.project_brief);
    n++;
    if (t && t !== c.title) await sb.from("clips").update({ title: t }).eq("id", c.id).eq("title_source", "lexical").eq("title", c.title);
  }
}

/** Export bajo demanda: versión inmutable del clip → MP4 en el formato pedido. */
async function processRender(job: Job) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-r-"));
  try {
    const { version, ratio, burn } = job.params;
    if (!job.clip_id || !version || !ratio) throw Object.assign(new Error("Petición de export incompleta"), { permanent: true });
    const clip = ok(await sb.from("clips").select("id,workspace_id,project_id").eq("id", job.clip_id).single(), "clip");
    const project = ok(await sb.from("projects").select("source_id,deleted_at,brand_kit_id,brand_kit_version").eq("id", clip.project_id).single(), "proyecto");
    if (project.deleted_at) return void (await setStatus(job.id, "cancelled"));
    const cv = ok(await sb.from("clip_versions").select("composition").eq("clip_id", clip.id).eq("version", version).single(), "versión");
    const comp = { ...(cv.composition as Composition), ratio, burnSubtitles: burn !== false };
    await setStatus(job.id, "rendering");
    const inp = join(dir, "in"), ass = join(dir, "c.ass"), out = join(dir, "o.mp4");
    await fetchOriginal(sb, `${clip.workspace_id}/${project.source_id}/original`, inp);
    const fontsDir = await fontsFor(clip.workspace_id, comp.style.fontName, dir);
    writeFileSync(ass, buildAss(retimeWords(comp.words, comp.cuts), { ...styleForRatio(comp.style, ratio), fontName: renderFamily(comp.style.fontName) }, RATIO_SIZE[ratio]));
    const t1 = Date.now();
    // B-roll propio: solo rutas del mismo workspace, descargadas una vez
    const broll: { local: string; kind: "video" | "photo"; start: number; dur: number }[] = [];
    for (const [bi, b] of (comp.broll ?? []).entries()) {
      if (!b.path.startsWith(`${clip.workspace_id}/media/`)) throw Object.assign(new Error("B-roll fuera de tu workspace."), { permanent: true });
      const bd = await sb.storage.from("originals").download(b.path);
      if (bd.error || !bd.data) throw new Error(`descarga de B-roll: ${bd.error?.message}`);
      const lp = join(dir, `broll${bi}`); writeFileSync(lp, Buffer.from(await bd.data.arrayBuffer()));
      broll.push({ local: lp, kind: b.kind, start: b.start, dur: b.dur });
    }
    // Marca: versión fijada del kit aplicado al proyecto (logo, intro, outro). Solo rutas de `<workspace>/brand/`.
    let brand: Pick<Parameters<typeof ffmpegArgs>[1], "logo" | "intro" | "outro"> = {};
    let brandRef: string | null = null;
    if (project.brand_kit_id && project.brand_kit_version) {
      const bv = (await sb.from("brand_kit_versions").select("snapshot").eq("kit_id", project.brand_kit_id).eq("version", project.brand_kit_version).eq("workspace_id", clip.workspace_id).maybeSingle()).data;
      if (bv) {
        const snap = bv.snapshot as { logo_path: string | null; config: { logo?: Partial<BrandLogo>; intro?: { path: string; kind: "video" | "photo"; dur: number; hasAudio: boolean }; outro?: { path: string; kind: "video" | "photo"; dur: number; hasAudio: boolean } } | null };
        const grab = async (path: string, name: string) => {
          if (!path.startsWith(`${clip.workspace_id}/brand/`)) throw Object.assign(new Error("Recurso de marca fuera de tu workspace."), { permanent: true });
          const d2 = await sb.storage.from("originals").download(path);
          if (d2.error || !d2.data) throw new Error(`descarga de marca (${name}): ${d2.error?.message}`);
          const lp = join(dir, `brand-${name}`); writeFileSync(lp, Buffer.from(await d2.data.arrayBuffer())); return lp;
        };
        if (snap.logo_path) brand.logo = { local: await grab(snap.logo_path, "logo"), ...sanitizeLogo(snap.config?.logo) };
        if (snap.config?.intro?.path) brand.intro = { local: await grab(snap.config.intro.path, "intro"), kind: snap.config.intro.kind, dur: snap.config.intro.dur, hasAudio: !!snap.config.intro.hasAudio };
        if (snap.config?.outro?.path) brand.outro = { local: await grab(snap.config.outro.path, "outro"), kind: snap.config.outro.kind, dur: snap.config.outro.dur, hasAudio: !!snap.config.outro.hasAudio };
        brandRef = `${project.brand_kit_id}@${project.brand_kit_version}`;
      }
    }
    const mainHasAudio = !!JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", inp])).streams.find((x: { codec_type: string }) => x.codec_type === "audio");
    sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out, fontsDir, broll, ...brand, mainHasAudio }));
    const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
    const vs = probe.streams.find((x: { codec_type: string }) => x.codec_type === "video");
    const { width, height } = RATIO_SIZE[ratio];
    if (vs?.width !== width || vs?.height !== height) throw new Error(`dimensiones inesperadas ${vs?.width}x${vs?.height}`);
    const rpath = `${clip.workspace_id}/${clip.id}/v${version}-${ratio.replace(":", "x")}${comp.burnSubtitles ? "" : "-sin-subs"}.mp4`;
    const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(`subida render: ${up.error.message}`);
    const ins = await sb.from("renders").upsert({ workspace_id: clip.workspace_id, clip_id: clip.id, clip_version: version, ratio, burn_subtitles: comp.burnSubtitles, spec_sha256: briefHash(JSON.stringify(comp) + (brandRef ? `|brand:${brandRef}` : "")), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size, width: vs.width, height: vs.height, brand: brandRef } }, { onConflict: "workspace_id,clip_id,clip_version,ratio,burn_subtitles,spec_sha256" });
    if (ins.error) throw new Error(`registro render: ${ins.error.message}`);
    await setStatus(job.id, "done", { metrics: { render_ms: Date.now() - t1, total_ms: Date.now() - t0 } });
    console.log("render ok", job.id, ratio, Date.now() - t0, "ms");
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("render fallo", job.id, err.message);
    await setStatus(job.id, err.permanent || job.attempts >= 3 ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Reencuadre automático: detecta caras en el tramo del clip y guarda la trayectoria sugerida (no modifica el clip). */
async function processReframe(job: Job) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-f-"));
  const tid = (job.params as { track_id?: string }).track_id;
  try {
    const tr = ok(await sb.from("reframe_tracks").select("id,workspace_id,clip_id,source_start,source_end,ratio,mode,status").eq("id", tid ?? "").single(), "análisis de encuadre");
    if (tr.status === "cancelled") return void (await setStatus(job.id, "cancelled"));
    await sb.from("reframe_tracks").update({ status: "analyzing" }).eq("id", tr.id);
    await setStatus(job.id, "rendering");
    const clip = ok(await sb.from("clips").select("project_id").eq("id", tr.clip_id).single(), "clip");
    const project = ok(await sb.from("projects").select("source_id,deleted_at").eq("id", clip.project_id).single(), "proyecto");
    if (project.deleted_at) return void (await setStatus(job.id, "cancelled"));
    const inp = join(dir, "in"); await fetchOriginal(sb, `${tr.workspace_id}/${project.source_id}/original`, inp);
    const len = Number(tr.source_end) - Number(tr.source_start);
    const t1 = Date.now();
    const scan = scanFaces(inp, Number(tr.source_start), len);
    const R = RATIO_SIZE[tr.ratio as Ratio];
    const path = reframePath(scan, R.width / R.height, len, tr.mode as "follow" | "group");
    const faces = scan.samples.filter((x) => x.faces.length).length;
    await sb.from("reframe_tracks").update({ status: "ready", path, finished_at: new Date().toISOString(), metrics: { scan_ms: Date.now() - t1, total_ms: Date.now() - t0, samples: scan.samples.length, with_faces: faces, src: `${scan.w}x${scan.h}` } }).eq("id", tr.id);
    await setStatus(job.id, "done", { metrics: { total_ms: Date.now() - t0, with_faces: faces } });
    console.log("reframe ok", tr.id, `${faces}/${scan.samples.length} muestras con cara`, path.mode, Date.now() - t0, "ms");
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("reframe fallo", job.id, err.message);
    const final = !!err.permanent || job.attempts >= 3;
    if (tid) await sb.from("reframe_tracks").update(final ? { status: "failed", error: err.message.slice(0, 400), finished_at: new Date().toISOString() } : { status: "queued", error: `Reintentando: ${err.message.slice(0, 200)}` }).eq("id", tid);
    await setStatus(job.id, final ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Lyric Studio: canción → letra alineada (cacheada) → N variantes MP4. */
async function processLyrics(job: Job) {
  const t0 = Date.now();
  const m: Record<string, number | string> = {};
  const dir = mkdtempSync(join(tmpdir(), "rafaga-l-"));
  try {
    const p = job.params;
    const song = ok(await sb.from("songs").select("id,workspace_id,title,artist,language,storage_path,lyrics_text").eq("id", p.song_id!).single(), "canción");
    const ratio = (p.ratio ?? "9:16") as Ratio;
    const { width: W, height: H } = RATIO_SIZE[ratio];
    await setStatus(job.id, "extracting");
    const dl = await sb.storage.from("originals").download(song.storage_path);
    if (dl.error || !dl.data) throw new Error(`descarga: ${dl.error?.message}`);
    const src = join(dir, "song"); writeFileSync(src, Buffer.from(await dl.data.arrayBuffer()));
    const full = Number(JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", src])).format.duration);
    const start = Math.max(0, p.start ?? 0), end = Math.min(full, p.end && p.end > start ? p.end : full);
    const len = end - start;
    if (!(len >= 3)) throw Object.assign(new Error("El tramo elegido es demasiado corto (mínimo 3 s)."), { permanent: true });
    // Audio del tramo (sirve para ASR y para el render)
    const seg = join(dir, "seg.m4a");
    sh("ffmpeg", ["-y", "-v", "error", "-ss", String(start), "-t", String(len), "-i", src, "-vn", "-c:a", "aac", "-b:a", "192k", seg]);
    // Alineación: una vez por (letra, tramo)
    const key = briefHash(`v1|${song.lyrics_text ?? ""}|${start.toFixed(2)}|${end.toFixed(2)}`);
    let words: TimedWord[];
    const cached = (await sb.from("song_alignments").select("words").eq("song_id", song.id).eq("lyrics_sha256", key).maybeSingle()).data;
    // Sincronización manual (pulsación) de esta misma letra: prioridad sobre la automática; tiempos absolutos de la canción
    const manual = (await sb.from("song_alignments").select("words").eq("song_id", song.id).eq("lyrics_sha256", `manual:${briefHash(song.lyrics_text ?? "")}`).maybeSingle()).data;
    if (manual) {
      words = (manual.words as TimedWord[]).filter((w) => w.end > start && w.start < end).map((w) => ({ ...w, start: +Math.max(0, w.start - start).toFixed(3), end: +Math.min(len, w.end - start).toFixed(3) }));
      m.alignment = "manual";
    } else if (cached) { words = cached.words as TimedWord[]; m.alignment = "cache"; }
    else {
      await setStatus(job.id, "transcribing");
      const ogg = join(dir, "a.ogg");
      sh("ffmpeg", ["-y", "-v", "error", "-i", seg, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", ogg]);
      const t1 = Date.now();
      const tr = await transcribeAuto(ogg, len, { language: song.language as "auto" | "es" | "en", dgKey: DG, tariffs: TARIFFS });
      m.asr_ms = Date.now() - t1; m.asr_words = tr.words.length; m.asr_provider = tr.provider;
      await recordUsage(sb, { ws: song.workspace_id, jobId: job.id, lines: tr.lines });
      const lines = song.lyrics_text ? parseLyrics(song.lyrics_text) : [];
      words = lines.length ? alignLyrics(lines, tr.words) : lyricsFromAsr(tr.words);
      if (!words.length) throw Object.assign(new Error("No se detectó voz cantada en el tramo. Aporta la letra o elige otro tramo."), { permanent: true });
      await sb.from("song_alignments").insert({ workspace_id: song.workspace_id, song_id: song.id, lyrics_sha256: key, words, asr_words: tr.words.length });
      m.alignment = lines.length ? "lyrics+asr" : "asr";
    }
    m.words = words.length; m.interpolated = words.filter((w) => w.origin === "interpolated").length;
    // Fondos: colección propia (vídeo/foto) o colores sólidos
    const settings: BgSettings = { ...DEFAULT_BG, ...(p.settings ?? {}) };
    const textScale = Math.min(1.6, Math.max(0.6, p.settings?.textScale ?? 1));
    let items: BgItem[] = [];
    const shotItems: ShotItem[] = [];
    const shotSrc: (string | null)[] = [];   // identidad estable de cada clip (ruta en storage) para reconstruir planos entre trabajos
    if (p.collection_id) {
      const { data: mi } = await sb.from("media_items").select("kind,storage_path").eq("collection_id", p.collection_id).eq("workspace_id", song.workspace_id).order("storage_path");
      if (!mi?.length) throw Object.assign(new Error("La colección elegida no tiene vídeos ni fotos."), { permanent: true });
      for (const [i, it] of mi.entries()) {
        const d2 = await sb.storage.from("originals").download(it.storage_path);
        if (d2.error || !d2.data) throw new Error(`descarga de fondo: ${d2.error?.message}`);
        const fp = join(dir, `bg${i}${it.kind === "photo" ? ".img" : ".vid"}`); writeFileSync(fp, Buffer.from(await d2.data.arrayBuffer()));
        items.push({ path: fp, kind: it.kind as "video" | "photo" });
        let duration: number | undefined;
        if (it.kind === "video") { try { duration = Number(JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", fp])).format.duration) || undefined; } catch { duration = undefined; } }
        shotItems.push({ path: fp, kind: it.kind as "video" | "photo", duration }); shotSrc.push(it.storage_path);
      }
    }
    // Ritmo del tramo (solo si algún look usa montaje al ritmo): se detecta una vez y se cachea por canción y tramo
    let beatMemo: BeatResult | null | undefined;
    const getBeats = async (): Promise<BeatResult | null> => {
      if (beatMemo !== undefined) return beatMemo;
      const key = `beats:v1:${start.toFixed(2)}:${end.toFixed(2)}`;
      const hit = (await sb.from("song_alignments").select("words").eq("song_id", song.id).eq("lyrics_sha256", key).maybeSingle()).data?.words as BeatResult | undefined;
      if (hit && typeof hit === "object" && "bpm" in hit) { m.beats = "cache"; return (beatMemo = hit); }
      const t3 = Date.now();
      const r = spawnSync("ffmpeg", ["-v", "error", "-i", seg, "-ac", "1", "-ar", "22050", "-f", "f32le", "-"], { maxBuffer: 1 << 29 });
      if (r.status !== 0 || !r.stdout?.length) return (beatMemo = null);
      const out = r.stdout as Buffer; const x = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length - (out.length % 4)));
      beatMemo = detectBeats(x, 22050); m.beats_ms = Date.now() - t3; m.bpm = beatMemo.bpm; m.beat_confidence = beatMemo.confidence;
      await sb.from("song_alignments").insert({ workspace_id: song.workspace_id, song_id: song.id, lyrics_sha256: key, words: beatMemo, asr_words: 0 });
      return beatMemo;
    };
    // Plan exacto de N variantes
    const pools = { styles: p.styles?.length ? p.styles : ["Letra"], backgrounds: items.length ? ["coleccion"] : p.backgrounds?.length ? p.backgrounds : ["#111111"] };
    // «Más versiones como esta» / «Cambiar este plano»: parten de un vídeo ya generado de ESTA canción y workspace
    let baseShots: SavedShot[] | null = null; let swap: number[] = [];
    let plan: { variants: VariantSpec[]; distinct: number; repeats: number };
    if (p.more) {
      const { data: bv } = await sb.from("lyric_videos").select("params").eq("id", p.more.from_video).eq("song_id", song.id).eq("workspace_id", song.workspace_id).maybeSingle();
      const bp = bv?.params as { style?: string; background?: string; seed?: number; shots?: SavedShot[] } | undefined;
      if (!bp?.style) throw Object.assign(new Error("El vídeo de origen ya no existe."), { permanent: true });
      baseShots = bp.shots ?? null; swap = (p.more.swap ?? []).filter((x) => Number.isInteger(x) && x >= 0 && x < 500);
      const lock = { style: !!p.more.lock?.style, background: !!p.more.lock?.background, shots: !!p.more.lock?.shots };
      const variants = swap.length ? [{ index: 1, style: bp.style, background: bp.background ?? "coleccion", seed: (p.seed ?? 1) * 1000 + 1 }] : planMore({ style: bp.style, background: bp.background ?? "coleccion", seed: bp.seed ?? 0 }, p.n ?? 1, lock, pools, p.seed ?? 1);
      plan = { variants, distinct: variants.length, repeats: 0 };
      m.more_from = p.more.from_video; if (swap.length) m.swap = swap.join(",");
    } else plan = planVariants(p.n ?? 1, pools.styles, pools.backgrounds, p.seed ?? 1);
    m.n = plan.variants.length; m.distinct = plan.distinct;
    await setStatus(job.id, "rendering");
    const byLine = new Map<number, TimedWord[]>();
    for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w]);
    const done = new Set(((await sb.from("lyric_videos").select("variant").eq("job_id", job.id).eq("status", "ready")).data ?? []).map((r) => r.variant));
    for (const v of plan.variants) {
      if (done.has(v.index)) continue;   // reintento: no repite variantes ya listas
      const { data: cur } = await sb.from("jobs").select("status").eq("id", job.id).single();
      if (cur?.status === "cancelled") break;
      await sb.from("lyric_videos").upsert({ workspace_id: song.workspace_id, song_id: song.id, job_id: job.id, variant: v.index, params: { ...v, settings, textScale, collection_id: p.collection_id ?? null }, status: "rendering" }, { onConflict: "job_id,variant" });
      if (v.style.startsWith("look:")) {   // Looks de referencia: composición completa (imagen contenida, letra anclada, tratamiento, montaje)
        const id = v.style.slice(5);
        if (!LOOKS[id]) throw Object.assign(new Error(`Estilo desconocido: ${id}`), { permanent: true });
        const look = varyLook(resolveLook(id, p.look_overrides?.[id] ?? {}), v.seed, Math.min(1, Math.max(0, p.variation ?? 0.5)));
        const { W: LW, H: LH } = canvasSize(p.native ? look.canvas.ratio : ratio, p.res === 720 ? 720 : 1080);
        const L = layoutLyrics(words, look, LW, LH, len);
        const ass = join(dir, `v${v.index}.ass`), out = join(dir, `v${v.index}.mp4`);
        writeFileSync(ass, layoutToAss(L));
        let shots: ReturnType<typeof planShots>; let montageInfo: Record<string, unknown> = { mode: look.montage.cut === "interval" ? "interval" : "phrases" };
        if (look.montage.cut === "beat" && shotItems.length) {
          const b = await getBeats(); const pl = planShotsOnBeats(shotItems, b, len, look.montage, v.seed, !!b && beatsReliable(b));
          shots = pl.shots; montageInfo = { ...pl.info };
        } else shots = planShots(shotItems, L.pages, len, look.montage, v.seed);
        if (p.more && (swap.length || p.more.lock?.shots)) {   // planos heredados del vídeo base (y, si se pide, un plano concreto sustituido)
          const kept = restoreShots(baseShots, shotItems, shotSrc, len);
          if (kept) {
            if (swap.length) { const sw = swapShots(kept, swap, shotItems, v.seed); shots = sw.shots; montageInfo = { ...montageInfo, swapped: sw.changed }; if (!sw.changed.length) m.swap_note = "sin alternativa para ese plano"; }
            else { shots = kept; montageInfo = { ...montageInfo, inherited: true }; }
          } else m.shots_note = "no se pudieron heredar los planos (otro tramo, colección distinta o vídeo antiguo): se generaron nuevos";
        }
        const t2 = Date.now();
        sh("ffmpeg", lookFfmpegArgs({ look, W: LW, H: LH, len, shots, color: /^#[0-9a-f]{6}$/i.test(v.background) ? v.background : "#111111", seed: v.seed, audio: seg, ass, out, escape: escapeFilterPath }));
        const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height:format=duration,size", out]));
        const rpath = `${song.workspace_id}/lyrics/${job.id}/${v.index}.mp4`;
        const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
        if (up.error) throw new Error(`subida: ${up.error.message}`);
        await sb.from("lyric_videos").update({ storage_path: rpath, status: "ready", probe, params: { ...v, look: { id, version: look.version, engine: LOOK_ENGINE_VERSION, resolved: look }, shots: shots.map((x) => ({ start: x.start, dur: x.dur, entry: x.entry, item: shotItems.indexOf(x.item), src: shotSrc[shotItems.indexOf(x.item)] ?? null })), montage: montageInfo, res: p.res ?? 1080, collection_id: p.collection_id ?? null, alignment: m.alignment } }).eq("job_id", job.id).eq("variant", v.index);
        if (v.index === 1) m.first_ms = Date.now() - t0;
        m[`render_ms_${v.index}`] = Date.now() - t2;
        await sb.from("jobs").update({ heartbeat_at: new Date().toISOString(), metrics: m }).eq("id", job.id);
        continue;
      }
      let base = PRESETS[v.style] ?? PRESETS.Letra;
      if (v.style.startsWith("custom:")) {   // estilo propio: solo del mismo workspace y siempre validado
        const { data: ts } = await sb.from("text_styles").select("style").eq("id", v.style.slice(7)).eq("workspace_id", song.workspace_id).maybeSingle();
        if (ts) base = validateStyle(ts.style);
      }
      const eff = styleForRatio({ ...base, fontSize: Math.round(base.fontSize * textScale) }, ratio);
      const groups = groupsFrom([...byLine.values()], eff.maxCharsPerLine);
      const ass = join(dir, `v${v.index}.ass`), out = join(dir, `v${v.index}.mp4`);
      writeFileSync(ass, buildAss(words, { ...eff, fontName: renderFamily(eff.fontName), maxLines: 3 }, { width: W, height: H }, groups));
      const fontsDir = await fontsFor(song.workspace_id, eff.fontName, dir);
      const t2 = Date.now();
      sh("ffmpeg", lyricFfmpegArgs({ W, H, len, color: /^#[0-9a-f]{6}$/i.test(v.background) ? v.background : "#111111", segments: sequenceFor(items, len, settings, v.seed), settings, audio: seg, ass, fontsDir, out, escape: escapeFilterPath }));
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_name,width,height:format=duration,size", out]));
      const rpath = `${song.workspace_id}/lyrics/${job.id}/${v.index}.mp4`;
      const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error(`subida: ${up.error.message}`);
      await sb.from("lyric_videos").update({ storage_path: rpath, status: "ready", probe }).eq("job_id", job.id).eq("variant", v.index);
      if (v.index === 1) m.first_ms = Date.now() - t0;
      m[`render_ms_${v.index}`] = Date.now() - t2;
      await sb.from("jobs").update({ heartbeat_at: new Date().toISOString(), metrics: m }).eq("id", job.id);
    }
    m.total_ms = Date.now() - t0;
    await setStatus(job.id, "done", { metrics: m });
    console.log("lyrics ok", job.id, m);
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("lyrics fallo", job.id, err.message);
    await setStatus(job.id, err.permanent || job.attempts >= 3 ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300), metrics: m });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Paquete de entrega: ZIP por partes (≤ 40 MB cada una por el límite de archivo del almacenamiento actual) + manifiesto. */
const PART_MAX = 40 * 1024 * 1024;
const safeName = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "pieza";
async function processPackage(job: Job) {
  const t0 = Date.now();
  const pkgId = (job.params as { package_id?: string }).package_id;
  const uploaded: string[] = [];
  try {
    const pkg = ok(await sb.from("delivery_packages").select("id,workspace_id,delivery_id,options,status").eq("id", pkgId!).single(), "paquete");
    if (pkg.status === "cancelled") return void (await setStatus(job.id, "cancelled"));
    const opt = pkg.options as { only_approved: boolean; include: string[]; clips: string[] | null };
    await sb.from("delivery_packages").update({ status: "building", progress: { phase: "collecting", done: 0, total: 0 } }).eq("id", pkg.id);
    await setStatus(job.id, "rendering");
    const del = ok(await sb.from("deliveries").select("name,project_id").eq("id", pkg.delivery_id).single(), "entrega");
    const prj = ok(await sb.from("projects").select("name,brand_kit_id").eq("id", del.project_id).single(), "proyecto");
    const brand = prj.brand_kit_id ? (await sb.from("brand_kits").select("name").eq("id", prj.brand_kit_id).maybeSingle()).data?.name : null;
    const base = `${safeName(brand ?? prj.name)}_${safeName(del.name)}`;
    const items = ((await sb.from("delivery_items").select("clip_id,version,position,clip:clips!inner(title,review_status,approved_version,current_version,thumb_path)").eq("delivery_id", pkg.delivery_id).order("position")).data ?? []) as unknown as { clip_id: string; version: number; position: number; clip: { title: string; review_status: string; approved_version: number | null; current_version: number; thumb_path: string | null } }[];
    const chosen = items.filter((x) => (!opt.clips || opt.clips.includes(x.clip_id)) && (!opt.only_approved || (x.clip.review_status === "approved" && x.clip.approved_version === x.version)));
    if (!chosen.length) throw Object.assign(new Error(opt.only_approved ? "Ninguna pieza de la entrega está aprobada en su versión entregada." : "La selección no contiene piezas."), { permanent: true });
    const manifest: Record<string, unknown>[] = []; const parts: { path: string; name: string; bytes: number; files: number; kind: string }[] = [];
    let zip = new ZipBuilder(), partFiles: string[] = [], partN = 0, partErr: string | null = null, verified = 0;
    const flush = async (last = false) => {
      if (!zip.count) return;
      partN++; const name = `${base}-parte${partN}.zip`; const path = `${pkg.workspace_id}/packages/${pkg.id}/${name}`;
      zip.add(`manifiesto-parte${partN}.json`, Buffer.from(JSON.stringify({ parte: partN, archivos: partFiles }, null, 2)));
      const buf = zip.build();
      // Integridad: se comprueba el ZIP con unzip antes de subirlo (si la herramienta existe en el worker)
      const tmpZip = join(tmpdir(), `pkg-${pkg.id}-${partN}.zip`); writeFileSync(tmpZip, buf);
      const chk = spawnSync("unzip", ["-tq", tmpZip], { encoding: "utf8" }); rmSync(tmpZip, { force: true });
      if (chk.error == null) { if (chk.status !== 0) throw new Error(`El ZIP de la parte ${partN} no pasó la comprobación de integridad`); verified++; }
      const up = await sb.storage.from("renders").upload(path, buf, { contentType: "application/zip", upsert: true });
      if (up.error) throw new Error(`No se pudo subir ${name} (${(buf.length / 1048576).toFixed(1)} MB): ${up.error.message}`);
      uploaded.push(path); parts.push({ path, name, bytes: buf.length, files: partFiles.length + 1, kind: "zip" });
      zip = new ZipBuilder(); partFiles = []; void last; void partErr;
    };
    const addFile = async (name: string, data: Buffer) => { if (zip.count && zip.size + data.length > PART_MAX) await flush(); zip.add(name, data); partFiles.push(name); };
    let i = 0, mp4Bytes = 0;
    for (const it of chosen) {
      const cur = (await sb.from("delivery_packages").select("status").eq("id", pkg.id).single()).data?.status;
      if (cur === "cancelled") { await sb.storage.from("renders").remove(uploaded); return void (await setStatus(job.id, "cancelled")); }
      i++; await sb.from("delivery_packages").update({ progress: { phase: "packing", done: i - 1, total: chosen.length, current: it.clip.title } }).eq("id", pkg.id);
      await sb.from("jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", job.id);
      const stem = `${base}_${String(i).padStart(2, "0")}-${safeName(it.clip.title)}`;
      const r = (await sb.from("renders").select("storage_path,ratio,probe,burn_subtitles").eq("clip_id", it.clip_id).eq("clip_version", it.version).eq("status", "ready").order("created_at", { ascending: false }).limit(1)).data?.[0];
      const row: Record<string, unknown> = { titulo: it.clip.title, version: it.version, estado: it.clip.review_status === "approved" && it.clip.approved_version === it.version ? "Aprobado" : "Sin aprobar", id_interno: it.clip_id, archivos: [] as string[] };
      const ratio = (r?.ratio ?? "9:16").replace(":", "x");
      if (opt.include.includes("mp4")) {
        if (r) { const d = await sb.storage.from("renders").download(r.storage_path); if (d.error || !d.data) throw new Error(`descarga de «${it.clip.title}»: ${d.error?.message}`); const buf = Buffer.from(await d.data.arrayBuffer()); mp4Bytes += buf.length; const f = `video/${stem}_${ratio}_v${it.version}.mp4`; await addFile(f, buf); (row.archivos as string[]).push(f); Object.assign(row, { formato: r.ratio, duracion_s: r.probe?.duration ? +Number(r.probe.duration).toFixed(1) : null, subtitulos_incrustados: r.burn_subtitles }); }
        else { row.incluido = false; row.motivo = `La v${it.version} no tiene MP4 exportado`; }
      }
      if (opt.include.includes("thumbs") && it.clip.thumb_path) { const d = await sb.storage.from("renders").download(it.clip.thumb_path); if (!d.error && d.data) { const f = `portadas/${stem}.jpg`; await addFile(f, Buffer.from(await d.data.arrayBuffer())); (row.archivos as string[]).push(f); } }
      if (["srt", "vtt", "transcript"].some((k) => opt.include.includes(k))) {
        const cv = (await sb.from("clip_versions").select("composition").eq("clip_id", it.clip_id).eq("version", it.version).maybeSingle()).data?.composition as Composition | undefined;
        if (cv?.words?.length) {
          if (opt.include.includes("srt")) { const f = `subtitulos/${stem}_v${it.version}.srt`; await addFile(f, Buffer.from(toSRT(retimeWords(cv.words, cv.cuts), cv.style), "utf8")); (row.archivos as string[]).push(f); }
          if (opt.include.includes("vtt")) { const f = `subtitulos/${stem}_v${it.version}.vtt`; await addFile(f, Buffer.from(toVTT(retimeWords(cv.words, cv.cuts), cv.style), "utf8")); (row.archivos as string[]).push(f); }
          if (opt.include.includes("transcript")) { const f = `transcripciones/${stem}_v${it.version}.txt`; await addFile(f, Buffer.from(toTranscript(retimeWords(cv.words, cv.cuts)) + "\n", "utf8")); (row.archivos as string[]).push(f); }
        } else if (["srt", "vtt", "transcript"].some((k) => opt.include.includes(k))) row.sin_texto = "Esta versión no tiene palabras transcritas";
      }
      manifest.push(row);
    }
    await flush(true);
    const mf = Buffer.from(JSON.stringify({ entrega: del.name, proyecto: prj.name, marca: brand, generado: new Date().toISOString(), solo_aprobadas: opt.only_approved, contenido: opt.include, partes: parts.map((p) => ({ archivo: p.name, bytes: p.bytes, archivos: p.files })), piezas: manifest }, null, 2), "utf8");
    const mpath = `${pkg.workspace_id}/packages/${pkg.id}/${base}-manifiesto.json`;
    const mu = await sb.storage.from("renders").upload(mpath, mf, { contentType: "application/json", upsert: true });
    if (mu.error) throw new Error(`manifiesto: ${mu.error.message}`);
    uploaded.push(mpath); parts.push({ path: mpath, name: `${base}-manifiesto.json`, bytes: mf.length, files: 1, kind: "manifest" });
    await sb.from("delivery_packages").update({ status: "ready", parts, progress: { phase: "done", done: chosen.length, total: chosen.length }, finished_at: new Date().toISOString(), error: null }).eq("id", pkg.id);
    await setStatus(job.id, "done", { metrics: { items: chosen.length, mp4_bytes: mp4Bytes, parts: parts.length - 1, zip_verified: verified, total_ms: Date.now() - t0 } });
    console.log("package ok", pkg.id, chosen.length, "piezas", parts.length - 1, "partes", Date.now() - t0, "ms");
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("package fallo", job.id, err.message);
    const final = !!err.permanent || job.attempts >= 3;
    if (uploaded.length && final) await sb.storage.from("renders").remove(uploaded).catch(() => {});
    if (pkgId) await sb.from("delivery_packages").update(final ? { status: "failed", error: err.message.slice(0, 400), finished_at: new Date().toISOString() } : { status: "queued", error: `Reintentando: ${err.message.slice(0, 200)}` }).eq("id", pkgId);
    await setStatus(job.id, final ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300) });
  }
}

/** Automatizaciones: feed RSS HTTPS autorizado → entradas nuevas (posteriores al cursor) → proyecto + detección. Una entrada nunca se procesa dos veces. */
type RuleRow = { id: string; workspace_id: string; name: string; feed_url: string; review_first: boolean; clip_count: number; brief: string | null; daily_limit: number; active: boolean; cursor_published: string | null; created_by: string };
async function checkRule(rule: RuleRow): Promise<string> {
  await sb.from("automation_rules").update({ last_checked_at: new Date().toISOString() }).eq("id", rule.id);
  try {
    const feed = await safeGet(rule.feed_url, { maxBytes: 2_000_000, timeoutMs: 20000, accept: /xml|rss|atom|text\/plain/i });
    if (feed.status !== 200) throw new Error(`El feed respondió ${feed.status}`);
    const cursor = rule.cursor_published ? new Date(rule.cursor_published).getTime() : Date.now();
    const entries = parseFeed(feed.body.toString("utf8")).filter((e) => e.enclosureUrl && /^video\//i.test(e.enclosureType ?? "") && e.published && e.published.getTime() > cursor).sort((a, b) => a.published!.getTime() - b.published!.getTime());
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count: today } = await sb.from("automation_runs").select("id", { count: "exact", head: true }).eq("rule_id", rule.id).eq("status", "imported").gte("created_at", dayStart.toISOString());
    let room = Math.max(0, rule.daily_limit - (today ?? 0)), imported = 0;
    for (const e of entries) {
      if (room <= 0) break;
      const ins = await sb.from("automation_runs").insert({ workspace_id: rule.workspace_id, rule_id: rule.id, entry_guid: e.guid, entry_title: e.title, entry_url: e.enclosureUrl, status: "queued" }).select("id").maybeSingle();
      if (ins.error || !ins.data) continue;                  // ya existía (unique rule_id+guid): no se repite
      const runId = ins.data.id;
      try {
        const file = await safeGet(e.enclosureUrl!, { maxBytes: 50 * 1024 * 1024, timeoutMs: 180000, accept: /^video\/(mp4|quicktime|webm)/i });
        const b = file.body;
        const isMp4 = b.subarray(4, 8).toString("latin1") === "ftyp", isWebm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
        if (file.status !== 200 || !(isMp4 || isWebm)) throw new Error("El archivo no es un MP4, MOV o WebM válido");
        const srcId = crypto.randomUUID();
        const mime = isWebm ? "video/webm" : /quicktime/i.test(file.contentType) ? "video/quicktime" : "video/mp4";
        const path = `${rule.workspace_id}/${srcId}/original`;
        const up = await sb.storage.from("originals").upload(path, b, { contentType: mime });
        if (up.error) throw new Error(`subida: ${up.error.message}`);
        ok(await sb.from("sources").insert({ id: srcId, workspace_id: rule.workspace_id, kind: "feed", mime, bytes: b.length, created_by: rule.created_by }).select("id").single(), "fuente");
        const prj = ok(await sb.from("projects").insert({ workspace_id: rule.workspace_id, source_id: srcId, name: e.title || "Entrada del feed", created_by: rule.created_by, project_brief: rule.brief, clip_count: rule.clip_count }).select("id").single(), "proyecto");
        await sb.from("jobs").insert({ workspace_id: rule.workspace_id, kind: "detect", idempotency_key: `detect:auto:${runId}`, project_id: prj.id, created_by: rule.created_by });
        await sb.from("automation_runs").update({ status: "imported", project_id: prj.id, detail: rule.review_first ? "Pendiente de revisión" : "Procesado" }).eq("id", runId);
        await sb.from("notifications").insert({ workspace_id: rule.workspace_id, kind: "automation", body: `${rule.name}: «${e.title}» se está procesando${rule.review_first ? " y quedará pendiente de tu revisión" : ""}.` });
        room--; imported++;
      } catch (x) { await sb.from("automation_runs").update({ status: "failed", detail: (x as Error).message.slice(0, 300) }).eq("id", runId); }
    }
    await sb.from("automation_rules").update({ last_error: null }).eq("id", rule.id);
    return `${imported} entrada(s) importada(s) de ${entries.length} nueva(s)`;
  } catch (x) {
    const m = (x as Error).message.slice(0, 300);
    await sb.from("automation_rules").update({ last_error: m }).eq("id", rule.id);
    return `error: ${m}`;
  }
}
async function processAutomation(job: Job) {
  try {
    const { data: rule } = await sb.from("automation_rules").select("id,workspace_id,name,feed_url,review_first,clip_count,brief,daily_limit,active,cursor_published,created_by").eq("id", job.params.rule_id!).maybeSingle();
    if (!rule) return void (await setStatus(job.id, "cancelled"));
    if (!rule.active && !job.params.manual) return void (await setStatus(job.id, "done"));
    const r = await checkRule(rule as RuleRow);
    await setStatus(job.id, "done", { metrics: { result: r } }); console.log("automation", rule.name, r);
  } catch (e) { await setStatus(job.id, "failed", { error_message: (e as Error).message.slice(0, 300) }); }
}
let lastTick = 0;
/** Planificador: mientras el worker está vivo, revisa las reglas activas cada 15 min. */
async function tickAutomations() {
  if (Date.now() - lastTick < 60_000) return; lastTick = Date.now();
  const due = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data } = await sb.from("automation_rules").select("id,workspace_id,name,feed_url,review_first,clip_count,brief,daily_limit,active,cursor_published,created_by,last_checked_at").eq("active", true).or(`last_checked_at.is.null,last_checked_at.lt.${due}`).limit(5);
  for (const r of data ?? []) console.log("tick", r.name, await checkRule(r as RuleRow));
}

/** En vivo: captura HLS autorizada en ventanas; cada ventana se convierte en un proyecto que pasa por el pipeline de clips. */
let liveActive = 0;
async function processLive(job: Job, deadlineSec: number) {
  liveActive++;
  const dir = mkdtempSync(join(tmpdir(), "rafaga-live-"));
  try {
    const { data: ses } = await sb.from("live_sessions").select("*").eq("id", job.params.session_id!).maybeSingle();
    if (!ses || !["queued", "capturing"].includes(ses.status)) return void (await setStatus(job.id, "cancelled"));
    await sb.from("live_sessions").update({ status: "capturing", started_at: ses.started_at ?? new Date().toISOString(), last_error: null }).eq("id", ses.id);
    await setStatus(job.id, "extracting");
    let idx = Number((await sb.from("live_windows").select("idx").eq("session_id", ses.id).order("idx", { ascending: false }).limit(1)).data?.[0]?.idx ?? -1) + 1;
    let lastCheck = 0, lastProg = 0, active = true;
    // Contexto entre ventanas y cuota por tramos
    const prior = (await sb.from("live_windows").select("seconds").eq("session_id", ses.id)).data ?? [];
    let cum = prior.reduce((a, x) => a + Number(x.seconds), 0), prevFile: string | null = null, prevSec: number | null = null, capturedNow = 0, quotaStop: string | null = null;
    const [liveLim, liveUse] = await Promise.all([loadLimits(sb, ses.workspace_id), loadUsage(sb, ses.workspace_id)]);
    const remaining = Math.max(0, ses.max_seconds - Number(ses.captured_seconds));
    const stats = await captureHls({
      fetch: safeGet, url: ses.hls_url, dir, windowSeconds: ses.window_seconds, minWindowSeconds: 20, maxSeconds: Math.min(remaining, deadlineSec), resumeFromSeq: ses.last_media_seq,
      shouldStop: async () => {
        if (Date.now() - lastCheck < 4000) return !active; lastCheck = Date.now();
        const { data } = await sb.from("live_sessions").select("status").eq("id", ses.id).single();
        active = data?.status === "capturing";
        // Reserva por tramos de 2 min: si la cuota se agota, se detiene conservando lo ya entregado
        const rsv = reserveLiveChunk(liveLim, liveUse, 2, (Number(ses.captured_seconds) + capturedNow) / 60);
        if (active && rsv.grant <= 0) { quotaStop = rsv.reason; active = false; await sb.from("live_sessions").update({ status: "stopped", last_error: rsv.reason }).eq("id", ses.id); }
        else if (rsv.warn && !ses.last_error) await sb.from("live_sessions").update({ last_error: rsv.warn }).eq("id", ses.id);
        await sb.from("jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", job.id);
        return !active;
      },
      onProgress: async (p) => { capturedNow = p.capturedSeconds; if (Date.now() - lastProg > 10000) { lastProg = Date.now(); await sb.from("live_sessions").update({ captured_seconds: Number(ses.captured_seconds) + p.capturedSeconds, last_media_seq: p.lastSeq }).eq("id", ses.id); } },
      onWindow: async (w: WindowOut) => {
        const i = idx++;
        const out = join(dir, `win${i}.mp4`);
        let c = concatWindow(w.files, out, join(dir, `win${i}.txt`));
        for (const f of w.files) rmSync(f, { force: true });
        // Contexto compartido: se antepone la cola de la ventana anterior. Si algo falla, se usa la ventana sola (comportamiento anterior).
        let tail = 0, upFile = out;
        const T = contextTail(prevSec);
        if (T > 0 && prevFile) {
          try {
            const tf = join(dir, `tail${i}.mp4`), cf = join(dir, `ctx${i}.mp4`);
            sh("ffmpeg", ["-y", "-v", "error", "-sseof", `-${T}`, "-i", prevFile, "-c", "copy", tf]);
            c = concatWindow([tf, out], cf, join(dir, `ctx${i}.txt`)); upFile = cf; tail = T; rmSync(tf, { force: true });
          } catch (e) { console.error("contexto de ventana omitido:", (e as Error).message.slice(0, 160)); tail = 0; upFile = out; }
        }
        const absStart = Math.max(0, cum - tail);
        if (prevFile && prevFile !== out) rmSync(prevFile, { force: true });
        prevFile = out; prevSec = w.seconds; cum += w.seconds;
        const srcId = crypto.randomUUID();
        const up = await sb.storage.from("originals").upload(`${ses.workspace_id}/${srcId}/original`, readFileSync(upFile), { contentType: "video/mp4" });
        if (upFile !== out) rmSync(upFile, { force: true });
        if (up.error) throw new Error(`subida de ventana: ${up.error.message}`);
        ok(await sb.from("sources").insert({ id: srcId, workspace_id: ses.workspace_id, kind: "live", mime: "video/mp4", bytes: c.bytes, created_by: ses.created_by }).select("id").single(), "fuente");
        const label = new Date(w.startedAtMs).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
        const prj = ok(await sb.from("projects").insert({ workspace_id: ses.workspace_id, source_id: srcId, name: `En vivo ${label} (ventana ${i + 1})`, created_by: ses.created_by, project_brief: ses.brief, clip_count: 3 }).select("id").single(), "proyecto");
        await sb.from("jobs").insert({ workspace_id: ses.workspace_id, kind: "detect", idempotency_key: `detect:live:${ses.id}:${i}`, project_id: prj.id, created_by: ses.created_by, params: { live: { session_id: ses.id, abs_start: absStart, skip_before: tail, window_end_ms: Date.now() } } });
        await sb.from("live_windows").insert({ workspace_id: ses.workspace_id, session_id: ses.id, idx: i, seconds: w.seconds, reason: w.reason, project_id: prj.id, abs_start: absStart, context_seconds: tail });
        await sb.from("live_sessions").update({ windows_done: i + 1 }).eq("id", ses.id);
        console.log("live window", i, Math.round(w.seconds), "s", w.reason, c.reencoded ? "(recodificada)" : "");
      },
    });
    const { data: fin } = await sb.from("live_sessions").select("status").eq("id", ses.id).single();
    const finalStatus = stats.endedBy === "error" ? "failed" : fin?.status === "capturing" ? (stats.endedBy === "ended" ? "done" : stats.endedBy === "max" ? "done" : "stopped") : fin?.status;
    await sb.from("live_sessions").update({ status: finalStatus, ended_at: new Date().toISOString(), captured_seconds: Number(ses.captured_seconds) + stats.capturedSeconds, last_media_seq: stats.lastSeq, gaps: ses.gaps + stats.gaps, reconnects: ses.reconnects + stats.reconnects, last_error: stats.error ?? null }).eq("id", ses.id);
    await setStatus(job.id, finalStatus === "failed" ? "failed" : "done", { metrics: { windows: stats.windows, gaps: stats.gaps, reconnects: stats.reconnects, captured_s: Math.round(stats.capturedSeconds), ended_by: stats.endedBy }, error_message: stats.error ?? null });
    console.log("live fin", ses.id, stats);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    console.error("live fallo", job.id, msg);
    await sb.from("live_sessions").update({ status: "failed", ended_at: new Date().toISOString(), last_error: msg }).eq("id", job.params.session_id!);
    await setStatus(job.id, "failed", { error_message: msg });
  } finally { rmSync(dir, { recursive: true, force: true }); liveActive--; }
}

const idleMs = Number(process.env.WORKER_IDLE_SECONDS ?? 0) * 1000;   // 0 = salir si no hay trabajo
const maxMs = Number(process.env.WORKER_MAX_SECONDS ?? 3000) * 1000;
const started = Date.now();
let processed = 0, lastWork = Date.now();
const liveRuns: Promise<void>[] = [];
const workerId = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}` : `local-${process.pid}`;
let lastBeat = 0;
async function beat() {   // latido para el programador (scheduler_tick): evita lanzar otro worker si este está vivo
  if (Date.now() - lastBeat < 30_000) return; lastBeat = Date.now();
  await sb.from("worker_heartbeats").upsert({ id: workerId, seen_at: new Date().toISOString(), info: { processed, live: liveActive } });
}
for (;;) {
  const elapsedMs = Date.now() - started;
  await beat().catch(() => {});
  if (elapsedMs > maxMs && liveActive === 0) break;
  await tickAutomations().catch((e) => console.error("tick:", (e as Error).message));
  await tickThumbs().catch((e) => console.error("thumbs:", (e as Error).message));
  await tickTitles().catch((e) => console.error("titles:", (e as Error).message));
  if (elapsedMs > maxMs) { await new Promise((r) => setTimeout(r, 3000)); continue; }       // solo esperar a que termine el directo
  const { data, error } = await sb.rpc("claim_job");
  if (error) { console.error("claim_job:", error.message); process.exit(1); }
  const job = (data as Job[] | null)?.[0];
  if (!job) {
    if (liveActive === 0 && Date.now() - lastWork > idleMs) break;
    await new Promise((r) => setTimeout(r, 3000));   // sondeo cada 3 s mientras está caliente
    continue;
  }
  lastWork = Date.now();
  if (job.kind === "live") { liveRuns.push(processLive(job, Math.max(60, Math.floor((maxMs - (Date.now() - started)) / 1000) - 120))); continue; }   // en segundo plano: no bloquea otros trabajos
  await (job.kind === "render" ? processRender(job) : job.kind === "lyrics" ? processLyrics(job) : job.kind === "automation" ? processAutomation(job) : job.kind === "package" ? processPackage(job) : job.kind === "reframe" ? processReframe(job) : processJob(job)); processed++; lastWork = Date.now();
}
await Promise.allSettled(liveRuns);
console.log(`terminado: ${processed} job(s) en ${Math.round((Date.now() - started) / 1000)} s`);
