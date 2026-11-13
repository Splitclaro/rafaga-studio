// Limitador de las llamadas a Groq (plan gratuito): cubetas por minuto, hora y día. Reloj inyectable para probarlo sin esperar.
export type Kind = "stt" | "llm";
export interface Limits {
  stt: { rpm: number; rpd: number; audio_s_per_h: number; audio_s_per_day: number };
  llm: { rpm: number; rpd: number; tpm: number; tpd: number };
}
export const DEFAULT_LIMITS: Limits = { stt: { rpm: 20, rpd: 2000, audio_s_per_h: 7200, audio_s_per_day: 28800 }, llm: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 } };

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  try { const j = JSON.parse(env.GROQ_LIMITS ?? "{}"); return { stt: { ...DEFAULT_LIMITS.stt, ...(j.stt ?? {}) }, llm: { ...DEFAULT_LIMITS.llm, ...(j.llm ?? {}) } }; } catch { return DEFAULT_LIMITS; }
}

interface Ev { t: number; cost: number }
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

export class GroqLimiter {
  private ev: Record<Kind, Ev[]> = { stt: [], llm: [] };
  private blockedUntil = 0;
  private limits: Limits; private now: () => number; private sleep: (ms: number) => Promise<void>;
  constructor(limits: Limits = DEFAULT_LIMITS, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.limits = limits; this.now = now; this.sleep = sleep;
  }

  private inWindow(kind: Kind, win: number, t: number) { return this.ev[kind].filter((e) => t - e.t < win); }
  /** Milisegundos hasta poder hacer una petición de `cost` (segundos de audio para stt, tokens para llm). 0 = ahora. */
  waitMs(kind: Kind, cost: number): number {
    const t = this.now(); let wait = Math.max(0, this.blockedUntil - t);
    const check = (win: number, max: number, per: (e: Ev) => number, add: number) => {
      const evs = this.inWindow(kind, win, t).sort((a, b) => a.t - b.t);
      let used = evs.reduce((s, e) => s + per(e), 0) + add;
      for (const e of evs) { if (used <= max) break; wait = Math.max(wait, e.t + win - t); used -= per(e); }
    };
    if (kind === "stt") { const l = this.limits.stt; check(MIN, l.rpm, () => 1, 1); check(DAY, l.rpd, () => 1, 1); check(HOUR, l.audio_s_per_h, (e) => e.cost, cost); check(DAY, l.audio_s_per_day, (e) => e.cost, cost); }
    else { const l = this.limits.llm; check(MIN, l.rpm, () => 1, 1); check(DAY, l.rpd, () => 1, 1); check(MIN, l.tpm, (e) => e.cost, cost); check(DAY, l.tpd, (e) => e.cost, cost); }
    return wait;
  }
  /** Espera lo necesario y registra la petición. Devuelve lo esperado (para `job_stages.output.wait_ms`). */
  async wait(kind: Kind, cost: number): Promise<number> {
    const w = this.waitMs(kind, cost);
    if (w > 0) await this.sleep(w);
    this.ev[kind].push({ t: this.now(), cost });
    return w;
  }
  /** Un 429 con retry-after: nada sale antes de ese instante. */
  on429(retryAfterS: number) { this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(1, retryAfterS) * 1000); }
}
