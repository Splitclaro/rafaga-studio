// Selección de momentos v2. Generaliza los arreglos ya desplegados en run.ts (2fbd1a5 · 1d1024f · f74e330) dentro de etapas:
//  · candidates: propuestas por ventana (cada una con su try/catch, bajo GroqLimiter) o por señales (destacados); manual no llama a ningún LLM.
//  · select: descarta clips anteriores, valida, filtra por calidad, puntúa, segunda pasada de la IA, completado léxico, pasada relajada y aviso.
//    Nunca se entrega 0 en silencio. · translate: texto por grupo con tiempos intactos.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aiConfig, groqProposeClips, groqChat, AiError } from "@rafaga/providers";
import { validateCandidates, refineBounds, padBounds, lexicalCandidates, transcriptText, windows, type TWord, type RawCandidate } from "@rafaga/selection";
import { MODES, qualityFilters, scoreAll, shortfall, DROP_TEXT, type ModeId } from "@rafaga/selection/modes";
import { StageError, type StageCtx, type StageImpl, type StageRow } from "./registry.ts";
import { GroqLimiter, limitsFromEnv } from "../groqlimits.ts";

interface Gctx { generation_id: string; workspace_id: string; project_id: string; params: Record<string, unknown> & { min_s?: number; max_s?: number; count?: number | null; brief?: string; exclude_previous?: boolean; alternatives_for?: { start_ms: number; end_ms: number } }; mode: ModeId | null; requested_count: number | null; words: TWord[]; scenes: number[]; audio_signals: { t: number; kind: string; score: number }[]; previous: { start_ms: number; end_ms: number; user_edited?: boolean }[] }
export interface SelectDeps { propose?: (a: { brief: string; windowText: string; target: string; want: number }) => Promise<RawCandidate[]>; limiter?: GroqLimiter; chat?: (system: string, user: string) => Promise<string> }
const dir = (ctx: StageCtx, gen: string) => { const d = join(ctx.tmpDir ?? "/tmp/rafaga", `gen-${gen}`); mkdirSync(d, { recursive: true }); return d; };
const candKey = (ws: string, gen: string) => `${ws}/stages/${gen}-candidates.json`;
const clean = (s: string) => s.replace(/\bviral(es|idad)?\b/gi, "interesante");
const NO_MODE = (m: string | null): ModeId => (m && m in MODES ? (m as ModeId) : "automatico");

function bounds(gc: Gctx) {
  const min = Number(gc.params.min_s ?? 10), max = Math.max(min + 1, Number(gc.params.max_s ?? 180));
  const range = (gc.words.at(-1)?.end ?? 0) - (gc.words[0]?.start ?? 0);
  const want = gc.params.count ? Number(gc.params.count) : Math.max(1, Math.min(20, Math.floor(range / Math.max(min, 1))));
  return { min, max, want, asked: Math.max(3, Math.min(10, Math.ceil(want * 1.6))) };
}

function makePropose(ctx: StageCtx, deps: SelectDeps) {
  const cfg = aiConfig(ctx.env ?? process.env), limiter = deps.limiter ?? new GroqLimiter(limitsFromEnv(ctx.env ?? process.env));
  const call = deps.propose ?? (async (a: { brief: string; windowText: string; target: string; want: number }) => (await groqProposeClips(cfg, { ...a, fetchImpl: ctx.fetch })).clips);
  return async (a: { brief: string; windowText: string; target: string; want: number }): Promise<RawCandidate[]> => {
    await limiter.wait("llm", Math.ceil(a.windowText.length / 4) + 900);
    try { return await call(a); } catch (e) { if (e instanceof AiError && e.status === 429) limiter.on429(e.retryAfter ?? 20); throw e; }
  };
}
const briefWith = (mode: ModeId, brief: string | undefined, taken: string[] = []) =>
  [MODES[mode].hint, brief?.trim() ? `Encargo del usuario: ${brief.trim()}` : "", taken.length ? `Ya están elegidos estos tramos (NO los repitas ni los solapes): ${taken.join(", ")}. Busca momentos distintos.` : ""].filter(Boolean).join("\n");
const targetText = (min: number, max: number) => `entre ${min} y ${max} s cada momento; no propongas momentos más cortos de ${min} s`;

