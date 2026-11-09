// Worker en GitHub Actions: reclama jobs `detect` de Supabase y ejecuta el pipeline real.
// Secretos requeridos (variables de entorno): SUPABASE_URL, SUPABASE_SECRET_KEY, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, buildComposition, ffmpegArgs, type Word } from "@rafaga/composition";
import { transcribe, proposeClips } from "@rafaga/providers";
import { briefHash, RUBRIC_VERSION, validateCandidates, windows, transcriptText, type TWord, type RawCandidate } from "@rafaga/selection";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Falta el secreto ${k}`); process.exit(2); } return v; };
const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
const DG = need("DEEPGRAM_API_KEY"), AN = need("ANTHROPIC_API_KEY");
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 28, encoding: "buffer" });
  if (r.status !== 0) throw new Error(`${cmd} falló (${r.status}): ${r.stderr.toString().slice(-400)}`);
  return r.stdout.toString();
};
const ok = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => { if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message ?? "sin datos"}`); return r.data as NonNullable<T>; };

type Job = { id: string; workspace_id: string; project_id: string; attempts: number };
const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  sb.from("jobs").update({ status, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra }).eq("id", id);

async function processJob(job: Job) {
  const m: Record<string, number | string> = {};
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "rafaga-"));
  try {
    const project = ok(await sb.from("projects").select("id,workspace_id,source_id,project_brief,language,clip_count,target_seconds,max_seconds,deleted_at").eq("id", job.project_id).single(), "proyecto");
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
      const audio = join(dir, "a.ogg");
      sh("ffmpeg", ["-y", "-v", "error", "-i", inp, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", audio]);
      await setStatus(job.id, "transcribing");
      const t1 = Date.now();
      const res = await transcribe(readFileSync(audio), "audio/ogg", DG, project.language);
      m.asr_ms = Date.now() - t1;
      if (!res.words.length) throw Object.assign(new Error("No se detectó habla en el audio."), { permanent: true });
      tr = ok(await sb.from("transcripts").insert({ workspace_id: project.workspace_id, source_id: src.id, language: res.language, words: res.words, asr_provider: "deepgram", asr_model: "nova-3" }).select("id,words,language").single(), "transcript");
    } else m.asr_ms = 0; // reutilizado
    if (!tr) throw new Error("transcript no disponible");
    const words = tr.words as TWord[];

    // 2) Selección guiada por brief
    await setStatus(job.id, "selecting");
    const t2 = Date.now();
    const brief = project.project_brief as string | null;
    const raw: RawCandidate[] = [];
    for (const w of windows(words, 600, 45)) {
      raw.push(...(await proposeClips({ key: AN, model: MODEL, brief, windowText: transcriptText(words, w.from, w.to), target: `${project.target_seconds}s (máx ${project.max_seconds}s)` })));
    }
    const { accepted, rejected } = validateCandidates(words, raw, { minSec: 12, maxSec: project.max_seconds, count: project.clip_count, hasBrief: !!brief?.trim() });
    m.selection_ms = Date.now() - t2; m.raw = raw.length; m.accepted = accepted.length; m.rejected = rejected.length;

    const gen = ok(await sb.from("generations").insert({ workspace_id: project.workspace_id, project_id: project.id, transcript_id: tr.id, brief_snapshot: brief, brief_sha256: briefHash(brief), rubric_version: RUBRIC_VERSION, model: MODEL, params: { clip_count: project.clip_count, max_seconds: project.max_seconds, rejected }, status: "running" }).select("id").single(), "generación");

    // 3) Candidatos, clips y render (primer clip antes del lote)
    await setStatus(job.id, "rendering");
    const src2 = await sb.storage.from("originals").download(path);
    const inp = join(dir, "in");
    if (!src2.error && src2.data) writeFileSync(inp, Buffer.from(await src2.data.arrayBuffer()));
    let firstClipMs = 0;
    for (const [i, c] of accepted.entries()) {
      const cand = ok(await sb.from("clip_candidates").insert({ workspace_id: project.workspace_id, generation_id: gen.id, start_ms: Math.round(c.startSec * 1000), end_ms: Math.round(c.endSec * 1000), title: c.title, reason: c.reason, brief_fit: c.briefFit, scores: { ...c.scores, overall: c.overall, label: "estimación editorial de IA" } }).select("id").single(), "candidato");
      const clip = ok(await sb.from("clips").insert({ workspace_id: project.workspace_id, project_id: project.id, generation_id: gen.id, candidate_id: cand.id, title: c.title }).select("id").single(), "clip");
      const comp = buildComposition({ words: words as Word[], startSec: c.startSec, endSec: c.endSec });
      await sb.from("clip_versions").insert({ clip_id: clip.id, workspace_id: project.workspace_id, version: 1, composition: comp });
      const ass = join(dir, `c${i}.ass`), out = join(dir, `c${i}.mp4`);
      writeFileSync(ass, buildAss(comp.words, { ...comp.style, fontName: "Liberation Sans" }, { width: 1080, height: 1920 }));
      const t3 = Date.now();
      sh("ffmpeg", ffmpegArgs(comp, { input: inp, assPath: ass, output: out }));
      const probe = JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]));
      const rpath = `${project.workspace_id}/${clip.id}/v1-9x16.mp4`;
      const up = await sb.storage.from("renders").upload(rpath, readFileSync(out), { contentType: "video/mp4", upsert: true });
      if (up.error) throw new Error(`subida render: ${up.error.message}`);
      await sb.from("renders").insert({ workspace_id: project.workspace_id, clip_id: clip.id, clip_version: 1, ratio: "9:16", burn_subtitles: true, spec_sha256: briefHash(JSON.stringify(comp)), storage_path: rpath, status: "ready", probe: { duration: probe.format.duration, size: probe.format.size, streams: probe.streams.map((s: { codec_name: string; width?: number; height?: number }) => [s.codec_name, s.width, s.height]) } });
      m[`render_ms_${i}`] = Date.now() - t3;
      if (i === 0) firstClipMs = Date.now() - t0;
    }
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

let processed = 0;
for (;;) {
  const { data, error } = await sb.rpc("claim_job");
  if (error) { console.error("claim_job:", error.message); process.exit(1); }
  const job = (data as Job[] | null)?.[0];
  if (!job) break;
  await processJob(job); processed++;
  if (processed >= 5) break; // límite por ejecución; el siguiente ciclo continúa
}
console.log(`terminado: ${processed} job(s)`);
