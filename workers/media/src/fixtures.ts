// Fixtures de vídeo sintéticos con ffmpeg (lavfi): reproducen las propiedades del archivo real de pruebas del propietario
// (1080p25 H.264, audio PCM 24 bits estéreo, pista de datos de timecode y habla escasa). Si falta ffmpeg, las pruebas fallan.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Rpc, MediaR2 } from "./stages/registry.ts";

export type FixtureKind = "ok" | "noaudio" | "corrupt" | "rotated" | "vfr" | "short3";
const SPARSE = "aevalsrc=0.3*sin(2*PI*440*t)*lt(mod(t\\,2)\\,0.5):s=48000:c=stereo";   // tono 0,5 s de cada 2 = «habla escasa»

function ff(args: string[]) {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg falló: ${r.stderr?.slice(-300)}`);
}

export function makeFixture(kind: FixtureKind, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${kind}.mov`);
  if (existsSync(out)) return out;
  const video = (secs: number, fps = 25) => ["-f", "lavfi", "-i", `testsrc2=s=1920x1080:r=${fps}:d=${secs}`];
  const enc = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "25"];
  switch (kind) {
    case "ok":
      ff([...video(6), "-f", "lavfi", "-i", SPARSE, "-t", "6", ...enc, "-c:a", "pcm_s24le", "-timecode", "01:00:00:00", out]);
      break;
    case "short3":
      ff([...video(3), "-f", "lavfi", "-i", SPARSE, "-t", "3", ...enc, "-c:a", "pcm_s24le", "-timecode", "01:00:00:00", out]);
      break;
    case "noaudio":
      ff([...video(4), "-t", "4", ...enc, out]);
      break;
    case "corrupt":
      writeFileSync(out, readFileSync(makeFixture("ok", dir)).subarray(0, 4096));
      break;
    case "rotated": {
      const tmp = join(dir, "rot-src.mp4");
      ff([...video(4), "-f", "lavfi", "-i", SPARSE, "-t", "4", ...enc, "-c:a", "aac", tmp]);
      ff(["-display_rotation", "90", "-i", tmp, "-c", "copy", out]);
      break;
    }
    case "vfr":
      ff([...video(2, 25), ...video(2, 12), "-f", "lavfi", "-i", SPARSE, "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-t", "4",
        ...enc, "-c:a", "aac", "-fps_mode", "passthrough", out]);
      break;
  }
  return out;
}

const SETOF = new Set(["claim_stage", "claim_job", "purge_candidates"]);
/** `rpc` ejecutado como servicio sobre PGlite (sin cliente HTTP). */
export function pgliteRpc(db: PGlite): Rpc {
  return (async (fn: string, args: Record<string, unknown> = {}) => {
    const names = Object.keys(args);
    const values = names.map((n) => { const v = args[n]; return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v; });
    await db.exec("set role service_role; select set_config('request.jwt.claim.sub', '', false);");
    try {
      const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      if (SETOF.has(fn)) return (await db.query<{ r: unknown }>(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) r from ${call} t`, values)).rows[0].r;   // como PostgREST: lista de filas
      const r = await db.query<{ r: unknown }>(`select to_jsonb(${call}) r`, values);
      return r.rows[0]?.r ?? null;
    } finally { await db.exec("reset role;"); }
  }) as Rpc;
}
export const pgliteCtx = (db: PGlite, extra: Record<string, unknown> = {}) => ({ rpc: pgliteRpc(db), workerId: "test-worker", componentVersions: { v: "test" }, log: () => {}, ...extra });

/** R2 en memoria con la misma interfaz que usan las etapas. */
export function fakeR2(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files)), deleted: string[] = [], uploaded: string[] = [];
  const r2: MediaR2 = {
    async download(key, dest) { const p = store.get(key); if (!p) throw new Error(`R2: no existe ${key}`); writeFileSync(dest, readFileSync(p)); },
    async upload(key, file) { store.set(key, file); uploaded.push(key); },
    async remove(keys) { for (const k of keys) { store.delete(k); deleted.push(k); } },
  };
  return { r2, store, deleted, uploaded };
}