/** Ventanas en paralelo (máx. 3), cada una con su propio try/catch: un fallo no anula lo de las demás. */
async function askAll(words: TWord[], mode: ModeId, brief: string | undefined, b: ReturnType<typeof bounds>, propose: ReturnType<typeof makePropose>, taken: (from: number, to: number) => string[] = () => []) {
  const ws = windows(words, 600, 45), out: RawCandidate[] = []; let ok = 0, next = 0, lastErr = "";
  const worker = async () => { while (next < ws.length) { const w = ws[next++];
    try { out.push(...(await propose({ brief: briefWith(mode, brief, taken(w.from, w.to)), windowText: transcriptText(words, w.from, w.to), target: targetText(b.min, b.max), want: b.asked }))); ok++; }
    catch (e) { lastErr = (e as Error).message.slice(0, 160); } } };
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, ws.length)) }, worker));
  return { raw: out, ok, total: ws.length, lastErr };
}

/** Destacados: candidatos centrados en subidas de energía y cambios de escena (sin LLM). */
export function highlightCandidates(words: TWord[], signals: { t: number; score: number }[], scenes: number[], min: number, max: number, count: number): RawCandidate[] {
  const pts = [...signals.map((s) => ({ t: s.t, s: s.score })), ...scenes.map((t) => ({ t, s: 0.3 }))].sort((a, b) => b.s - a.s).slice(0, count * 3);
  const out: RawCandidate[] = [];
  for (const p of pts) {
    let a = words.findIndex((w) => w.start >= p.t - 8); if (a < 0) continue;
    for (let k = 0; k < 15 && a > 0 && !/[.!?…]\s*$/.test(words[a - 1].text); k++) a--;
    let e = a; while (e < words.length - 1 && (words[e].end - words[a].start < min || !/[.!?…]\s*$/.test(words[e].text)) && words[e + 1].end - words[a].start <= max) e++;
    const dur = words[e].end - words[a].start; if (dur < min || dur > max) continue;
    const mm = `${Math.floor(words[a].start / 60)}:${String(Math.floor(words[a].start % 60)).padStart(2, "0")}`;
    out.push({ startWord: a, endWord: e, title: `Momento destacado a los ${mm}`, reason: p.s >= 0.5 ? "Hay una subida de energía en el audio justo antes." : "Hay un cambio de escena en este punto.", briefFit: "Selección por señales sonoras y visuales", scores: { relevance: 6, hook: 7, standalone: 6, closure: 6 } });
  }
  return out;
}

const candidates: StageImpl = {
  inputs: (_c, row) => ({ stage: "candidates", generation: row.params.generation_id, v: 2 }),
  async run(ctx, row) {
    const gen = String(row.params.generation_id), gc = await ctx.rpc<Gctx>("generation_context", { p_generation: gen });
    if (!gc) throw new StageError("not_found", "La generación no existe");
    const mode = NO_MODE(gc.mode), b = bounds(gc), words = gc.words;
    if (!words.length && mode !== "manual") throw new StageError("no_speech", "No hay habla que analizar");
    let raw: RawCandidate[] = [], aiWindows = "0/0", err = "";
    if (mode === "manual") raw = [];
    else if (MODES[mode].model === null) raw = highlightCandidates(words, gc.audio_signals, gc.scenes, b.min, b.max, b.want);
    else { const r = await askAll(words, mode, gc.params.brief, b, makePropose(ctx, (ctx.deps ?? {}) as SelectDeps)); raw = r.raw; aiWindows = `${r.ok}/${r.total}`; err = r.lastErr; }
    if (!ctx.r2) throw new StageError("not_configured", "R2 no está configurado en el worker");
    const f = join(dir(ctx, gen), "candidates.json"); writeFileSync(f, JSON.stringify({ raw, mode, ai_windows: aiWindows }));
    await ctx.r2.upload(candKey(gc.workspace_id, gen), f, "application/json");
    return { output: { count: raw.length, mode, ai_windows: aiWindows, ...(err ? { ai_error: err } : {}) } };
  },
};

const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => Math.min(a.e, b.e) - Math.max(a.s, b.s) > 0;

