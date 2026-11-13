// Despierta al procesador tras encolar (Modal o GitHub Actions según WORKER_BACKEND). Lógica en lib/routes/wake.ts.
import { handleWake } from "../../../lib/routes/wake.ts";

export const dynamic = "force-dynamic";
export async function POST(req: Request) { return handleWake(req); }
