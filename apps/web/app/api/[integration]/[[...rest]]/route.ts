import { handleIntegrations } from "../../../../lib/routes/integrations.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;   // el envío a Zernio sube el MP4 desde esta función (no desde Modal)
type Ctx = { params: Promise<{ integration: string; rest?: string[] }> };
async function run(req: Request, ctx: Ctx) { const p = await ctx.params; return handleIntegrations(req, p.integration, p.rest ?? []); }
export async function GET(req: Request, ctx: Ctx) { return run(req, ctx); }
export async function POST(req: Request, ctx: Ctx) { return run(req, ctx); }
export async function PATCH(req: Request, ctx: Ctx) { return run(req, ctx); }
