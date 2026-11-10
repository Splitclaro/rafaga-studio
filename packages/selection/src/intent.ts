// Interpretación del encargo en lenguaje natural. Módulo PURO (sin dependencias de Node): sirve en el navegador y en el worker.
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ");
export const STOP = new Set("a al algo como con de del el ella ellas ellos en entre es esa ese eso esta este esto estos la las le les lo los me mi mis muy no nos o para pero por que quiero se sin sobre su sus te tu un una uno unos y ya clips clip cortes corte momentos momento quiero quieres busca buscar prioriza priorizar gente personas cada cuando donde cual hablar habla hablan hable hablen hablando mencionar mencione tratar trate salir salga aparecer aparezca incluir incluya contar cuente deja dejes escuche escuchar escuchen remate evita evitar excluye excluir".split(" "));
export const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);
export const contentTerms = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

export type Kind = "tips" | "stories" | "reactions" | "demo" | "opinion" | "qa";
// Léxico por tipo de contenido (señales observables en el transcript; no entienden el significado)
export const KIND_LEX: Record<Kind, RegExp> = {
  tips: /\b(consejo|consejos|truco|trucos|tip|tips|recomiendo|recomendaci[oó]n|tienes que|debes|deber[ií]as|lo primero|lo segundo|paso|clave|importante|siempre|nunca|evita|aprende|empieza por|error)\b/i,
  stories: /\b(un d[ií]a|recuerdo|hace (\w+ )?(a[nñ]os|meses|tiempo)|resulta que|de repente|al final|sucedi[oó]|pas[oó]|fue cuando|me dijo|no sab[ií]a|sorpresa|historia|an[eé]cdota|cuando [a-z]+ (era|tenia|tenía|estaba))\b/i,
  reactions: /\b(jaja+|risas|aplausos|ovaci[oó]n|incre[ií]ble|wow|no me lo puedo creer|gritos|p[uú]blico|la gente)\b/i,
  demo: /\b(mira|mirad|f[ií]jate|aqu[ií]|como ves|como veis|resultado|ahora|as[ií] queda|lo que (hago|hacemos)|vamos a ver)\b/i,
  opinion: /\b(creo que|pienso que|opino|para m[ií]|mentira|nadie|todos|siempre se dice|el problema es|me parece|postura|pol[eé]mic)\b/i,
  qa: /\?\s*$/,
};
export const KIND_WORDS: [Kind, RegExp][] = [
  ["tips", /consej|truc|\btips?\b|recomend|paso a paso|c[oó]mo (hacer|empezar|mejorar)|aprend|gu[ií]a/i],
  ["stories", /historia|an[eé]cdota|cuent|relato|giro|sorprend|detr[aá]s de/i],
  ["reactions", /reacci|p[uú]blico|risas|aplaus|gritos|ovaci/i],
  ["demo", /demostr|mostrar|ver c[oó]mo|resultado|tutorial|en pantalla/i],
  ["opinion", /opini|pol[eé]mic|contundente|postura|cr[ií]tica/i],
  ["qa", /pregunta|respuesta|responde|entrevista/i],
];
export const NUM: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20 };
const SEG = "(?:segundos|segs?|s)\\b";

export interface Intent {
  raw: string; count?: number; minSec?: number; maxSec?: number; audience?: string; tone?: string;
  kinds: Kind[]; focus: string[]; must: string[]; exclude: string[]; soft: { term: string; weight: number }[];
  wantsPayoff: boolean; wantsQuestion: boolean; clarify?: string; notes: string[];
}

