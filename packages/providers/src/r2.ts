// Cloudflare R2 (API compatible con S3): URLs prefirmadas con AWS Signature V4 por query string.
// Solo servidor y worker: necesita la clave secreta. El navegador recibe únicamente URLs firmadas de vida corta para un objeto concreto.
export interface R2Config { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/** Valor de marcador («PEGAR_AQUI…»): la variable existe pero aún no tiene la clave real; cuenta como no configurada. */
export const PLACEHOLDER = "PEGAR_AQUI_LA_CLAVE";
const real = (v: string | undefined) => (v && v.trim() && !v.trim().toUpperCase().startsWith("PEGAR") ? v.trim() : undefined);
export function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = real(env.R2_ACCOUNT_ID), accessKeyId = real(env.R2_ACCESS_KEY_ID), secretAccessKey = real(env.R2_SECRET_ACCESS_KEY), bucket = real(env.R2_BUCKET);
  return accountId && accessKeyId && secretAccessKey && bucket ? { accountId, accessKeyId, secretAccessKey, bucket } : null;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
/** Codificación URI de S3: todo menos A-Z a-z 0-9 - _ . ~ (y `/` en la ruta). */
export const uriEncode = (s: string, slash = true) => [...enc.encode(s)].map((b) => {
  const c = String.fromCharCode(b);
  return /[A-Za-z0-9\-_.~]/.test(c) || (!slash && c === "/") ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
}).join("");

/** Presigned URL genérica (SigV4, UNSIGNED-PAYLOAD). `path` empieza por `/`. Probada con el ejemplo de la documentación de AWS. */
export async function presignV4(o: { method: string; host: string; path: string; accessKeyId: string; secretAccessKey: string; region: string; service?: string; expires: number; date?: Date; query?: Record<string, string> }): Promise<string> {
  const service = o.service ?? "s3";
  const d = (o.date ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = d.slice(0, 8), scope = `${day}/${o.region}/${service}/aws4_request`;
  const q: Record<string, string> = { ...(o.query ?? {}), "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${o.accessKeyId}/${scope}`, "X-Amz-Date": d, "X-Amz-Expires": String(o.expires), "X-Amz-SignedHeaders": "host" };
  const qs = Object.keys(q).sort().map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join("&");
  const canonical = [o.method, uriEncode(o.path, false), qs, `host:${o.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", d, scope, await sha256(canonical)].join("\n");
  let k: ArrayBuffer = await hmac(enc.encode(`AWS4${o.secretAccessKey}`), day);
  for (const part of [o.region, service, "aws4_request"]) k = await hmac(k, part);
  const sig = hex(await hmac(k, toSign));
  return `https://${o.host}${uriEncode(o.path, false)}?${qs}&X-Amz-Signature=${sig}`;
}

/** URL firmada para leer (GET, admite rangos) o subir (PUT) un objeto del bucket. */
export function r2Url(cfg: R2Config, method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, expires = 3600, date?: Date) {
  return presignV4({ method, host: `${cfg.accountId}.r2.cloudflarestorage.com`, path: `/${cfg.bucket}/${key}`, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: "auto", expires, date });
}

/** Clave del original de una fuente: misma forma que en Supabase Storage. */
export const originalKey = (ws: string, src: string) => `${ws}/${src}/original`;

/** Clave de la parte N de un original subido en piezas independientes (estrategia `parts`). */
export const partsKey = (key: string, n: number) => `${key}.part${String(n).padStart(3, "0")}`;

type Fetch = typeof fetch;
const host = (cfg: R2Config) => `${cfg.accountId}.r2.cloudflarestorage.com`;
const sign = (cfg: R2Config, method: string, key: string, query: Record<string, string>, expires = 900, date?: Date) =>
  presignV4({ method, host: host(cfg), path: `/${cfg.bucket}/${key}`, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: "auto", expires, date, query });
const tag = (xml: string, t: string) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);
const unq = (s: string) => s.replace(/^&quot;|&quot;$/g, "").replace(/^"|"$/g, "");

/** Subida multiparte S3 sobre R2 con URLs prefirmadas (el navegador sube cada parte directamente al bucket). */
export function r2Multipart(cfg: R2Config, f: Fetch = fetch) {
  return {
    createUrl: (key: string, date?: Date) => sign(cfg, "POST", key, { uploads: "" }, 900, date),
    partUrl: (key: string, uploadId: string, n: number, expires = 900, date?: Date) => sign(cfg, "PUT", key, { partNumber: String(n), uploadId }, expires, date),
    listUrl: (key: string, uploadId: string, date?: Date) => sign(cfg, "GET", key, { uploadId }, 900, date),
    completeUrl: (key: string, uploadId: string, date?: Date) => sign(cfg, "POST", key, { uploadId }, 900, date),
    abortUrl: (key: string, uploadId: string, date?: Date) => sign(cfg, "DELETE", key, { uploadId }, 900, date),
    async create(key: string): Promise<string> {
      const r = await f(await this.createUrl(key), { method: "POST" });
      if (!r.ok) throw new Error(`R2 CreateMultipartUpload ${r.status}`);
      const id = tag(await r.text(), "UploadId")[0];
      if (!id) throw new Error("R2 CreateMultipartUpload sin UploadId");
      return id;
    },
    async list(key: string, uploadId: string): Promise<{ n: number; etag: string; size: number }[]> {
      const r = await f(await this.listUrl(key, uploadId));
      if (!r.ok) throw new Error(`R2 ListParts ${r.status}`);
      return tag(await r.text(), "Part").map((p) => ({ n: Number(tag(p, "PartNumber")[0]), etag: unq(tag(p, "ETag")[0] ?? ""), size: Number(tag(p, "Size")[0] ?? 0) }));
    },
    async complete(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void> {
      const body = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.n - b.n).map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>"${unq(p.etag)}"</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const r = await f(await this.completeUrl(key, uploadId), { method: "POST", body, headers: { "Content-Type": "application/xml" } });
      const text = await r.text();
      if (!r.ok || /<Error>/.test(text)) throw new Error(`R2 CompleteMultipartUpload ${r.status}: ${tag(text, "Code")[0] ?? ""}`);
    },
    async abort(key: string, uploadId: string): Promise<void> {
      const r = await f(await this.abortUrl(key, uploadId), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`R2 AbortMultipartUpload ${r.status}`);
    },
  };
}
