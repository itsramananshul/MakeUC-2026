import { failure, json } from "@/lib/incident-validation";
import { searchPlaces } from "@/lib/osm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 120) {
    return json({ error: "Enter a place or address from 2 to 120 characters." }, 400);
  }
  try { return json({ places: await searchPlaces(query, undefined, true) }); }
  catch (error) { return failure(error); }
}