const cut = (s: string) => s.split(/[.;\n]/)[0].trim();
/** El objeto de «evita/prioriza…» termina donde empieza otra indicación («, y deja que…», «pero…»), no al final de la frase. */
const CLAUSE_END = /\s*(?:,|;|\s+y\s+(?=(?:deja|dejes|prioriza|busca|quiero|incluye|haz|pon|usa|mant[eé]n|que\s|con\s|solo|adem[aá]s|tambi[eé]n)\b)|\s+pero\s|\s+aunque\s)/i;
const clause = (g: string) => g.split(CLAUSE_END)[0];
/** Interpreta el encargo. Obligatorio = «excluye/evita/sin/debe incluir…»; preferencia = «prioriza/prefiero/menos…». */
export function interpretBrief(text: string | null | undefined): Intent {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  const t = raw;
  const it: Intent = { raw, kinds: [], focus: [], must: [], exclude: [], soft: [], wantsPayoff: false, wantsQuestion: false, notes: [] };
  if (!raw) return it;
  // cantidad
  const cm = t.match(new RegExp(`\\b(\\d{1,3}|${Object.keys(NUM).join("|")})\\s+(?:mejores\\s+)?(?:cortes|clips|momentos|fragmentos|piezas|v[ií]deos|shorts|reels)\\b`, "i"));
  if (cm) { const n = /^\d/.test(cm[1]) ? Number(cm[1]) : NUM[cm[1].toLowerCase()]; if (n >= 1 && n <= 100) it.count = n; }
  // duración
  const range = t.match(new RegExp(`(?:de|entre)\\s+(\\d{1,3})\\s*(?:a|y|-|–)\\s*(\\d{1,3})\\s*${SEG}`, "i"));
  if (range) { it.minSec = Number(range[1]); it.maxSec = Number(range[2]); }
  else {
    const mx = t.match(new RegExp(`(?:m[aá]ximo|hasta|no m[aá]s de|menos de)\\s+(\\d{1,3})\\s*${SEG}`, "i")); if (mx) it.maxSec = Number(mx[1]);
    const mn = t.match(new RegExp(`(?:m[ií]nimo|al menos|no menos de|m[aá]s de)\\s+(\\d{1,3})\\s*${SEG}`, "i")); if (mn) it.minSec = Number(mn[1]);
    if (/menos de (un|1) minuto/i.test(t)) it.maxSec = it.maxSec ?? 60;
    const one = t.match(/\bde (un|1) minuto\b/i); if (one && !it.maxSec) { it.minSec = 45; it.maxSec = 70; }
  }
  // público y tono
  const au = t.match(/\bpara\s+((?:gente|personas|quien(?:es)?|p[uú]blico|oyentes|audiencia|principiantes|novatos|fans|seguidores|alguien)[^,.;\n]*)/i); if (au) it.audience = cut(au[1]).slice(0, 120);
  const tone = t.match(/\btono\s+(\w+)|\b(divertid[oa]s?|emotiv[oa]s?|serio|cercano|profesional|inspirador)\b/i); if (tone) it.tone = (tone[1] ?? tone[2]).toLowerCase();
  // exclusiones OBLIGATORIAS
  t.replace(/\b(?:evita(?:r)?|excluye|excluir|sin incluir|no incluyas|no quiero(?: que (?:salga|aparezca|se hable de))?|nada de|que no (?:hable|hablen|aparezca|incluya)(?: de| sobre)?)\s+([^.;\n]+)/gi, (_m, g: string) => { it.exclude.push(...contentTerms(clause(g))); return ""; });
  // «debe incluir / tiene que aparecer»: OBLIGATORIO
  t.replace(/\b(?:debe(?:n)? (?:incluir|aparecer|mencionar)|tiene(?:n)? que (?:incluir|aparecer|mencionar)|incluye(?: siempre)?|que aparezca|con la participaci[oó]n de)\s+([^.;\n]+)/gi, (_m, g: string) => { it.must.push(...contentTerms(clause(g))); return ""; });
  // «menos X»: preferencia negativa
  t.replace(/\bmenos\s+([^.;,\n]+)/gi, (_m, g: string) => { for (const w of contentTerms(clause(g))) it.soft.push({ term: w, weight: -1 }); return ""; });
  // preferencias positivas
  t.replace(/\b(?:prioriza(?:r)?|prefiero|prefiere|mejor si|busca(?:r)?|enf[oó]cate en|centrad[oa]s? en|que hablen de|sobre)\s+([^.;\n]+)/gi, (_m, g: string) => { it.focus.push(...contentTerms(clause(g))); return ""; });
  const rest = t.replace(/\b(?:evita(?:r)?|excluye|excluir|sin incluir|no incluyas|nada de)\s+[^.;\n]+/gi, " ");
  if (!it.focus.length) it.focus.push(...contentTerms(rest).filter((w) => !it.exclude.includes(w)).slice(0, 8));
  it.focus = [...new Set(it.focus)].filter((w) => !it.exclude.includes(w)); it.exclude = [...new Set(it.exclude)]; it.must = [...new Set(it.must)];
  for (const [k, re] of KIND_WORDS) if (re.test(rest)) it.kinds.push(k);
  it.wantsPayoff = /\b(remate|desenlace|cierre|se escuche el final|final de cada|punchline|resultado final)\b/i.test(t);
  it.wantsQuestion = /\bincluye la pregunta|con la pregunta|con su pregunta\b/i.test(t);
  // aclaración solo si cambia mucho la selección
  if (it.minSec != null && it.maxSec != null && it.minSec > it.maxSec) it.clarify = `Has indicado un mínimo (${it.minSec} s) mayor que el máximo (${it.maxSec} s). ¿Qué duración quieres para cada corte?`;
  const clash = it.must.filter((x) => it.exclude.includes(x)); if (!it.clarify && clash.length) it.clarify = `Pides incluir y excluir lo mismo («${clash[0]}»). ¿Cuál de las dos prevalece?`;
  if (it.count) it.notes.push(`${it.count} cortes pedidos`); if (it.exclude.length) it.notes.push("exclusiones obligatorias"); if (it.soft.length) it.notes.push("preferencias suaves");
  return it;
}

