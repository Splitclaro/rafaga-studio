// Cliente de subida reanudable: partes de 16 MB directas a R2, 3 en paralelo, reintentos con espera creciente,
// progreso real (bytes, velocidad, tiempo restante), cancelación y reanudación tras recargar la página.

export const PART_SIZE = 16777216;
export interface Part { n: number; start: number; end: number; size: number }

export function planParts(bytes: number, partSize = PART_SIZE): Part[] {
  const out: Part[] = [];
  for (let start = 0, n = 1; start < bytes; start += partSize, n++) { const end = Math.min(bytes, start + partSize); out.push({ n, start, end, size: end - start }); }
  return out;
}

/** Partes pendientes: manda el servidor (lo que R2 dice que ya tiene); el registro local solo es una pista. */
export function mergeResume(total: number, serverDone: { n: number; etag: string }[], _localDone: { n: number; etag: string }[] = []): number[] {
  const done = new Set(serverDone.map((p) => p.n));
  return Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
}

/** Velocidad por media móvil exponencial y tiempo restante. */
export class Throughput {
  private bps = 0; private last = 0; private lastBytes = 0; private alpha: number;
  constructor(alpha = 0.3) { this.alpha = alpha; }
  sample(now: number, bytesSent: number): number {
    if (this.last) { const dt = (now - this.last) / 1000; if (dt > 0) { const inst = (bytesSent - this.lastBytes) / dt; this.bps = this.bps ? this.alpha * inst + (1 - this.alpha) * this.bps : inst; } }
    this.last = now; this.lastBytes = bytesSent; return this.bps;
  }
  get speed() { return this.bps; }
}
export const etaSeconds = (remaining: number, bps: number) => (bps > 0 ? Math.ceil(remaining / bps) : null);

// ── SHA-256 incremental en TypeScript puro (FIPS 180-4), para huellas de archivos grandes sin cargarlos enteros ──
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private buf = new Uint8Array(64); private bufLen = 0; private total = 0; private w = new Uint32Array(64);
  private block(b: Uint8Array, o: number) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b2, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b2) ^ (a & c) ^ (b2 & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
    }
    const H = this.h; H[0] += a; H[1] += b2; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  update(data: Uint8Array): this {
    let i = 0; this.total += data.length;
    if (this.bufLen) { while (i < data.length && this.bufLen < 64) this.buf[this.bufLen++] = data[i++]; if (this.bufLen === 64) { this.block(this.buf, 0); this.bufLen = 0; } }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    while (i < data.length) this.buf[this.bufLen++] = data[i++];
    return this;
  }
  hex(): string {
    const bits = this.total * 8, pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0, L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi; pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    this.total -= pad.length; this.update(pad);
    return [...this.h].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
}

// ── Subida ──
export type UploadState = "uploading" | "retrying" | "completing" | "done" | "cancelled" | "error";
export interface UploadEvent { bytesSent: number; totalBytes: number; speedBps: number; etaS: number | null; state: UploadState; message?: string }
export interface Blobish { size: number; slice(start: number, end: number): Blob | Uint8Array }
export interface UploadApi {
  status(uploadId: string): Promise<{ uploaded_parts: { n: number; etag: string; size: number }[]; state: string }>;
  urls(uploadId: string, parts: number[]): Promise<Record<string, string>>;
  complete(uploadId: string, parts: { n: number; etag: string }[], sha256: string): Promise<{ job_id: string }>;
  abort(uploadId: string): Promise<void>;
}
export interface ResumeStore { get(k: string): { n: number; etag: string }[] | null; set(k: string, v: { n: number; etag: string }[]): void; del(k: string): void }
export interface RunOpts {
  uploadId: string; file: Blobish; api: UploadApi; fetch?: typeof fetch; store?: ResumeStore; sha256?: () => Promise<string>;
  concurrency?: number; retries?: number; backoffMs?: number[]; partSize?: number; onEvent?: (e: UploadEvent) => void;
  sleep?: (ms: number) => Promise<void>; now?: () => number;
}

