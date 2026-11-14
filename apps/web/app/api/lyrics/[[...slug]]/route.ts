import { handleLyrics } from "../../../../lib/routes/lyrics.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug?: string[] }> };
export async function GET(req: Request, ctx: Ctx) { return handleLyrics(req, (await ctx.params).slug ?? []); }
export async function POST(req: Request, ctx: Ctx) { return handleLyrics(req, (await ctx.params).slug ?? []); }
export async function PUT(req: Request, ctx: Ctx) { return handleLyrics(req, (await ctx.params).slug ?? []); }
