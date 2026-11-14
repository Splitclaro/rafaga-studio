// «Estilos populares»: una galería de partida para la letra y los subtítulos, como la de LyricTune. Son estilos propios de Ráfaga (fuentes del catálogo
// con licencia abierta), no copias de los de ninguna referencia. Cada uno se aplica con el mismo motor de vista previa y exportación.
import { validateCaptionStyle, type BehaviourPresetId, type CaptionStyleV2 } from "@rafaga/composition";

export interface TrendingStyle { id: string; name: string; preset: BehaviourPresetId; style: CaptionStyleV2 }
const S = (patch: Record<string, unknown>) => validateCaptionStyle({ rafagaStyle: 2, ...patch });
const FRASE: BehaviourPresetId = "frase_palabra_activa", TYPE: BehaviourPresetId = "escritura_progresiva", SLIDE: BehaviourPresetId = "entrada_deslizada", WORD: BehaviourPresetId = "palabra_a_palabra";

export const TRENDING_STYLES: TrendingStyle[] = [
  { id: "brat", name: "brat", preset: FRASE, style: S({ font: "Inter", weight: 700, case: "lower", color: "#8ACE00", activeColor: "#FFFFFF", effect: "none", entrance: "pop", active: "color", size: "L" }) },
  { id: "type", name: "type", preset: TYPE, style: S({ font: "Space Mono", weight: 400, case: "asis", color: "#FFFFFF", activeColor: "#7DF9FF", effect: "none", entrance: "typewriter", active: "underline", size: "M" }) },
  { id: "phantom", name: "phantom", preset: FRASE, style: S({ font: "Bebas Neue", weight: 400, case: "upper", color: "#FFFFFF", activeColor: "#7DF9FF", effect: "glow", entrance: "fade", active: "color", size: "L", tracking: 0.08 }) },
  { id: "flip", name: "flip", preset: SLIDE, style: S({ font: "Anton", weight: 400, case: "upper", color: "#FFFFFF", activeColor: "#FFD400", effect: "shadow", entrance: "slide", active: "color", size: "L" }) },
  { id: "glitch", name: "glitch", preset: WORD, style: S({ font: "Space Mono", weight: 700, case: "upper", color: "#FFFFFF", activeColor: "#FF2D55", effect: "stroke", entrance: "pop", active: "scale", size: "M" }) },
  { id: "muse", name: "muse", preset: FRASE, style: S({ font: "Playfair Display", weight: 400, case: "asis", color: "#FFFFFF", activeColor: "#F5D0A9", effect: "shadow", entrance: "fade", active: "color", size: "M", italic: true }) },
  { id: "arcade", name: "arcade", preset: WORD, style: S({ font: "Righteous", weight: 400, case: "upper", color: "#FFE600", activeColor: "#FFFFFF", effect: "stroke", entrance: "pop", active: "scale", size: "L" }) },
  { id: "handtorn", name: "handtorn", preset: FRASE, style: S({ font: "Dancing Script", weight: 700, case: "asis", color: "#FFFFFF", activeColor: "#FFB3C7", effect: "shadow", entrance: "fade", active: "color", size: "L" }) },
  { id: "daydream", name: "daydream", preset: FRASE, style: S({ font: "Nunito", weight: 700, case: "lower", color: "#FFFFFF", activeColor: "#FFC8DD", effect: "glow", entrance: "fade", active: "color", size: "M", entranceMs: 600 }) },
  { id: "doodle", name: "doodle", preset: FRASE, style: S({ font: "Lobster", weight: 400, case: "asis", color: "#FFFFFF", activeColor: "#FFD400", effect: "stroke", entrance: "pop", active: "color", size: "L" }) },
  { id: "afterglow", name: "afterglow", preset: FRASE, style: S({ font: "Raleway", weight: 700, case: "asis", color: "#FFFFFF", activeColor: "#FF9E5E", effect: "glow", entrance: "fade", active: "color", size: "M", tracking: 0.04 }) },
  { id: "hollow", name: "hollow", preset: FRASE, style: S({ font: "Abril Fatface", weight: 400, case: "asis", color: "#FFFFFF", activeColor: "#FFFFFF", effect: "stroke", entrance: "fade", active: "scale", size: "L" }) },
  { id: "lofi", name: "lofi pop", preset: FRASE, style: S({ font: "Nunito", weight: 700, case: "lower", color: "#FFFFFF", activeColor: "#FFD400", effect: "box", entrance: "slide", active: "color", size: "M" }) },
  { id: "emo", name: "emo", preset: FRASE, style: S({ font: "Oswald", weight: 700, case: "lower", color: "#EDEDED", activeColor: "#E5173F", effect: "shadow", entrance: "fade", active: "color", size: "M", tracking: 0.02 }) },
  { id: "titlecard", name: "title card", preset: "texto_estatico" as BehaviourPresetId, style: S({ font: "Playfair Display", weight: 700, case: "upper", color: "#FFFFFF", activeColor: "#FFFFFF", effect: "none", entrance: "fade", active: "none", size: "L", position: { x: 0.5, y: 0.45 }, tracking: 0.1 }) },
];
