// Extras de estilo de letra (degradado, ecos, dirección y curva de entrada, salida, reposo, caos): validación, escena ↔ ASS y render real con libass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCaptionStyle } from "./style.ts";
import { validateLyricComposition, lyricLayout, lyricTimeline, lyricSceneAt, lyricAss, wordMotion, lyricFrameSize, FPS, type LyricComposition } from "./lyricscene.ts";

const NAMES = "uno dos tres cuatro cinco seis".split(" ");
const WORDS = NAMES.map((text, k) => ({ text, start: 0.5 + k * 0.6, end: 0.5 + k * 0.6 + 0.5, line: Math.floor(k / 3) }));
const comp = (style: Record<string, unknown> = {}, o: Record<string, unknown> = {}): LyricComposition => validateLyricComposition({ aspect: "9:16", res: 720, range: { start: 0, end: 5 }, words: WORDS, preset: "entrada_deslizada", seed: 7, style: { entrance: "slide", entranceMs: 400, ...style }, ...o });

test("validateCaptionStyle: los extras se normalizan, los valores raros se descartan y el estilo sin extras no cambia", () => {
  const s = validateCaptionStyle({ rafagaStyle: 2, gradient: "#ff00aa", echo: 2, entranceDir: "left", ease: "out", exit: "slide", idle: "float", chaos: 5 });
  assert.equal(s.gradient, "#FF00AA"); assert.equal(s.echo, 2); assert.equal(s.entranceDir, "left"); assert.equal(s.ease, "out"); assert.equal(s.exit, "slide"); assert.equal(s.idle, "float"); assert.equal(s.chaos, 1);
  const bad = validateCaptionStyle({ rafagaStyle: 2, gradient: "rojo", echo: 9, entranceDir: "up", ease: "rebote", exit: "x", idle: "y", chaos: -1 });
  for (const k of ["gradient", "echo", "entranceDir", "ease", "exit", "idle", "chaos"]) assert.ok(!(k in bad), k);
  assert.deepEqual(validateCaptionStyle(s), s);
});

test("wordMotion: la dirección de la entrada, la curva, la salida, el reposo y el caos cambian el estado de forma reproducible", () => {
  const dirs = { left: (m: { dx: number; dy: number }) => m.dx < 0 && m.dy === 0, right: (m: { dx: number; dy: number }) => m.dx > 0 && m.dy === 0, up: (m: { dx: number; dy: number }) => m.dy > 0 && m.dx === 0, down: (m: { dx: number; dy: number }) => m.dy < 0 && m.dx === 0 };
  for (const [dir, ok] of Object.entries(dirs)) { const c = comp({ entranceDir: dir === "up" ? undefined : dir }), L = lyricLayout(c), w = lyricTimeline(c, L)[0]; assert.ok(ok(wordMotion(c, L, w, w.vs)), dir); }
  const lin = comp(), out = comp({ ease: "out" }), Ll = lyricLayout(lin), Lo = lyricLayout(out), wl = lyricTimeline(lin, Ll)[0], wo = lyricTimeline(out, Lo)[0], mid = wl.vs + 3;
  assert.ok(Math.abs(wordMotion(out, Lo, wo, mid).dy) < Math.abs(wordMotion(lin, Ll, wl, mid).dy), "«out» llega antes a su sitio que lineal");
  const ex = comp({ exit: "slide", entranceMs: 300 }), Le = lyricLayout(ex), we = lyricTimeline(ex, Le)[0];
  assert.ok(wordMotion(ex, Le, we, we.ve - 1).dy < 0 && wordMotion(ex, Le, we, we.ve - 1).alpha < 1);
  const idle = comp({ idle: "float" }), Li = lyricLayout(idle), wi = lyricTimeline(idle, Li)[0], seen = new Set<number>();
  for (let k = wi.vs + 20; k < wi.vs + 80; k++) seen.add(wordMotion(idle, Li, wi, k).dy); assert.ok(seen.size > 2, "el reposo se mueve");
  const ch = comp({ chaos: 1 }), Lc = lyricLayout(ch), tl = lyricTimeline(ch, Lc), a = wordMotion(ch, Lc, tl[0], tl[0].ve - 10), b = wordMotion(ch, Lc, tl[1], tl[1].ve - 10);
  assert.notDeepEqual([a.rot, a.dx, a.dy], [b.rot, b.dx, b.dy]); assert.deepEqual(a, wordMotion(ch, Lc, tl[0], tl[0].ve - 10), "reproducible");
});

test("escena ↔ ASS: con extras, cada fotograma de la entrada tiene su posición explícita igual a la de la escena", () => {
  const c = comp({ entranceDir: "left", ease: "inout" }), L = lyricLayout(c), TL = lyricTimeline(c, L), ass = lyricAss(c), w = TL[0];
  assert.ok(!/\\move\(/.test(ass), "sin \\move: un evento por fotograma");
  const cs = (t: string) => { const [h, m, s] = t.split(":"); return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100); };
  const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue: 1,") && l.endsWith("}uno"));
  for (let k = w.vs; k < w.vs + 6; k++) {
    const sc = lyricSceneAt(c, k / FPS + 1e-4, L, TL), sw = sc.words.find((x) => x.index === 0)!, now = Math.floor((k / FPS) * 100 + 1e-6);
    const line = ev.find((l) => { const f = l.split(","); return cs(f[1]) <= now && now < cs(f[2]); })!, m = /\\pos\((-?\d+),(-?\d+)\)/.exec(line)!;
    assert.equal(Number(m[1]), sw.box.x + sw.dx, `x frame ${k}`); assert.equal(Number(m[2]), sw.box.y + sw.dy, `y frame ${k}`);
  }
});

