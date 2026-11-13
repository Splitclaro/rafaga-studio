// Selección v2: ventanas con fallos, segunda pasada, pasada relajada, avisos, modos sin IA, clips anteriores y traducción.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { AiError } from "@rafaga/providers";
import { windows, type TWord, type RawCandidate } from "@rafaga/selection";
import { freshDb } from "../../../supabase/tests/migrate.ts";
import { pgliteCtx, fakeR2 } from "./fixtures.ts";
import { STAGE_IMPLS as SEL, highlightCandidates, translateGroups } from "./stages/select.ts";
import type { StageRow } from "./stages/registry.ts";

let db: PGlite, wsA: string, A: string;
before(async () => { ({ db, wsA, A } = await freshDb()); });

// ── Transcripts de esta prueba: bloques de 3 frases (≈14 s) separados por pausas largas (habla escasa) ──
const BLOCK = ["Hoy aprendemos cómo mejorar el sonido de nuestras grabaciones caseras.", "Primero conviene colocar el micrófono cerca de la boca y lejos del ruido.", "Por eso cada pequeño ajuste cambia mucho el resultado final."];
function longTranscript(blocks: number): TWord[] {
  const w: TWord[] = []; let t = 0;
  for (let b = 0; b < blocks; b++) { for (const s of BLOCK) { for (const x of s.split(" ")) { w.push({ text: x, start: +t.toFixed(2), end: +(t + 0.34).toFixed(2) }); t += 0.38; } t += 0.8; } t += 6; }
  return w;
}
const BW = BLOCK.join(" ").split(" ").length;      // palabras por bloque

async function setup(words: TWord[], params: Record<string, unknown> = {}, mode = "automatico", requested: number | null = 10) {
  const one = async (q: string) => (await db.query<{ id: string }>(q)).rows[0].id;
  const src = await one(`insert into sources(workspace_id, kind, status, created_by, duration_ms) values ('${wsA}','upload','validated','${A}', 3600000) returning id`);
  const proj = await one(`insert into projects(workspace_id, source_id, name, created_by) values ('${wsA}','${src}','S','${A}') returning id`);
  const tid = await one(`insert into transcripts(workspace_id, source_id, words) values ('${wsA}','${src}', '${JSON.stringify(words)}'::jsonb) returning id`);
  const ana = await one(`insert into analyses(workspace_id, source_id, version, range_end_ms, transcript_id, status) values ('${wsA}','${src}',1,3600000,'${tid}','done') returning id`);
  const p = { min_s: 10, max_s: 30, count: requested, ...params };
  const gen = await one(`insert into generations(workspace_id, project_id, transcript_id, rubric_version, model, params, analysis_id, mode, requested_count) values ('${wsA}','${proj}','${tid}','r2','m','${JSON.stringify(p)}'::jsonb,'${ana}','${mode}', ${requested ?? "null"}) returning id`);
  return { src, proj, tid, ana, gen };
}
const row = (stage: string, gen: string): StageRow => ({ id: "s", workspace_id: wsA, job_id: "j", stage: stage as never, seq: 1, attempts: 1, params: { generation_id: gen }, units: 2, worker_id: "w" });
const mk = (deps: Record<string, unknown>) => { const f = fakeR2(); return { ctx: pgliteCtx(db, { r2: f.r2, tmpDir: mkdtempSync(join(tmpdir(), "rafaga-sel-")), env: {}, deps }) }; };

/** Groq simulado: devuelve bloques completos; la primera pasada da pocos por ventana y la segunda (con «Ya están elegidos») da muchos. */
function fakePropose(o: { failWindow?: number; firstPassMax?: number } = {}) {
  const calls: { brief: string; first: number }[] = []; let seen = 0; const failed = new Set<string>();
  const fn = async (a: { brief: string; windowText: string; target: string; want: number }): Promise<RawCandidate[]> => {
    const idx = [...a.windowText.matchAll(/\[(\d+)\]/g)].map((m) => +m[1]); const first = idx[0], last = idx.at(-1)!;
    calls.push({ brief: a.brief, first }); seen++;
    const second = a.brief.includes("Ya están elegidos");
    if (!second && o.failWindow != null && first >= o.failWindow && !failed.has(String(first)) && failed.size === 0) { failed.add(String(first)); throw new AiError(400, 'Groq chat 400: {"error":{"code":"json_validate_failed"}}'); }
    const taken = [...a.brief.matchAll(/\[(\d+)\]–\[(\d+)\]/g)].map((m) => [+m[1], +m[2]]);
    const out: RawCandidate[] = []; const maxN = second ? a.want : (o.firstPassMax ?? a.want);
    for (let s = Math.ceil(first / BW) * BW; s + BW - 1 <= last && out.length < maxN; s += BW) {
      if (taken.some(([x, y]) => s <= y && s + BW - 1 >= x)) continue;
      out.push({ startWord: s, endWord: s + BW - 1, title: `Bloque ${s / BW}`, reason: "Explica cómo mejorar el sonido de las grabaciones.", briefFit: "", scores: { relevance: 7, hook: 6, standalone: 7, closure: 8 } });
      s += BW * 2;   // espaciados: no se solapan entre sí
    }
    return out;
  };
  return { fn, calls, get n() { return seen; } };
}

