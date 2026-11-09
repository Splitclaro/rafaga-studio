// Worker en GitHub Actions: reclama jobs `detect` de Supabase y ejecuta el pipeline real.
// Secretos requeridos (variables de entorno): SUPABASE_URL, SUPABASE_SECRET_KEY, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, buildComposition, ffmpegArgs, styleForRatio, renderFamily, groupsFrom, escapeFilterPath, PRESETS, RATIO_SIZE, type Composition, type Ratio, type Word } from "@rafaga/composition";
import { transcribe, proposeClips } from "@rafaga/providers";
import { alignLyrics, lyricsFromAsr, parseLyrics, planVariants, type TimedWord } from "@rafaga/lyrics";
import { briefHash, RUBRIC_VERSION, validateCandidates, windows, transcriptText, lexicalCandidates, LEXICAL_VERSION, type TWord, type RawCandidate } from "@rafaga/selection";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Falta el secreto ${k}`); process.exit(2); } return v; };
const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const DG = need("DEEPGRAM_API_KEY"), AN = process.env.ANTHROPIC_API_KEY ?? "";
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
  const { data } = await sb.from("workspace_fonts").select("storage_path").eq("workspace_id", ws).eq("family", family).maybeSingle();
  if (!data) throw Object.assign(new Error(`La fuente «${family}» no está en este workspace.`), { permanent: true });
  const dl = await sb.storage.from("brand-assets").download(data.storage_path);
  if (dl.error || !dl.data) throw new Error(`descarga de fuente: ${dl.error?.message}`);
  const fd = join(dir, "fonts"); mkdirSync(fd, { recursive: true });
  writeFileSync(join(fd, "font" + (data.storage_path.endsWith(".otf") ? ".otf" : ".ttf")), Buffer.from(await dl.data.arrayBuffer()));
  return fd;
}

type Job = { id: string; kind: string; workspace_id: string; project_id: string | null; clip_id: string | null; attempts: number; params: { version?: number; ratio?: Ratio; burn?: boolean; song_id?: string; n?: number; styles?: string[]; backgrounds?: string[]; seed?: number; start?: number; end?: number } };
const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  sb.from("jobs").update({ status, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra }).eq("id", id);

async function processJob(job: Job) {
  const m: Record<string, number | string> = {};
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-"));
  try {
    const project = ok(await sb.from("projects").select("id,workspace_id,source_id,project_brief,language,clip_count,target_seconds,max_seconds,deleted_at").eq("id", job.project_id!).single(), "proyecto");
    if (project.deleted_at) return void (await setStatus(job.id, "cancelled"));
    const src = ok(await sb.from("sources").select("id,mime").eq("id", project.source_id).single(), "fuente");
    const path = `${project.workspace_id}/${src.id}/original`;

    // 1) Transcript (reutilizado si ya existe: cambiar el brief no repite ASR)
    let tr = (await sb.from("transcripts").select("id,words,language").eq("source_id", src.id).order("created_at", { ascending: false }).limit(1)).data?.[0];
    if (!tr) {
      await setStatus(job.id, "extracting");
      const dl = await sb.storage.from("originals").download(path);
      if (dl.error || !dl.data) throw new Error(`descarga: ${dl.error?.message}`);
      const inp = join(dir, "in"); writeFileSync(inp, Buffer.from(await dl.data.arrayBuffer()));
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", inp]));
      const hasAudio = probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio");
      const durationMs = Math.round(Number(probe.format.duration) * 1000);
      const vs = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      await sb.from("sources").update({ status: hasAudio ? "validated" : "failed", duration_ms: durationMs, width: vs?.width, height: vs?.height, has_audio: hasAudio }).eq("id", src.id);
      if (!hasAudio) throw Object.assign(new Error("El vídeo no tiene pista de audio: no se puede seleccionar por voz."), { permanent: true });
      if (durationMs < 15000) throw Object.assign(new Error(`El vídeo dura ${(durationMs / 1000).toFixed(1)} s. Para buscar momentos hace falta al menos 15 s de contenido hablado.`), { permanent: true });
      const audio = join(dir, "a.ogg");
      sh("ffmpeg", ["-y", "-v", "error", "-i", inp, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", audio]);
      await setStatus(job.id, "transcribing");
      const t1 = Date.now();
      const res = await transcribe(readFileSync(audio), "audio/ogg", DG, project.language);
      m.asr_ms = Date.now() - t1;
      if (!res.words.length) throw Object.assign(new Error("No se detectó voz en el audio (¿solo música o silencio?). La detección de momentos necesita habla; para canciones usa Lyric Studio."), { permanent: true });
      tr = ok(await sb.from("transcripts").insert({ workspace_id: project.workspace_id, source_id: src.id, language: res.language, words: res.words, asr_provider: "deepgram", asr_model: "nova-3" }).select("id,words,language").single(), "transcript");
    } else m.asr_ms = 0; // reutilizado
    if (!tr) throw new Error("transcript no disponible");
    const words = tr.words as TWord[];

    // 2) Selección guiada por brief
    await setStatus(job.id, "selecting");
    const t2 = Date.now();
    const brief = project.project_brief as string | null;
    let raw: RawCandidate[] = [];
    let selector = MODEL, fallbackReason: string | null = null;
    try {
      if (!AN) throw new Error("ANTHROPIC_API_KEY no configurada");
      for (const w of windows(words, 600, 45)) {
        raw.push(...(await proposeClips({ key: AN, model: MODEL, brief, windowText: transcriptText(words, w.from, w.to), target: `${project.target_seconds}s (máx ${project.max_seconds}s)` })));
      }
    } catch (e) {
      // Respaldo sin IA, etiquetado: el usuario ve que la selección es léxica.
      fallbackReason = (e as Error).message.slice(0, 200);
      selector = LEXICAL_VERSION;
      raw = lexicalCandidates(words, brief, { minSec: 12, maxSec: project.max_seconds, count: project.clip_count });
    }
    m.selector = selector;
    const { accepted, rejected } = validateCandidates(words, raw, { minSec: 12, maxSec: project.max_seconds, count: project.clip_count, hasBrief: !!brief?.trim() });
    m.selection_ms = Date.now() - t2; m.raw = raw.length; m.accepted = accepted.length; m.rejected = rejected.length;

    const gen = ok(await sb.from("generations").insert({ workspace_id: project.workspace_id, project_id: project.id, transcript_id: tr.id, brief_snapshot: brief, brief_sha256: briefHash(brief), rubric_version: RUBRIC_VERSION, model: selector, params: { clip_count: project.clip_count, max_seconds: project.max_seconds, rejected, fallbackReason }, status: "running" }).select("id").single(), "generación");

    // 3) Candidatos, clips y render (primer clip antes del lote)
    await setStatus(job.id, "rendering");
    const inp = join(dir, "in");
    if (!existsSync(inp)) {
      const d2 = await sb.storage.from("originals").download(path);
      if (d2.error || !d2.data) throw new Error(`descarga: ${d2.error?.message}`);
      writeFileSync(inp, Buffer.from(await d2.data.arrayBuffer()));
    }
    let firstClipMs = 0;
    const renderOne = async (i: number, c: (typeof accepted)[number]) => {
      const cand = ok(await sb.from("clip_candidates").insert({ workspace_id: project.workspace_id, generation_id: gen.id, start_ms: Math.round(c.startSec * 1000), end_ms: Math.round(c.endSec * 1000), title: c.title, reason: c.reason, brief_fit: c.briefFit, scores: { ...c.scores, overall: c.overall, label: "estimación editorial de IA" } }).select("id").single(), "candidato");
      const clip = ok(await sb.from("clips").insert({ workspace_id: project.workspace_id, project_id: project.id, generation_id: gen.id, candidate_id: cand.id, title: c.title }).select("id").single(), "clip");
      const comp = buildComposition({ words: words as Word[], startSec: c.startSec, endSec: c.endSec });
      await sb.from("clip_versions").insert({ clip_id: clip.id, workspace_id: project.workspace_id, version: 1, composition: comp });
      const ass = join(dir, `c${i}.ass`), out = join(dir, `c${i}.mp4`);
      writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: renderFamily(comp.style.fontName) }, RATIO_SIZE[comp.ratio]));
      const t3 = Date.now();
      sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out }));
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
      const rpath = `${project.workspace_id}/${clip.id}/v1-9x16.mp4`;
      const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error(`subida render: ${up.error.message}`);
      await sb.from("renders").insert({ workspace_id: project.workspace_id, clip_id: clip.id, clip_version: 1, ratio: "9:16", burn_subtitles: true, spec_sha256: briefHash(JSON.stringify(comp)), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size, streams: probe.streams.map((s: { codec_name: string; width?: number; height?: number }) => [s.codec_name, s.width, s.height]) } });
      m[`render_ms_${i}`] = Date.now() - t3;
      if (i === 0) firstClipMs = Date.now() - t0;
        };
    if (accepted.length) await renderOne(0, accepted[0]);          // primer clip antes que el lote
    const rest = accepted.slice(1).map((c, k) => [k + 1, c] as const);
    for (let k = 0; k < rest.length; k += 2) await Promise.all(rest.slice(k, k + 2).map(([i, c]) => renderOne(i, c)));
    m.first_clip_ms = firstClipMs; m.all_clips_ms = Date.now() - t0;
    await sb.from("generations").update({ status: "done" }).eq("id", gen.id);
    await setStatus(job.id, "done", { generation_id: gen.id, metrics: m });
    console.log("job ok", job.id, m);
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("job fallo", job.id, err.message);
    // Permanente: no se reintenta. Transitorio: vuelve a la cola hasta 3 intentos (claim_job lo limita).
    await setStatus(job.id, err.permanent || job.attempts >= 3 ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300), metrics: m });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Export bajo demanda: versión inmutable del clip → MP4 en el formato pedido. */
async function processRender(job: Job) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-r-"));
  try {
    const { version, ratio, burn } = job.params;
    if (!job.clip_id || !version || !ratio) throw Object.assign(new Error("Petición de export incompleta"), { permanent: true });
    const clip = ok(await sb.from("clips").select("id,workspace_id,project_id").eq("id", job.clip_id).single(), "clip");
    const project = ok(await sb.from("projects").select("source_id,deleted_at").eq("id", clip.project_id).single(), "proyecto");
    if (project.deleted_at) return void (await setStatus(job.id, "cancelled"));
    const cv = ok(await sb.from("clip_versions").select("composition").eq("clip_id", clip.id).eq("version", version).single(), "versión");
    const comp = { ...(cv.composition as Composition), ratio, burnSubtitles: burn !== false };
    await setStatus(job.id, "rendering");
    const dl = await sb.storage.from("originals").download(`${clip.workspace_id}/${project.source_id}/original`);
    if (dl.error || !dl.data) throw new Error(`descarga: ${dl.error?.message}`);
    const inp = join(dir, "in"), ass = join(dir, "c.ass"), out = join(dir, "o.mp4");
    writeFileSync(inp, Buffer.from(await dl.data.arrayBuffer()));
    const fontsDir = await fontsFor(clip.workspace_id, comp.style.fontName, dir);
    writeFileSync(ass, buildAss(comp.words, { ...styleForRatio(comp.style, ratio), fontName: renderFamily(comp.style.fontName) }, RATIO_SIZE[ratio]));
    const t1 = Date.now();
    sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out, fontsDir }));
    const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
    const vs = probe.streams.find((x: { codec_type: string }) => x.codec_type === "video");
    const { width, height } = RATIO_SIZE[ratio];
    if (vs?.width !== width || vs?.height !== height) throw new Error(`dimensiones inesperadas ${vs?.width}x${vs?.height}`);
    const rpath = `${clip.workspace_id}/${clip.id}/v${version}-${ratio.replace(":", "x")}${comp.burnSubtitles ? "" : "-sin-subs"}.mp4`;
    const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
    if (up.error) throw new Error(`subida render: ${up.error.message}`);
    const ins = await sb.from("renders").upsert({ workspace_id: clip.workspace_id, clip_id: clip.id, clip_version: version, ratio, burn_subtitles: comp.burnSubtitles, spec_sha256: briefHash(JSON.stringify(comp)), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size, width: vs.width, height: vs.height } }, { onConflict: "workspace_id,clip_id,clip_version,ratio,burn_subtitles,spec_sha256" });
    if (ins.error) throw new Error(`registro render: ${ins.error.message}`);
    await setStatus(job.id, "done", { metrics: { render_ms: Date.now() - t1, total_ms: Date.now() - t0 } });
    console.log("render ok", job.id, ratio, Date.now() - t0, "ms");
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    console.error("render fallo", job.id, err.message);
    await setStatus(job.id, err.permanent || job.attempts >= 3 ? "failed" : "queued", { error_code: err.permanent ? "permanent" : "transient", error_message: err.message.slice(0, 300) });
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
    if (cached) { words = cached.words as TimedWord[]; m.alignment = "cache"; }
    else {
      await setStatus(job.id, "transcribing");
      const ogg = join(dir, "a.ogg");
      sh("ffmpeg", ["-y", "-v", "error", "-i", seg, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", ogg]);
      const t1 = Date.now();
      const tr = await transcribe(readFileSync(ogg), "audio/ogg", DG, song.language as "auto" | "es" | "en");
      m.asr_ms = Date.now() - t1; m.asr_words = tr.words.length;
      const lines = song.lyrics_text ? parseLyrics(song.lyrics_text) : [];
      words = lines.length ? alignLyrics(lines, tr.words) : lyricsFromAsr(tr.words);
      if (!words.length) throw Object.assign(new Error("No se detectó voz cantada en el tramo. Aporta la letra o elige otro tramo."), { permanent: true });
      await sb.from("song_alignments").insert({ workspace_id: song.workspace_id, song_id: song.id, lyrics_sha256: key, words, asr_words: tr.words.length });
      m.alignment = lines.length ? "lyrics+asr" : "asr";
    }
    m.words = words.length; m.interpolated = words.filter((w) => w.origin === "interpolated").length;
    // Plan exacto de N variantes
    const plan = planVariants(p.n ?? 1, p.styles?.length ? p.styles : ["Impacto"], p.backgrounds?.length ? p.backgrounds : ["#111111"], p.seed ?? 1);
    m.n = plan.variants.length; m.distinct = plan.distinct;
    await setStatus(job.id, "rendering");
    const byLine = new Map<number, TimedWord[]>();
    for (const w of words) byLine.set(w.line, [...(byLine.get(w.line) ?? []), w]);
    const done = new Set(((await sb.from("lyric_videos").select("variant").eq("job_id", job.id).eq("status", "ready")).data ?? []).map((r) => r.variant));
    for (const v of plan.variants) {
      if (done.has(v.index)) continue;   // reintento: no repite variantes ya listas
      const { data: cur } = await sb.from("jobs").select("status").eq("id", job.id).single();
      if (cur?.status === "cancelled") break;
      await sb.from("lyric_videos").upsert({ workspace_id: song.workspace_id, song_id: song.id, job_id: job.id, variant: v.index, params: v, status: "rendering" }, { onConflict: "job_id,variant" });
      const style = { ...(PRESETS[v.style] ?? PRESETS.Impacto), y: 0.5 + (v.seed % 7) * 0.01 };
      const eff = styleForRatio(style, ratio);
      const groups = groupsFrom([...byLine.values()], eff.maxCharsPerLine);
      const ass = join(dir, `v${v.index}.ass`), out = join(dir, `v${v.index}.mp4`);
      writeFileSync(ass, buildAss(words, { ...eff, fontName: renderFamily(eff.fontName), maxLines: 3 }, { width: W, height: H }, groups));
      const bg = /^#[0-9a-f]{6}$/i.test(v.background) ? v.background.slice(1) : "111111";
      const t2 = Date.now();
      sh("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x${bg}:s=${W}x${H}:r=30:d=${len}`, "-i", seg,
        "-vf", `subtitles=${escapeFilterPath(ass)},format=yuv420p`, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "superfast", "-crf", "22", "-tune", "stillimage",
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
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

const idleMs = Number(process.env.WORKER_IDLE_SECONDS ?? 0) * 1000;   // 0 = salir si no hay trabajo
const maxMs = Number(process.env.WORKER_MAX_SECONDS ?? 3000) * 1000;
const started = Date.now();
let processed = 0, lastWork = Date.now();
for (;;) {
  if (Date.now() - started > maxMs) break;
  const { data, error } = await sb.rpc("claim_job");
  if (error) { console.error("claim_job:", error.message); process.exit(1); }
  const job = (data as Job[] | null)?.[0];
  if (!job) {
    if (Date.now() - lastWork > idleMs) break;
    await new Promise((r) => setTimeout(r, 3000));   // sondeo cada 3 s mientras está caliente
    continue;
  }
  await (job.kind === "render" ? processRender(job) : job.kind === "lyrics" ? processLyrics(job) : processJob(job)); processed++; lastWork = Date.now();
}
console.log(`terminado: ${processed} job(s) en ${Math.round((Date.now() - started) / 1000)} s`);
