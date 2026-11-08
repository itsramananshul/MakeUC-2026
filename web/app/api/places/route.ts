import { failure, json } from "@/lib/incident-validation";
import { searchPlaces } from "@/lib/osm";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lon"));
  const near = params.has("lat") && params.has("lon") && Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : undefined;
  if (query.length < 2 || query.length > 120) return json({ error: "Enter a place or address from 2 to 120 characters." }, 400);
  try { return json({ places: await searchPlaces(query, near) }); }
  catch (error) { return failure(error); }
}
