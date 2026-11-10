// Títulos sugeridos sin IA y fieles al contenido: solo palabras del propio fragmento (nunca se inventa texto).
// Elige la frase que mejor encaja con el enfoque del usuario, quita muletillas de arranque y recorta en un límite natural.
const FILLER_START = /^(?:bueno|pues|entonces|vale|mira|oye|o sea|así que|y|pero|e|ok|okay|nada|bien|well|so|and|but|okay|like|um|uh|yeah)(?:[\s,.:;-]+|$)/i;
const STOP_END = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "que", "y", "o", "en", "a", "con", "por", "para", "al", "se", "su", "sus", "mi", "mis", "lo", "me", "te", "es", "the", "of", "and", "to", "a", "an", "in", "on", "for", "with", "or", "but", "is", "my", "your", "that", "this", "demasiado", "muy", "más", "menos", "tan", "ya", "no", "también", "sin", "very", "too"]);
const BOUND = new Set(["antes", "después", "despues", "porque", "cuando", "para", "pero", "donde", "mientras", "hasta", "aunque", "sin", "cuando", "because", "when", "before", "after", "while", "but"]);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((x) => x.length > 2);
const tidy = (w: string) => w.replace(/^[¿¡"“«(]+/, "").replace(/[.,;:!?…"”»)]+$/, "");

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?…])\s+(?=[¿¡"“«(A-ZÁÉÍÓÚÑ0-9])|(?<=[.!?…])$/u).map((s) => s.trim()).filter(Boolean);
}

/** `maxWords` palabras como máximo; corta en coma/conjunción si hace falta y no termina en una palabra vacía. */
export function suggestTitle(text: string, brief?: string | null, maxWords = 10): string {
  const want = new Set(norm(brief ?? ""));
  const sents = splitSentences(text);
  if (!sents.length) return "";
  const scored = sents.map((raw, i) => {
    let s = raw; for (let k = 0; k < 3; k++) s = s.replace(FILLER_START, "");
    const ws = s.split(" ").filter(Boolean);
    const overlap = norm(s).filter((x) => want.has(x)).length;
    const len = ws.length;
    const score = overlap * 3 + (len >= 4 && len <= 12 ? 1.5 : len >= 3 ? 0.5 : -2) + (/[?¡!]|\d/.test(s) ? 0.8 : 0) - i * 0.15;
    return { s, ws, score };
  }).filter((x) => x.ws.length >= 2);
  const best = scored.sort((a, b) => b.score - a.score)[0];
  let ws = (best ?? { ws: sents[0].split(" ") }).ws;
  if (ws.length > maxWords) {
    // preferir el último corte natural dentro del límite: tras una coma o justo antes de una cláusula nueva
    let cut = -1;
    for (let c = 5; c <= maxWords; c++) if (/[,;:]$/.test(ws[c - 1]) || BOUND.has(tidy(ws[c] ?? "").toLowerCase())) cut = c;
    ws = ws.slice(0, cut > 0 ? cut : maxWords);
  }
  while (ws.length > 2 && STOP_END.has(tidy(ws[ws.length - 1]).toLowerCase())) ws = ws.slice(0, -1);
  const out = ws.map((w, i) => (i === ws.length - 1 ? tidy(w) : w.replace(/^[¿¡"“«(]+/, ""))).join(" ").replace(/\s+/g, " ").trim();
  // conservar la apertura de pregunta/exclamación si el título conserva su cierre
  const q = /\?$/.test(ws[ws.length - 1] ?? "") ? "?" : "";
  const cap = out.charAt(0).toLocaleUpperCase("es") + out.slice(1);
  return q && !cap.startsWith("¿") && /[¿]/.test(best?.s ?? "") ? `¿${cap}?` : cap;
}
