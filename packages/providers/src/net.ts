// Acceso a URLs externas con protección SSRF: solo HTTPS:443, IPs públicas validadas EN EL MOMENTO DE CONECTAR
// (evita DNS rebinding), redirecciones revalidadas, límites de tamaño y tiempo. Sin shell ni FFmpeg sobre URLs de usuario.
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

export class SsrfError extends Error { constructor(m: string) { super(m); this.name = "SsrfError"; } }

export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;       // CGNAT
    if (a === 169 && b === 254) return false;                  // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith("192.0.0.")))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPublicIp(mapped[1]);
    if (l === "::" || l === "::1") return false;
    if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l) || /^ff/.test(l)) return false;   // ULA, link-local, multicast
    return true;
  }
  return false;
}

/** Validación previa de la URL (sin resolver DNS). */
export function checkUrl(raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new SsrfError("URL no válida"); }
  if (u.protocol !== "https:") throw new SsrfError("Solo se admiten URLs https");
  if (u.username || u.password) throw new SsrfError("No se admiten credenciales en la URL");
  if (u.port && u.port !== "443") throw new SsrfError("Solo se admite el puerto 443");
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) throw new SsrfError("Host no permitido");
  if (net.isIP(h) && !isPublicIp(h)) throw new SsrfError("Dirección no pública");
  return u;
}

