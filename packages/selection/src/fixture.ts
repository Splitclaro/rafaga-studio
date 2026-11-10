// Entrevista de prueba (consejos, vida privada, anécdota con giro, pregunta/respuesta, patrocinador). Compartida por las pruebas y el demo editorial.
import type { TWord } from "./index.ts";

export /** Construye un transcript con tiempos: 0,35 s por palabra y 0,5 s entre frases. */
function buildTranscript(sents: string[]): TWord[] { const out: TWord[] = []; let t = 0; for (const s of sents) { for (const w of s.split(" ")) { out.push({ text: w, start: +t.toFixed(2), end: +(t + 0.33).toFixed(2) }); t += 0.38; } t += 0.5; } return out; }

export const INTERVIEW = [
  // 0-5 consejos
  "Hoy hablamos de cómo grabar tu primera canción en casa sin gastar demasiado.",
  "Lo primero que tienes que hacer es grabar siempre la voz con un buen micrófono.",
  "Esto es clave porque el ruido de fondo no se puede arreglar después en la mezcla.",
  "Mi consejo para principiantes es terminar una sola canción antes de pensar en un álbum.",
  "Nunca empieces por el disco entero porque te quedarás sin energía a la mitad.",
  "Y el último truco es guardar siempre una copia de seguridad de cada sesión.",
  // 6-11 vida privada
  "Hablando de otra cosa, mi vida privada es bastante complicada estos días.",
  "Mi pareja y yo discutimos mucho por el dinero y por la casa nueva.",
  "La verdad es que casi no hablo de mi familia en las entrevistas.",
  "Mi madre se mudó el año pasado y desde entonces todo cambió en casa.",
  // 10-15 anécdota con giro
  "Un día llegué al estudio sin la guitarra y no sabía qué hacer.",
  "Resulta que el técnico la había guardado en su coche por un malentendido.",
  "De repente se fue la luz y tuvimos que grabar todo con el teléfono móvil.",
  "Nadie esperaba nada de aquella toma improvisada y pequeña.",
  "Al final esa toma fue la que acabó en el disco y la que más escucha la gente.",
  // 15-18 pregunta y respuesta
  "¿Cómo conseguiste el sonido de batería del estribillo?",
  "Pues grabé la batería en un pasillo vacío con un solo micrófono colgado del techo.",
  "Decidí vender mi coche para pagar el primer disco entero.",
  "Eso fue lo que lo cambió todo porque ya no había vuelta atrás.",
  // 19-21 patrocinador
  "Ahora una pausa para el patrocinador de este episodio, una marca de café de especialidad.",
  "Usa el código del programa para conseguir un descuento en tu primera compra.",
  "Volvemos con la conversación después de este mensaje corto.",
];
