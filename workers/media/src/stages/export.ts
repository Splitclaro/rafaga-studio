// Exportaciones: render (MP4 / SRT / VTT / TXT / FCPXML / xmeml / EDL) desde la versión INMUTABLE pedida y zip del lote.
// El MP4 usa el mismo motor que la vista previa (toLegacyComposition → ffmpegArgs + injectHeadline).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAss, ffmpegArgs, injectHeadline, renderFamily, styleForRatio, toLegacyComposition, toSRT, toTranscript, toVTT, RATIO_SIZE, type CompositionV2, type Word } from "@rafaga/composition";
import { toVTT as vtt } from "@rafaga/composition";
import { StageError, type StageCtx, type StageImpl } from "./registry.ts";
import { mezzaninePath } from "./analysis.ts";
import { ZipBuilder } from "../zip.ts";
import { renderLyricItem } from "./lyric.ts";

export interface ExportItem { render_id: string; workspace_id: string; clip_id: string; version: number; kind: string; aspect: string; burn: boolean; composition: CompositionV2; source_id: string; title: string; words: Word[]; hash: string; batch_id: string | null }
const EXT: Record<string, string> = { mp4: "mp4", srt: "srt", vtt: "vtt", txt: "txt", fcpxml: "fcpxml", xmeml: "xml", edl: "edl", lrc: "lrc", lrc_word: "lrc", ass: "ass" };
const MIME: Record<string, string> = { mp4: "video/mp4", srt: "application/x-subrip", vtt: "text/vtt", txt: "text/plain", fcpxml: "application/xml", xmeml: "application/xml", edl: "text/plain", lrc: "text/plain", lrc_word: "text/plain", ass: "text/x-ssa" };
export const exportKey = (it: Pick<ExportItem, "workspace_id" | "clip_id" | "version" | "hash" | "kind">) => `${it.workspace_id}/${it.clip_id}/v${it.version}-${it.hash.slice(0, 12)}.${EXT[it.kind]}`;
const FPS = 30;
const frames = (s: number) => Math.round(s * FPS);
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const tc = (f: number) => { const s = Math.floor(f / FPS), p = (n: number) => String(n).padStart(2, "0"); return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(f % FPS)}`; };
const frag = (c: CompositionV2) => c.fragments.map((f) => ({ start: f.start, end: f.end }));
const base = (n: string) => n.replace(/[^\p{L}\p{N}._-]+/g, "_").slice(0, 60) || "clip";

/** EDL CMX3600: un evento por fragmento conservado. */
export function buildEDL(title: string, c: CompositionV2, reel = "AX"): string {
  let rec = 0; const out = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];
  frag(c).forEach((f, i) => { const a = frames(f.start), b = frames(f.end), d = b - a; out.push(`${String(i + 1).padStart(3, "0")}  ${reel.padEnd(8)} V     C        ${tc(a)} ${tc(b)} ${tc(rec)} ${tc(rec + d)}`, `* FROM CLIP NAME: ${title}`, ""); rec += d; });
  return out.join("\n");
}
/** FCPXML 1.10 con un asset y un clip por fragmento. */
export function buildFCPXML(title: string, c: CompositionV2, file: string): string {
  const { width, height } = RATIO_SIZE[c.aspect], fs = frag(c), total = fs.reduce((t, f) => t + frames(f.end) - frames(f.start), 0); let off = 0;
  const clips = fs.map((f) => { const d = frames(f.end) - frames(f.start), s = `<asset-clip ref="r2" name="${xml(title)}" offset="${off}/${FPS}s" start="${frames(f.start)}/${FPS}s" duration="${d}/${FPS}s"/>`; off += d; return s; }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<fcpxml version="1.10"><resources><format id="r1" name="FFVideoFormat${height}p${FPS}" frameDuration="1/${FPS}s" width="${width}" height="${height}"/><asset id="r2" name="${xml(title)}" start="0s" duration="${total}/${FPS}s" hasVideo="1" hasAudio="1" format="r1"><media-rep kind="original-media" src="${xml(file)}"/></asset></resources><library><event name="${xml(title)}"><project name="${xml(title)}"><sequence format="r1" duration="${total}/${FPS}s"><spine>${clips}</spine></sequence></project></event></library></fcpxml>\n`;
}
/** Final Cut Pro 7 / Premiere (xmeml v4). */
export function buildXMEML(title: string, c: CompositionV2, file: string): string {
  const { width, height } = RATIO_SIZE[c.aspect], fs = frag(c); let off = 0;
  const items = fs.map((f, i) => { const a = frames(f.start), b = frames(f.end), d = b - a, s = off; off += d; return `<clipitem id="clip${i + 1}"><name>${xml(title)}</name><start>${s}</start><end>${s + d}</end><in>${a}</in><out>${b}</out><file id="file1"><name>${xml(file)}</name><pathurl>${xml(file)}</pathurl></file></clipitem>`; }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xmeml version="4"><sequence><name>${xml(title)}</name><duration>${off}</duration><rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate><media><video><format><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></format><track>${items}</track></video></media></sequence></xmeml>\n`;
}

/** Texto de salida para formatos sin vídeo, de las palabras del propio clip (relativas al clip). */
export function textOutput(it: ExportItem): string {
  const comp = toLegacyComposition(it.composition, it.words, { width: 1920, height: 1080 }), style = styleForRatio(comp.style, comp.ratio);
  switch (it.kind) {
    case "srt": return toSRT(comp.words, style);
    case "vtt": return vtt(comp.words, style);
    case "txt": return toTranscript(comp.words);
    case "edl": return buildEDL(it.title, it.composition);
    case "fcpxml": return buildFCPXML(it.title, it.composition, `${base(it.title)}.mp4`);
    case "xmeml": return buildXMEML(it.title, it.composition, `${base(it.title)}.mp4`);
    default: throw new StageError("invalid_kind", `Formato desconocido: ${it.kind}`);
  }
}
void toVTT;

class BatchItemFailed extends Error { code: string; inBatch: boolean; constructor(code: string, msg: string, inBatch: boolean) { super(msg); this.code = code; this.inBatch = inBatch; } }
const dir = (ctx: StageCtx, id: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", `exp-${id}`); mkdirSync(d, { recursive: true }); return d; };
const probe = (file: string) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,pix_fmt:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}") as { streams?: { width: number; height: number; codec_name: string; pix_fmt: string }[]; format?: { duration?: string } };
  return { width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0, codec: j.streams?.[0]?.codec_name, pix_fmt: j.streams?.[0]?.pix_fmt, duration_s: Number(j.format?.duration ?? 0) };
};

const render: StageImpl = {
  inputs: (_c, row) => ({ stage: "render", render: row.params.render_id, v: 1 }),
  async run(ctx, row) {
    const id = String(row.params.render_id);
    const it = await ctx.rpc<ExportItem>("export_job_item", { p_render: id });
    if (!it) throw new StageError("not_found", "La exportación no existe");
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    // En un lote, un render fallido no detiene la etapa (si no, el ZIP de los demás quedaría bloqueado): la fila queda failed y el lote partial.
    const fail = async (code: string, msg: string): Promise<never> => { await ctx.rpc("finish_render", { p_render: id, p_status: "failed", p_path: null, p_probe: null, p_bytes: null, p_duration_ms: null, p_width: null, p_height: null, p_error: code }); throw new BatchItemFailed(code, msg, !!it.batch_id); };
    const key = exportKey(it), d = dir(ctx, id);
    try {
      if ((it.composition as unknown as { kind?: string }).kind === "lyric") return await renderLyricItem(ctx, it as never, { key, dir: d, fail });
      if (it.kind !== "mp4") {
        const text = textOutput(it), out = join(d, `out.${EXT[it.kind]}`); writeFileSync(out, text);
        await ctx.r2.upload(key, out, MIME[it.kind]);
        await ctx.rpc("finish_render", { p_render: id, p_status: "ready", p_path: key, p_probe: null, p_bytes: statSync(out).size, p_duration_ms: Math.round(it.composition.duration * 1000), p_width: null, p_height: null, p_error: null });
        return { output: { key, kind: it.kind } };
      }
      const { file } = await mezzaninePath(ctx, it.source_id);
      const comp = toLegacyComposition(it.composition, it.words, { width: 1920, height: 1080 });
      comp.burnSubtitles = it.burn && it.composition.subtitles.enabled;
      const ass = join(d, "subs.ass"), out = join(d, "out.mp4"), size = RATIO_SIZE[comp.ratio];
      let doc = buildAss(comp.words, { ...styleForRatio(comp.style, comp.ratio), fontName: renderFamily(comp.style.fontName) }, size);
      doc = injectHeadline(doc, it.composition);
      writeFileSync(ass, doc);
      const r = spawnSync("ffmpeg", ffmpegArgs(comp, { input: file, assPath: ass, output: out }), { encoding: "utf8", maxBuffer: 1 << 26 });
      if (r.status !== 0) await fail("render_failed", `ffmpeg: ${(r.stderr ?? "").slice(-300)}`);
      const p = probe(out);
      if (p.codec !== "h264" || p.pix_fmt !== "yuv420p" || !p.width) await fail("render_incompatible", "El MP4 resultante no es H.264/yuv420p");
      await ctx.r2.upload(key, out, "video/mp4");
      await ctx.rpc("finish_render", { p_render: id, p_status: "ready", p_path: key, p_probe: p, p_bytes: statSync(out).size, p_duration_ms: Math.round(p.duration_s * 1000), p_width: p.width, p_height: p.height, p_error: null });
      return { output: { key, kind: "mp4", width: p.width, height: p.height } };
    } catch (e) {
      if (!(e instanceof BatchItemFailed)) { try { await fail("render_failed", (e as Error).message); } catch (x) { e = x; } }
      const b = e as BatchItemFailed;
      if (b.inBatch) return { output: { failed: b.code, message: b.message.slice(0, 300) } };   // el motivo queda en la etapa para diagnosticar
      throw new StageError(b.code, b.message);
    }
  },
};

// Cierra el lote: un render fallido NO bloquea a los demás; el ZIP lleva solo lo disponible y el lote queda `partial`.
const zip: StageImpl = {
  inputs: (_c, row) => ({ stage: "zip", batch: row.params.batch_id, v: 1 }),
  async run(ctx, row) {
    const batch = String(row.params.batch_id);
    const items = (await ctx.rpc<{ render_id: string; status: string; path: string | null; kind: string; clip_id: string; version: number; ratio: string }[]>("batch_renders", { p_batch: batch })) ?? [];
    const ready = items.filter((i) => i.status === "ready" && i.path);
    const status = await ctx.rpc<string>("finish_batch", { p_batch: batch });
    if (!ready.length) return { output: { status, files: 0 } };
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const d = dir(ctx, batch), z = new ZipBuilder(), ws = ready[0].path!.split("/")[0];
    for (const [i, it] of ready.entries()) {
      const f = join(d, `p${i}`); await ctx.r2.download(it.path!, f);
      z.add(`${String(i + 1).padStart(2, "0")}-${it.clip_id.slice(0, 8)}-v${it.version}-${it.ratio.replace(":", "x")}.${it.path!.split(".").pop()}`, readFileSync(f));
    }
    const out = join(d, "lote.zip"), buf = z.build(); writeFileSync(out, buf);
    const key = `${ws}/batches/${batch}.zip`;
    await ctx.r2.upload(key, out, "application/zip");
    await ctx.rpc("set_batch_zip", { p_batch: batch, p_path: key, p_bytes: buf.length });
    return { output: { status, files: ready.length, key } };
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { render, zip };
