// Validación de fuentes subidas: solo TTF/OTF (lo que usa el renderer FreeType/libass) y lectura del nombre de familia.
export function sniffFont(b: Uint8Array): "ttf" | "otf" | null {
  const h = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  if (h === 0x00010000 || h === 0x74727565) return "ttf"; // 'true'
  if (h === 0x4f54544f) return "otf"; // 'OTTO'
  return null;
}
/** Nombre de familia (nameID 16 si existe, si no 1) leído de la tabla 'name'. */
export function fontFamily(b: Uint8Array): string | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12) return null;
  const n = v.getUint16(4);
  let off = -1;
  for (let i = 0; i < n; i++) {
    const p = 12 + 16 * i; if (p + 16 > b.length) return null;
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) === "name") off = v.getUint32(p + 8);
  }
  if (off < 0 || off + 6 > b.length) return null;
  const count = v.getUint16(off + 2), so = off + v.getUint16(off + 4);
  const found: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const r = off + 6 + 12 * i; if (r + 12 > b.length) break;
    const pid = v.getUint16(r), nid = v.getUint16(r + 6), len = v.getUint16(r + 8), o = v.getUint16(r + 10);
    if ((nid !== 1 && nid !== 16) || found[nid]) continue;
    const raw = b.subarray(so + o, so + o + len);
    found[nid] = pid === 0 || pid === 3 ? new TextDecoder("utf-16be").decode(raw) : new TextDecoder("latin1").decode(raw);
  }
  const fam = (found[16] ?? found[1] ?? "").replace(/[\x00-\x1f{}\\,;]/g, "").trim();
  return fam || null;
}
/** Familia que usa el renderer: «Arial» se sirve con Liberation Sans (métricas compatibles). */
export const renderFamily = (f: string) => (f === "Arial" ? "Liberation Sans" : f);
