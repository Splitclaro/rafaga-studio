// Purga de retención (lo carga `stage.ts --purge` con import() dinámico): borra en R2 lo que devuelve `purge_candidates`
// (un 404 cuenta como borrado) y llama a `mark_purged`; sin esa llamada la cuota no bajaría y las URLs apuntarían a objetos borrados.
import { r2FromEnv } from "@rafaga/providers/r2";
import { realR2 } from "./media.ts";
import type { MediaR2, Rpc } from "./registry.ts";

export interface PurgeDeps { r2?: MediaR2; env?: Record<string, string | undefined>; batch?: number; maxRounds?: number }
export interface PurgeResult { purged: number; bytes: number; rounds: number; by_reason: Record<string, number> }
interface Candidate { key: string; bytes: number | string; reason: string }

export async function purge(rpc: Rpc, deps: PurgeDeps = {}): Promise<PurgeResult> {
  let r2 = deps.r2;
  if (!r2) { const cfg = r2FromEnv(deps.env ?? process.env); if (!cfg) throw new Error("not_configured: R2 no está configurado en el worker"); r2 = realR2(cfg); }
  const batch = deps.batch ?? 100, res: PurgeResult = { purged: 0, bytes: 0, rounds: 0, by_reason: {} };
  for (; res.rounds < (deps.maxRounds ?? 50); res.rounds++) {
    const list = (await rpc<Candidate[]>("purge_candidates", { p_limit: batch })) ?? [];
    if (!list.length) break;
    await r2.remove(list.map((c) => c.key));                       // si falla, nada se marca: se reintenta en la siguiente pasada
    const n = Number(await rpc("mark_purged", { p_keys: list.map((c) => c.key) }));
    res.purged += n; res.bytes += list.reduce((t, c) => t + Number(c.bytes), 0);
    for (const c of list) res.by_reason[c.reason] = (res.by_reason[c.reason] ?? 0) + 1;
    if (n === 0) break;                                              // nada avanzó: evita bucles
  }
  try { await rpc("finalize_deleted_projects"); } catch { /* aún no hay función: solo se purgan archivos */ }
  return res;
}
