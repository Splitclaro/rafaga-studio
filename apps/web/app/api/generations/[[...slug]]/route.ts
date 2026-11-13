import { handleGenerations } from "../../../../lib/routes/generations.ts";

export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  return handleGenerations(req, (await ctx.params).slug ?? []);
}