test("1 ventana de 3 falla con 400 json_validate_failed: se procesan las otras 2, segunda pasada con rangos excluidos, y se entregan los 10", async () => {
  const words = longTranscript(110), nWin = windows(words, 600, 45).length;
  assert.ok(nWin >= 3, `ventanas ${nWin}`);
  const g = await setup(words);
  const p = fakePropose({ failWindow: 1, firstPassMax: 2 });
  const { ctx } = mk({ propose: p.fn });
  const c = (await SEL.candidates.run(ctx, row("candidates", g.gen))).output as { ai_windows: string };
  assert.equal(c.ai_windows, `${nWin - 1}/${nWin}`);
  const s = (await SEL.select.run(ctx, row("select", g.gen))).output as { delivered: number; second_pass?: number; relaxed?: string; warnings: number };
  assert.equal(s.delivered, 10); assert.ok((s.second_pass ?? 0) > 0, "segunda pasada"); assert.equal(s.relaxed, undefined);
  assert.ok(p.calls.some((x) => x.brief.includes("Ya están elegidos") && /\[\d+\]–\[\d+\]/.test(x.brief)), "pide momentos nuevos con los rangos ya elegidos excluidos");
  const gen = (await db.query<{ delivered_count: number; warnings: unknown[] }>(`select delivered_count, warnings from generations where id='${g.gen}'`)).rows[0];
  assert.equal(gen.delivered_count, 10);
  const clips = (await db.query<{ technical_state: string }>(`select technical_state from clips where generation_id='${g.gen}'`)).rows;
  assert.equal(clips.length, 10); assert.ok(clips.every((x) => x.technical_state === "preparando"));
  const reasons = (await db.query<{ reason: string; scores: { overall: number; gancho: number } }>(`select reason, scores from clip_candidates where generation_id='${g.gen}'`)).rows;
  assert.ok(reasons.every((r) => !/viral/i.test(r.reason) && r.scores.overall >= 0 && r.scores.overall <= 100 && r.scores.gancho >= 0));
});

test("criterio 8: se piden 10 y el tramo solo da para pocos → se entregan menos, con delivered_count y aviso shortfall explicado", async () => {
  const g = await setup(longTranscript(2));
  const p = fakePropose(); const { ctx } = mk({ propose: p.fn });
  await SEL.candidates.run(ctx, row("candidates", g.gen));
  const out = (await SEL.select.run(ctx, row("select", g.gen))).output as { delivered: number };
  assert.ok(out.delivered >= 1 && out.delivered < 10, `entregados ${out.delivered}`);
  const gen = (await db.query<{ delivered_count: number; warnings: { code: string; requested: number; delivered: number; reasons: string[] }[] }>(`select delivered_count, warnings from generations where id='${g.gen}'`)).rows[0];
  assert.equal(gen.delivered_count, out.delivered);
  const w = gen.warnings.find((x) => x.code === "shortfall")!;
  assert.equal(w.requested, 10); assert.equal(w.delivered, out.delivered); assert.ok(Array.isArray(w.reasons));
});

test("sin momentos completos de la duración pedida pero con habla: pasada relajada anotada en el motivo", async () => {
  const words: TWord[] = Array.from({ length: 50 }, (_, i) => ({ text: i % 10 === 9 ? `palabra${i}.` : `palabra${i}`, start: +(i * 0.32).toFixed(2), end: +(i * 0.32 + 0.3).toFixed(2) }));   // ≈16 s de habla: menos que el mínimo pedido (30 s), más que el relajado (15 s)
  const g = await setup(words, { min_s: 30, max_s: 60 }, "automatico", 3);
  const { ctx } = mk({ propose: async () => [] });
  await SEL.candidates.run(ctx, row("candidates", g.gen));
  const r = await SEL.select.run(ctx, row("select", g.gen));
  const out = r.output as { delivered: number; relaxed?: string };
  assert.ok(out.delivered >= 1, "con habla no se entrega 0"); assert.equal(out.relaxed, "15-90");
  const reason = (await db.query<{ reason: string }>(`select reason from clip_candidates where generation_id='${g.gen}' limit 1`)).rows[0].reason;
  assert.match(reason, /duración ajustada/);
});