const select: StageImpl = {
  inputs: (_c, row) => ({ stage: "select", generation: row.params.generation_id, v: 2 }),
  async run(ctx, row) {
    const gen = String(row.params.generation_id), gc = await ctx.rpc<Gctx>("generation_context", { p_generation: gen });
    if (!gc) throw new StageError("not_found", "La generación no existe");
    const mode = NO_MODE(gc.mode), b = bounds(gc), words = gc.words, brief = gc.params.brief, hasBrief = !!brief?.trim();
    const warnings: unknown[] = []; const dropCount: Record<string, number> = {};
    const note = (why: string, n = 1) => { dropCount[why] = (dropCount[why] ?? 0) + n; };
    if (mode === "manual") { await ctx.rpc("save_selection", { p_generation: gen, p_candidates: [], p_warnings: [], p_requested: null }); return { output: { delivered: 0, manual: true }, units_actual: 0 }; }
    // 1) propuestas de la etapa anterior
    let raw: RawCandidate[] = []; let aiWindows = "0/0";
    if (ctx.r2) { try { const f = join(dir(ctx, gen), "in.json"); await ctx.r2.download(candKey(gc.workspace_id, gen), f); const j = JSON.parse(readFileSync(f, "utf8")); raw = j.raw ?? []; aiWindows = j.ai_windows ?? aiWindows; } catch { /* sin propuestas: se completará por reglas */ } }
    const prev = (gc.params.exclude_previous === false ? [] : gc.previous).map((p) => ({ s: p.start_ms / 1000, e: p.end_ms / 1000 }));
    const notPrevious = (c: { startSec: number; endSec: number }) => { const hit = prev.some((p) => overlaps({ s: c.startSec, e: c.endSec }, p)); if (hit) note("previous"); return !hit; };
    const alt = gc.params.alternatives_for;
    const altWin = alt ? { s: alt.start_ms / 1000 - 30, e: alt.end_ms / 1000 + 30 } : null;
    const refine = (cs: RawCandidate[]) => cs.map((c) => { try { const r = refineBounds(words, c.startWord, c.endWord, { maxSec: b.max, wantsPayoff: false, wantsQuestion: mode === "pregunta_respuesta" }); return { ...c, startWord: r.a, endWord: r.b, reason: clean(c.reason ?? "") }; } catch { return { ...c, reason: clean(c.reason ?? "") }; } });
    const pipeline = (cs: RawCandidate[], min = b.min, max = b.max) => {
      const v = validateCandidates(words, refine(cs), { minSec: min, maxSec: max, count: 40, hasBrief });
      for (const r of v.rejected) note(r.reason);
      let acc = v.accepted.filter(notPrevious);
      if (altWin) acc = acc.filter((c) => overlaps({ s: c.startSec, e: c.endSec }, altWin) && !(Math.abs(c.startSec - alt!.start_ms / 1000) < 1 && Math.abs(c.endSec - alt!.end_ms / 1000) < 1));
      const q = qualityFilters(words, acc, { filters: MODES[mode].filters, maxOverlap: 0.5, score: (c) => scoreAll(words, [c], { brief, minSec: min, maxSec: max })[0].score.overall });
      for (const d of q.dropped) note(d.reason);
      return q.kept as typeof acc;
    };
    let acc = pipeline(raw); let secondPass = 0, topup = 0, relaxed: string | null = null;
    const propose = makePropose(ctx, (ctx.deps ?? {}) as SelectDeps);
    // 2) segunda pasada de la IA con lo ya elegido excluido
    if (acc.length < b.want && MODES[mode].model && words.length >= 20) {
      const take = (from: number, to: number) => acc.filter((c) => c.endWord >= from && c.startWord <= to).map((c) => `[${c.startWord}]–[${c.endWord}]`);
      const r = await askAll(words, mode, brief, { ...b, asked: Math.max(3, Math.min(10, (b.want - acc.length) * 2)) }, propose, take);
      const merged = pipeline([...raw, ...r.raw]);
      if (merged.length > acc.length) { secondPass = merged.length - acc.length; acc = merged; }
    }
    // 3) completar por reglas léxicas hasta el número pedido
    if (acc.length < b.want && words.length >= 20 && MODES[mode].model) {
      const lex = lexicalCandidates(words, brief ?? null, { minSec: b.min, maxSec: b.max, count: b.want * 2 }).map((c) => ({ ...c, reason: `${c.reason} (completado por reglas)` }));
      const merged = pipeline([...raw, ...lex]);
      if (merged.length > acc.length) { topup = merged.length - acc.length; acc = merged; }
    }
    // 4) pasada relajada (mín ×0.5, máx ×1.5) si no hay ninguno y sí hay habla; se anota en el motivo
    if (!acc.length && words.length >= 20 && mode !== "destacados") {
      const rMin = Math.max(6, Math.round(b.min * 0.5)), rMax = Math.max(rMin + 5, Math.round(b.max * 1.5));
      const lex = lexicalCandidates(words, null, { minSec: rMin, maxSec: rMax, count: b.want * 2 }).map((c) => ({ ...c, reason: `${c.reason} (duración ajustada: no había momentos completos de ${b.min}–${b.max} s)` }));
      const merged = pipeline([...raw, ...lex], rMin, rMax);
      if (merged.length) { acc = merged; relaxed = `${rMin}-${rMax}`; }
    }
    // 5) puntuar, ordenar por nota y quedarse con los pedidos; guardar en orden temporal
    const scored = scoreAll(words, acc, { brief, minSec: b.min, maxSec: b.max }).slice(0, b.want).sort((x, y) => x.startSec - y.startSec);
    const payload = scored.map((c) => {
      const p = padBounds(words, c.startWord, c.endWord), s = c.score, r = s.reasons;
      const top = (Object.keys(r) as (keyof typeof r)[]).sort((x, y) => r[y].score - r[x].score).slice(0, 2).map((k) => r[k].text);
      return { start_ms: Math.round(p.startSec * 1000), end_ms: Math.round(p.endSec * 1000), title: c.title, brief_fit: c.briefFit,
        reason: [clean(c.reason ?? ""), ...top].filter(Boolean).join(" ").slice(0, 780),
        scores: { overall: s.overall, gancho: r.gancho.score, desarrollo: r.desarrollo.score, valor: r.valor.score, afinidad: r.afinidad.score, calidad_tecnica: r.calidad_tecnica.score,
          reasons: Object.fromEntries((Object.keys(r) as (keyof typeof r)[]).map((k) => [k, r[k].text])), notes: s.notes, mode,
          relevance: Math.round(r.afinidad.score * 10), hook: Math.round(r.gancho.score * 10), standalone: Math.round(r.desarrollo.score * 10), closure: Math.round(r.calidad_tecnica.score * 10) } };
    });
    const reasons = Object.entries(dropCount).map(([k, n]) => `${n} ${n === 1 ? "momento" : "momentos"}: ${DROP_TEXT[k] ?? k}`);
    const sf = shortfall(gc.requested_count ?? gc.params.count ?? null, payload.length, reasons);
    if (sf) warnings.push(sf);
    if (aiWindows.startsWith("0/") && aiWindows !== "0/0" && MODES[mode].model) warnings.push({ code: "selector_fallback", message: "La IA no respondió; se usaron reglas de respaldo." });
    await ctx.rpc("save_selection", { p_generation: gen, p_candidates: payload, p_warnings: warnings, p_requested: gc.requested_count ?? gc.params.count ?? null });
    return { output: { delivered: payload.length, requested: gc.requested_count ?? gc.params.count ?? null, ai_windows: aiWindows, ...(secondPass ? { second_pass: secondPass } : {}), ...(topup ? { topup } : {}), ...(relaxed ? { relaxed } : {}), warnings: warnings.length },
      ...(payload.length === 0 ? { units_actual: 0 } : {}) };      // 0 útiles: se devuelve la selección; el análisis se mantiene
  },
};

