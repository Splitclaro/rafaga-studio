// Corrección de la transcripción: ortografía, tildes, mayúsculas, puntuación y palabras mal reconocidas por contexto, SIN cambiar el número
// de palabras ni sus tiempos (los subtítulos y los cortes dependen de ellos). Si la respuesta no es válida, se conserva el original.
import type { TWord } from "@rafaga/selection";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ]/g, "");
function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let prev = dp[0]; dp[0] = i; for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return dp[b.length];
}
/** ¿El token corregido sigue siendo «la misma palabra» (ortografía, tilde, mayúscula, homófono cercano)? */
export const plausibleFix = (orig: string, fixed: string): boolean => {
  if (!fixed || /\s/.test(fixed.trim())) return false;
  const a = norm(orig), b = norm(fixed); if (!a || !b) return !a && !b;
  return lev(a, b) / Math.max(a.length, b.length) <= 0.45;
};

const SYSTEM = `Eres un corrector de transcripciones automáticas de voz. Recibes una lista numerada de tokens (palabras tal como las oyó el reconocedor) y el contexto anterior.
Corrige en cada token: ortografía y tildes, mayúsculas (inicio de frase y nombres propios), signos de puntuación finales pegados al token (. , ? ! …) y palabras mal reconocidas cuando el contexto lo deja claro (homófonos o parecidas).
Reglas estrictas: devuelve EXACTAMENTE tantas cadenas como tokens, en el mismo orden; cada cadena es UNA sola palabra (sin espacios); no unas ni dividas tokens; no traduzcas; no resumas; no inventes lo que no se oye; si dudas, deja el token igual.
Responde SOLO con un JSON {"t":["…"]}.`;

export interface FixResult { words: TWord[]; changed: number; batches: number; failed: number }
export async function correctWords(words: TWord[], chat: (system: string, user: string) => Promise<string>, o: { batch?: number; concurrency?: number; language?: string | null } = {}): Promise<FixResult> {
  const size = o.batch ?? 120, out = words.map((w) => ({ ...w })); let changed = 0, failed = 0, next = 0;
  const starts = Array.from({ length: Math.ceil(words.length / size) }, (_, i) => i * size);
  const worker = async () => {
    while (next < starts.length) {
      const a = starts[next++], part = words.slice(a, a + size), ctx = words.slice(Math.max(0, a - 15), a).map((w) => w.text).join(" ");
      try {
        const txt = await chat(SYSTEM, JSON.stringify({ idioma: o.language ?? "auto", contexto_anterior: ctx, tokens: part.map((w) => w.text) }));
        const m = txt.match(/\{[\s\S]*\}/); const t = (JSON.parse(m ? m[0] : txt) as { t?: unknown }).t;
        if (!Array.isArray(t) || t.length !== part.length) { failed++; continue; }
        part.forEach((w, k) => { const f = typeof t[k] === "string" ? (t[k] as string).trim() : ""; if (f && f !== w.text && plausibleFix(w.text, f)) { out[a + k].text = f; changed++; } });
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 2, starts.length) }, worker));
  return { words: out, changed, batches: starts.length, failed };
}