// ───────── instrucciones sobre resultados ─────────
export type Directive =
  | { scope: "clip"; action: "include_question" | "extend" | "shorten"; note: string }
  | { scope: "search"; action: "more_like" | "less"; terms: string[]; note: string }
  | { scope: "search"; action: "only_kind"; kind: Kind; note: string }
  | { scope: "search"; action: "variants"; count: number; note: string };
/** Interpreta «más como este», «menos polémica», «incluye la pregunta», «busca solo reacciones», «haz cinco variantes». */
export function parseDirective(s: string): Directive | null {
  const t = s.trim();
  if (/\bincluye la pregunta|con la pregunta\b/i.test(t)) return { scope: "clip", action: "include_question", note: "Ajusta el inicio de este corte para que incluya la pregunta." };
  if (/\bm[aá]s (largo|extenso)|alarga|ampl[ií]a\b/i.test(t)) return { scope: "clip", action: "extend", note: "Alarga este corte." };
  if (/\bm[aá]s corto|acorta|recorta\b/i.test(t)) return { scope: "clip", action: "shorten", note: "Acorta este corte." };
  const v = t.match(/\bhaz\s+(\w+)\s+variantes\b/i); if (v) { const n = /^\d+$/.test(v[1]) ? Number(v[1]) : NUM[v[1].toLowerCase()]; if (n) return { scope: "search", action: "variants", count: n, note: `Genera ${n} variantes manteniendo el intervalo.` }; }
  const only = t.match(/\bbusca solo\s+(.+)/i); if (only) for (const [k, re] of KIND_WORDS) if (re.test(only[1])) return { scope: "search", action: "only_kind", kind: k, note: `Busca nuevos momentos de tipo «${only[1].trim()}».` };
  if (/\bm[aá]s como (este|esta|ese|esa)\b/i.test(t)) return { scope: "search", action: "more_like", terms: [], note: "Busca momentos parecidos a este." };
  const less = t.match(/\bmenos\s+(.+)/i); if (less) return { scope: "search", action: "less", terms: contentTerms(less[1]), note: `Rebaja los momentos con «${less[1].trim()}».` };
  return null;
}