export function runUpload(o: RunOpts) {
  const ac = new AbortController();
  const f = o.fetch ?? fetch, sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))), now = o.now ?? Date.now;
  const conc = o.concurrency ?? 3, retries = o.retries ?? 5, backoff = o.backoffMs ?? [1000, 2000, 4000, 8000, 16000];
  const parts = planParts(o.file.size, o.partSize ?? PART_SIZE);
  const tp = new Throughput();
  let sent = 0, cancelled = false, state: UploadState = "uploading";
  const attempts = new Map<number, number>();
  const emit = (st: UploadState = state, message?: string) => { state = st; const bps = tp.sample(now(), sent); o.onEvent?.({ bytesSent: sent, totalBytes: o.file.size, speedBps: bps, etaS: etaSeconds(o.file.size - sent, bps), state: st, message }); };

  const promise = (async () => {
    const srv = await o.api.status(o.uploadId);
    const done = new Map(srv.uploaded_parts.map((p) => [p.n, p.etag]));
    const pending = mergeResume(parts.length, srv.uploaded_parts, o.store?.get(o.uploadId) ?? []);
    sent = parts.filter((p) => done.has(p.n)).reduce((s, p) => s + p.size, 0);
    emit("uploading");
    const queue = [...pending];
    const worker = async () => {
      while (queue.length && !cancelled) {
        const n = queue.shift()!, p = parts[n - 1];
        for (let k = 0; ; k++) {
          if (cancelled) return;
          attempts.set(n, k + 1);
          try {
            const url = (await o.api.urls(o.uploadId, [n]))[String(n)];
            const r = await f(url, { method: "PUT", body: o.file.slice(p.start, p.end) as BodyInit, signal: ac.signal });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const etag = (r.headers.get("etag") ?? "").replace(/"/g, "") || `part-${n}`;
            done.set(n, etag); sent += p.size;
            o.store?.set(o.uploadId, [...done].map(([n2, e]) => ({ n: n2, etag: e })));
            emit("uploading");
            break;
          } catch (e) {
            if (cancelled || (e as Error).name === "AbortError") return;
            if (k >= retries) throw new Error(`La parte ${n} falló tras ${k + 1} intentos: ${(e as Error).message}`);
            emit("retrying", `Reintentando la parte ${n}…`);
            await sleep(backoff[Math.min(k, backoff.length - 1)]);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, queue.length)) }, worker));
    if (cancelled) return null;
    emit("completing");
    const sha = o.sha256 ? await o.sha256() : "";
    const res = await o.api.complete(o.uploadId, [...done].map(([n, etag]) => ({ n, etag })), sha);
    o.store?.del(o.uploadId);
    emit("done");
    return res;
  })().catch((e) => { if (!cancelled) emit("error", (e as Error).message); throw e; });

  return {
    promise, attempts,
    async cancel() { cancelled = true; ac.abort(); await o.api.abort(o.uploadId).catch(() => {}); o.store?.del(o.uploadId); emit("cancelled"); },
  };
}

/** API real contra las rutas /api/uploads con el token de la sesión. */
export function httpApi(token: string, f: typeof fetch = fetch): UploadApi {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ok = async <T>(r: Response): Promise<T> => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error((b as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}`); return b as T; };
  return {
    status: async (id) => ok(await f(`/api/uploads/${id}`, { headers: h })),
    urls: async (id, parts) => (await ok<{ urls: Record<string, string> }>(await f(`/api/uploads/${id}/parts`, { method: "POST", headers: h, body: JSON.stringify({ part_numbers: parts }) }))).urls,
    complete: async (id, parts, sha256) => ok(await f(`/api/uploads/${id}/complete`, { method: "POST", headers: h, body: JSON.stringify({ parts, sha256 }) })),
    abort: async (id) => { await f(`/api/uploads/${id}`, { method: "DELETE", headers: h }); },
  };
}

/** Registro local de partes subidas (sobrevive a recargas). Tolerante a navegadores sin almacenamiento. */
export const localResumeStore: ResumeStore = {
  get(k) { try { return JSON.parse(localStorage.getItem(`rafaga-upload:${k}`) ?? "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`rafaga-upload:${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(`rafaga-upload:${k}`); } catch { /* sin almacenamiento */ } },
};
