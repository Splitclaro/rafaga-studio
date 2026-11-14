# Opus · página de recetas (`/recipes?preset=builtin:long-to-shorts`) — estudio y réplica

Estudiada en solo lectura el 2026-11-14 con las capturas del propietario y la propia página. Réplica en `CreationPanel.tsx` (pantalla de «Nuevo proyecto»), `HomeHero.tsx` (Inicio) y `UploadPanel.tsx`.

| Elemento de Opus | Réplica en Ráfaga | Estado |
|---|---|---|
| Inicio: pestañas Clip long video · Auto-edit footage · Open editor | `HomeHero`: Clips de vídeo largo · Edición automática (receta de limpieza) · Abrir editor (proyectos) | ✅ |
| Entrada de enlace + «Get clips in 1 click» | Entrada de enlace + «Obtener clips en 1 clic» (importa por enlace https validado en servidor) | ✅ (enlace directo; plataformas como YouTube/Rumble/Zoom requieren un descargador externo, fuera de alcance a 0 €) |
| Upload · Google Drive · Try a sample project | Subir · Google Drive (se activa al conectar) · Probar un proyecto de muestra | ✅ / Drive 🟡 |
| Zona «Drop your video here or choose a way to upload» + enlace | `UploadPanel` con enlace, Subir, Drive y muestra | ✅ |
| Recipe (selector) → «Manage Recipes» (OpusClip Recipes / My custom Recipes / Create new Recipe) | Mosaico Receta → «Gestionar recetas» con pestañas Recetas de Ráfaga / Mis recetas y «Crear receta nueva» | ✅ |
| Brand kit (selector) + texto explicativo | Mosaico Brand kit + el mismo texto | ✅ |
| Recipe settings (colapsable) | «Ajustes de la receta» | ✅ |
| Clipping (interruptor) | Interruptor: apagado convierte la receta en solo subtítulos | ✅ |
| AI picks: Auto / ClipAnything / ClipBasic | «La IA elige»: Cualquier momento (≈ ClipAnything) y los 7 modos editoriales, con descripción de cada uno | ✅ (nombres propios) |
| Clip length (multiselección: Auto, <30s, 30–59s, 60–89s, 90s–3m, 3–5m) | Casillas con las mismas franjas; el servidor admite la unión (`duration_set`) | ✅ |
| Moments to include + «How to prompt» | «Momentos a incluir» + «Cómo escribirlo» | ✅ |
| Captions (interruptor + galería «Selected» + «View 37 more») | Interruptor + galería de estilos (y, con Lyric v2, el editor completo con «Estilos populares») | ✅ (16 estilos propios, no 37) |
| Auto hook (beta) · Headline: Editorial / Statement / Classic | «Gancho automático (beta)» con Editorial / Declaración / Clásico | ✅ |
| Motion graphics · AI Emojis | Fila «Próximamente» | ⬜ |
| Auto B-roll · AI video B-roll | Fila «Próximamente» (existe la herramienta B-roll antigua) | ⬜ |
| Sound sharp · Speech cleanup · Enhance audio · Auto SFX | Fila «Próximamente» | ⬜ |
| Look good · Auto Zoom · Auto transitions · Auto Color Correction | Fila «Próximamente» | ⬜ |
| Translate · Voice dubbing · Caption translation | Traducción de subtítulos operativa; doblaje «Próximamente» | ✅ / ⬜ |
| Summary: Video processing · Clipping · Captions | Resumen con las mismas líneas y unidades reales | ✅ |
| Premium features «Applied to top N clips» + deslizador y explicación | Desplegable con deslizador y número; mismo texto de reembolso y orden por nota de la IA | ✅ |
| Headline · Total · Create · aviso de derechos | Titular · Total ⚡ · Crear · «Al continuar, confirmas que tienes derechos para usar este vídeo.» | ✅ |

**Por qué hay filas «Próximamente»:** cada una necesita un motor propio (emojis y gráficos, B-roll generado, limpieza de audio, SFX, zoom y transiciones automáticos, doblaje). Un interruptor que no hace nada engañaría a quien lo use. Se irán activando según haya motor real a coste 0 €.
