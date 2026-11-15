# Comparación clip a clip · videoblog «CAP. 2 DE PROMO CON SAMUELIYO – TOLEDO» (1:28, 480p, poca voz)

Mismo pedido en ambas: «20 momentos de cualquier parte del vídeo». Opus: ClipAnything, Auto (<90 s), Let AI detect. Ráfaga: «Cualquier momento», 20 clips, plantilla a pantalla completa. Copia de 4 MB para subirla a Ráfaga (mismo audio y duración).

| | Opus | Ráfaga (tras las correcciones) |
|---|---|---|
| Clips entregados | **2** (sin avisar de que pidió 20) | **8** + aviso: «8 de los 8 son tramos repartidos…» y «pediste 20, hay 8» |
| Tiempo | ~4 min | ~2 min |
| Clip A | 0:38 · «Así se Vive una Presentación en un Estudio de TV» · 4 escenas con marca de tiempo (00:33–01:11) · titular en pantalla «ASÍ SE PREPARA UNA ACTUACIÓN EN TELEVISIÓN» | Tramos de 10–12 s a 0:00, 0:10, 0:20, 0:29, 0:39, 0:48, 0:59 y 1:10 |
| Clip B | «Así Se Graba Almas Gemelas: El Detrás de Cámaras en Toledo» · 2 escenas (00:00–00:28) | (mismo reparto; el inicio queda cubierto por el primer tramo) |
| Títulos | Gancho redactado por IA a partir de lo que se **ve** | Antes «Momento a los 0:10»; ahora de lo dicho en el tramo o «Escena a los m:ss» |
| Análisis de escena | Descripción visual por escena («el presentador gesticula ante la cámara…») | Solo lo dicho y el motivo de elección; **sin descripción visual** |
| Clip = varios fragmentos | Sí (el clip A une 4 escenas) | No: un clip es un tramo continuo |
| Titular sobre el vídeo | Sí, en caja blanca | Opcional (gancho automático), no activado por defecto |
| Notas | Sin nota visible en la lista | Nota 50 neutra a los repartidos |

## Qué falló en Ráfaga durante la prueba (arreglado)
1. **1 clip de 20:** el selector elegía un único tramo de ~80 s (máximo 3 min) y no dejaba hueco. Ahora, con número pedido, cada clip se acota a ≈1,5× lo que toca (mín. 15 s) y se reparte.
2. El modelo de transcripción de la generación seguía en `turbo`; ahora `large-v3` (la mejora de precisión ya aplica).
3. Un clip anterior gigante de otra generación bloqueaba el reparto de la siguiente: es el comportamiento previsto («no sobrescribir lo anterior»), pero para comparar hizo falta un proyecto limpio.

## Lo que Opus hace mejor y no replicamos aún
Descripción visual por escena y títulos de gancho a partir de la imagen (modelo de visión con coste), clips de varios fragmentos, titular sobre el vídeo por defecto.
Lo que Ráfaga hace mejor: respeta el número pedido hasta donde el vídeo permite y lo explica; es más rápida; no lleva marca de agua.
