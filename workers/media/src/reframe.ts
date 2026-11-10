import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planReframe, type FaceSample, type ReframeMode, type ReframePath } from "@rafaga/composition";

const SCRIPT = fileURLToPath(new URL("../py/faces.py", import.meta.url));
export interface FaceScan { w: number; h: number; fps: number; samples: FaceSample[] }

/** Muestrea el tramo y detecta caras con OpenCV (Python). Lanza si Python/OpenCV no está disponible. */
export function scanFaces(video: string, start: number, dur: number, fps = 3): FaceScan {
  const r = spawnSync(process.env.PYTHON_BIN ?? "python3", [SCRIPT, video, "--start", String(start), "--dur", String(dur), "--fps", String(fps)], { maxBuffer: 1 << 28, timeout: 15 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`detector de caras: ${(r.stderr?.toString() || r.error?.message || "error").slice(0, 300)}`);
  return JSON.parse(r.stdout.toString()) as FaceScan;
}

export function reframePath(scan: FaceScan, targetAspect: number, len: number, mode: ReframeMode, fallbackX = 0.5): ReframePath {
  return planReframe(scan.samples, { srcAspect: scan.w / scan.h, targetAspect, len, mode, fallbackX });
}
