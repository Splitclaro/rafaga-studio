# Recon · LyricTune (lyrictune.app) — 2026-11-14

Solo lectura, con la cuenta del propietario: `/generate` (Video Studio). Sin exportar ni gastar exportaciones (3 gratis con marca de agua).

## Estructura
Navegación: **Video Studio · Style Studio · Library · Schedule · Hooks**. Video Studio en un solo panel: Select Song → Lyrics Preview (Auto-sync, Edit, Fine-tune timing, Re-sync) → Choose Video Style (Video/Photo; LyricTune Collections / Custom Collections / Solid Color; 21 paquetes) → Mode (Lyrics / Text / LP Cover) → Customize Lyrics (galería de estilos «trending» + Create) → Text color → Settings → vista previa 9:16 con «arrastra la letra para reposicionar» → Export 720p / 1080p / Batch.

## Paridad (Ráfaga Lyric Studio v2)
| Función observada | Estado |
|---|---|
| Canción + letra con auto-sincronía, editar, ajuste fino de tiempos, re-sincronizar | ✅ (`LyricSyncEditor`) |
| Colecciones de la plataforma y propias, vídeo/foto/color sólido | ✅ (Ráfaga Collections / Custom Collections; las oficiales aún sin medios con licencia) |
| Modos Letra · Texto · Portada (LP cover) | ✅ (`lyricscene.ts`, `switchLyricMode`) |
| Galería de estilos + crear estilo | ✅ (Style Studio v2) |
| Modo de fondo en secuencia + intervalo, variaciones sutiles | ✅ |
| Recorte cinematográfico, atenuado del fondo, vibración, mezcla texto/vídeo | ✅ (`settings.crop/dim/shake/blend`) |
| Filtros Midnight · Super 8 · Noir · Vaporwave | ✅ (`noche/super8/bn/vapor`) |
| Tamaño del texto, gancho (hook), ajuste del fondo | ✅ |
| Exportar 720p/1080p y lote | ✅ (variantes en lote) |
| Arrastrar la letra en la vista previa | ✅ (`LyricPreview`: arrastre y flechas, pantalla completa, zonas seguras) |
| Programación (Schedule) y Hooks | ✅ Calendario y paquetes de ganchos |

## No clonable
Los 21 paquetes de vídeo de LyricTune (derechos de terceros: Minecraft, CSGO, San Andreas, etc.), su catálogo de estilos «Creator», marca de agua y cuotas. Las colecciones de Ráfaga se rellenan con medios propios o con licencia del propietario.

Tamaño: **S**. Sin huecos funcionales pendientes frente a lo observado; falta solo contenido con licencia para las colecciones oficiales.