export interface Group { start: number; end: number; text: string }
/** Traduce el texto de cada grupo de subtítulos conservando inicio y fin. Si la respuesta no es válida, se deja el original. */
export async function translateGroups(groups: Group[], lang: string, chat: (system: string, user: string) => Promise<string>): Promise<Group[]> {
  const out: Group[] = [];
  for (let i = 0; i < groups.length; i += 20) {
    const part = groups.slice(i, i + 20);
    const txt = await chat(`Traduce al idioma «${lang}» cada línea numerada. Responde SOLO con un JSON {"t":["…"]} con exactamente ${part.length} cadenas, en el mismo orden. No cambies nombres propios ni cifras.`, JSON.stringify(part.map((g) => g.text)));
    let t: string[] = []; try { const m = txt.match(/\{[\s\S]*\}/); t = (JSON.parse(m ? m[0] : txt) as { t: string[] }).t ?? []; } catch { t = []; }
    part.forEach((g, k) => out.push({ start: g.start, end: g.end, text: typeof t[k] === "string" && t.length === part.length ? t[k] : g.text }));
  }
  return out;
}
const translate: StageImpl = {
  inputs: (_c, row) => ({ stage: "translate", groups: row.params.groups, lang: row.params.target_language }),
  async run(ctx, row) {
    const groups = row.params.groups as Group[] | undefined, lang = String(row.params.target_language ?? "");
    if (!Array.isArray(groups) || !lang) throw new StageError("bad_params", "Faltan grupos o idioma");
    const cfg = aiConfig(ctx.env ?? process.env), deps = (ctx.deps ?? {}) as SelectDeps;
    const limiter = deps.limiter ?? new GroqLimiter(limitsFromEnv(ctx.env ?? process.env));
    const chat = deps.chat ?? (async (s: string, u: string) => { await limiter.wait("llm", Math.ceil(u.length / 4) + 400); return (await groqChat(cfg, { system: s, user: u, json: true, fetchImpl: ctx.fetch })).text; });
    const res = await translateGroups(groups, lang, chat);
    return { output: { groups: res, language: lang } };
  },
};

export const STAGE_IMPLS: Record<string, StageImpl> = { candidates, select, translate };
void (null as unknown as StageRow);
