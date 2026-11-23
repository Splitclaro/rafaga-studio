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
export type LyricFilter = "none" | "noche" | "super8" | "bn" | "vapor" | "cine16" | "vhs" | "camara_noche" | "gran_angular";
export interface LyricComposition {
  kind: "lyric"; v: 1; aspect: LyricAspect; res: 720 | 1080; fps: 30; mode: "letra" | "texto" | "portada";
  range: { start: number; end: number }; duration: number; words: LyricWord[]; style: CaptionStyleV2; preset: BehaviourPresetId;
  background: { kind: "media" | "color"; color: string; items: LyricBgItem[]; sequence: number[]; interval: number; order: "aleatorio" | "fijo"; loop: boolean; fit: "preserve" | "fill" | "band" };
  settings: { crop: number; dim: number; filter: LyricFilter; shake: boolean; blend: number; variation: number; fadeIn: number; fadeOut: number };
  hook: { text: string; dur: number; start?: number } | null; message: { text: string; start: number; end: number } | null; cover: { title: string; artist?: string; front?: string; back?: string; motion?: "lenta" | "estatica"; lyrics?: boolean } | null; seed: number; variant_hash?: string;
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
    range: { start, end }, duration: end - start, words, style: { ...validateCaptionStyle(o.style), position: { x: 0.5, y: 0.5 } }, preset: o.preset in BEHAVIOUR_PRESETS ? o.preset : "frase_palabra_activa",
    background: { kind: b.kind === "media" ? "media" : "color", color: hex(b.color, "#000000"), items: Array.isArray(b.items) ? b.items.slice(0, 200) : [], sequence: Array.isArray(b.sequence) ? b.sequence.filter((n: unknown) => Number.isInteger(n)).slice(0, 500) : [],
      interval: num(b.interval, 0.5, 30, 3), order: b.order === "fijo" ? "fijo" : "aleatorio", loop: b.loop !== false, fit: b.fit === "fill" || b.fit === "band" ? b.fit : "preserve" },
    settings: { crop: num(st.crop, 0, 1, 0), dim: num(st.dim, 0, 0.9, 0.2), filter: ["noche", "super8", "bn", "vapor", "cine16", "vhs", "camara_noche", "gran_angular"].includes(st.filter) ? st.filter : "none", shake: !!st.shake, blend: num(st.blend, 0, 2, 0), variation: Math.round(num(st.variation, 0, 100, 0)), fadeIn: num(st.fadeIn, 0, 5, 0), fadeOut: num(st.fadeOut, 0, 5, 0) },
    hook: o.hook && typeof o.hook.text === "string" ? { text: o.hook.text.slice(0, 120), dur: num(o.hook.dur, 0.5, 600, 3), ...(o.hook.start != null ? { start: num(o.hook.start, 0, 7200, 0) } : {}) } : null,
    message: o.message && typeof o.message.text === "string" ? { text: o.message.text.slice(0, 200), start: num(o.message.start, 0, 7200, 0), end: num(o.message.end, 0, 7200, 5) } : null,
    cover: o.cover && typeof o.cover.title === "string" ? { title: o.cover.title.slice(0, 120), ...(typeof o.cover.artist === "string" ? { artist: o.cover.artist.slice(0, 120) } : {}), ...(typeof o.cover.front === "string" ? { front: o.cover.front.slice(0, 200) } : {}), ...(typeof o.cover.back === "string" ? { back: o.cover.back.slice(0, 200) } : {}), motion: o.cover.motion === "estatica" ? "estatica" : "lenta", ...(o.cover.lyrics ? { lyrics: true } : {}) } : null,
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
  const tr = (c.style.tracking ?? 0) * em, wpx = (i: number) => measureText(caseOf(c, c.words[i].text), family, c.style.weight, em) + tr * caseOf(c, c.words[i].text).length, space = measureText(" ", family, c.style.weight, em) + tr;
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
export const showWords = (c: LyricComposition) => c.mode === "letra" || (c.mode === "portada" && !!c.cover?.lyrics);
export function lyricTimeline(c: LyricComposition, L = lyricLayout(c)): WordTimeline[] {
  if (!showWords(c)) return [];
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

export interface Overlay { id: "hook" | "message" | "title" | "artist"; text: string; box: LyricBox; em: number; startF: number; endF: number }
const wrapText = (c: LyricComposition, L: LyricLayout, text: string, em: number): string[] => {
  const maxW = L.frame.width * 0.84, lines: string[] = []; let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && measureText(t, L.family, c.style.weight, em) > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines.slice(0, 4);
};
/** Gancho, mensaje, título y artista con su caja e intervalo (fotogramas): única fuente para la escena y para el ASS. */
export function lyricOverlays(c: LyricComposition, L = lyricLayout(c)): Overlay[] {
  const out: Overlay[] = [], { width: W, height: H } = L.frame, total = F(c.duration), lh = (em: number) => { const f = fontFor(L.family, c.style.weight); return even((em * (f.ascent - f.descent)) / f.unitsPerEm); };
  const put = (id: Overlay["id"], text: string, em: number, cy: number, s: number, e: number, left = false) => {
    const lines = wrapText(c, L, caseOf(c, text), em), h = lh(em); const top = even(Math.max(0, cy - (lines.length * h) / 2));
    lines.forEach((ln, i) => { const w = measureText(ln, L.family, c.style.weight, em); out.push({ id, text: ln, em, box: { x: even(Math.max(0, left ? 0 : (W - w) / 2)), y: top + i * h, w: even(w + 1), h }, startF: s, endF: e }); });
  };
  if (c.hook) { const s = Math.max(0, F((c.hook.start ?? 0))), e = Math.min(total, F((c.hook.start ?? 0) + c.hook.dur)); if (e > s) put("hook", c.hook.text, even(L.em * 0.75), H * 0.12, s, e); }
  if (c.message && c.mode !== "portada") { const s = Math.max(0, F(c.message.start - c.range.start)), e = Math.min(total, F(c.message.end - c.range.start)); if (e > s) put("message", c.message.text, L.em, c.style.position.y * H, s, e); }
  if (c.mode === "portada" && c.cover) {
    const side = even(W * 0.7), bottom = H * 0.4 + side / 2;
    put("title", c.cover.title, L.em, bottom + L.em * 1.4, 0, total); if (c.cover.artist) put("artist", c.cover.artist, even(L.em * 0.7), bottom + L.em * 2.9, 0, total);
  }
  return out;
}
/** Portada: imagen y zoom por fotograma, en un cuadrado de 0,7 W centrado a 0,4 H. */
export function coverAt(c: LyricComposition, k: number) {
  if (c.mode !== "portada" || !c.cover) return null;
  const { width: W, height: H } = lyricFrameSize(c), side = even(W * 0.7), total = Math.max(1, F(c.duration)), half = k >= total / 2;
  return { image: (half ? c.cover.back ?? c.cover.front : c.cover.front) ?? null, side: half ? "back" as const : "front" as const, zoom: c.cover.motion === "estatica" ? 1 : +(1 + 0.06 * Math.min(1, k / Math.max(1, total - 1))).toFixed(4), box: { x: even((W - side) / 2), y: even(H * 0.4 - side / 2), w: side, h: side } };
}
/** Cambia de modo sin tocar la letra, el estilo, el fondo, el tramo ni la semilla. */
export function switchLyricMode(c: LyricComposition, mode: LyricComposition["mode"]): LyricComposition { return { ...c, mode }; }

export interface SceneWord { index: number; text: string; box: LyricBox; alpha: number; scale: number; dx: number; dy: number; active: boolean; rot?: number; color?: string }
export interface LyricScene { t: number; frame: number; words: SceneWord[]; overlays: Overlay[]; hook: string | null; message: string | null; cover: ReturnType<typeof coverAt>; shake: { dx: number; dy: number }; bars: null }
const entranceMs = (c: LyricComposition) => (c.style.entranceMs && c.style.entranceMs > 0 ? c.style.entranceMs : BEHAVIOUR_PRESETS[c.preset].durationMs);

const EASE = { out: (u: number) => 1 - (1 - u) * (1 - u), in: (u: number) => u * u, inout: (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) } as const;
const hash01 = (n: number, seed: number) => { let t = (seed * 2654435761 + n * 40503) >>> 0; t = Math.imul(t ^ (t >>> 15), 2246822507) >>> 0; t = Math.imul(t ^ (t >>> 13), 3266489909) >>> 0; return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
/** ¿El estilo mueve las palabras de forma que el ASS necesita un evento por fotograma (entrada con curva/dirección, salida propia, reposo)? */
export const styleIsDynamic = (c: LyricComposition) => !!(c.style.ease || c.style.entranceDir || c.style.exit || c.style.idle || c.style.entranceRot || c.style.stagger);
/** Color de una palabra con «ciclo de paleta»: alterna color, color activo y color final del degradado (o blanco). */
export const paletteColor = (c: LyricComposition, index: number): string | null => (c.style.palette ? [c.style.color, c.style.activeColor, c.style.gradient ?? "#FFFFFF"][index % 3] : null);
export interface WordMotion { alpha: number; scale: number; dx: number; dy: number; rot: number }
/** Estado de una palabra en el fotograma `k` (sin la sacudida): fuente única para la vista previa y el ASS. */
export function wordMotion(c: LyricComposition, L: LyricLayout, w: WordTimeline, k: number): WordMotion {
  const p = BEHAVIOUR_PRESETS[c.preset], dur = Math.max(1, Math.round((entranceMs(c) / 1000) * FPS)), ent = c.style.entrance !== "none" ? c.style.entrance : p.entrance;
  let delay = 0;
  if (c.style.stagger) { const pg = L.pages.find((q) => q.words.includes(w.index)); if (pg) { const pos = pg.words.indexOf(w.index), n = pg.words.length; delay = Math.round(((c.style.stagger / 1000) * FPS) * (c.style.staggerOrder === "reverse" ? n - 1 - pos : pos)); } }
  const ease = c.style.ease ? EASE[c.style.ease] : (u: number) => u, el = k - w.vs - delay, exitLeft = w.ve - k, m = Math.round(L.em * 0.5);
  let alpha = 1, scale = 1, dx = 0, dy = 0, rot = 0;
  if (el < 0) alpha = 0;   // escalonado: todavía no le toca entrar
  if (dur > 0 && el >= 0 && el < dur) {
    const u = ease((el + 1) / (dur + 1)); if (c.style.entranceRot) rot += c.style.entranceRot * (1 - u);
    if (ent === "fade") alpha = u; else if (ent === "pop") scale = 0.8 + 0.2 * u;
    else if (ent === "slide") { const d = 1 - u, dir = c.style.entranceDir ?? "up"; if (dir === "up") dy = Math.round(d * m); else if (dir === "down") dy = -Math.round(d * m); else if (dir === "left") dx = -Math.round(d * m); else dx = Math.round(d * m); }
  }
  const exit = c.style.exit ?? (p.exit === "fade" ? "fade" : "cut");
  if (exit !== "cut" && dur > 0 && exitLeft <= dur) {
    const u = ease(exitLeft / (dur + 1));
    if (exit === "fade") alpha = Math.min(alpha, u); else if (exit === "slide") { dy -= Math.round((1 - u) * m); alpha = Math.min(alpha, 0.35 + 0.65 * u); } else if (exit === "pop") { scale *= 0.8 + 0.2 * u; alpha = Math.min(alpha, u); }
  }
  if (c.style.idle) {   // movimiento lento y continuo, cuantizado a 3 fotogramas como la sacudida
    const ph = (Math.floor(k / 3) * 3 / FPS) * Math.PI * 2;
    if (c.style.idle === "float") dy += Math.round(Math.sin(ph * 0.6) * L.em * 0.04); else if (c.style.idle === "pulse") scale *= 1 + 0.04 * Math.sin(ph * 1.2); else rot += Math.round(3 * Math.sin(ph * 0.8) * 10) / 10;
  }
  if (c.style.jitter) dy += Math.round((hash01(w.index * 5 + 7, c.seed) - 0.5) * 2 * c.style.jitter);
  if (c.style.chaos) {   // desorden fijo por palabra (misma semilla → mismo resultado)
    const q = c.style.chaos, i = w.index; rot += Math.round((hash01(i * 3, c.seed) - 0.5) * 2 * 8 * q * 10) / 10;
    dx += Math.round((hash01(i * 3 + 1, c.seed) - 0.5) * 2 * L.em * 0.12 * q); dy += Math.round((hash01(i * 3 + 2, c.seed) - 0.5) * 2 * L.em * 0.12 * q);
  }
  return { alpha: +alpha.toFixed(3), scale: +scale.toFixed(3), dx, dy, rot: +rot.toFixed(1) };
}
/** Opacidad de cada eco (capas fantasma detrás de la palabra) y su desplazamiento en fracción del cuerpo. */
export const ECHO_OPACITY = [0.4, 0.25, 0.12] as const;
export const ECHO_OFFSET = 0.05;

/** Escena en el instante `t` (s desde el inicio del recorte): palabras visibles con su caja, opacidad, escala y desplazamiento. */
export function lyricSceneAt(c: LyricComposition, t: number, L = lyricLayout(c), TL = lyricTimeline(c, L)): LyricScene {
  const k = Math.floor(t * FPS + 1e-6), p = BEHAVIOUR_PRESETS[c.preset], dur = Math.max(1, Math.round((entranceMs(c) / 1000) * FPS)), words: SceneWord[] = [];
  const shake = c.settings.shake ? shakeOffset(Math.floor(k / 3), c.seed) : { dx: 0, dy: 0 };
  for (const w of TL) {
    if (k < w.vs || k >= w.ve) continue;
    if (styleIsDynamic(c) || c.style.chaos || c.style.jitter || c.style.palette) {
      const m = wordMotion(c, L, w, k), act2 = w.as < w.ae && k >= w.as && k < w.ae; let sc = m.scale; if (act2 && (c.style.active !== "none" ? c.style.active : p.active) === "scale") sc = +(sc * 1.15).toFixed(3);
      words.push({ index: w.index, text: L.word[w.index].text, box: L.word[w.index].box, alpha: m.alpha, scale: sc, dx: m.dx + shake.dx, dy: m.dy + shake.dy, active: act2, ...(m.rot ? { rot: m.rot } : {}), ...(paletteColor(c, w.index) ? { color: paletteColor(c, w.index)! } : {}) }); continue;
    }
    const el = k - w.vs, ent = c.style.entrance !== "none" ? c.style.entrance : p.entrance, exitLeft = w.ve - k;
    let alpha = 1, scale = 1, dy = 0;
    if (dur > 0 && el < dur) { const u = (el + 1) / (dur + 1); if (ent === "fade") alpha = u; else if (ent === "pop") scale = 0.8 + 0.2 * u; else if (ent === "slide") dy = Math.round((1 - u) * L.em * 0.5); }
    if (p.exit === "fade" && dur > 0 && exitLeft <= dur) alpha = Math.min(alpha, exitLeft / (dur + 1));
    const act = w.as < w.ae && k >= w.as && k < w.ae;
    if (act && (c.style.active !== "none" ? c.style.active : p.active) === "scale") scale *= 1.15;
    words.push({ index: w.index, text: L.word[w.index].text, box: L.word[w.index].box, alpha: +alpha.toFixed(3), scale: +scale.toFixed(3), dx: shake.dx, dy: dy + shake.dy, active: act });
  }
  const overlays = lyricOverlays(c, L).filter((o) => k >= o.startF && k < o.endF);
  return { t, frame: k, words, overlays, hook: overlays.find((o) => o.id === "hook")?.text ?? null, message: overlays.filter((o) => o.id === "message").map((o) => o.text).join(" ") || null, cover: coverAt(c, k), shake, bars: null };
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
const hexRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
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
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${L.frame.width}\nPlayResY: ${L.frame.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: W,${L.family},${fontsize.toFixed(2)},${bgr(c.style.color)},${bgr(c.style.color)},&H00000000,&H64000000,${c.style.weight === 700 ? -1 : 0},${c.style.italic ? -1 : 0},0,0,100,100,${((c.style.tracking ?? 0) * L.em).toFixed(2)},0,${c.style.effect === "box" ? 3 : 1},${c.style.effect === "box" ? 8 : outline},${shadow},7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev: string[] = [];
  for (const w of TL) {
    const b = L.word[w.index].box, text = esc(L.word[w.index].text), cuts = new Set<number>([w.vs, w.ve]);
    if (w.as < w.ae) { cuts.add(w.as); cuts.add(w.ae); }
    if (c.settings.shake) for (let k = Math.ceil(w.vs / 3) * 3; k < w.ve; k += 3) cuts.add(k);
    const dyn = styleIsDynamic(c), mot = dyn || !!c.style.chaos || !!c.style.jitter, durF = Math.max(1, Math.round((dur / 1000) * FPS));
    if (dyn) { const extra = c.style.stagger ? Math.round((c.style.stagger / 1000) * FPS * 12) : 0; for (let k = w.vs; k <= Math.min(w.ve, w.vs + durF + extra); k++) cuts.add(k); for (let k = Math.max(w.vs, w.ve - durF); k <= w.ve; k++) cuts.add(k); if (c.style.idle) for (let k = Math.ceil(w.vs / 3) * 3; k < w.ve; k += 3) cuts.add(k); }
    const pts = [...cuts].filter((k) => k >= w.vs && k <= w.ve).sort((a, b) => a - b);
    for (let j = 0; j < pts.length - 1; j++) {
      const s = pts[j], e = pts[j + 1]; if (e <= s) continue;
      const isActive = w.as < w.ae && s >= w.as && e <= w.ae, sh = c.settings.shake ? shakeOffset(Math.floor(s / 3), c.seed) : { dx: 0, dy: 0 };
      const m = mot ? wordMotion(c, L, w, s) : null, x = b.x + sh.dx + (m?.dx ?? 0), y = b.y + sh.dy + (m?.dy ?? 0); let tags = `\\an7\\pos(${x},${y})`;
      if (m) {
        const sc = isActive && active === "scale" ? m.scale * 1.15 : m.scale;
        if (m.alpha < 1) tags += `\\alpha&H${Math.round(255 * (1 - m.alpha)).toString(16).padStart(2, "0").toUpperCase()}&`;
        if (sc !== 1) tags += `\\fscx${Math.round(sc * 100)}\\fscy${Math.round(sc * 100)}`;
        if (m.rot) tags += `\\org(${Math.round(x + b.w / 2)},${Math.round(y + b.h / 2)})\\frz${-m.rot}`;
      } else if (j === 0 && dur > 0 && !c.settings.shake) {
        if (ent === "fade") tags += `\\fad(${dur},0)`; else if (ent === "pop") tags += `\\fscx80\\fscy80\\t(0,${dur},\\fscx100\\fscy100)`;
        else if (ent === "slide") tags = `\\an7\\move(${x},${y + Math.round(L.em * 0.5)},${x},${y},0,${dur})`;
      }
      if (!m && p.exit === "fade" && dur > 0 && j === pts.length - 2 && e === w.ve) tags += `\\fad(0,${dur})`;
      if (isActive) { if (active === "color") tags += `\\c${bgr(c.style.activeColor)}&`; else if (active === "scale" && !m) tags += `\\fscx115\\fscy115`; else if (active === "underline") tags += `\\u1\\c${bgr(c.style.activeColor)}&`; }
      if (isActive && active === "box") ev.push(`Dialogue: 0,${assFrame(s)},${assFrame(e)},W,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c${bgr(c.style.activeColor)}&\\alpha&H60&\\bord0\\shad0}m ${b.x - 6} ${b.y} l ${b.x + b.w + 6} ${b.y} ${b.x + b.w + 6} ${b.y + b.h} ${b.x - 6} ${b.y + b.h}{\\p0}`);
      const stT = assFrame(s), enT = assFrame(e);
      if (c.style.echo && !(isActive && active === "box")) for (let i = c.style.echo; i >= 1; i--) {   // ecos: copias fantasma detrás, más lejanas y más tenues
        const o = Math.round(L.em * ECHO_OFFSET * i), op = (m?.alpha ?? 1) * ECHO_OPACITY[i - 1];
        ev.push(`Dialogue: 0,${stT},${enT},W,,0,0,0,,{${tags.replace(/\\pos\(-?\d+,-?\d+\)/, `\\pos(${x + o},${y + o})`).replace(/\\alpha&H[0-9A-F]{2}&/, "")}\\alpha&H${Math.round(255 * (1 - op)).toString(16).padStart(2, "0").toUpperCase()}&}${text}`);
      }
      const pcol = paletteColor(c, w.index);
      if (pcol && !isActive) ev.push(`Dialogue: 1,${stT},${enT},W,,0,0,0,,{${tags}\\c${bgr(pcol.toUpperCase())}&}${text}`);
      else if (c.style.gradient && !isActive) {   // degradado vertical en 6 bandas recortadas (ASS no tiene degradado de texto)
        const N = 6, a = hexRgb(c.style.color), z = hexRgb(c.style.gradient);
        for (let i = 0; i < N; i++) {
          const t = (i + 0.5) / N, col = "#" + [0, 1, 2].map((q) => Math.round(a[q] + (z[q] - a[q]) * t).toString(16).padStart(2, "0")).join(""), y0 = Math.round(y + (b.h * i) / N) - (i === 0 ? 40 : 0), y1 = Math.round(y + (b.h * (i + 1)) / N) + (i === N - 1 ? 40 : 0);
          ev.push(`Dialogue: 1,${stT},${enT},W,,0,0,0,,{${tags}\\c${bgr(col.toUpperCase())}&\\clip(${Math.round(x - 60)},${y0},${Math.round(x + b.w + 60)},${y1})}${text}`);
        }
      } else
      ev.push(`Dialogue: 1,${stT},${enT},W,,0,0,0,,{${tags}}${text}`);
    }
  }
  for (const o of lyricOverlays(c, L)) ev.push(`Dialogue: 2,${assFrame(o.startF)},${assFrame(o.endF)},W,,0,0,0,,{\\an7\\pos(${o.box.x},${o.box.y})\\fs${((o.em * (f.ascent - f.descent)) / f.unitsPerEm).toFixed(2)}}${esc(o.text)}`);
  return head + ev.join("\n") + "\n";
}

// ───────── Render: filtros, ajuste de fondo, argumentos de ffmpeg y variantes ─────────
/** Mismas cadenas que `FILTERS.midnight|super8|noir|vaporwave` de @rafaga/lyrics/background.ts (copiadas: composition no depende de lyrics). */
export const LYRIC_FILTERS: Record<Exclude<LyricFilter, "none">, string> = {
  noche: "colorbalance=bs=0.22:bm=0.08,eq=brightness=-0.04:saturation=0.85",
  super8: "eq=saturation=1.15:contrast=1.06,colorbalance=rs=0.08:gs=0.04:bs=-0.06,noise=alls=10:allf=t,vignette=PI/5",
  bn: "hue=s=0,eq=contrast=1.18:brightness=-0.02",
  vapor: "colorbalance=rs=0.22:gs=-0.08:bs=0.28,eq=saturation=1.35",
  cine16: "eq=saturation=0.92:contrast=1.1:gamma=0.97,colorbalance=rs=0.05:gs=0.01:bs=-0.05,noise=alls=22:allf=t+u,unsharp=3:3:0.4,vignette=PI/6",   // película de 16 mm: grano visible, tono cálido, viñeteado suave
  vhs: "eq=saturation=1.25:contrast=1.08,chromashift=crh=3:cbh=-3,noise=alls=14:allf=t+u,unsharp=5:5:-0.6",
  camara_noche: "hue=s=0,colorbalance=gs=0.45:gm=0.35:rs=-0.25:bs=-0.25,eq=brightness=0.05:contrast=1.25,noise=alls=16:allf=t,vignette=PI/4",
  gran_angular: "lenscorrection=k1=-0.16:k2=-0.02,eq=saturation=1.08:contrast=1.04",
};
/** Aproximación para el canvas de la vista previa. */
export const LYRIC_FILTER_CSS: Record<LyricFilter, string> = { none: "none", noche: "saturate(.85) hue-rotate(-12deg) brightness(.92)", super8: "saturate(1.15) contrast(1.06) sepia(.15)", bn: "grayscale(1) contrast(1.18)", vapor: "saturate(1.35) hue-rotate(40deg)", cine16: "saturate(.92) contrast(1.1) sepia(.12)", vhs: "saturate(1.25) contrast(1.08)", camara_noche: "grayscale(1) sepia(1) hue-rotate(60deg) saturate(2.2) brightness(1.05) contrast(1.2)", gran_angular: "saturate(1.08) contrast(1.04)" };

/** Rectángulo (escalado + posición) de un plano de fondo según el ajuste: `fill` recorta, `preserve` cabe con negro, `band` banda 16:9 centrada. */
export function bgRect(fit: "preserve" | "fill" | "band", item: { w: number; h: number }, W: number, H: number) {
  const cover = (bw: number, bh: number) => Math.max(bw / item.w, bh / item.h), contain = (bw: number, bh: number) => Math.min(bw / item.w, bh / item.h);
  if (fit === "preserve") { const k = contain(W, H), w = even(item.w * k), h = even(item.h * k); return { x: even((W - w) / 2), y: even((H - h) / 2), w, h, clip: null }; }
  const bh = fit === "band" ? even((W * 9) / 16) : H, k = cover(W, bh), w = even(item.w * k), h = even(item.h * k), y0 = fit === "band" ? even((H - bh) / 2) : 0;
  return { x: even((W - w) / 2), y: y0 + even((bh - h) / 2), w, h, clip: { x: 0, y: y0, w: W, h: bh } };
}
const filt = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
export interface RenderIo { audio: string; items: string[]; coverFront?: string; coverBack?: string; ass: string; fontsDir: string; out: string }
/** Argumentos de ffmpeg (sin shell). El audio sale SOLO de la canción, sin filtros de audio: `-c:a aac -b:a 192k`. */
export function lyricRenderArgs(c: LyricComposition, io: RenderIo): string[] {
  const { width: W, height: H } = lyricFrameSize(c), D = c.duration, a: string[] = ["-y", "-v", "error"], chains: string[] = [];
  const bandH = even((W * 9) / 16), fitF = c.background.fit === "fill" ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : c.background.fit === "band" ? `scale=${W}:${bandH}:force_original_aspect_ratio=increase,crop=${W}:${bandH},pad=${W}:${H}:0:${even((H - bandH) / 2)}:color=black`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
  const shots = lyricShots(c); let n = 0;
  if (shots.length) {
    shots.forEach((s, i) => {
      const it = c.background.items[s.item], d = +(s.end - s.start).toFixed(3), fade = c.settings.blend > 0 && shots.length > 1 ? `,fade=t=in:st=0:d=${(c.settings.blend * 0.25).toFixed(2)},fade=t=out:st=${Math.max(0, d - c.settings.blend * 0.25).toFixed(2)}:d=${(c.settings.blend * 0.25).toFixed(2)}` : "";
      if (it.kind === "video") a.push("-stream_loop", "-1", "-ss", "0", "-t", String(d), "-i", io.items[s.item]); else a.push("-loop", "1", "-framerate", "30", "-t", String(d), "-i", io.items[s.item]);
      chains.push(`[${n}:v]setsar=1,fps=30,${fitF},format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS${fade}[s${i}]`); n++;
    });
    chains.push(`${shots.map((_, i) => `[s${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[bg]`);
  } else { a.push("-f", "lavfi", "-t", String(D), "-i", `color=c=${c.background.color.replace("#", "0x")}:s=${W}x${H}:r=30`); chains.push(`[${n}:v]setsar=1,format=yuv420p[bg]`); n++; }
  const post: string[] = [];
  if (c.settings.filter !== "none") post.push(LYRIC_FILTERS[c.settings.filter]);
  if (c.settings.dim > 0) post.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@${Math.min(0.8, c.settings.dim).toFixed(2)}:t=fill`);
  const bar = even(Math.round((c.settings.crop * 0.4 * H) / 2));
  if (bar > 0) post.push(`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`, `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`);
  let last = "bg"; chains.push(`[bg]${post.length ? post.join(",") : "null"}[g]`); last = "g";
  if (c.mode === "portada" && (io.coverFront || io.coverBack)) {
    const side = even(W * 0.7), cx = W / 2, cy = H * 0.4, zoom = c.cover?.motion === "estatica" ? "1" : `(1+0.06*t/${D})`;
    for (const [k, path, half] of [["f", io.coverFront, 0], ["b", io.coverBack ?? io.coverFront, 1]] as const) {
      if (!path) continue; a.push("-loop", "1", "-framerate", "30", "-t", String(D), "-i", path);
      const en = half ? `gte(t,${(D / 2).toFixed(3)})` : io.coverBack ? `lt(t,${(D / 2).toFixed(3)})` : "1";
      chains.push(`[${n}:v]scale=${side}:${side}:force_original_aspect_ratio=increase,crop=${side}:${side},scale=w='${side}*${zoom}':h='${side}*${zoom}':eval=frame,format=yuva420p[c${k}]`);
      chains.push(`[${last}][c${k}]overlay=x='${cx}-overlay_w/2':y='${cy}-overlay_h/2':eval=frame:enable='${en}'[o${k}]`); last = `o${k}`; n++;
    }
  }
  chains.push(`[${last}]subtitles=${filt(io.ass)}:fontsdir=${filt(io.fontsDir)},scale=out_range=tv,format=yuv420p[v]`);   // fotos JPG llegan en rango completo (yuvj420p): se normaliza a rango TV para que el MP4 sea H.264/yuv420p estándar
  a.push("-ss", String(c.range.start), "-t", String(D), "-i", io.audio);
  const fi = Math.min(c.settings.fadeIn, D / 2), fo = Math.min(c.settings.fadeOut, D / 2);   // entrada y salida suaves del volumen
  const af = [fi > 0 ? `afade=t=in:st=0:d=${fi.toFixed(2)}` : "", fo > 0 ? `afade=t=out:st=${(D - fo).toFixed(2)}:d=${fo.toFixed(2)}` : ""].filter(Boolean).join(",");
  if (af) chains.push(`[${n}:a:0]${af}[a]`);
  a.push("-filter_complex", chains.join(";"), "-map", "[v]", "-map", af ? "[a]" : `${n}:a:0`, "-c:v", "libx264", "-preset", "superfast", "-crf", "20", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-t", String(D), "-movflags", "+faststart", io.out);
  return a;
}

// ───────── Variantes ─────────
export interface VariantLocks { song_range?: boolean; lyrics_sync?: boolean; style?: boolean; background?: boolean; format?: boolean }
export interface VariantOpts { styles?: CaptionStyleV2[]; collections?: LyricBgItem[][]; aspects?: LyricAspect[]; ranges?: { start: number; end: number }[]; alignments?: LyricWord[][] }
/** N composiciones con semillas distintas (`seed × 1000 + i`); solo varía lo no bloqueado, rotando entre las opciones dadas. */
export function planLyricVariants(base: LyricComposition, n: number, locks: VariantLocks = {}, opts: VariantOpts = {}): LyricComposition[] {
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => {
    const seed = base.seed * 1000 + i; let s = seed >>> 0; const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let c: LyricComposition = { ...base, seed };
    const pick = <T,>(a: T[] | undefined) => (a && a.length ? a[i % a.length] : undefined);
    const st = !locks.style ? pick(opts.styles) : undefined, bg = !locks.background ? pick(opts.collections) : undefined, ar = !locks.format ? pick(opts.aspects) : undefined, rg = !locks.song_range ? pick(opts.ranges) : undefined, al = !locks.lyrics_sync ? pick(opts.alignments) : undefined;
    if (st) c = { ...c, style: st }; if (bg) c = { ...c, background: { ...c.background, kind: "media", items: bg, sequence: [] } }; if (ar) c = { ...c, aspect: ar };
    if (rg) c = { ...c, range: rg, duration: rg.end - rg.start }; if (al) c = { ...c, words: al };
    if (base.settings.variation > 0 && !locks.background) { const v = base.settings.variation / 100; c = { ...c, settings: { ...c.settings, crop: +Math.min(1, Math.max(0, c.settings.crop + (r() - 0.5) * 0.2 * v)).toFixed(2), dim: +Math.min(0.8, Math.max(0, c.settings.dim + (r() - 0.5) * 0.2 * v)).toFixed(2) } }; }
    return c;
  });
}
/** FNV-1a de 64 bits (hex) de los parámetros que hacen distinta a una variante: estilo, formato, tramo, fondo y ajustes (no la semilla). */
export function variantHash(c: LyricComposition): string {
  const txt = JSON.stringify([c.style, c.aspect, c.range, c.background.kind, c.background.color, c.background.items.map((i) => i.ref), c.background.sequence, c.background.interval, c.background.order, c.background.fit, c.settings, c.mode, c.preset]);
  let h = 0xcbf29ce484222325n; for (const b of new TextEncoder().encode(txt)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}
const bits = (a: string, b: string) => { let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };
/** Pares casi duplicados: mismo `variantHash`, o hash perceptivo del primer fotograma a ≤ `maxBits` bits. */
export function nearDuplicates(items: { id: string; hash: string; ahash?: string | null }[], maxBits = 4): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.hash === b.hash || (a.ahash && b.ahash && bits(a.ahash, b.ahash) <= maxBits)) out.push([a.id, b.id]);
  }
  return out;
}
