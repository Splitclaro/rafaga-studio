import { handlePost } from "../../../../lib/routes/jobs.ts";

export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  return handlePost(req, (await ctx.params).slug ?? []);
}
