import { handleClips } from "../../../../lib/routes/clips.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug?: string[] }> };
export async function POST(req: Request, ctx: Ctx) { return handleClips(req, (await ctx.params).slug ?? []); }
export async function PUT(req: Request, ctx: Ctx) { return handleClips(req, (await ctx.params).slug ?? []); }
