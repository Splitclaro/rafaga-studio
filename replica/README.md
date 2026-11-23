# Paridad con OpusClip y Escalium

Auditoría del 2026-11-23 sobre el commit `7dd21b3`. Léelo en este orden:

1. `plan-implementacion.md` — resultado, plan por entregas, cierre y las cinco mejoras.
2. `matriz-paridad.csv` — 61 filas con ID estable, evidencia del referente, ruta de Ráfaga, caso de prueba, resultado y brecha.
3. `informe-fallos.md` — fallos reproducidos, formatos, rendimiento y corpus de pruebas.
4. `inventario/opus.md` y `inventario/escalium.md` — inventario por pantalla y ajuste de cada referente.
5. `features.csv` (estricto: lo pendiente cuenta como no hecho) y `features_declarado.csv` (lo pendiente cuenta como hecho) — entradas de `python3 ~/.claude/skills/replica-diff/parity.py`.
6. `_genera_matriz.py` — fuente única de los tres CSV: edítalo y vuelve a ejecutarlo (`python3 replica/_genera_matriz.py`).
7. Estudios anteriores: `opus/`, `escalium/`, `lyrictune/`, `../docs/recon/`.

`evidencia/` guarda capturas internas (contienen el correo de la cuenta) y no se versiona.

Vocabulario de resultados: **verificada** (recorrido normal completo y criterio cumplido) · **parcial** · **falla** · **falta** · **pendiente de verificar**. Una pantalla visible, una ruta existente o una prueba simulada no acreditan un recorrido real.
