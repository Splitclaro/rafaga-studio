// Formatos de letra (SRT, VTT, LRC, LRC mejorado, ASS, TXT): un archivo por formato, con extensión y MIME, y releídos con importLyrics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLyrics } from "@rafaga/lyrics";
import { validateLyricComposition } from "@rafaga/composition";
import { fakeR2 } from "./fixtures.ts";
import { renderLyricItem } from "./stages/lyric.ts";

const WORDS = [["Llueve", 3, 3.6, 0], ["sobre", 3.7, 4.2, 0], ["Madrid", 4.3, 5.4, 0], ["canto", 7, 7.5, 1], ["sin", 7.6, 7.9, 1], ["mirar", 8, 9.1, 1]] as const;
const c = validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 2, end: 10 }, words: WORDS.map(([text, start, end, line]) => ({ text, start, end, line })), seed: 1 });
const EXT: Record<string, string> = { srt: "srt", vtt: "vtt", lrc: "lrc", lrc_word: "lrc", ass: "ass", txt: "txt" };
const MIME: Record<string, string> = { srt: "application/x-subrip", vtt: "text/vtt", lrc: "text/plain", lrc_word: "text/plain", ass: "text/x-ssa", txt: "text/plain" };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 0.0100001, `${a} vs ${b}`);
const LINES = ["Llueve sobre Madrid", "canto sin mirar"], STARTS = [1, 5], ENDS = [3.4, 7.1];   // relativos al tramo (range.start = 2)

async function run(kind: string) {
  const fake = fakeR2(), calls: { fn: string; a: Record<string, unknown> }[] = [], key = `ws/clip/v1-abc.${EXT[kind]}`;
  const ctx = { workerId: "w", componentVersions: {}, log: () => {}, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-lf-")), r2: fake.r2, env: {}, rpc: async (fn: string, a: Record<string, unknown> = {}) => { calls.push({ fn, a }); return null; } };
  const dir = mkdtempSync(join(tmpdir(), "rafaga-lfd-"));
  await renderLyricItem(ctx as never, { render_id: "r1", workspace_id: "ws", clip_id: "clip", version: 1, kind, composition: c, source_id: "s", title: "Mi canción" }, { key, dir, fail: async (code, msg) => { throw new Error(`${code}: ${msg}`); } });
  assert.deepEqual(fake.uploaded, [key]); const fin = calls.find((x) => x.fn === "finish_render")!.a; assert.equal(fin.p_status, "ready"); assert.equal(fin.p_path, key);
  return readFileSync(fake.store.get(key)!, "utf8");
}

test("un archivo por formato con su extensión; SRT, VTT y los dos LRC se releen con las mismas líneas y tiempos (≤10 ms)", async () => {
  for (const kind of ["srt", "vtt"]) { const r = importLyrics(await run(kind)); assert.equal(r.format, kind); assert.deepEqual(r.lines.map((l) => l.text), LINES); r.hints.forEach((h, i) => { near(h.start, STARTS[i]); near(h.end!, ENDS[i]); }); }
  const lrc = await run("lrc"); assert.match(lrc, /^\[ti:Mi canción\]\n\[00:01\.00\]Llueve sobre Madrid\n\[00:05\.00\]canto sin mirar/);
  const r1 = importLyrics(lrc); assert.equal(r1.format, "lrc"); assert.deepEqual(r1.lines.map((l) => l.text), LINES); r1.hints.forEach((h, i) => near(h.start, STARTS[i]));
  const lw = await run("lrc_word"); assert.match(lw, /\[00:01\.00\]<00:01\.00>Llueve <00:01\.70>sobre <00:02\.30>Madrid <00:03\.40>/);
  const r2 = importLyrics(lw); assert.deepEqual(r2.lines.map((l) => l.text), LINES); assert.deepEqual(r2.words!.map((w) => w.text), WORDS.map((w) => w[0])); r2.words!.forEach((w, i) => near(w.start, WORDS[i][1] - 2));
  assert.equal(await run("txt"), "Llueve sobre Madrid\ncanto sin mirar\n");
});

test("ass lleva un Dialogue por línea y una etiqueta {\\kN} por palabra", async () => {
  const ass = await run("ass"), ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(ev.length, 2); assert.ok((ev[0].match(/\{\\k\d+\}/g) ?? []).length >= 3); assert.match(ass, /\{\\k\d+\}Llueve/);
});

test("un formato desconocido o sin letra en el tramo deja la variante en failed (render_failed)", async () => {
  await assert.rejects(renderLyricItem({ workerId: "w", componentVersions: {}, log: () => {}, r2: fakeR2().r2, rpc: async () => null } as never, { render_id: "r", workspace_id: "w", clip_id: "c", version: 1, kind: "edl", composition: c, source_id: "s", title: "t" }, { key: "k", dir: mkdtempSync(join(tmpdir(), "x-")), fail: async (code) => { throw new Error(code); } }), /render_failed/);
  const empty = validateLyricComposition({ range: { start: 50, end: 60 }, words: [{ text: "a", start: 0, end: 1, line: 0 }] });
  await assert.rejects(renderLyricItem({ workerId: "w", componentVersions: {}, log: () => {}, r2: fakeR2().r2, rpc: async () => null } as never, { render_id: "r", workspace_id: "w", clip_id: "c", version: 1, kind: "srt", composition: empty, source_id: "s", title: "t" }, { key: "k", dir: mkdtempSync(join(tmpdir(), "x-")), fail: async (code) => { throw new Error(code); } }), /render_failed/);
});
