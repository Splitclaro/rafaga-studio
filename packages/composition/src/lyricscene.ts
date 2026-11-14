// Motor de escena de letra (código puro): composición → diseño (cajas en píxeles) → escena por fotograma → ASS.
// `lyricSceneAt` (vista previa) y `lyricAss` (exportación con libass) salen de la MISMA línea de tiempo por fotograma
// (`lyricTimeline`): cada palabra es visible en los mismos fotogramas de 1/30 s en los dos caminos.
import { RATIO_SIZE } from "./composition.ts";
import { BEHAVIOUR_PRESETS, validateCaptionStyle, type BehaviourPresetId, type CaptionStyleV2 } from "./style.ts";
import { fontFor, measureText, resolveFamilyForText } from "./fontcatalog.ts";

export const FPS = 30;
export type LyricAspect = "9:16" | "4:5" | "1:1" | "16:9";
export const LYRIC_ASPECTS: LyricAspect[] = ["9:16", "4:5", "1:1", "16:9"];
export interface LyricWord { text: string; start: number; end: number; line: number }
export interface LyricBgItem { ref: string; kind: "image" | "video"; dur?: number }
export type LyricFilter = "none" | "noche" | "super8" | "bn" | "vapor";
export interface LyricComposition {
  kind: "lyric"; v: 1; aspect: LyricAspect; res: 720 | 1080; fps: 30; mode: "letra" | "texto" | "portada";
  range: { start: number; end: number }; duration: number; words: LyricWord[]; style: CaptionStyleV2; preset: BehaviourPresetId;
  background: { kind: "media" | "color"; color: string; items: LyricBgItem[]; sequence: number[]; interval: number; order: "aleatorio" | "fijo"; loop: boolean; fit: "preserve" | "fill" | "band" };
  settings: { crop: number; dim: number; filter: LyricFilter; shake: boolean; blend: number; variation: number };
  hook: { text: string; dur: number } | null; message: { text: string; start: number; end: number } | null; cover: { title: string; artist?: string } | null; seed: number; variant_hash?: string;
}
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : d);

export function validateLyricComposition(raw: unknown): LyricComposition {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>, b = (o.background ?? {}) as Record<string, any>, st = (o.settings ?? {}) as Record<string, any>;
  const start = num(o.range?.start, 0, 7200, 0), end = Math.max(start + 0.5, num(o.range?.end, 0, 7200, start + 30));
  const words: LyricWord[] = (Array.isArray(o.words) ? o.words : []).filter((w: any) => w && typeof w.text === "string" && w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w: any) => ({ text: String(w.text).slice(0, 80), start: +w.start, end: +w.end, line: Math.max(0, Math.round(+w.line || 0)) })).sort((a: LyricWord, c: LyricWord) => a.start - c.start);
  return {
    kind: "lyric", v: 1, aspect: LYRIC_ASPECTS.includes(o.aspect) ? o.aspect : "9:16", res: o.res === 720 ? 720 : 1080, fps: 30, mode: o.mode === "texto" || o.mode === "portada" ? o.mode : "letra",
    range: { start, end }, duration: end - start, words, style: validateCaptionStyle(o.style), preset: o.preset in BEHAVIOUR_PRESETS ? o.preset : "frase_palabra_activa",
    background: { kind: b.kind === "media" ? "media" : "color", color: hex(b.color, "#000000"), items: Array.isArray(b.items) ? b.items.slice(0, 200) : [], sequence: Array.isArray(b.sequence) ? b.sequence.filter((n: unknown) => Number.isInteger(n)).slice(0, 500) : [],
      interval: num(b.interval, 0.5, 30, 3), order: b.order === "fijo" ? "fijo" : "aleatorio", loop: b.loop !== false, fit: b.fit === "fill" || b.fit === "band" ? b.fit : "preserve" },
    settings: { crop: num(st.crop, 0, 1, 0), dim: num(st.dim, 0, 0.9, 0.2), filter: ["noche", "super8", "bn", "vapor"].includes(st.filter) ? st.filter : "none", shake: !!st.shake, blend: num(st.blend, 0, 2, 0), variation: Math.round(num(st.variation, 0, 100, 0)) },
    hook: o.hook && typeof o.hook.text === "string" ? { text: o.hook.text.slice(0, 120), dur: num(o.hook.dur, 0.5, 10, 3) } : null,
    message: o.message && typeof o.message.text === "string" ? { text: o.message.text.slice(0, 200), start: num(o.message.start, 0, 7200, 0), end: num(o.message.end, 0, 7200, 5) } : null,
    cover: o.cover && typeof o.cover.title === "string" ? { title: o.cover.title.slice(0, 120), ...(typeof o.cover.artist === "string" ? { artist: o.cover.artist.slice(0, 120) } : {}) } : null,
    seed: Math.round(num(o.seed, 0, 2 ** 31 - 1, 1)), ...(typeof o.variant_hash === "string" ? { variant_hash: o.variant_hash } : {}),
  };
}

