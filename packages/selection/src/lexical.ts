import { suggestTitle } from "./title.ts";
// Selector de respaldo SIN IA: coincidencia léxica con el brief, exclusiones explícitas y cortes en fin de frase.
// Se usa solo si el LLM no está disponible y se etiqueta como tal. No pretende entender el contenido.
import { type RawCandidate, type TWord } from "./index.ts";
import { interpretBrief, editorialCandidates } from "./editorial.ts";

export const LEXICAL_VERSION = "lexical-editorial-v1";   // la interfaz reconoce el prefijo «lexical» como selección sin IA
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
  // Criterio editorial determinista (sin IA): entiende el encargo, puntúa por contenido, decide entrada/salida y evita cortes repetidos.
  const intent = interpretBrief(brief);
  const minSec = intent.minSec ?? o.minSec, maxSec = Math.max(minSec + 1, intent.maxSec ?? o.maxSec), count = intent.count ?? o.count;
  return editorialCandidates(words, intent, { minSec, maxSec, count, briefText: brief }).map((c) => ({
    startWord: c.startWord, endWord: c.endWord, title: c.title, reason: c.reason, briefFit: c.briefFit, excluded: c.excluded, scores: c.scores,
  }));
}
