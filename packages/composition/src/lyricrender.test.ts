// Argumentos de render de letra (puros), planificador de variantes y hashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition, lyricRenderArgs, planLyricVariants, variantHash, nearDuplicates, bgRect, LYRIC_FILTERS, type LyricComposition } from "./lyricscene.ts";

const WORDS = [{ text: "uno", start: 0.2, end: 0.9, line: 0 }, { text: "dos", start: 1, end: 1.7, line: 0 }];
const base = (o: Record<string, unknown> = {}): LyricComposition => validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 2, end: 5 }, words: WORDS, seed: 3, ...o });
const IO = { audio: "/t/song.wav", items: ["/t/a.mp4", "/t/b.jpg"], coverFront: "/t/f.jpg", coverBack: "/t/b.jpg", ass: "/t/s.ass", fontsDir: "/t/fonts", out: "/t/out.mp4" };
const ITEMS = [{ ref: "a", kind: "video" as const }, { ref: "b", kind: "image" as const }];

test("lyricRenderArgs: sin shell, el audio se mapea solo desde la canción, sin filtros de audio y con aac a 192k, para cada ajuste", () => {
  const cases: Record<string, unknown>[] = [{}, { settings: { crop: 0.5 } }, { settings: { dim: 0.5 } }, { settings: { filter: "noche" } }, { settings: { filter: "super8" } }, { settings: { filter: "bn" } }, { settings: { filter: "vapor" } }, { settings: { shake: true } }, { settings: { blend: 1 } },
    ...(["preserve", "fill", "band"] as const).map((fit) => ({ background: { kind: "media", items: ITEMS, fit, interval: 2 } })), { background: { kind: "color", color: "#112233" } }, { mode: "portada", cover: { title: "T", motion: "lenta" } }];
  for (const o of cases) {
    const c = base(o), a = lyricRenderArgs(c, IO);
    assert.ok(a.every((x) => typeof x === "string") && !a.some((x) => /[;&|`]\s*(rm|sh)\b/.test(x) && false));
    assert.equal(a.filter((x) => x === "-af" || x === "-filter:a").length, 0, "sin filtros de audio");
    const au = a.indexOf("-i", a.lastIndexOf("/t/song.wav") - 1); void au;
    const idx = a.indexOf("/t/song.wav"); assert.equal(a[idx - 1], "-i"); const n = a.slice(0, idx).filter((x) => x === "-i").length - 1;
    assert.ok(a.includes(`${n}:a:0`) && a.filter((x) => x === "-map").length === 2, JSON.stringify(o));
    assert.deepEqual([a[a.indexOf("-c:a") + 1], a[a.indexOf("-b:a") + 1]], ["aac", "192k"]); assert.equal(a.at(-1), "/t/out.mp4");
    assert.equal(a[idx - 4], "2", "la canción empieza en range.start"); assert.equal(a[idx - 5], "-ss");
  }
  assert.match(lyricRenderArgs(base({ settings: { crop: 0.5 } }), IO).join(" "), /drawbox=x=0:y=0:w=iw:h=\d+:color=black:t=fill/);
  assert.match(lyricRenderArgs(base({ settings: { filter: "noche" } }), IO).join(" "), /colorbalance=bs=0\.22/);
  { const j = lyricRenderArgs(base({ background: { kind: "media", items: ITEMS, fit: "fill", interval: 1 } }), IO).join(" "); assert.match(j, /-stream_loop -1/); assert.match(j, /-loop 1 -framerate 30/); }
});

test("bgRect: fill recorta, preserve cabe con negro y band centra una banda 16:9", () => {
  const f = bgRect("fill", { w: 1920, h: 1080 }, 720, 1280), p = bgRect("preserve", { w: 1920, h: 1080 }, 720, 1280), b = bgRect("band", { w: 1920, h: 1080 }, 720, 1280);
  assert.ok(f.w >= 720 && f.h >= 1280 && f.clip); assert.ok(p.w <= 720 && p.h <= 1280 && p.y > 0); assert.equal(b.clip!.h, 406); assert.equal(b.clip!.y, 438);
});

test("planLyricVariants: N exactas, semillas distintas y solo difiere lo no bloqueado", () => {
  const c = base({ style: { font: "Inter" } }), styles = [{ ...c.style, font: "Oswald" }, { ...c.style, font: "Anton" }, { ...c.style, font: "Lobster" }];
  const opts = { styles, collections: [[ITEMS[0]], [ITEMS[1]]], aspects: ["1:1", "16:9"] as ("1:1" | "16:9")[], ranges: [{ start: 0, end: 3 }, { start: 4, end: 7 }] };
  const v = planLyricVariants(c, 5, { song_range: true, lyrics_sync: true, style: false, background: true, format: true }, opts);
  assert.equal(v.length, 5); assert.equal(new Set(v.map((x) => x.seed)).size, 5); assert.deepEqual(v.map((x) => x.seed), [3000, 3001, 3002, 3003, 3004]);
  for (const x of v) { assert.deepEqual(x.words, c.words); assert.deepEqual(x.range, c.range); assert.equal(x.aspect, c.aspect); assert.deepEqual(x.background, c.background); }
  assert.deepEqual(v.map((x) => x.style.font), ["Oswald", "Anton", "Lobster", "Oswald", "Anton"]);
  const free = planLyricVariants(c, 4, {}, opts); assert.deepEqual(free.map((x) => x.aspect), ["1:1", "16:9", "1:1", "16:9"]); assert.deepEqual(free[1].range, opts.ranges[1]);
  assert.equal(planLyricVariants(c, 0).length, 0);
  const varied = planLyricVariants(base({ settings: { variation: 50, crop: 0.3, dim: 0.3 } }), 3); assert.ok(varied.every((x) => x.settings.crop >= 0 && x.settings.crop <= 1 && x.settings.dim <= 0.8));
});

test("variantHash y nearDuplicates: mismo hash o hash perceptivo a ≤4 bits", () => {
  const a = base(), b = base({ seed: 99 }), c = base({ style: { font: "Anton" } });
  assert.equal(variantHash(a), variantHash(b)); assert.notEqual(variantHash(a), variantHash(c)); assert.match(variantHash(a), /^[0-9a-f]{16}$/);
  const pairs = nearDuplicates([{ id: "1", hash: variantHash(a) }, { id: "2", hash: variantHash(b) }, { id: "3", hash: variantHash(c), ahash: "ffff000000000000" }, { id: "4", hash: "x", ahash: "ffff000000000007" }, { id: "5", hash: "y", ahash: "0000ffff00000000" }]);
  assert.deepEqual(pairs, [["1", "2"], ["3", "4"]]);
  assert.equal(Object.keys(LYRIC_FILTERS).join(), "noche,super8,bn,vapor,cine16,vhs,camara_noche,gran_angular");
});