const even = (n: number) => Math.round(n / 2) * 2;
export function lyricFrameSize(c: Pick<LyricComposition, "aspect" | "res">) { const s = RATIO_SIZE[c.aspect], k = c.res / 1080; return { width: even(s.width * k), height: even(s.height * k) }; }
const EM = { S: 0.045, M: 0.06, L: 0.08 } as const;
export const lyricEm = (c: LyricComposition) => even(lyricFrameSize(c).height * EM[c.style.size] * c.style.sizeFine);
const caseOf = (c: LyricComposition, t: string) => (c.style.case === "upper" ? t.toUpperCase() : c.style.case === "lower" ? t.toLowerCase() : t);
const allText = (c: LyricComposition) => c.words.map((w) => caseOf(c, w.text)).join(" ");
const F = (t: number) => Math.ceil(t * FPS - 1e-6);   // primer fotograma cuyo instante k/30 ≥ t

export interface LyricBox { x: number; y: number; w: number; h: number }
export interface LayoutWord { index: number; text: string; box: LyricBox }
export interface LayoutLine { words: number[]; box: LyricBox }
export interface LayoutPage { words: number[]; lines: LayoutLine[]; box: LyricBox; startF: number; endF: number }
export interface LyricLayout { frame: { width: number; height: number }; em: number; lineHeight: number; family: string; pages: LayoutPage[]; word: Record<number, LayoutWord> }

