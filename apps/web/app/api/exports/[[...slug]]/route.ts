import { handleExports } from "../../../../lib/routes/exports.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug?: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return handleExports(req, (await ctx.params).slug ?? []); }
export async function POST(req: Request, ctx: Ctx) { return handleExports(req, (await ctx.params).slug ?? []); }
