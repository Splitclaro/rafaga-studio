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