/** Diseño: páginas por preset, ancho de línea ≤ 0,84 W medido con la fuente real, bloque centrado en `position`, cajas pares. */
export function lyricLayout(c: LyricComposition): LyricLayout {
  const frame = lyricFrameSize(c), em = lyricEm(c), p = BEHAVIOUR_PRESETS[c.preset], family = resolveFamilyForText(c.style.font, c.style.weight, allText(c));
  const f = fontFor(family, c.style.weight), lineHeight = even((em * (f.ascent - f.descent)) / f.unitsPerEm), maxW = frame.width * 0.84;
  const visible = c.words.map((w, i) => ({ w, i })).filter(({ w }) => w.end > c.range.start && w.start < c.range.end);
  const wpx = (i: number) => measureText(caseOf(c, c.words[i].text), family, c.style.weight, em), space = measureText(" ", family, c.style.weight, em);
  // 1) páginas: se cierran al cambiar de línea de letra, al pasar el máximo de palabras o de líneas
  const groups: number[][] = []; let cur: number[] = [], curLines = 1, lineW = 0;
  for (const { w, i } of visible) {
    const ww = wpx(i), lyricLineChanged = cur.length > 0 && c.words[cur.at(-1)!].line !== w.line && p.unit !== "frase";
    const wrap = cur.length > 0 && lineW + space + ww > maxW, tooMany = cur.length >= p.group.words || (wrap && curLines + 1 > p.group.lines) || p.unit === "palabra" || lyricLineChanged || (cur.length > 0 && p.unit === "frase" && c.words[cur.at(-1)!].line !== w.line && false);
    if (tooMany && cur.length) { groups.push(cur); cur = []; curLines = 1; lineW = 0; }
    if (cur.length && lineW + space + ww > maxW) { curLines++; lineW = ww; } else lineW = cur.length ? lineW + space + ww : ww;
    cur.push(i);
  }
  if (cur.length) groups.push(cur);
  // 2) líneas y cajas
  const word: Record<number, LayoutWord> = {};
  const pages: LayoutPage[] = groups.map((idx) => {
    const lines: number[][] = [[]]; let x = 0;
    for (const i of idx) { const ww = wpx(i); if (lines.at(-1)!.length && x + space + ww > maxW) { lines.push([]); x = 0; } x += (lines.at(-1)!.length ? space : 0) + ww; lines.at(-1)!.push(i); }
    const blockH = lines.length * lineHeight, top = even(Math.min(Math.max(c.style.position.y * frame.height - blockH / 2, 0), frame.height - blockH));
    const ls: LayoutLine[] = lines.map((li, k) => {
      const widths = li.map(wpx), total = widths.reduce((a, b) => a + b, 0) + space * (li.length - 1);
      let x0 = c.style.position.x * frame.width - total / 2; x0 = Math.min(Math.max(x0, 0), Math.max(0, frame.width - total));
      let cx = x0;
      li.forEach((i, j) => { word[i] = { index: i, text: caseOf(c, c.words[i].text), box: { x: even(cx), y: top + k * lineHeight, w: even(widths[j] + 1), h: lineHeight } }; cx += widths[j] + space; });
      return { words: li, box: { x: even(x0), y: top + k * lineHeight, w: even(total + 1), h: lineHeight } };
    });
    const minX = Math.min(...ls.map((l) => l.box.x)), maxX = Math.max(...ls.map((l) => l.box.x + l.box.w));
    return { words: idx, lines: ls, box: { x: minX, y: top, w: maxX - minX, h: blockH }, startF: 0, endF: 0 };
  });
  // 3) intervalo (en fotogramas, relativos al inicio del recorte) de cada página
  const hold = p.unit === "palabra" ? 0 : 0.25, total = F(c.duration);
  pages.forEach((pg, k) => {
    const first = c.words[pg.words[0]], last = c.words[pg.words.at(-1)!], s0 = Math.max(0, F(first.start - c.range.start));
    const next = pages[k + 1] ? Math.max(0, F(c.words[pages[k + 1].words[0]].start - c.range.start)) : total;
    pg.startF = s0; pg.endF = Math.min(total, Math.max(s0 + 1, Math.min(next, F(last.end + hold - c.range.start))));
  });
  return { frame, em, lineHeight, family, pages, word };
}