test("nunca 0 en silencio: sin nada utilizable → aviso no_moments con motivos y se libera la selección (units_actual 0)", async () => {
  const words: TWord[] = Array.from({ length: 22 }, (_, i) => ({ text: `w${i}`, start: +(i * 0.05).toFixed(2), end: +(i * 0.05 + 0.04).toFixed(2) }));   // ≈1 s
  const g = await setup(words, { min_s: 30, max_s: 60 }, "automatico", 3);
  const { ctx } = mk({ propose: async () => [] });
  await SEL.candidates.run(ctx, row("candidates", g.gen));
  const r = await SEL.select.run(ctx, row("select", g.gen));
  assert.equal((r.output as { delivered: number }).delivered, 0); assert.equal(r.units_actual, 0);
  const w = (await db.query<{ warnings: { code: string; reasons: string[] }[]; delivered_count: number }>(`select warnings, delivered_count from generations where id='${g.gen}'`)).rows[0];
  assert.equal(w.delivered_count, 0); assert.equal(w.warnings[0].code, "no_moments"); assert.ok(Array.isArray(w.warnings[0].reasons));
});

test("destacados y manual: 0 llamadas al LLM; destacados se centra en picos y escenas; exclude_previous evita solapes con clips anteriores", async () => {
  const words = longTranscript(12);
  const peaks = [{ t: 20, kind: "energy_rise", score: 0.9 }, { t: 150, kind: "energy_rise", score: 0.8 }, { t: 290, kind: "energy_rise", score: 0.7 }];
  const direct = highlightCandidates(words, peaks, [75, 210], 10, 30, 5);
  assert.ok(direct.length >= 3); assert.ok(direct.every((c) => words[c.endWord].end - words[c.startWord].start >= 10));
  const calls = { n: 0 }; const spy = async () => { calls.n++; return [] as RawCandidate[]; };
  const g = await setup(words, { count: 3 }, "destacados", 3);
  await db.exec(`update analyses set audio_signals='${JSON.stringify(peaks)}'::jsonb, scenes='[75,210]'::jsonb where id='${g.ana}'`);
  const { ctx } = mk({ propose: spy });
  await SEL.candidates.run(ctx, row("candidates", g.gen)); const out = (await SEL.select.run(ctx, row("select", g.gen))).output as { delivered: number };
  assert.equal(calls.n, 0); assert.ok(out.delivered >= 1);
  const gm = await setup(words, {}, "manual", null); const mm = mk({ propose: spy });
  await SEL.candidates.run(mm.ctx, row("candidates", gm.gen)); const mo = (await SEL.select.run(mm.ctx, row("select", gm.gen))).output as { delivered: number; manual?: boolean };
  assert.equal(calls.n, 0); assert.equal(mo.delivered, 0); assert.equal(mo.manual, true);
  // clips anteriores del mismo proyecto
  const first = (await db.query<{ start_ms: number; end_ms: number }>(`select start_ms, end_ms from clip_candidates where generation_id='${g.gen}' order by start_ms limit 1`)).rows[0];
  const g2 = await setup(words, { count: 3 }, "destacados", 3);
  await db.exec(`update generations set project_id='${g.proj}' where id='${g2.gen}'`);
  await db.exec(`update analyses set audio_signals='${JSON.stringify(peaks)}'::jsonb, scenes='[75,210]'::jsonb where id='${g2.ana}'`);
  const c2 = mk({ propose: spy });
  await SEL.candidates.run(c2.ctx, row("candidates", g2.gen)); await SEL.select.run(c2.ctx, row("select", g2.gen));
  const next = (await db.query<{ start_ms: number; end_ms: number }>(`select start_ms, end_ms from clip_candidates where generation_id='${g2.gen}'`)).rows;
  for (const n of next) assert.ok(n.end_ms <= first.start_ms || n.start_ms >= first.end_ms || true);
  const prevAll = (await db.query<{ start_ms: number; end_ms: number }>(`select start_ms, end_ms from clip_candidates where generation_id='${g.gen}'`)).rows;
  for (const n of next) for (const p of prevAll) assert.ok(Math.min(n.end_ms, p.end_ms) - Math.max(n.start_ms, p.start_ms) <= 0, "no se solapa con un clip anterior");
});

test("translate conserva el inicio y el fin de cada grupo de subtítulos", async () => {
  const groups = Array.from({ length: 25 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Frase ${i}` }));
  const chat = async (_s: string, u: string) => JSON.stringify({ t: (JSON.parse(u) as string[]).map((x) => `${x} (en)`) });
  const out = await translateGroups(groups, "en", chat);
  assert.equal(out.length, 25);
  assert.ok(out.every((g, i) => g.start === groups[i].start && g.end === groups[i].end && g.text === `Frase ${i} (en)`));
  const broken = await translateGroups(groups.slice(0, 3), "en", async () => "no es json");
  assert.deepEqual(broken, groups.slice(0, 3), "si la respuesta no es válida se conserva el original");
});
