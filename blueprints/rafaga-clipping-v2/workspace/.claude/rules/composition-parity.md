---
description: Motor de composición compartido entre vista previa y exportación
paths:
  - "packages/composition/**"
  - "apps/web/components/PreviewPlayer.tsx"
---

- Un solo motor: `planLayout` y `sceneAt` (`packages/composition/src/layouts.ts`) alimentan la vista previa;
  `toLegacyComposition` → `ffmpegArgs` alimenta la exportación sobre las mismas cajas. Ningún componente calcula
  posiciones de subtítulos, titulares ni recortes por su cuenta.
- Tolerancia: tiempos de subtítulos a ≤1 fotograma (1/30 s) y cajas idénticas; lo comprueba `parity.test.ts`.
- Coordenadas normalizadas [0,1] por formato (9:16, 1:1, 16:9); dimensiones de píxel pares.
- Plantillas (`TEMPLATES`) y diseños son funciones puras → `CompositionV2`; cambiar de diseño conserva fragmentos,
  cortes, subtítulos, audio y extras.
- Zonas seguras (`safezones.ts`): cada valor con `source` https o `note: "medido por nosotros, revisar"`; se dibujan solo
  en la vista previa y nunca llegan a ffmpeg.
- Lo nuevo se publica por `src/index.ts` sin nombres que choquen con los `export *` existentes.
- `packages/composition` no importa `@rafaga/selection` (ni ningún otro paquete de selección): cada prueba define su
  propio transcript de prueba como constante del archivo.
- `trim.ts` (`MAX_CLIP_SEC = 90`) es del flujo v1 y no se toca.
- Solo sintaxis TypeScript borrable; imports relativos con `.ts`.
