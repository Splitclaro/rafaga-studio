// Formatos de letra: ida y vuelta (exportar → importLyrics) con 10 ms de tolerancia y el ASS karaoke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLines, toLrc, toLrcEnhanced, toSrtLyrics, toVttLyrics, toAssKaraoke, toTxtLyrics, parseLrc, parseSrtCues } from "./formats.ts";
import { importLyrics, DEMO_SONG, type SyncWord } from "./sync.ts";

const mk = (rows: [string, number, number, number][]): SyncWord[] => rows.map(([text, start, end, line]) => ({ text, start, end, line, occurrence: 1, manual: false, confidence: 1, origin: "asr", flags: [] }));
const W = mk([["Hola", 1.234, 1.7, 0], ["mundo", 1.8, 2.45, 0], ["feliz", 3.005, 3.6, 1], ["cumpleaños", 3.7, 5.119, 1], ["otra", 65.5, 66, 2], ["vez", 66.1, 67.25, 2]]);
const lineTexts = (ws: SyncWord[]) => groupLines(ws).map((g) => g.text);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 0.0100001, `${a} vs ${b}`);

test("LRC de línea: mismas líneas y mismo inicio de línea (≤10 ms); cabeceras ignoradas", () => {
  const r = importLyrics(toLrc(W, { title: "T", artist: "A" }));
  assert.equal(r.format, "lrc"); assert.deepEqual(r.lines.map((l) => l.text), lineTexts(W));
  groupLines(W).forEach((g, i) => near(r.hints[i].start, g.start));
  assert.equal(parseLrc("[ar:Yo]\n[00:01.00]a\n[00:02.00][00:05.00]b").length, 3, "varias marcas = repeticiones");
});
test("LRC mejorado: mismas líneas e inicio de cada palabra (≤10 ms) y fin de línea", () => {
  const r = importLyrics(toLrcEnhanced(W));
  assert.deepEqual(r.lines.map((l) => l.text), lineTexts(W)); assert.equal(r.words!.length, W.length);
  r.words!.forEach((w, i) => { assert.equal(w.text, W[i].text); near(w.start, W[i].start); });
  const l0 = parseLrc(toLrcEnhanced(W))[0]; near(l0.end!, 2.45);
});
test("SRT y VTT: mismas líneas e inicio/fin de cada línea (≤10 ms)", () => {
  for (const [raw, fmt] of [[toSrtLyrics(W), "srt"], [toVttLyrics(W), "vtt"]] as const) {
    const r = importLyrics(raw); assert.equal(r.format, fmt); assert.deepEqual(r.lines.map((l) => l.text), lineTexts(W));
    groupLines(W).forEach((g, i) => { near(r.hints[i].start, g.start); near(r.hints[i].end!, g.end); });
  }
  assert.match(toVttLyrics(W), /^WEBVTT/); assert.match(toSrtLyrics(W), /00:00:01,234 --> 00:00:02,450/); assert.equal(parseSrtCues(toSrtLyrics(W)).length, 3);
});
test("TXT: una línea por línea de letra", () => assert.equal(toTxtLyrics(W), "Hola mundo\nfeliz cumpleaños\notra vez\n"));

test("ASS karaoke: un Dialogue por línea y {\\kN} por palabra; la suma difiere de la duración en ≤1 centésima por palabra", () => {
  for (const ws of [W, DEMO_SONG.words]) {
    const ass = toAssKaraoke(ws), ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:")), groups = groupLines(ws);
    assert.equal(ev.length, groups.length);
    const cs = (t: string) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100); };
    ev.forEach((e, i) => {
      const f = e.split(","), dur = cs(f[2]) - cs(f[1]), sum = [...e.matchAll(/\{\\k(\d+)\}/g)].reduce((t, m) => t + Number(m[1]), 0);
      assert.ok(Math.abs(sum - dur) <= groups[i].words.length, `línea ${i}: ${sum} vs ${dur}`);
      assert.ok((e.match(/\{\\k\d+\}/g) ?? []).length >= groups[i].words.length);
    });
  }
  assert.ok(DEMO_SONG.words.at(-1)!.end <= 24);
});
