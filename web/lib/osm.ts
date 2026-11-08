import { booleanIntersects } from "@turf/boolean-intersects";
import { polygon, lineString } from "@turf/helpers";
import { boundsTuple, distanceMeters, lngLat, within, type Coordinate, type GeographicBounds,
  type IncidentRoute, type IncidentSummary, type Place, type Road } from "./incident-types";
import { RequestError } from "./store";

const userAgent = "AFTERMAP/1.0 (+https://aftermap-makeuc.vercel.app)";
type OsmElement = {
  type: "node" | "way"; id: number; lat?: number; lon?: number; nodes?: number[];
  tags?: Record<string, string>;
};
const walkable = "primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|track|steps|cycleway";

type OsmData = { elements?: (OsmElement & { geometry?: { lat: number; lon: number }[] })[]; remark?: string };
const usableHighway = new RegExp(`^(${walkable})$`);

function extractRoads(data: OsmData, bounds: GeographicBounds): Road[] {
  const nodes = new Map(data.elements?.filter(node => node.type === "node").map(node => [node.id, node]));
  const roads: Road[] = [];
  for (const way of data.elements ?? []) {
    if (!way.nodes || !usableHighway.test(way.tags?.highway ?? "") || way.tags?.area === "yes" ||
        way.tags?.foot === "no" || way.tags?.foot === "private" ||
        (["no", "private"].includes(way.tags?.access ?? "") && !["yes", "designated", "permissive"].includes(way.tags?.foot ?? ""))) continue;
    const label = way.tags?.name || way.tags?.ref || way.tags?.highway?.replaceAll("_", " ") || "Unnamed passage";
    const geometry = way.geometry ?? way.nodes.map(id => nodes.get(id));
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1], b = geometry[i];
      if (a?.lat === undefined || a.lon === undefined || b?.lat === undefined || b.lon === undefined) continue;
      const from = { latitude: a.lat, longitude: a.lon }, to = { latitude: b.lat, longitude: b.lon };
      if ((!within(from, bounds) && !within(to, bounds)) || distanceMeters(from, to) < .3) continue;
      roads.push({ id: `osm-${way.id}-${way.nodes[i - 1]}-${way.nodes[i]}`, from, to, state: "unknown", label });
      if (roads.length > 9000) throw new RequestError("This area contains too many roads. Create a smaller incident.", 422);
    }
  }
  return roads;
}

export async function loadRoads(bounds: GeographicBounds): Promise<Road[]> {
  const overpass = new URL(process.env.OVERPASS_URL || "https://overpass.private.coffee/api/interpreter");
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].join(",");
  overpass.searchParams.set("data", `[out:json][timeout:8];way["highway"~"^(${walkable})$"]["area"!="yes"](${box});out body geom;`);
  const fallback = new URL("https://api.openstreetmap.org/api/0.6/map.json");
  fallback.searchParams.set("bbox", boundsTuple(bounds).join(","));
  for (const url of process.env.OVERPASS_URL ? [overpass] : [overpass, fallback]) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) continue;
      const data = await response.json() as OsmData;
      if (data.remark || !Array.isArray(data.elements)) continue;
      return extractRoads(data, bounds);
    } catch (error) {
      if (error instanceof RequestError) throw error;
    }
  }
  throw new RequestError("OpenStreetMap road import is temporarily unavailable. Try again shortly.", 503);
}

type SearchResult = { at: number; places: Place[] };
const searchCache = new Map<string, SearchResult>();
let lastSearch = 0;
let searchQueue: Promise<void> = Promise.resolve();

async function waitForPublicGeocoder(): Promise<void> {
  if (process.env.PHOTON_URL) return;
  const turn = searchQueue.then(async () => {
    const delay = Math.max(0, 750 - (Date.now() - lastSearch));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastSearch = Date.now();
  });
  searchQueue = turn.catch(() => undefined);
  await turn;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const cacheKey = query.toLocaleLowerCase();
  const entry = searchCache.get(cacheKey);
  if (entry && Date.now() - entry.at < 30 * 60_000) return entry.places;
  await waitForPublicGeocoder();
  const url = new URL("/api/", process.env.PHOTON_URL || "https://photon.komoot.io");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9_000), headers: { "User-Agent": userAgent } });
    if (!response.ok) throw new Error("Geocoder failed");
    const data = await response.json() as { features?: {
      geometry: { coordinates: [number, number] };
      properties: Record<string, string | number | undefined>;
    }[] };
    const places = (data.features ?? []).flatMap(({ geometry, properties: p }) => {
      const [longitude, latitude] = geometry.coordinates;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const address = [p.housenumber, p.street].filter(Boolean).join(" ");
      const name = String(p.name || address || p.city || p.county || "Unnamed place");
      const detail = [...new Set([p.city, p.state, p.country])].filter(part => part && part !== name).join(", ");
      return [{ id: `${p.osm_type}-${p.osm_id ?? latitude}`, name, detail, latitude, longitude }];
    });
    if (searchCache.size >= 500) searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(cacheKey, { at: Date.now(), places });
    return places;
  } catch { throw new RequestError("Place search is temporarily unavailable.", 503); }
}

function incidentPolygon(bounds: GeographicBounds) {
  const [w, s, e, n] = boundsTuple(bounds);
  return polygon([[[w, s], [e, s], [e, n], [w, n], [w, s]]]);
}

let lastRoute = 0;
export async function standardRoute(origin: Coordinate, destination: Coordinate, incidents: IncidentSummary[]): Promise<IncidentRoute> {
  const unset: IncidentRoute = { status: "unavailable", coordinates: [], distanceMeters: 0, reason: "No walking route was found." };
  if (!process.env.OSRM_FOOT_URL && Date.now() - lastRoute < 1000) {
    throw new RequestError("Wait briefly before requesting another route.", 429);
  }
  lastRoute = Date.now();
  const pair = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const base = (process.env.OSRM_FOOT_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/$/, "");
  const url = `${base}/route/v1/driving/${pair}?overview=full&geometries=geojson&alternatives=true`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000), headers: { "User-Agent": userAgent, Referer: "https://aftermap-makeuc.vercel.app/" },
    });
    const data = await response.json() as { code?: string; routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
    if (!response.ok && data.code !== "NoRoute" && data.code !== "NoSegment") throw new Error("Router failed");
    const routes = data.routes ?? [];
    if (!routes.length) return unset;
    const safe = routes.find(route => route.geometry.coordinates.length >= 2 &&
      !incidents.some(incident => booleanIntersects(lineString(route.geometry.coordinates), incidentPolygon(incident.bounds))));
    if (!safe) return { ...unset, reason: "Available routes pass through an incident. Choose points on its reported passage network." };
    return { status: "complete", coordinates: safe.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      distanceMeters: Math.round(safe.distance), reason: "Standard walking route outside mapped incidents." };
  } catch { throw new RequestError("The walking route service is temporarily unavailable.", 503); }
}
