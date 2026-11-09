// Selector de respaldo SIN IA: coincidencia léxica con el brief, exclusiones explícitas y cortes en fin de frase.
// Se usa solo si el LLM no está disponible y se etiqueta como tal. No pretende entender el contenido.
import { isSentenceEnd, type RawCandidate, type TWord } from "./index.ts";

export const LEXICAL_VERSION = "lexical-v1";
const STOP = new Set("a al algo como con de del el ella ellas ellos en entre es esa ese eso esta este esto estos la las le les lo los me mi mis muy no nos o para pero por que quiero se sin sobre su sus te tu un una uno unos y ya clips clip video vídeo momentos parte quiero necesito the a an and of to in for on with is are this that i want".split(" "));
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ");
const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);
const terms = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/** Separa el brief en términos deseados y exclusiones («evita/excluye/sin/no incluyas …» hasta el punto). */
export function parseBrief(brief: string | null) {
  const b = brief ?? "";
  const excl: string[] = [];
  const rest = b.replace(/(?:evita|evitar|excluye|excluir|sin incluir|no incluyas|avoid|exclude)\s+([^.;\n]+)/gi, (_m, g: string) => { excl.push(...terms(g)); return " "; });
  return { want: [...new Set(terms(rest))], exclude: [...new Set(excl)] };
}

export function lexicalCandidates(words: TWord[], brief: string | null, o: { minSec: number; maxSec: number; count: number }): RawCandidate[] {
  // Frases (índices inclusivos)
  const sents: { from: number; to: number }[] = [];
  let from = 0;
  words.forEach((w, i) => { if (isSentenceEnd(w.text) || i === words.length - 1) { sents.push({ from, to: i }); from = i + 1; } });
  const { want, exclude } = parseBrief(brief);
  const stemsOf = (a: number, b: number) => words.slice(a, b + 1).flatMap((w) => terms(w.text));
  const out: (RawCandidate & { _s: number })[] = [];
  for (let s = 0; s < sents.length; s++) {
    for (let e = s; e < sents.length; e++) {
      const a = sents[s].from, b = sents[e].to, dur = words[b].end - words[a].start;
      if (dur > o.maxSec) break;
      if (dur < o.minSec) continue;
      const st = stemsOf(a, b);
      const hitsExcl = exclude.filter((x) => st.includes(x)).length;
      const hits = want.filter((x) => st.includes(x)).length;
      // Densidad: proporción de palabras del fragmento que pertenecen al enfoque (evita premiar ventanas largas).
      const density = st.length ? st.filter((x) => want.includes(x)).length / st.length : 0;
      const firstSent = words.slice(a, sents[s].to + 1).map((w) => w.text).join(" ");
      const startsOnTopic = want.some((x) => terms(firstSent).includes(x));
      const rel = want.length ? Math.min(10, 10 * (0.4 * (hits / Math.min(want.length, 6)) + 0.6 * Math.min(1, 5 * density)) + (startsOnTopic ? 1 : 0)) : 5;
      const hook = /[?¡!]|\d/.test(firstSent) ? 7 : 5;
      const scores = { relevance: Math.round(rel * 10) / 10, hook, standalone: 6, closure: 7 };
      out.push({ startWord: a, endWord: b, title: firstSent.split(" ").slice(0, 8).join(" ").replace(/[.,;:]$/, ""),
        reason: "Selección por coincidencia de palabras (sin IA)", briefFit: want.length ? `Coinciden ${hits} término(s) del enfoque` : "Sin enfoque: fragmento autónomo",
        excluded: hitsExcl > 0, scores, _s: rel + hook / 10 });
    }
  }
  const useful = out.filter((c) => !c.excluded && (!want.length || c.scores.relevance > 0));
  return useful.sort((x, y) => y._s - x._s).slice(0, o.count * 4).map(({ _s, ...c }) => c);
}