test("ASS: el degradado emite 6 bandas recortadas por palabra y los ecos añaden capas fantasma más tenues", () => {
  const g = lyricAss(comp({ gradient: "#FF0066", entrance: "none", entranceMs: 0 })), clips = g.split("\n").filter((l) => l.includes("\\clip(") && l.endsWith("}uno"));
  assert.ok(clips.length >= 6 && clips.length % 6 === 0, `bandas ${clips.length}`);
  const e = lyricAss(comp({ echo: 3, entrance: "none", entranceMs: 0 })), ghosts = e.split("\n").filter((l) => l.startsWith("Dialogue: 0,") && l.endsWith("}uno")), mains = e.split("\n").filter((l) => l.startsWith("Dialogue: 1,") && l.endsWith("}uno"));
  assert.equal(ghosts.length, mains.length * 3);
});

test("render real con libass: el degradado cambia de color de arriba abajo y los ecos añaden píxeles tras la palabra", () => {
  const dir = mkdtempSync(join(tmpdir(), "lyx-")); let n = 0;
  const shot = (style: Record<string, unknown>) => {
    const c = comp({ entrance: "none", entranceMs: 0, size: "L", effect: "none", ...style }, { words: [{ text: "AAAA", start: 0, end: 1, line: 0 }, { text: "BBBB", start: 3, end: 4, line: 0 }], preset: "texto_estatico" }), { width, height } = lyricFrameSize(c);
    const f = join(dir, `s${n++}.ass`); writeFileSync(f, lyricAss(c));
    const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=3:r=30`, "-vf", `ass=${f},select=eq(n\\,75)`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
    assert.equal(r.status, 0, r.stderr?.toString()); return { px: r.stdout as Buffer, width, height };
  };
  const lit = (b: { px: Buffer }) => { let k = 0; for (let i = 0; i < b.px.length; i += 3) if (b.px[i] + b.px[i + 1] + b.px[i + 2] > 60) k++; return k; };
  const g = shot({ color: "#FF0000", gradient: "#0000FF" }), rows: { y: number; r: number; b: number }[] = [];
  for (let y = 0; y < g.height; y++) { let r = 0, b = 0, k = 0; for (let x = 0; x < g.width; x++) { const i = (y * g.width + x) * 3; if (g.px[i] + g.px[i + 2] > 100) { r += g.px[i]; b += g.px[i + 2]; k++; } } if (k > 5) rows.push({ y, r: r / k, b: b / k }); }
  assert.ok(rows.length > 20, "hay texto");
  const q = Math.max(1, Math.floor(rows.length / 4)), avg = (xs: typeof rows, f: "r" | "b") => xs.reduce((t, x) => t + x[f], 0) / xs.length;
  const top = rows.slice(0, q), bot = rows.slice(-q);
  assert.ok(avg(top, "r") > avg(top, "b"), `arriba rojo ${avg(top, "r")} vs ${avg(top, "b")}`); assert.ok(avg(bot, "b") > avg(bot, "r"), `abajo azul ${avg(bot, "b")} vs ${avg(bot, "r")}`);
  const plain = shot({ color: "#FFFFFF" }), echo = shot({ color: "#FFFFFF", echo: 3 });
  assert.ok(lit(echo) > lit(plain) * 1.05, `ecos: ${lit(echo)} vs ${lit(plain)}`);
});

test("rotación de entrada, escalonado, vibración de línea base y ciclo de paleta: reproducibles y coherentes entre escena y ASS", () => {
  const c = comp({ entranceRot: 20, stagger: 200, jitter: 6, palette: true, gradient: "#FF0066", entrance: "pop" }), L = lyricLayout(c), TL = lyricTimeline(c, L);
  const pg = L.pages[0], [a, b] = [pg.words[0], pg.words[1]], wa = TL.find((x) => x.index === a)!, wb = TL.find((x) => x.index === b)!;
  assert.equal(wordMotion(c, L, wb, wb.vs).alpha, 0, "la segunda palabra espera su turno");
  assert.ok(wordMotion(c, L, wa, wa.vs).rot > 0 && wordMotion(c, L, wa, wa.vs + 20).rot === 0, "la rotación se disipa");
  const rev = comp({ stagger: 200, staggerOrder: "reverse" }), Lr = lyricLayout(rev), pr = Lr.pages[0], TLr = lyricTimeline(rev, Lr);
  assert.equal(wordMotion(rev, Lr, TLr.find((x) => x.index === pr.words[0])!, TLr[0].vs).alpha, 0, "en orden inverso espera la primera");
  assert.deepEqual(wordMotion(c, L, wa, wa.vs + 30), wordMotion(c, L, wa, wa.vs + 30));
  const sc = lyricSceneAt(c, (wa.vs + 30) / FPS + 1e-4, L, TL), w0 = sc.words.find((x) => x.index === a)!, w1 = sc.words.find((x) => x.index === b)!;
  assert.ok(w0.color && w1.color && w0.color !== w1.color, "el ciclo de paleta alterna colores");
  const ass = lyricAss(c);
  assert.match(ass, /\\org\(/); assert.match(ass, /\\c&H/);
  assert.deepEqual(validateCaptionStyle({ rafagaStyle: 2, entranceRot: 99, stagger: 5, jitter: 99, palette: true, staggerOrder: "reverse" }), { ...validateCaptionStyle({ rafagaStyle: 2 }), entranceRot: 45, stagger: 20, jitter: 12, palette: true, staggerOrder: "reverse" });
});