const guardedLookup: typeof dns.lookup = ((host: string, opts: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
  dns.lookup(host, { ...(typeof opts === "object" ? opts : {}), all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (bad || !list.length) return cb(new SsrfError("El dominio resuelve a una dirección no pública"));
    const o = typeof opts === "object" ? opts : {};
    return o.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;

export interface GetOpts { maxBytes: number; timeoutMs?: number; maxRedirects?: number; accept?: RegExp; headers?: Record<string, string> }
export interface GetResult { status: number; contentType: string; body: Buffer; finalUrl: string }

/** GET con las defensas anteriores. `accept` se aplica al Content-Type. */
export async function safeGet(url: string, o: GetOpts): Promise<GetResult> {
  let cur = checkUrl(url).toString();
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    const res = await new Promise<GetResult & { location?: string }>((resolve, reject) => {
      const req = https.get(cur, { lookup: guardedLookup, timeout: o.timeoutMs ?? 20000, headers: { "user-agent": "RafagaStudio/1.0", accept: "*/*", ...o.headers } }, (r) => {
        const loc = r.headers.location; const status = r.statusCode ?? 0;
        if (status >= 300 && status < 400 && loc) { r.resume(); return resolve({ status, contentType: "", body: Buffer.alloc(0), finalUrl: cur, location: loc }); }
        const ct = String(r.headers["content-type"] ?? "");
        if (o.accept && !o.accept.test(ct)) { r.resume(); return reject(new SsrfError(`Tipo de contenido no admitido: ${ct.split(";")[0] || "desconocido"}`)); }
        const len = Number(r.headers["content-length"] ?? 0);
        if (len > o.maxBytes) { r.resume(); return reject(new SsrfError("El archivo supera el tamaño máximo")); }
        const chunks: Buffer[] = []; let total = 0;
        r.on("data", (c: Buffer) => { total += c.length; if (total > o.maxBytes) { r.destroy(new SsrfError("El archivo supera el tamaño máximo")); return; } chunks.push(c); });
        r.on("end", () => resolve({ status, contentType: ct, body: Buffer.concat(chunks), finalUrl: cur }));
        r.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new SsrfError("Tiempo de espera agotado")));
      req.on("error", reject);
    });
    if (res.location) { cur = checkUrl(new URL(res.location, cur).toString()).toString(); continue; }   // cada salto se revalida
    return res;
  }
  throw new SsrfError("Demasiadas redirecciones");
}

export interface FeedEntry { guid: string; title: string; published: Date | null; enclosureUrl: string | null; enclosureType: string | null }
const unesc = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? unesc(m[1]) : ""; };

/** RSS 2.0 / Atom mínimo: solo lee texto, nunca ejecuta nada. */
export function parseFeed(xml: string): FeedEntry[] {
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.slice(0, 100).map((it) => {
    const enc = it.match(/<enclosure\b[^>]*>/i)?.[0] ?? it.match(/<link\b[^>]*rel=["']enclosure["'][^>]*>/i)?.[0] ?? "";
    const attr = (a: string) => enc.match(new RegExp(`${a}=["']([^"']+)["']`, "i"))?.[1] ?? null;
    const url = attr("url") ?? attr("href"), type = attr("type");
    const date = tag(it, "pubDate") || tag(it, "published") || tag(it, "updated");
    const d = date ? new Date(date) : null;
    const guid = tag(it, "guid") || tag(it, "id") || url || tag(it, "title");
    return { guid: guid.slice(0, 500), title: tag(it, "title").slice(0, 200), published: d && !Number.isNaN(d.getTime()) ? d : null, enclosureUrl: url, enclosureType: type };
  }).filter((e) => e.guid);
}

// ───────── Importación por enlace (paso 17) ─────────
export type LinkReason = "not_https" | "private_address" | "redirect_private" | "bad_url";
export class LinkError extends Error { reason: LinkReason; constructor(reason: LinkReason, m: string) { super(m); this.name = "LinkError"; this.reason = reason; } }
export interface PreflightDeps {
  /** Resuelve un host a sus IPs (inyectable en pruebas). */
  resolve?: (host: string) => Promise<string[]>;
  /** HEAD sin seguir redirecciones: estado y `location` (inyectable en pruebas). */
  head?: (url: string) => Promise<{ status: number; location?: string | null }>;
  maxRedirects?: number;
}
const defaultResolve = async (host: string) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
const defaultHead = async (url: string) => { const r = await fetch(url, { method: "HEAD", redirect: "manual", headers: { "user-agent": "RafagaStudio/1.0" }, signal: AbortSignal.timeout(10000) }); return { status: r.status, location: r.headers.get("location") }; };
const reasonOf = (e: unknown, hop: number): LinkReason => {
  const m = (e as Error).message;
  if (/https/i.test(m)) return hop ? "redirect_private" : "not_https";
  if (/URL no válida/.test(m)) return "bad_url";
  return hop ? "redirect_private" : "private_address";
};
/** Valida una URL de usuario ANTES de crear trabajo: https, host público (DNS incluido) y cada salto de redirección igual. */
export async function preflightLink(raw: string, d: PreflightDeps = {}): Promise<string> {
  const resolve = d.resolve ?? defaultResolve, head = d.head ?? defaultHead;
  let cur = raw;
  for (let hop = 0; hop <= (d.maxRedirects ?? 3); hop++) {
    let u: URL;
    try { u = checkUrl(cur); } catch (e) { throw new LinkError(reasonOf(e, hop), (e as Error).message); }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!net.isIP(host)) {
      let ips: string[]; try { ips = await resolve(host); } catch { throw new LinkError(hop ? "redirect_private" : "bad_url", "El dominio no se puede resolver"); }
      if (!ips.length || ips.some((ip) => !isPublicIp(ip))) throw new LinkError(hop ? "redirect_private" : "private_address", "El dominio resuelve a una dirección no pública");
    }
    const h = await head(u.toString());
    if (h.status >= 300 && h.status < 400 && h.location) { cur = new URL(h.location, u).toString(); continue; }
    return u.toString();
  }
  throw new LinkError("redirect_private", "Demasiadas redirecciones");
}

export interface OpenResult { status: number; headers: Record<string, string>; stream: NodeJS.ReadableStream & { destroy(e?: Error): void }; finalUrl: string }
/** GET en flujo (para archivos grandes) con la misma guarda SSRF en cada salto y en el momento de conectar. */
export async function openStream(url: string, o: { timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {}): Promise<OpenResult> {
  let cur = checkUrl(url).toString();
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    const res = await new Promise<OpenResult & { location?: string }>((resolve, reject) => {
      const req = https.get(cur, { lookup: guardedLookup, timeout: o.timeoutMs ?? 30000, headers: { "user-agent": "RafagaStudio/1.0", accept: "*/*", ...o.headers } }, (r) => {
        const status = r.statusCode ?? 0, loc = r.headers.location;
        if (status >= 300 && status < 400 && loc) { r.resume(); return resolve({ status, headers: {}, stream: r, finalUrl: cur, location: loc }); }
        const headers: Record<string, string> = {}; for (const [k, v] of Object.entries(r.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(",") : String(v);
        resolve({ status, headers, stream: r, finalUrl: cur });
      });
      req.on("timeout", () => req.destroy(new SsrfError("Tiempo de espera agotado")));
      req.on("error", reject);
    });
    if (res.location) { cur = checkUrl(new URL(res.location, cur).toString()).toString(); continue; }
    return res;
  }
  throw new SsrfError("Demasiadas redirecciones");
}
