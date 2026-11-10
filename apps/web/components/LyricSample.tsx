"use client";
import { caseOf, fxOf, type SubtitleStyle } from "@rafaga/composition";

const kw = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * Muestra animada de una frase con un estilo, con las mismas reglas de modo que el render (aparecer / atenuar / color)
 * y una aproximación CSS del compositor (entrada, caja, palabras clave, tracking, cursiva, suavizado).
 * El export usa libass con las mismas reglas de palabra clave y los mismos parámetros; la curva exacta de la animación puede variar levemente.
 */
export default function LyricSample({ style, text, scale = 0.32, step }: { style: SubtitleStyle; text: string; scale?: number; step: number }) {
  const words = text.split(" ").filter(Boolean);
  const cycle = words.length + 2;
  const active = step % cycle;
  const round = Math.floor(step / cycle);
  const mode = style.highlight ?? "color";
  const fx = fxOf(style);
  const kws = new Set(fx.keywords.map(kw).filter(Boolean));
  const anim = fx.entry !== "none" && active <= 1 ? `fx-${fx.entry} ${fx.entryMs}ms ease-out both` : undefined;
  const box = fx.box;
  return (
    <p key={`${round}-${fx.entry}`} className="px-3 text-center leading-[1.15]" style={{
      fontFamily: `"${style.fontName}", ui-rounded, sans-serif`, fontWeight: style.bold === false ? 400 : 700, fontStyle: fx.italic ? "italic" : "normal", fontSize: style.fontSize * scale,
      letterSpacing: fx.spacing * scale, filter: fx.soften ? `blur(${fx.soften * scale * 0.6}px)` : undefined, animation: anim,
      WebkitTextStroke: !box && style.outlineWidth ? `${style.outlineWidth * scale * 2}px ${style.outline}` : undefined, paintOrder: "stroke fill",
      textShadow: !box && style.shadow ? `0 ${style.shadow * scale * 2}px ${style.shadow * scale * 3}px rgba(0,0,0,.55)` : "none",
      ...(box ? { background: `${box.color}${Math.round(box.opacity * 255).toString(16).padStart(2, "0")}`, padding: `${box.pad * scale}px ${box.pad * scale * 1.4}px`, borderRadius: 2, display: "inline-block" } : {}),
    }}>
      {words.map((w, i) => {
        const future = i > active, cur = i === active;
        const isKey = kws.has(kw(w)) || (fx.keywordsAuto && (/\d/.test(w) || kw(w).length >= 7));
        const color = cur ? style.active : isKey ? fx.keywordColor : style.primary;
        return <span key={i} style={{ color, opacity: future ? (mode === "reveal" ? 0 : mode === "dim" ? 0.4 : 1) : 1 }}>{caseOf(style, w)} </span>;
      })}
    </p>
  );
}
