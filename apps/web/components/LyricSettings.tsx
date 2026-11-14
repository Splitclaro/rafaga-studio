"use client";
// Ajustes de fondo e imagen: secuencia, intervalo, orden, bucle, ajuste, recorte, oscurecer, filtros, sacudida, fundir, variaciones y color sólido.
import { FILTER_OPTIONS, settingsToComposition, validateLyricSettings, type LyricUi } from "../lib/lyricsettings";
import type { LyricComposition } from "@rafaga/composition";

const field = "w-full rounded-lg border hairline bg-white px-2 py-1.5 text-sm", lbl = "mb-1 block text-xs text-[var(--muted)]";
export default function LyricSettings({ composition, onChange }: { composition: LyricComposition; onChange: (c: LyricComposition) => void }) {
  const ui = validateLyricSettings({ ...composition.settings, ...composition.background, interval: composition.background.interval, color: composition.background.color, sizeFine: composition.style.sizeFine });
  const set = (p: Partial<LyricUi>) => onChange(settingsToComposition(composition, validateLyricSettings({ ...ui, ...p })));
  const range = (label: string, k: keyof LyricUi, min: number, max: number, step: number) => <label key={k}><span className={lbl}>{label} ({String(ui[k])})</span><input type="range" min={min} max={max} step={step} value={Number(ui[k])} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<LyricUi>)} className="w-full" /></label>;
  return (
    <section className="card grid gap-3 p-4 sm:grid-cols-3" aria-label="Ajustes del fondo">
      <label><span className={lbl}>Orden</span><select className={field} value={ui.order} onChange={(e) => set({ order: e.target.value as LyricUi["order"] })}><option value="aleatorio">Aleatorio</option><option value="fijo">Como los elegiste</option></select></label>
      <label><span className={lbl}>Ajuste</span><select className={field} value={ui.fit} onChange={(e) => set({ fit: e.target.value as LyricUi["fit"] })}><option value="preserve">Mantener proporción</option><option value="fill">Llenar</option><option value="band">Banda</option></select></label>
      <label><span className={lbl}>Filtro</span><select className={field} value={ui.filter} onChange={(e) => set({ filter: e.target.value as LyricUi["filter"] })}>{FILTER_OPTIONS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
      {range("Cambiar de plano cada (s)", "interval", 2, 15, 0.5)}{range("Recorte cinematográfico", "crop", 0, 1, 0.05)}{range("Oscurecer", "dim", 0, 0.8, 0.05)}
      {range("Fundir con el vídeo", "blend", 0, 2, 0.1)}{range("Ligeras variaciones", "variation", 0, 100, 5)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ui.loop} onChange={(e) => set({ loop: e.target.checked })} />Repetir en bucle</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ui.shake} onChange={(e) => set({ shake: e.target.checked })} />Sacudida</label>
      <label className="flex items-center gap-2 text-sm"><input type="color" value={ui.color} onChange={(e) => set({ color: e.target.value })} aria-label="Color sólido" />Color sólido</label>
    </section>
  );
}
