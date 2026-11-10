// Reencuadre automático: de detecciones de caras a una trayectoria suave de recorte horizontal (layout «fill»).
// Pura y determinista. El mismo `xAt` alimenta la vista previa del editor y `cropXExpr` el export de ffmpeg (preview = export).
export interface FaceBox { cx: number; cy: number; w: number; h: number; s: number }      // normalizados al fotograma (0..1)
export interface FaceSample { t: number; faces: FaceBox[] }                                 // t relativo al clip
export interface ReframeKf { t: number; x: number }                                         // x con la semántica de crop.x (0 = izquierda, 1 = derecha)
export type ReframeMode = "follow" | "group";
export interface ReframePath { v: 1; kf: ReframeKf[]; mode: ReframeMode | "static"; coverage: number; samples: number; note?: string }

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Fracción del ancho de la fuente que cabe en el cuadro al rellenar por altura (1 = sin recorte horizontal). */
export const visibleFraction = (srcAspect: number, targetAspect: number) => clamp(targetAspect / srcAspect, 0, 1);

export interface PlanOptions { srcAspect: number; targetAspect: number; len: number; mode?: ReframeMode; fallbackX?: number; maxPanPerSec?: number; deadband?: number; holdSec?: number; minCoverage?: number }

/** Centro de interés de una muestra, o null. `prev` da estabilidad: no salta a otra cara por un pequeño cambio de tamaño. */
export function focusOf(faces: FaceBox[], wf: number, mode: ReframeMode, prev: number | null): number | null {
  const f = faces.filter((x) => x.w > 0 && x.h > 0); if (!f.length) return null;
  const area = (b: FaceBox) => b.w * b.h * (b.s > 0 ? Math.min(1, 0.5 + b.s / 20) : 1);
  const main = [...f].sort((a, b) => area(b) - area(a));
  if (mode === "group") {
    const big = main.filter((b) => area(b) >= area(main[0]) * 0.25);
    const l = Math.min(...big.map((b) => b.cx - b.w / 2)), r = Math.max(...big.map((b) => b.cx + b.w / 2));
    if (r - l <= wf * 0.9) return (l + r) / 2;
  }
  let best = main[0], bs = -Infinity;
  for (const b of main) { const s = area(b) * (prev == null ? 1 : 1 - 0.5 * Math.min(1, Math.abs(b.cx - prev) / Math.max(wf, 0.05))); if (s > bs) { bs = s; best = b; } }
  return best.cx;
}

function simplify(p: ReframeKf[], eps: number): ReframeKf[] {
  if (p.length < 3) return p;
  let idx = -1, dmax = 0; const a = p[0], b = p[p.length - 1];
  for (let i = 1; i < p.length - 1; i++) { const y = a.x + ((b.x - a.x) * (p[i].t - a.t)) / Math.max(1e-9, b.t - a.t); const d = Math.abs(p[i].x - y); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b];
  return [...simplify(p.slice(0, idx + 1), eps).slice(0, -1), ...simplify(p.slice(idx), eps)];
}

