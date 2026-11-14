// Notas en letra de las cuatro señales de un clip (como las subnotas de OpusClip). Entrada 0–10. Es una estimación de la IA, no una garantía.
const BANDS: [number, string][] = [[9.5, "A+"], [9, "A"], [8.5, "A-"], [8, "B+"], [7.5, "B"], [7, "B-"], [6, "C+"], [5, "C"], [4, "C-"], [0, "D"]];
export const gradeOf = (v: number): string => (BANDS.find(([min]) => v >= min) ?? BANDS[BANDS.length - 1])[1];
