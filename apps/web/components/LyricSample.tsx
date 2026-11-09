"use client";
import { caseOf, type SubtitleStyle } from "@rafaga/composition";

/** Muestra animada de una frase con un estilo, con las mismas reglas de modo que el render (aparecer / atenuar / color). */
export default function LyricSample({ style, text, scale = 0.32, step }: { style: SubtitleStyle; text: string; scale?: number; step: number }) {
  const words = text.split(" ").filter(Boolean);
  const active = step % (words.length + 2);
  const mode = style.highlight ?? "color";
  return (
    <p className="px-3 text-center leading-[1.15]" style={{ fontFamily: `"${style.fontName}", ui-rounded, sans-serif`, fontWeight: style.bold === false ? 400 : 700, fontSize: style.fontSize * scale,
      WebkitTextStroke: style.outlineWidth ? `${style.outlineWidth * scale * 2}px ${style.outline}` : undefined, paintOrder: "stroke fill", textShadow: style.shadow ? `0 ${style.shadow * scale * 2}px ${style.shadow * scale * 3}px rgba(0,0,0,.55)` : "none" }}>
      {words.map((w, i) => {
        const future = i > active, cur = i === active;
        return <span key={i} style={{ color: cur ? style.active : style.primary, opacity: future ? (mode === "reveal" ? 0 : mode === "dim" ? 0.4 : 1) : 1 }}>{caseOf(style, w)} </span>;
      })}
    </p>
  );
}
