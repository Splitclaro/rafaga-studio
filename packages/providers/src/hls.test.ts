import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlaylist, captureHls, type Fetcher } from "./hls.ts";

const ts = (n: number) => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, n)]);
const media = (seq: number, count: number, extra = "") => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${seq}\n${Array.from({ length: count }, (_, i) => `${extra && i === 1 ? extra + "\n" : ""}#EXTINF:4.0,\ns${seq + i}.ts`).join("\n")}\n`;

test("parsePlaylist: maestra, media, secuencia y discontinuidad", () => {
  const m = parsePlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhi.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nlo.m3u8\n", "https://x.com/a/master.m3u8");
  assert.equal(m.type, "master"); assert.equal(m.type === "master" && m.variants[1].uri, "https://x.com/a/lo.m3u8");
  const p = parsePlaylist(media(100, 3, "#EXT-X-DISCONTINUITY"), "https://x.com/a/p.m3u8");
  assert.equal(p.type, "media"); if (p.type !== "media") return;
  assert.deepEqual(p.segments.map((s) => s.seq), [100, 101, 102]); assert.equal(p.segments[1].discontinuity, true); assert.equal(p.segments[0].uri, "https://x.com/a/s100.ts"); assert.equal(p.ended, false);
  assert.throws(() => parsePlaylist("hola", "https://x.com/"));
});

test("captureHls: ventanas, huecos sin unir, reconexión y parada", async () => {
  // Emisión simulada que avanza una playlist por consulta: seq 0-2, 3-5, salto a 9-11 (HUECO), error de red, 12-14.
  const steps: (string | Error)[] = [media(0, 3), media(0, 6), media(9, 3), new Error("caída"), media(9, 6), media(9, 6)];
  let i = 0; const got: string[] = [];
  const fetch: Fetcher = async (url) => {
    if (url.endsWith(".m3u8")) { const s = steps[Math.min(i++, steps.length - 1)]; if (s instanceof Error) throw s; return { status: 200, contentType: "application/vnd.apple.mpegurl", body: Buffer.from(s), finalUrl: url }; }
    got.push(url); return { status: 200, contentType: "video/mp2t", body: ts(1), finalUrl: url };
  };
  const wins: { n: number; reason: string }[] = []; let polls = 0;
  const st = await captureHls({ fetch, url: "https://x.com/live.m3u8", dir: mkdtempSync(join(tmpdir(), "hls-")), windowSeconds: 100, minWindowSeconds: 4, maxSeconds: 1000, shouldStop: async () => ++polls > 7, onWindow: async (w) => { wins.push({ n: w.files.length, reason: w.reason }); assert.ok(w.files.every(existsSync)); }, sleep: async () => {} });
  assert.equal(st.gaps >= 1, true, "detecta el hueco");
  assert.ok(st.reconnects >= 1, "reconecta");
  assert.equal(new Set(got).size, got.length, "no descarga dos veces el mismo segmento");
  assert.ok(wins.some((w) => w.reason === "gap"), "el hueco cierra ventana en vez de unir");
  assert.equal(st.endedBy, "stop");
  // Ninguna ventana mezcla segmentos a ambos lados del hueco (seq 5 → 9)
  assert.ok(st.lastSeq >= 11);
});

test("captureHls: fMP4 se rechaza con error claro y fin de emisión cierra la ventana", async () => {
  const f1: Fetcher = async (url) => ({ status: 200, contentType: "", body: Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4,\na.m4s\n"), finalUrl: url });
  const r1 = await captureHls({ fetch: f1, url: "https://x.com/l.m3u8", dir: mkdtempSync(join(tmpdir(), "hls-")), windowSeconds: 12, maxSeconds: 100, shouldStop: async () => false, onWindow: async () => {}, sleep: async () => {} });
  assert.equal(r1.endedBy, "error"); assert.match(r1.error ?? "", /fMP4/);
  const f2: Fetcher = async (url) => url.endsWith(".m3u8") ? { status: 200, contentType: "", body: Buffer.from(media(0, 3) + "#EXT-X-ENDLIST\n"), finalUrl: url } : { status: 200, contentType: "", body: ts(2), finalUrl: url };
  const w: number[] = [];
  const r2 = await captureHls({ fetch: f2, url: "https://x.com/l.m3u8", dir: mkdtempSync(join(tmpdir(), "hls-")), windowSeconds: 100, maxSeconds: 100, shouldStop: async () => false, onWindow: async (x) => { w.push(x.seconds); }, sleep: async () => {} });
  assert.equal(r2.endedBy, "ended"); assert.deepEqual(w, [12]);
});
