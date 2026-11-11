# Pipeline de IA

1. **Transcripción**: Groq `whisper-large-v3-turbo` (clave `GROQ_API_KEY`).
2. **Selección editorial**: Groq `openai/gpt-oss-120b`. Entrada: transcripción + brief («Di qué buscar»). Salida por candidato: inicio/fin, título, gancho, recomendación y 7 factores 0–10 (claridad del gancho, independencia narrativa, relevancia, ritmo, calidad de audio, ajuste a duración, elementos visuales). Puntuación = combinación documentada de los factores. Es una estimación, no una garantía.
3. **Reencuadre**: OpenCV (caras) en el worker; sin diarización por ahora.
4. **Render**: ffmpeg 9.0.2 fijado; subtítulos con el mismo motor en vista previa y exportación (≤ 1 frame de diferencia).
5. **Límites**: `ai_usage` y `workspace_ai_limits`. Sin clave de IA, el selector cae a reglas y la interfaz lo dice.
Pendiente de construir: columnas `factors`, `hook`, `recommendation` (migración 33) y la operación «quitar silencios».
