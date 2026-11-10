// ZIP mínimo (método «store», UTF-8, sin zip64): suficiente para partes ≤ 4 GB. Los MP4 ya están comprimidos.
import { crc32 } from "node:zlib";

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function dos(d: Date) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

/** Nombre seguro dentro del ZIP: sin rutas absolutas ni «..», separadores «/». */
export function zipName(n: string): string {
  const parts = n.replace(/\\/g, "/").split("/").map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim()).filter((p) => p && p !== "." && p !== "..");
  if (!parts.length) throw new Error("Nombre de archivo vacío");
  return parts.join("/");
}

export class ZipBuilder {
  private chunks: Buffer[] = []; private central: Buffer[] = []; private offset = 0; private n = 0; size = 0;
  add(name: string, data: Buffer, when = new Date()) {
    const nm = Buffer.from(zipName(name), "utf8"), crc = crc32(data), { time, date } = dos(when);
    if (data.length >= 0xffffffff || this.offset >= 0xffffffff) throw new Error("Parte demasiado grande para ZIP sin zip64");
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nm.length), u16(0), nm]);
    this.central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(this.offset), nm]));
    this.chunks.push(local, data); this.offset += local.length + data.length; this.n++; this.size += data.length;
  }
  get count() { return this.n; }
  build(): Buffer {
    const cd = Buffer.concat(this.central);
    return Buffer.concat([...this.chunks, cd, u32(0x06054b50), u16(0), u16(0), u16(this.n), u16(this.n), u32(cd.length), u32(this.offset), u16(0)]);
  }
}
