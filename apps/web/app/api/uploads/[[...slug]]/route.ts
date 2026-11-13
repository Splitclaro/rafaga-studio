import { handle } from "../../../../lib/routes/uploads.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug?: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).slug ?? []); }
export async function POST(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).slug ?? []); }
export async function DELETE(req: Request, ctx: Ctx) { return handle(req, (await ctx.params).slug ?? []); }