export function planReframe(samples: FaceSample[], o: PlanOptions): ReframePath {
  const mode = o.mode ?? "follow", wf = visibleFraction(o.srcAspect, o.targetAspect), fb = clamp(o.fallbackX ?? 0.5, 0, 1);
  const stat = (note: string, cov = 0): ReframePath => ({ v: 1, kf: [{ t: 0, x: r4(fb) }], mode: "static", coverage: cov, samples: samples.length, note });
  if (!samples.length) return stat("Sin muestras para analizar.");
  if (wf >= 0.999) return stat("El vídeo ya cabe entero en el formato elegido: no hay nada que recortar.");
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  // 1) centro de interés por muestra
  let prev: number | null = null; const fc: (number | null)[] = [];
  for (const s of sorted) { const f = focusOf(s.faces, wf, mode, prev); fc.push(f); if (f != null) prev = f; }
  const have = fc.filter((x) => x != null).length, coverage = have / sorted.length;
  if (coverage < (o.minCoverage ?? 0.2)) return stat(`Solo se detectaron caras en el ${Math.round(coverage * 100)} % del clip: se mantiene el encuadre fijo.`, coverage);
  // 2) rellenar huecos: mantener la última posición (y retroceder al principio si el clip empieza sin cara)
  const hold = o.holdSec ?? 1.5; const L: number[] = []; let last: number | null = null, lastT = -Infinity;
  const firstIdx = fc.findIndex((x) => x != null);
  sorted.forEach((s, i) => { const f = fc[i]; if (f != null) { last = f; lastT = s.t; L.push(f); } else L.push(last != null && s.t - lastT <= hold * 4 ? last : fc[firstIdx] as number); });
  for (let i = 0; i < firstIdx; i++) L[i] = fc[firstIdx] as number;
  // 3) filtro de mediana de 3 (descarta falsos positivos aislados) salvo en cortes reales
  const med = L.map((v, i) => { const a = [L[i - 1] ?? v, v, L[i + 1] ?? v].sort((x, y) => x - y); return a[1]; });
  // 4) trayectoria: banda muerta + velocidad máxima; los saltos grandes sostenidos se tratan como corte de plano
  const dead = (o.deadband ?? 0.08) * wf, vmax = (o.maxPanPerSec ?? 0.6) * wf, cutJump = 0.6 * wf;
  const toX = (center: number) => (1 - wf < 1e-6 ? 0.5 : clamp((clamp(center - wf / 2, 0, 1 - wf)) / (1 - wf), 0, 1));
  let curC = med[0]; const out: ReframeKf[] = [{ t: 0, x: r4(toX(curC)) }];
  for (let i = 1; i < sorted.length; i++) {
    const dt = Math.max(1e-3, sorted[i].t - sorted[i - 1].t), want = med[i];
    const sustained = Math.abs(want - curC) > cutJump && Math.abs((med[i + 1] ?? want) - want) < dead;
    if (sustained) { out.push({ t: r4(Math.max(0, sorted[i].t - 0.001)), x: r4(toX(curC)) }); curC = want; }
    else if (Math.abs(want - curC) > dead) curC += clamp(want - curC, -vmax * dt, vmax * dt);
    out.push({ t: r4(sorted[i].t), x: r4(toX(curC)) });
  }
  const end = Math.max(o.len, sorted[sorted.length - 1].t);
  if (out[out.length - 1].t < end) out.push({ t: r4(end), x: out[out.length - 1].x });
  let kf = simplify(out, 0.008);
  if (kf.length > 60) kf = simplify(out, 0.02);
  kf = kf.filter((k, i) => i === 0 || k.t > kf[i - 1].t);
  return { v: 1, kf, mode, coverage: r4(coverage), samples: sorted.length };
}

/** Posición x (0..1) en el instante t: interpolación lineal entre keyframes. */
export function xAt(kf: ReframeKf[] | undefined, t: number, fallback = 0.5): number {
  if (!kf?.length) return fallback;
  if (t <= kf[0].t) return kf[0].x;
  for (let i = 1; i < kf.length; i++) if (t < kf[i].t) { const a = kf[i - 1], b = kf[i]; return a.x + ((b.x - a.x) * (t - a.t)) / Math.max(1e-9, b.t - a.t); }
  return kf[kf.length - 1].x;
}

/** Expresión de ffmpeg (en `t`) equivalente a `xAt`, para el filtro crop. Sin comas fuera de if/lt: va entre comillas simples. */
export function cropXExpr(kf: ReframeKf[]): string {
  const f = (n: number) => String(r4(n));
  if (!kf.length) return "0.5";
  if (kf.length === 1) return f(kf[0].x);
  let e = f(kf[kf.length - 1].x);
  for (let i = kf.length - 1; i >= 1; i--) {
    const a = kf[i - 1], b = kf[i], span = Math.max(1e-6, b.t - a.t);
    const seg = Math.abs(b.x - a.x) < 1e-6 ? f(a.x) : `${f(a.x)}+${f(b.x - a.x)}*(t-${f(a.t)})/${f(span)}`;
    e = `if(lt(t,${f(b.t)}),${seg},${e})`;
  }
  return e;
}
