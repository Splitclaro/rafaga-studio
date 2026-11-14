<!-- rafaga-lyric-v2:merged — apéndice AÑADIDO al AGENTS.md raíz por el Bootstrap de blueprints/rafaga-lyric-studio-v2/ -->
## Construcción en curso: Lyric Studio v2
`blueprints/rafaga-lyric-studio-v2/` (`tasks.json` decide la siguiente tarea; depende de clipping v2 terminado).

| Tarea | Comando (desde la raíz; anteponer `export PATH="$HOME/.local/bin:$PATH" && `) |
|---|---|
| Pruebas | `pnpm test` · una: `node --test <ruta>` |
| Fuentes del vídeo | `node scripts/fetch-fonts.ts --check` |
| Rendimiento de letra | `node scripts/lyric-perf.ts --quick` |
| Vuelta atrás | `git revert --no-edit rafaga-lyric-v2-step-<NN-1>..HEAD` |

1. La letra del usuario nunca se modifica en silencio; las palabras corregidas a mano no se mueven al re-sincronizar.
2. Vista previa = exportación: un motor (`packages/composition/src/lyricscene.ts`).
3. La v1 de Lyric Studio sigue intacta detrás de `NEXT_PUBLIC_LYRIC_VERSION`.

Detalle: sección «Construcción v2 · Lyric Studio» de `CLAUDE.md`.
