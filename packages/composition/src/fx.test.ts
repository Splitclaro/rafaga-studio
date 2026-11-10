import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAss, groupsFrom, PRESETS, FX_DEFAULT, type SubtitleStyle, type Word } from "./subtitles.ts";
import { validateStyle, validateFx } from "./style.ts";

const words: Word[] = [{ text: "Hola", start: 1, end: 1.4 }, { text: "mundo", start: 1.5, end: 2 }, { text: "increíble", start: 2.1, end: 2.8 }, { text: "2026", start: 2.9, end: 3.4 }];
const W = 360, H = 640;
const has = spawnSync("ffmpeg", ["-version"]).status === 0;

test("catálogo: más de 20 tratamientos y todos pasan la validación sin perder su efecto", () => {
  const names = Object.keys(PRESETS);
  assert.ok(names.length >= 21, `solo ${names.length}`);
  const withFx = names.filter((n) => PRESETS[n].fx);
  assert.ok(withFx.length >= 13);
  for (const n of names) { const v = validateStyle(PRESETS[n], PRESETS[n]); assert.deepEqual(v.fx, PRESETS[n].fx ? validateFx(PRESETS[n].fx) : undefined, n); }
  // distintos entre sí (no el mismo estilo con otro nombre)
  assert.equal(new Set(names.map((n) => JSON.stringify(PRESETS[n]))).size, names.length);
});

test("validateFx acota valores y limpia palabras clave", () => {
  const f = validateFx({ entry: "zzz", entryMs: 99999, spacing: 50, soften: 99, keywords: ["{\\b1}hack", "ok", 5], box: { color: "rojo", opacity: 9, pad: 999 } })!;
  assert.equal(f.entry, "none"); assert.equal(f.entryMs, 800); assert.equal(f.spacing, 12); assert.equal(f.soften, 6);
  assert.deepEqual(f.keywords, ["b1hack", "ok"]); assert.deepEqual(f.box, { color: "#000000", opacity: 1, pad: 40 });
  assert.equal(validateFx({}), undefined);
});

test("ASS: etiquetas de entrada solo en el primer intervalo; salida en el último; sin inyección", () => {
  const st: SubtitleStyle = { ...PRESETS.Pop, fx: { entry: "rise", entryMs: 250, exitFade: 150, keywords: ["mundo"], keywordColor: "#FF0000" } };
  const ass = buildAss(words.slice(0, 2), st, { width: W, height: H }, groupsFrom([words.slice(0, 2)], 20));
  const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue"));
  assert.equal(ev.length, 2);
  assert.ok(ev[0].includes("\\move(") && !ev[1].includes("\\move("));
  assert.ok(ev[1].includes("\\fad(0,150)"));
  assert.ok(ev[0].includes("\\c&H000000FF"), "palabra clave en rojo (BGR)");
});

function render(st: SubtitleStyle, name: string, dir: string, ws = words) {
  const ass = join(dir, `${name}.ass`); writeFileSync(ass, buildAss(ws, st, { width: W, height: H }, groupsFrom([ws], 24)));
  const out = join(dir, `${name}.mp4`);
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x303030:s=${W}x${H}:r=30:d=4`, "-vf", `subtitles=${ass}`, "-pix_fmt", "yuv420p", out]);
  assert.equal(r.status, 0, `${name}: ${r.stderr?.toString()}`);
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 }).stdout as Buffer;
  const frame = (k: number) => raw.subarray(k * W * H * 3, (k + 1) * W * H * 3);
  return { frame };
}
const lit = (f: Buffer, pred: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < f.length; i += 3) if (pred(f[i], f[i + 1], f[i + 2])) n++; return n; };
const white = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;

test("render real de TODOS los tratamientos: libass los acepta y aparece texto", { skip: !has }, () => {
  const d = mkdtempSync(join(tmpdir(), "fx-"));
  try {
    for (const [n, st] of Object.entries(PRESETS)) {
      const { frame } = render({ ...st, fontName: "Arial" }, n.replace(/\W/g, "_"), d);
      const f = frame(Math.round(2.0 * 30));   // 2,0 s: «mundo» activa
      const base = frame(2);
      let diff = 0; for (let i = 0; i < f.length; i += 3) if (Math.abs(f[i] - base[i]) + Math.abs(f[i + 1] - base[i + 1]) > 60) diff++;
      assert.ok(diff > 300, `${n}: no se ve texto (${diff})`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("render real: fundido de entrada, caja de color, palabra clave y desplazamiento de subida", { skip: !has }, () => {
  const d = mkdtempSync(join(tmpdir(), "fx2-"));
  try {
    const base = { ...PRESETS.Limpio, fontName: "Arial", fontSize: 60, outlineWidth: 0, shadow: 0, y: 0.5 } as SubtitleStyle;
    // fundido: más blanco a +0,3 s del inicio que a +0,05 s
    const fd = render({ ...base, fx: { entry: "fade", entryMs: 400 } }, "fade", d);
    const a = lit(fd.frame(31), white), b = lit(fd.frame(40), white);   // 1,03 s vs 1,33 s
    assert.ok(b > a * 1.5 && a < b, `fundido ${a} → ${b}`);
    // caja roja opaca detrás del texto
    const bx = render({ ...base, fx: { box: { color: "#FF0000", opacity: 1, pad: 10 } } }, "box", d);
    assert.ok(lit(bx.frame(50), (r, g, bl) => r > 200 && g < 60 && bl < 60) > 1500, "caja roja visible");
    const nobox = render(base, "nobox", d);
    assert.ok(lit(nobox.frame(50), (r, g, bl) => r > 200 && g < 60 && bl < 60) === 0);
    // palabra clave: «increíble» (2,1–2,8 s) debe tener píxeles rojos cuando está activa otra palabra → 2,95 s activa «2026»
    const kwr = render({ ...base, highlight: "color", active: "#FFFFFF", fx: { keywords: ["increíble"], keywordColor: "#FF0000" } }, "kw", d);
    assert.ok(lit(kwr.frame(Math.round(3.0 * 30)), (r, g, bl) => r > 200 && g < 60 && bl < 60) > 200, "palabra clave en rojo");
    // subida: el centro de masa vertical del texto baja a medida que llega a su sitio (parte más abajo)
    const rs = render({ ...base, fx: { entry: "rise", entryMs: 400 } }, "rise", d);
    const cy = (f: Buffer) => { let sy = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (f[i] > 200 && f[i + 1] > 200 && f[i + 2] > 200) { sy += y; n++; } } return n ? sy / n : -1; };
    const y0 = cy(rs.frame(36)), y1 = cy(rs.frame(60));
    assert.ok(y0 > 0 && y1 > 0 && y0 > y1 + 3, `la subida no se mueve (${y0} → ${y1})`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
void FX_DEFAULT;
