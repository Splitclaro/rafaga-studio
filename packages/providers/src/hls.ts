// Captura HLS (MPEG-TS) con ventanas. El acceso a red se inyecta (producción: safeGet con SSRF; pruebas: fetcher local).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GetResult, GetOpts } from "./net.ts";

export type Fetcher = (url: string, o: GetOpts) => Promise<GetResult>;
export interface Seg { seq: number; uri: string; dur: number; discontinuity: boolean }
export type Parsed = { type: "master"; variants: { uri: string; bandwidth: number }[] } | { type: "media"; firstSeq: number; target: number; segments: Seg[]; ended: boolean; fmp4: boolean };

export function parsePlaylist(text: string, base: string): Parsed {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("No es una lista HLS (#EXTM3U)");
  const abs = (u: string) => new URL(u, base).toString();
  if (lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"))) {
    const variants: { uri: string; bandwidth: number }[] = [];
    lines.forEach((l, i) => { if (l.startsWith("#EXT-X-STREAM-INF")) { const bw = Number(l.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0); const u = lines[i + 1]; if (u && !u.startsWith("#")) variants.push({ uri: abs(u), bandwidth: bw }); } });
    return { type: "master", variants };
  }
  let seq = 0, target = 6, dur = 0, disc = false, ended = false, fmp4 = false;
  const segments: Seg[] = []; let n = 0;
  for (const l of lines) {
    if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = Number(l.split(":")[1]) || 0;
    else if (l.startsWith("#EXT-X-TARGETDURATION:")) target = Number(l.split(":")[1]) || 6;
    else if (l.startsWith("#EXT-X-MAP")) fmp4 = true;
    else if (l.startsWith("#EXT-X-DISCONTINUITY") && !l.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE")) disc = true;
    else if (l.startsWith("#EXTINF:")) dur = Number(l.slice(8).split(",")[0]) || 0;
    else if (l === "#EXT-X-ENDLIST") ended = true;
    else if (!l.startsWith("#")) { segments.push({ seq: seq + n, uri: abs(l), dur, discontinuity: disc }); n++; disc = false; }
  }
  return { type: "media", firstSeq: seq, target, segments, ended, fmp4 };
}

export interface WindowOut { files: string[]; seconds: number; startedAtMs: number; reason: "length" | "gap" | "stop" | "ended" }
export interface CaptureOpts { fetch: Fetcher; url: string; dir: string; windowSeconds: number; minWindowSeconds?: number; maxSegmentBytes?: number; maxSeconds: number; resumeFromSeq?: number | null; shouldStop: () => Promise<boolean>; onWindow: (w: WindowOut) => Promise<void>; onProgress?: (p: { capturedSeconds: number; lastSeq: number }) => Promise<void>; sleep?: (ms: number) => Promise<void> }
export interface CaptureStats { capturedSeconds: number; windows: number; gaps: number; reconnects: number; lastSeq: number; endedBy: "stop" | "ended" | "max" | "error"; error?: string }

/** Captura durable: nunca une segmentos a través de un hueco o discontinuidad; reconecta con backoff. */
export async function captureHls(o: CaptureOpts): Promise<CaptureStats> {
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  mkdirSync(o.dir, { recursive: true });
  const stats: CaptureStats = { capturedSeconds: 0, windows: 0, gaps: 0, reconnects: 0, lastSeq: o.resumeFromSeq ?? -1, endedBy: "stop" };
  let mediaUrl = o.url, files: string[] = [], winSec = 0, winStart = 0, fails = 0, count = 0;
  const flush = async (reason: WindowOut["reason"]) => {
    if (files.length && winSec >= (o.minWindowSeconds ?? 8)) { stats.windows++; await o.onWindow({ files, seconds: winSec, startedAtMs: winStart, reason }); }
    files = []; winSec = 0;
  };
  for (;;) {
    if (await o.shouldStop()) { await flush("stop"); stats.endedBy = "stop"; return stats; }
    if (stats.capturedSeconds >= o.maxSeconds) { await flush("stop"); stats.endedBy = "max"; return stats; }
    try {
      const pl = await o.fetch(mediaUrl, { maxBytes: 1_000_000, timeoutMs: 15000 });
      if (pl.status !== 200) throw new Error(`Lista HLS: HTTP ${pl.status}`);
      let p = parsePlaylist(pl.body.toString("utf8"), pl.finalUrl);
      if (p.type === "master") {
        if (!p.variants.length) throw new Error("Lista maestra sin variantes");
        mediaUrl = [...p.variants].sort((a, b) => a.bandwidth - b.bandwidth)[0].uri;   // variante más ligera
        continue;
      }
      if (p.fmp4) throw Object.assign(new Error("HLS con fMP4/CMAF no está soportado todavía (solo MPEG-TS)."), { fatal: true });
      fails = 0;
      const fresh = p.segments.filter((s) => s.seq > stats.lastSeq);
      if (fresh.length && stats.lastSeq >= 0 && fresh[0].seq > stats.lastSeq + 1) { stats.gaps++; await flush("gap"); }   // se perdieron segmentos
      for (const s of fresh) {
        if (s.discontinuity && files.length) { stats.gaps++; await flush("gap"); }
        const r = await o.fetch(s.uri, { maxBytes: o.maxSegmentBytes ?? 25 * 1024 * 1024, timeoutMs: 30000 });
        if (r.status !== 200) throw new Error(`Segmento ${s.seq}: HTTP ${r.status}`);
        if (r.body[0] !== 0x47) throw Object.assign(new Error("El segmento no es MPEG-TS (¿fMP4 o cifrado?)."), { fatal: true });
        const f = join(o.dir, `seg-${String(count++).padStart(6, "0")}.ts`); writeFileSync(f, r.body);
        if (!files.length) winStart = Date.now();
        files.push(f); winSec += s.dur; stats.capturedSeconds += s.dur; stats.lastSeq = s.seq;
        if (o.onProgress) await o.onProgress({ capturedSeconds: stats.capturedSeconds, lastSeq: stats.lastSeq });
        if (winSec >= o.windowSeconds) await flush("length");
      }
      if (p.ended) { await flush("ended"); stats.endedBy = "ended"; return stats; }
      await sleep(Math.max(1500, (p.target * 1000) / 2));
    } catch (e) {
      const err = e as Error & { fatal?: boolean };
      if (err.fatal) { await flush("stop"); stats.endedBy = "error"; stats.error = err.message; return stats; }
      fails++; stats.reconnects++;
      if (fails > 6) { await flush("stop"); stats.endedBy = "error"; stats.error = `Sin conexión con la emisión tras 6 intentos: ${err.message}`; return stats; }
      await sleep(Math.min(30000, 1000 * 2 ** fails) * (0.6 + Math.random() * 0.4));
    }
  }
}
