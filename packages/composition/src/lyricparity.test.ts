// Paridad dorada de letra: el ASS exportado coincide con el diseño y con la escena de la vista previa (≤ 2 px y ≤ 1 fotograma).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLyricComposition, lyricLayout, lyricSceneAt, lyricAss, FPS } from "./lyricscene.ts";

const TEXT = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce".split(" ");
const WORDS = TEXT.map((text, k) => ({ text, start: 0.5 + k * 0.7, end: 0.5 + k * 0.7 + 0.6, line: Math.floor(k / 4) }));
const csOf = (t: string) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100); };

for (const aspect of ["9:16", "4:5", "1:1", "16:9"] as const) {
  test(`paridad ${aspect}: \\pos del ASS = caja de lyricLayout (≤2 px) y visibilidad = lyricSceneAt (≤1 fotograma)`, () => {
    const c = validateLyricComposition({ aspect, res: 1080, range: { start: 0, end: 10 }, words: WORDS, preset: "frase_palabra_activa", seed: 2, style: { size: "M" } });
    const L = lyricLayout(c), ev = lyricAss(c).split("\n").filter((l) => l.startsWith("Dialogue: 1,"));
    for (const l of ev) {
      const i = TEXT.indexOf(l.replace(/^[^{]*\{[^}]*\}/, "")), m = /\\an7\\(?:pos\((\d+),(\d+)\)|move\((\d+),(\d+),(\d+),(\d+))/.exec(l)!, [x, y] = m[1] ? [+m[1], +m[2]] : [+m[5], +m[6]];
      assert.ok(Math.abs(x - L.word[i].box.x) <= 2 && Math.abs(y - L.word[i].box.y) <= 2, `${aspect} ${TEXT[i]}`);
    }
    for (let k = 0; k < Math.ceil(c.duration * FPS); k++) {
      const scene = new Set(lyricSceneAt(c, k / FPS).words.map((w) => w.index)), now = Math.floor((k / FPS) * 100 + 1e-6);
      for (const i of TEXT.keys()) {
        const evs = ev.filter((l) => TEXT.indexOf(l.replace(/^[^{]*\{[^}]*\}/, "")) === i).map((l) => l.split(","));
        const inAss = (kk: number) => { const n = Math.floor((kk / FPS) * 100 + 1e-6); return evs.some((f) => csOf(f[1]) <= n && n < csOf(f[2])); };
        // tolerancia de 1 fotograma: el estado debe coincidir con el de algún fotograma contiguo
        const ok = [k - 1, k, k + 1].some((kk) => inAss(kk) === scene.has(i)); assert.ok(ok, `${aspect} palabra ${i} fotograma ${k}`);
      }
      void now;
    }
  });
}
