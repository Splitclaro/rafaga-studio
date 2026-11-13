// Prueba real (una vez, la ejecuta el propietario) de la subida multiparte firmada contra R2.
//   node scripts/r2-multipart-probe.ts --dry-run   → imprime las 5 operaciones S3 sin red (salida 0)
//   node scripts/r2-multipart-probe.ts             → sube 2 partes de 5 MiB a rafaga-probe/ y las borra (salida 0 si todo va bien)
// Sin las 4 variables R2 (y sin --dry-run) sale con 78.
import { r2FromEnv, r2Multipart, r2Url } from "../packages/providers/src/r2.ts";

const OPS = ["CreateMultipartUpload (POST ?uploads)", "UploadPart ×2 (PUT ?partNumber&uploadId, URL prefirmada 900 s)", "ListParts (GET ?uploadId)", "CompleteMultipartUpload (POST ?uploadId)", "AbortMultipartUpload / DeleteObject (limpieza)"];
const dry = process.argv.includes("--dry-run");
if (dry) { OPS.forEach((o, i) => console.log(`${i + 1}. ${o}`)); process.exit(0); }
const cfg = r2FromEnv();
if (!cfg) { console.error("Faltan R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY"); process.exit(78); }
const key = `rafaga-probe/${Date.now()}.bin`, mp = r2Multipart(cfg);
const id = await mp.create(key);
const part = new Uint8Array(5 * 1024 * 1024).fill(7);
const etags: { n: number; etag: string }[] = [];
for (const n of [1, 2]) {
  const r = await fetch(await mp.partUrl(key, id, n), { method: "PUT", body: part });
  if (!r.ok) { console.error(`UploadPart ${n} → HTTP ${r.status}: ${await r.text()}`); await mp.abort(key, id); process.exit(1); }
  etags.push({ n, etag: (r.headers.get("etag") ?? "").replace(/"/g, "") });
}
console.log("ListParts:", (await mp.list(key, id)).map((p) => p.n).join(","));
await mp.complete(key, id, etags);
const head = await fetch(await r2Url(cfg, "HEAD", key, 300), { method: "HEAD" });
console.log("Objeto final:", head.status, head.headers.get("content-length"), "bytes");
await fetch(await r2Url(cfg, "DELETE", key, 300), { method: "DELETE" });
console.log(head.ok && Number(head.headers.get("content-length")) === 2 * part.length ? "OK: la subida multiparte prefirmada funciona en R2." : "FALLO: tamaño inesperado.");
process.exit(head.ok ? 0 : 1);