export interface WordTimeline { index: number; vs: number; ve: number; as: number; ae: number }
/** Fotogramas (relativos al recorte) en que cada palabra es visible y activa. Única fuente para la escena y para el ASS. */
export function lyricTimeline(c: LyricComposition, L = lyricLayout(c)): WordTimeline[] {
  const out: WordTimeline[] = [], p = BEHAVIOUR_PRESETS[c.preset], typewriter = c.style.entrance === "typewriter" || p.entrance === "typewriter";
  for (const pg of L.pages) {
    const byLine = c.style.entranceBy === "line";
    for (const ln of pg.lines) for (const i of ln.words) {
      const w = c.words[i], ws = Math.max(pg.startF, F(w.start - c.range.start)), lineStart = Math.max(pg.startF, F(c.words[ln.words[0]].start - c.range.start));
      const vs = typewriter ? (byLine ? lineStart : ws) : pg.startF, ve = pg.endF;
      const activeOn = (c.style.active !== "none" ? c.style.active : p.active) !== "none";
      out.push({ index: i, vs: Math.min(vs, ve), ve, as: activeOn ? Math.min(Math.max(ws, vs), ve) : 0, ae: activeOn ? Math.min(ve, Math.max(F(w.end - c.range.start), ws)) : 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
/** Desplazamiento entero en [−3, 3] px cada 100 ms (3 fotogramas), reproducible con la semilla. */
export function shakeOffset(slice: number, seed: number): { dx: number; dy: number } {
  const h = (n: number) => { let t = (seed * 2654435761 + n * 40503) >>> 0; t = Math.imul(t ^ (t >>> 15), 2246822507) >>> 0; t = Math.imul(t ^ (t >>> 13), 3266489909) >>> 0; return ((t ^ (t >>> 16)) >>> 0); };
  return { dx: (h(slice * 2) % 7) - 3, dy: (h(slice * 2 + 1) % 7) - 3 };
}

export interface SceneWord { index: number; text: string; box: LyricBox; alpha: number; scale: number; dx: number; dy: number; active: boolean }
export interface LyricScene { t: number; frame: number; words: SceneWord[]; hook: string | null; message: string | null; cover: LyricComposition["cover"]; shake: { dx: number; dy: number }; bars: null }
const entranceMs = (c: LyricComposition) => { const d = BEHAVIOUR_PRESETS[c.preset].durationMs; return d; };

/** Escena en el instante `t` (s desde el inicio del recorte): palabras visibles con su caja, opacidad, escala y desplazamiento. */
export function lyricSceneAt(c: LyricComposition, t: number, L = lyricLayout(c), TL = lyricTimeline(c, L)): LyricScene {
  const k = Math.floor(t * FPS + 1e-6), p = BEHAVIOUR_PRESETS[c.preset], dur = Math.max(1, Math.round((entranceMs(c) / 1000) * FPS)), words: SceneWord[] = [];
  const shake = c.settings.shake ? shakeOffset(Math.floor(k / 3), c.seed) : { dx: 0, dy: 0 };
  for (const w of TL) {
    if (k < w.vs || k >= w.ve) continue;
    const el = k - w.vs, ent = c.style.entrance !== "none" ? c.style.entrance : p.entrance, exitLeft = w.ve - k;
    let alpha = 1, scale = 1, dy = 0;
    if (dur > 0 && el < dur) { const u = (el + 1) / (dur + 1); if (ent === "fade") alpha = u; else if (ent === "pop") scale = 0.8 + 0.2 * u; else if (ent === "slide") dy = Math.round((1 - u) * L.em * 0.5); }
    if (p.exit === "fade" && dur > 0 && exitLeft <= dur) alpha = Math.min(alpha, exitLeft / (dur + 1));
    const act = w.as < w.ae && k >= w.as && k < w.ae;
    if (act && (c.style.active !== "none" ? c.style.active : p.active) === "scale") scale *= 1.15;
    words.push({ index: w.index, text: L.word[w.index].text, box: L.word[w.index].box, alpha: +alpha.toFixed(3), scale: +scale.toFixed(3), dx: shake.dx, dy: dy + shake.dy, active: act });
  }
  return { t, frame: k, words, hook: c.hook && t < c.hook.dur ? c.hook.text : null, message: c.message && t >= c.message.start - c.range.start && t < c.message.end - c.range.start ? c.message.text : null, cover: c.cover, shake, bars: null };
}

/** Planos del fondo: deterministas por semilla, intervalo y orden. */
export function lyricShots(c: LyricComposition): { item: number; start: number; end: number }[] {
  const n = c.background.items.length; if (c.background.kind !== "media" || !n) return [];
  const base = c.background.sequence.length ? c.background.sequence.filter((i) => i >= 0 && i < n) : c.background.items.map((_, i) => i);
  let s = c.seed >>> 0; const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const shots: { item: number; start: number; end: number }[] = []; let t = 0, round = 0;
  while (t < c.duration - 1e-9) {
    const order = c.background.order === "aleatorio" ? [...base].map((v) => [rnd(), v] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]) : base;
    for (const item of order) { if (t >= c.duration - 1e-9) break; const dur = Math.min(c.background.interval, c.duration - t); shots.push({ item, start: +t.toFixed(3), end: +(t + dur).toFixed(3) }); t += dur; }
    if (!c.background.loop || ++round > 1000) break;
  }
  return shots;
}

// ───────── ASS ─────────
const bgr = (h: string, a = 0) => `&H${a.toString(16).padStart(2, "0").toUpperCase()}${h.slice(5, 7)}${h.slice(3, 5)}${h.slice(1, 3)}`.toUpperCase();
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, " ");
/** Tiempo ASS a partir de un fotograma: suelo de centésima, igual que `assFrameTime` de looks.ts. */
export function assFrame(k: number): string {
  const cs = Math.floor((k / FPS) * 100 + 1e-6);
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}
/** ASS de la composición: un `Dialogue` por palabra y por tramo de estado, anclado con `\an7\pos(x,y)` en su caja de `lyricLayout`. */
export function lyricAss(c: LyricComposition): string {
  const L = lyricLayout(c), TL = lyricTimeline(c, L), p = BEHAVIOUR_PRESETS[c.preset], f = fontFor(L.family, c.style.weight), fontsize = (L.em * (f.ascent - f.descent)) / f.unitsPerEm;
  const active = c.style.active !== "none" ? c.style.active : p.active, ent = c.style.entrance !== "none" ? c.style.entrance : p.entrance, dur = entranceMs(c);
  const outline = c.style.effect === "stroke" ? Math.max(2, Math.round(L.em * 0.08)) : c.style.effect === "glow" ? 3 : 0, shadow = c.style.effect === "shadow" ? Math.max(2, Math.round(L.em * 0.05)) : 0;
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${L.frame.width}\nPlayResY: ${L.frame.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: W,${L.family},${fontsize.toFixed(2)},${bgr(c.style.color)},${bgr(c.style.color)},&H00000000,&H64000000,${c.style.weight === 700 ? -1 : 0},0,0,0,100,100,0,0,${c.style.effect === "box" ? 3 : 1},${c.style.effect === "box" ? 8 : outline},${shadow},7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev: string[] = [];
  for (const w of TL) {
    const b = L.word[w.index].box, text = esc(L.word[w.index].text), cuts = new Set<number>([w.vs, w.ve]);
    if (w.as < w.ae) { cuts.add(w.as); cuts.add(w.ae); }
    if (c.settings.shake) for (let k = Math.ceil(w.vs / 3) * 3; k < w.ve; k += 3) cuts.add(k);
    const pts = [...cuts].filter((k) => k >= w.vs && k <= w.ve).sort((a, b) => a - b);
    for (let j = 0; j < pts.length - 1; j++) {
      const s = pts[j], e = pts[j + 1]; if (e <= s) continue;
      const isActive = w.as < w.ae && s >= w.as && e <= w.ae, sh = c.settings.shake ? shakeOffset(Math.floor(s / 3), c.seed) : { dx: 0, dy: 0 };
      const x = b.x + sh.dx, y = b.y + sh.dy; let tags = `\\an7\\pos(${x},${y})`;
      if (j === 0 && dur > 0 && !c.settings.shake) {
        if (ent === "fade") tags += `\\fad(${dur},0)`; else if (ent === "pop") tags += `\\fscx80\\fscy80\\t(0,${dur},\\fscx100\\fscy100)`;
        else if (ent === "slide") tags = `\\an7\\move(${x},${y + Math.round(L.em * 0.5)},${x},${y},0,${dur})`;
      }
      if (p.exit === "fade" && dur > 0 && j === pts.length - 2 && e === w.ve) tags += `\\fad(0,${dur})`;
      if (isActive) { if (active === "color") tags += `\\c${bgr(c.style.activeColor)}&`; else if (active === "scale") tags += `\\fscx115\\fscy115`; else if (active === "underline") tags += `\\u1\\c${bgr(c.style.activeColor)}&`; }
      if (isActive && active === "box") ev.push(`Dialogue: 0,${assFrame(s)},${assFrame(e)},W,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c${bgr(c.style.activeColor)}&\\alpha&H60&\\bord0\\shad0}m ${b.x - 6} ${b.y} l ${b.x + b.w + 6} ${b.y} ${b.x + b.w + 6} ${b.y + b.h} ${b.x - 6} ${b.y + b.h}{\\p0}`);
      ev.push(`Dialogue: 1,${assFrame(s)},${assFrame(e)},W,,0,0,0,,{${tags}}${text}`);
    }
  }
  return head + ev.join("\n") + "\n";
}
