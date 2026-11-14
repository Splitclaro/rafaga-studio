# Recon · OpusClip (clip.opus.pro) — 2026-11-14

Solo lectura, con la cuenta del propietario, sin crear proyectos ni gastar créditos. Fuentes: panel (`/dashboard`) y el proyecto de demostración (`/clip/demo-danny`). Ni código, ni logos, ni medios de la referencia se copian: solo funciones y patrones de uso.

## Pantallas observadas
| ID | Pantalla | Qué hay | Estado en Ráfaga |
|---|---|---|---|
| S01 | Inicio | Tres entradas (Clip long video · Auto-edit footage · Open editor), subir / Drive, «probar proyecto de muestra», Recipes (Clean up, Auto-edit, Captions, Reframe, Upscale, Social edits, AI B-roll, Translate & dub), proyectos demo con nº de clips | ✅ Inicio con recetas, subida, Drive/Dropbox y demos |
| S02 | Proyecto (resultados) | Título = el encargo («Give me highlight compilations…»), nº de clips, cuadrícula/lista, buscar palabras o momentos, filtro, orden | ✅ cuadrícula/lista, búsqueda, filtro y «Mayor encaje» |
| S03 | Tarjeta de clip | Vídeo vertical con reproducción al pasar, puntuación grande (99, 96…), título, duración, favorito y no-me-gusta, programar (calendario), descargar | 🟡 puntuación (encaje 0–10 con desglose), favorito, descarga, programar; **sin «no me gusta»** como señal explícita |
| S04 | Navegación | Crear: Home · My projects · Brand kit · Asset library. Publicar: Calendar · Analytics · Social accounts. Opus Labs · API · Learning · Help. Créditos arriba, invitar miembros | ✅ Inicio · Proyectos · Brand kit · Biblioteca · Calendario · Analítica · Conexiones · Uso · Invitar |

## Flujo principal (F01)
Subir/URL → elegir receta y encargo en lenguaje natural → procesar → rejilla de clips ordenada por puntuación → abrir clip → editar (subtítulos, encuadre, plantilla) → programar o descargar. Clics en el camino feliz: 4 hasta ver clips. En Ráfaga: subir → Crear → resultados (3 clics).

## Lo que NO se puede clonar
Los créditos y planes de pago, «OpusClip 4.0 / AI Producer» (editor conversacional propietario), la marca de agua, el ranking con datos de su red, los vídeos de demostración de terceros y la API de pago. La puntuación de Ráfaga es una **estimación de la IA, no una garantía**.

## Brechas y decisión
| Brecha | Decisión |
|---|---|
| «No me gusta» por clip (mejora la siguiente generación) | Pendiente; requiere guardar la señal y usarla en `exclude_previous`. No se hace sin diseño de datos. |
| Título del proyecto = encargo | Ya existe el encargo (brief) en la generación; mostrarlo como título del grupo queda como mejora menor. |
| AI Producer (chat editor) | Fuera de alcance (€0 y sin modelo propietario). |

Tamaño del resto de la paridad: **S** (todo lo núcleo ya existe).
