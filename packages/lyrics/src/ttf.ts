// Lector mínimo de TrueType: unitsPerEm, cmap (formato 4) y anchos de avance (hmtx).
// Se usa para generar la tabla de métricas y para comprobar en el worker que la fuente instalada coincide.
export interface FontMetrics { unitsPerEm: number; advance: Record<number, number>; fallback: number }

export function readMetrics(buf: Uint8Array, codepoints: number[]): FontMetrics {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint16(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])] = dv.getUint32(o + 8);
  }
  for (const t of ["head", "hhea", "hmtx", "cmap"]) if (tables[t] == null) throw new Error(`tabla ${t} ausente`);
  const unitsPerEm = dv.getUint16(tables.head + 18);
  const numHMetrics = dv.getUint16(tables.hhea + 34);
  const adv = (g: number) => dv.getUint16(tables.hmtx + 4 * Math.min(g, numHMetrics - 1));
  // cmap: subtabla Unicode BMP formato 4
  const cm = tables.cmap, nsub = dv.getUint16(cm + 2);
  let sub = -1;
  for (let i = 0; i < nsub; i++) {
    const pid = dv.getUint16(cm + 4 + i * 8), eid = dv.getUint16(cm + 6 + i * 8), off = dv.getUint32(cm + 8 + i * 8);
    if (dv.getUint16(cm + off) === 4 && ((pid === 3 && eid === 1) || pid === 0)) { sub = cm + off; break; }
  }
  if (sub < 0) throw new Error("cmap formato 4 no encontrado");
  const segX2 = dv.getUint16(sub + 6), segs = segX2 / 2;
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  const glyph = (cp: number) => {
    for (let s = 0; s < segs; s++) {
      const end = dv.getUint16(ends + s * 2);
      if (cp > end) continue;
      const start = dv.getUint16(starts + s * 2);
      if (cp < start) return 0;
      const delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
      if (!ro) return (cp + delta) & 0xffff;
      const g = dv.getUint16(ranges + s * 2 + ro + (cp - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const advance: Record<number, number> = {};
  for (const cp of codepoints) { const g = glyph(cp); if (g) advance[cp] = adv(g); }
  return { unitsPerEm, advance, fallback: adv(glyph(0x6e) || 0) };
}

/** Puntos de código cubiertos por la tabla (ASCII, Latin-1 y tipografía habitual en letras). */
export const METRIC_CODEPOINTS = [...Array.from({ length: 95 }, (_, i) => 32 + i), ...Array.from({ length: 96 }, (_, i) => 160 + i), 0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026];
