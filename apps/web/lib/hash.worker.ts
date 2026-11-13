// Web Worker: huellas del archivo sin bloquear la interfaz. Primero la de la primera parte (para detectar duplicados
// antes de subir) y después la completa (para verificar la subida), leyendo por trozos de 16 MB.
import { Sha256, PART_SIZE } from "./uploader.ts";

type Msg = { file: File };
self.onmessage = async (e: MessageEvent<Msg>) => {
  const file = e.data.file;
  const first = new Sha256().update(new Uint8Array(await file.slice(0, Math.min(PART_SIZE, file.size)).arrayBuffer())).hex();
  (self as unknown as Worker).postMessage({ kind: "prefix", sha256_prefix: first });
  const h = new Sha256();
  for (let o = 0; o < file.size; o += PART_SIZE) {
    h.update(new Uint8Array(await file.slice(o, Math.min(file.size, o + PART_SIZE)).arrayBuffer()));
    (self as unknown as Worker).postMessage({ kind: "progress", hashed: Math.min(file.size, o + PART_SIZE), total: file.size });
  }
  (self as unknown as Worker).postMessage({ kind: "full", sha256: h.hex() });
};
