import catalog from "@/lib/catia-imagery.json";

export function GET() {
  return Response.json(catalog, { headers: { "Cache-Control": "public, max-age=300" } });
}
