import { getImage } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const data = getImage(id);
  return data
    ? new Response(new Uint8Array(data), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=300" } })
    : new Response("Imagery not found.", { status: 404 });
}
