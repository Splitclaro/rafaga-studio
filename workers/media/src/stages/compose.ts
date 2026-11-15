// Composición de los clips elegidos: versión 1 de cada clip (aspecto, diseño, plantilla, titular, subtítulos) SIN renderizar ningún MP4
// (eso es la exportación). compose · previews (miniatura) · checks (composición, duración, zonas seguras).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqChat } from "@rafaga/providers";
import { viralTemplate, textBoxes, validateSafeZones, VIRAL_TEMPLATE_IDS, type ViralTemplateId, type AspectId, type Platform } from "@rafaga/composition";
import type { TWord } from "@rafaga/selection";
import { StageError, type StageCtx, type StageImpl } from "./registry.ts";
import { mezzaninePath } from "./analysis.ts";
import { GroqLimiter, limitsFromEnv } from "../groqlimits.ts";

interface GClip { clip_id: string; title: string; start_ms: number; end_ms: number; overall: number; reason: string | null; user_edited: boolean; has_version: boolean }
interface Gctx { generation_id: string; workspace_id: string; analysis_id: string; params: Record<string, unknown> & { aspect?: AspectId; template?: string; subtitles?: boolean; hook?: { enabled?: boolean; top_n?: number }; safe_zone_platforms?: Platform[]; min_s?: number; max_s?: number }; words: TWord[]; speakers: { needs_review?: boolean }[] }
export interface ComposeDeps { faces?: (file: string, start: number, dur: number) => { w: number; h: number; samples: unknown[] }; headline?: (prompt: { title: string; text: string }) => Promise<string[]>; limiter?: GroqLimiter }
const SPEAKER_TEMPLATES = new Set(["pantalla_dividida", "hablante_seguimiento", "cambio_hablante", "presentacion_ponente"]);
const LEGACY_TEMPLATE: Record<string, ViralTemplateId> = { split_dos_hablantes: "pantalla_dividida", hablante_activo: "cambio_hablante", titular_caja: "titular_en_caja", titular_desenfoque: "titular_sobre_desenfoque", completo_ajustado: "video_completo" };
export const templateOf = (t: unknown): ViralTemplateId => { const s = String(t ?? ""); const m = LEGACY_TEMPLATE[s] ?? s; return (VIRAL_TEMPLATE_IDS as readonly string[]).includes(m) ? (m as ViralTemplateId) : "hablante_seguimiento"; };
const dir = (ctx: StageCtx, gen: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", `gen-${gen}`); mkdirSync(d, { recursive: true }); return d; };
const upper = (s: string) => s.replace(/[.¿?¡!]+$/g, "").trim().toUpperCase();

/** Titular de 1–2 líneas con el modelo (barato) o, si falla, a partir del título del clip. */
async function headlineFor(ctx: StageCtx, deps: ComposeDeps, c: GClip, text: string): Promise<{ lines: string[]; llm: boolean }> {
  const fallback = (): string[] => { const w = c.title.split(/\s+/); return w.length > 6 ? [upper(w.slice(0, Math.ceil(w.length / 2)).join(" ")), upper(w.slice(Math.ceil(w.length / 2)).join(" "))] : [upper(c.title)]; };
  try {
    const limiter = deps.limiter ?? new GroqLimiter(limitsFromEnv(ctx.env ?? process.env));
    let lines: string[];
    if (deps.headline) lines = await deps.headline({ title: c.title, text });
    else {
      const cfg = aiConfig(ctx.env ?? process.env); if (!cfg.key) return { lines: fallback(), llm: false };
      await limiter.wait("llm", Math.ceil(text.length / 4) + 300);
      const r = await groqChat(cfg, { system: 'Escribe un titular de portada para un clip corto, en el idioma del texto, máximo 2 líneas de 28 caracteres, sin comillas ni emojis. Responde SOLO con JSON {"l1":"…","l2":"…"} (l2 puede ir vacío).', user: `Título: ${c.title}\nTexto del clip: ${text.slice(0, 1200)}`, json: true, maxTokens: 300, fetchImpl: ctx.fetch });
      const j = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as { l1?: string; l2?: string }; lines = [j.l1 ?? "", j.l2 ?? ""];
    }
    lines = lines.map((l) => upper(String(l ?? "")).slice(0, 40)).filter(Boolean).slice(0, 2);
    return lines.length ? { lines, llm: true } : { lines: fallback(), llm: false };
  } catch { return { lines: fallback(), llm: false }; }
}

const compose: StageImpl = {
  inputs: (_c, row) => ({ stage: "compose", generation: row.params.generation_id, v: 3 }),
  async run(ctx, row) {
    const gen = String(row.params.generation_id), gc = await ctx.rpc<Gctx>("generation_context", { p_generation: gen });
    if (!gc) throw new StageError("not_found", "La generación no existe");
    const clips = (await ctx.rpc<GClip[]>("generation_clips", { p_generation: gen })) ?? [], deps = (ctx.deps ?? {}) as ComposeDeps;
    const P = gc.params, aspect = (P.aspect ?? "9:16") as AspectId, template = templateOf(P.template), hookN = P.hook?.enabled === false ? 0 : P.hook?.enabled && Number(P.hook.top_n) > 0 ? Number(P.hook.top_n) : clips.length;   // por defecto todos los clips llevan titular (se puede quitar después)
    const top = new Set([...clips].sort((a, b) => b.overall - a.overall).slice(0, hookN).map((c) => c.clip_id));
    let composed = 0, hooks = 0, skipped = 0; const reviewNeeded = SPEAKER_TEMPLATES.has(template) && gc.speakers.some((s) => s.needs_review);
    // Reencuadre con seguimiento (como Opus): en diseños que rellenan el fotograma se detectan caras en cada tramo y se sigue al sujeto.
    const fills = (template === "hablante_seguimiento" || template === "cambio_hablante") && aspect === "9:16";
    let faceFile: string | null = null;
    if (fills && ctx.r2 && row.params.source_id) { try { faceFile = (await mezzaninePath(ctx, String(row.params.source_id))).file; } catch { faceFile = null; } }
    let tracked = 0;
    for (const c of clips) {
      if (c.has_version || c.user_edited) { skipped++; continue; }        // nunca se sobrescribe lo ya editado ni lo ya compuesto
      const startS = c.start_ms / 1000, endS = c.end_ms / 1000;
      let headline: { lines: string[]; accent?: string } | undefined;
      if (top.has(c.clip_id)) {
        const text = gc.words.filter((w) => w.start >= startS && w.end <= endS).map((w) => w.text).join(" ");
        const h = await headlineFor(ctx, deps, c, text); headline = { lines: h.lines }; if (h.llm) hooks++;
      }
      const spec = viralTemplate(template, aspect, { duration: +(endS - startS).toFixed(3), fragments: [{ start: startS, end: endS }], headline, platforms: P.safe_zone_platforms, subtitles: P.subtitles !== false });
      if (faceFile) {
        try {
          const { scanFaces, reframePath } = await import("../reframe.ts");
          const scan = deps.faces ? (deps.faces(faceFile, startS, endS - startS) as ReturnType<typeof scanFaces>) : scanFaces(faceFile, startS, endS - startS, 2);
          const path = reframePath(scan, 9 / 16, endS - startS, template === "cambio_hablante" ? "follow" : "follow");
          if (path.kf.length && path.mode !== "static") { (spec as { kf?: unknown }).kf = path.kf; tracked++; }
        } catch { /* sin OpenCV o sin caras: queda el encuadre centrado */ }
      }
      await ctx.rpc("compose_clip", { p_clip: c.clip_id, p_aspect: aspect, p_layout: spec.layout, p_template: template, p_spec: { ...spec, caption_style: P.caption_style ?? null }, p_needs_review: reviewNeeded });
      composed++;
    }
    return { output: { composed, hooks, skipped, tracked, template, aspect }, ...(hookN ? { units_actual: Math.round(0.1 * hooks * 100) / 100 } : {}) };
  },
};

const previews: StageImpl = {
  inputs: (_c, row) => ({ stage: "previews", generation: row.params.generation_id, v: 2 }),
  async run(ctx, row) {
    const gen = String(row.params.generation_id), gc = await ctx.rpc<Gctx & { project_id: string }>("generation_context", { p_generation: gen });
    const clips = (await ctx.rpc<GClip[]>("generation_clips", { p_generation: gen })) ?? [];
    const source = String(row.params.source_id ?? "");
    if (!source || !ctx.r2 || !clips.length) return { output: { thumbs: 0 } };
    const { file } = await mezzaninePath(ctx, source); let n = 0;
    for (const c of clips) {
      const out = join(dir(ctx, gen), `${c.clip_id}.jpg`), at = c.start_ms / 1000 + Math.min(2, (c.end_ms - c.start_ms) / 2000);
      const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], { encoding: "utf8" });
      if (r.status !== 0 || statSync(out).size < 1000) continue;
      const key = `${gc.workspace_id}/${source}/clips/${c.clip_id}.jpg`;
      await ctx.r2.upload(key, out, "image/jpeg");
      await ctx.rpc("record_object", { p_ws: gc.workspace_id, p_key: key, p_bytes: statSync(out).size, p_kind: "preview", p_project: null, p_source: source, p_render: null, p_expires_at: null });
      await ctx.rpc("set_clip_thumb", { p_clip: c.clip_id, p_path: key }); n++;
      // Análisis de escena (estimación): 3 fotogramas del clip → descripción visual con marcas de tiempo. Nunca bloquea el clip si falla.
      try {
        const cfg = aiConfig(ctx.env ?? process.env); const dur = (c.end_ms - c.start_ms) / 1000;
        if (cfg.key && dur >= 3) {
          const stamps = [0.1, 0.5, 0.9].map((f) => c.start_ms / 1000 + dur * f), imgs: unknown[] = [];
          for (let i = 0; i < stamps.length; i++) {
            const fo = join(dir(ctx, gen), `${c.clip_id}-s${i}.jpg`);
            const fr = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", stamps[i].toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=384:-2", "-q:v", "6", fo], { encoding: "utf8" });
            if (fr.status === 0 && statSync(fo).size > 500) imgs.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${readFileSync(fo).toString("base64")}` } });
          }
          if (imgs.length) {
            const limiter = new GroqLimiter(limitsFromEnv(ctx.env ?? process.env)); await limiter.wait("llm", 1500);
            const marks = stamps.map((t) => { const x = Math.round(t - c.start_ms / 1000); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; });
            const r = await groqChat(cfg, { model: (ctx.env ?? process.env).GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b", maxTokens: 2000,
              system: "Describes escenas de vídeo en español, de forma breve y objetiva. No inventes lo que no se ve.",
              user: [{ type: "text", text: `Estos ${imgs.length} fotogramas son del mismo clip, en los instantes ${marks.slice(0, imgs.length).join(", ")}. Escribe una línea por fotograma con el formato «[m:ss] descripción de lo que se ve» (máximo 18 palabras cada una).` }, ...imgs] });
            const text = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); if (text) await ctx.rpc("set_clip_scene", { p_clip: c.clip_id, p_text: text });
          }
        }
      } catch (e) { ctx.log?.(`escena sin describir: ${(e as Error).message?.slice(0, 120)}`); }
    }
    return { output: { thumbs: n } };
  },
};

const checks: StageImpl = {
  inputs: (_c, row) => ({ stage: "checks", generation: row.params.generation_id, v: 2 }),
  async run(ctx, row) {
    const gen = String(row.params.generation_id), gc = await ctx.rpc<Gctx>("generation_context", { p_generation: gen });
    const clips = (await ctx.rpc<GClip[]>("generation_clips", { p_generation: gen })) ?? [];
    const platforms = gc.params.safe_zone_platforms ?? [], aspect = (gc.params.aspect ?? "9:16") as AspectId; let warned = 0, missing = 0, outOfRange = 0;
    for (const c of clips) {
      const v = await ctx.rpc<{ composition: Parameters<typeof textBoxes>[0] } | null>("clip_version_spec", { p_clip: c.clip_id, p_version: 1 });
      if (!v) { missing++; continue; }
      const dur = (c.end_ms - c.start_ms) / 1000;
      if (gc.params.min_s && gc.params.max_s && (dur < Number(gc.params.min_s) * 0.5 || dur > Number(gc.params.max_s) * 1.5)) outOfRange++;
      if (platforms.length && aspect === "9:16") {
        const bad = validateSafeZones(textBoxes(v.composition), platforms);
        if (bad.length) { warned++; await ctx.rpc("add_generation_warning", { p_generation: gen, p_warning: { code: "safe_zone", clip_id: c.clip_id, boxes: [...new Set(bad.map((b) => `${b.box}:${b.platform}:${b.zone}`))] } }); }
      }
    }
    await ctx.rpc("finish_generation", { p_generation: gen });
    return { output: { clips: clips.length, missing, out_of_range: outOfRange, safe_zone_warnings: warned } };
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { compose, previews, checks };
