// R2 real para las etapas: descarga en streaming, subida con URL prefirmada y borrado. (Las pruebas usan fakeR2.)
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { r2Url, type R2Config } from "@rafaga/providers/r2";
import type { MediaR2 } from "./registry.ts";

export function realR2(cfg: R2Config, f: typeof fetch = fetch): MediaR2 {
  return {
    async download(key, dest) {
      const r = await f(await r2Url(cfg, "GET", key, 900));
      if (!r.ok || !r.body) throw new Error(`R2 GET ${key}: HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body as never), createWriteStream(dest));
    },
    async upload(key, file, contentType) {
      const size = statSync(file).size;
      const r = await f(await r2Url(cfg, "PUT", key, 900), { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(size) }, body: Readable.toWeb(createReadStream(file)) as never, duplex: "half" } as RequestInit);
      if (!r.ok) throw new Error(`R2 PUT ${key}: HTTP ${r.status}`);
    },
    async remove(keys) { for (const k of keys) { const r = await f(await r2Url(cfg, "DELETE", k, 300), { method: "DELETE" }); if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${k}: HTTP ${r.status}`); } },
  };
}
