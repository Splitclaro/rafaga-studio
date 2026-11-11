# Hoja de ruta de implementación

Prerrequisitos del usuario: elegir dirección visual (ver `design-migration-audit.md` §3), crear `GROQ_API_KEY`, borrar Storage huérfano.

| Fase | Contenido | Verificación |
|---|---|---|
| 0 | Tokens, shell, barra lateral de 9 entradas | typecheck + build + captura en Vercel |
| 1 | Inicio, Procesamiento, Resultados, Editor, Exportados con datos reales | prueba con vídeo real en producción |
| 2 | Groq: selector con factores, gancho, recomendación (migración 33), Comparar | prueba con el vídeo de 13 min |
| 3 | Quitar silencios, layouts, presets de subtítulos | pruebas de worker (`selftest`) |
| 4 | Proyectos con carpetas, Brand kit en pestañas, Compartidos | RLS (`pnpm test`) |
| 5 | Publicaciones manual, Conexiones, Automatización | flujo de consentimiento con el usuario |
| 6 | Demos propias | revisión visual |
