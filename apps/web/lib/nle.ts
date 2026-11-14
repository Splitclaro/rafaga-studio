// «Exportar XML» como en OpusClip: los clips elegidos como una secuencia de edición (FCP7 xmeml v4, que importan Premiere Pro, DaVinci Resolve y Final Cut)
// apuntando al vídeo original por nombre. Función pura: no toca la red ni el servidor.
export interface NleClip { title: string; startMs: number; endMs: number }
export interface NleInput { project: string; source: { name: string; durationMs: number; width?: number; height?: number }; fps?: number; clips: NleClip[] }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const frames = (ms: number, fps: number) => Math.max(0, Math.round((ms / 1000) * fps));

export function clipsToXmeml(i: NleInput): string {
  const fps = Math.round(i.fps ?? 30), W = i.source.width ?? 1920, H = i.source.height ?? 1080;
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const src = esc(i.source.name), srcDur = frames(i.source.durationMs, fps);
  const file = (first: boolean) => first
    ? `<file id="file-1"><name>${src}</name><pathurl>file://localhost/${encodeURI(i.source.name)}</pathurl>${rate}<duration>${srcDur}</duration><media><video><samplecharacteristics>${rate}<width>${W}</width><height>${H}</height></samplecharacteristics></video><audio><channelcount>2</channelcount></audio></media></file>`
    : `<file id="file-1"/>`;
  let cursor = 0, n = 0; const v: string[] = [], a: string[] = [];
  for (const c of i.clips.filter((x) => x.endMs > x.startMs)) {
    const inF = frames(c.startMs, fps), outF = frames(c.endMs, fps), len = Math.max(1, outF - inF), s = cursor, e = cursor + len; n++;
    const body = (kind: "v" | "a") => `<clipitem id="${kind}-${n}"><name>${esc(c.title)}</name><enabled>TRUE</enabled><duration>${srcDur}</duration>${rate}<start>${s}</start><end>${e}</end><in>${inF}</in><out>${outF}</out>${file(n === 1 && kind === "v")}${kind === "a" ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ""}</clipitem>`;
    v.push(body("v")); a.push(body("a")); cursor = e;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>${esc(i.project)}</name><duration>${cursor}</duration>${rate}<media><video><format><samplecharacteristics>${rate}<width>${W}</width><height>${H}</height></samplecharacteristics></format><track>${v.join("")}</track></video><audio><track>${a.join("")}</track></audio></media></sequence></xmeml>\n`;
}
