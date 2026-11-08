import { boundsTuple, distanceMeters, within, type Coordinate, type GeographicBounds,
  type IncidentRoute, type IncidentSummary, type Place, type Road, type RouteOption, type TravelMode } from "./incident-types";
import { crossesIncident } from "./route-boundaries";
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

let lastRoute = 0;
let routeQueue: Promise<void> = Promise.resolve();

async function waitForPublicRouter() {
  const turn = routeQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastRoute));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastRoute = Date.now();
  });
  routeQueue = turn.catch(() => undefined);
  await turn;
}

function router(mode: Exclude<TravelMode, "transit">) {
  if (mode === "driving") return {
    base: process.env.OSRM_CAR_URL || "https://router.project-osrm.org",
    configured: !!process.env.OSRM_CAR_URL,
  };
  if (mode === "cycling") return {
    base: process.env.OSRM_BIKE_URL || "https://routing.openstreetmap.de/routed-bike",
    configured: !!process.env.OSRM_BIKE_URL,
  };
  return {
    base: process.env.OSRM_FOOT_URL || "https://routing.openstreetmap.de/routed-foot",
    configured: !!process.env.OSRM_FOOT_URL,
  };
}

type RoutingStep = {
  distance: number; name: string; ref?: string; destinations?: string;
  maneuver: { type: string; modifier?: string; exit?: number };
};
type RoutingOption = { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: RoutingStep[] }[] };

function describeStep({ maneuver, name, ref, destinations }: RoutingStep) {
  const { type, modifier, exit } = maneuver;
  const road = name || ref || destinations;
  if (type === "arrive") return "Arrive at the destination";
  if (type === "roundabout" || type === "rotary") {
    return exit ? `Take exit ${exit} at the roundabout${road ? ` onto ${road}` : ""}` : "Enter the roundabout";
  }
  const direction = modifier && modifier !== "straight" ? ` ${modifier === "uturn" ? "back" : modifier}` : "";
  const action = type === "depart" ? "Start" : type === "merge" ? `Merge${direction}` :
    type === "fork" ? `Keep${direction}` : type === "on ramp" || type === "off ramp" ? "Take the ramp" :
      type === "turn" && direction ? `Turn${direction}` : `Continue${direction}`;
  return road ? `${action} onto ${road}` : action;
}

export async function standardRoute(origin: Coordinate, destination: Coordinate, incidents: IncidentSummary[],
  mode: TravelMode = "walking"): Promise<IncidentRoute> {
  const unset: IncidentRoute = { status: "unavailable", coordinates: [], distanceMeters: 0,
    reason: `No ${mode} route connects these points. Check the two locations or try another travel mode.` };
  if (distanceMeters(origin, destination) < 1) return { ...unset, reason: "Choose a different destination." };
  if (mode === "transit") return { ...unset, reason: "Transit routing is not available from the configured routing service." };
  const selectedRouter = router(mode);
  if (!selectedRouter.configured) await waitForPublicRouter();
  const pair = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const base = selectedRouter.base.replace(/\/$/, "");
  const url = `${base}/route/v1/driving/${pair}?overview=full&geometries=geojson&alternatives=2&steps=true&radiuses=2000;2000`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000), headers: { "User-Agent": userAgent, Referer: "https://aftermap-makeuc.vercel.app/" },
    });
    const data = await response.json() as { code?: string; routes?: RoutingOption[] };
    if (!response.ok && data.code !== "NoRoute" && data.code !== "NoSegment") throw new Error("Router failed");
    const routes = data.routes ?? [];
    if (!routes.length) return unset;
    const options: RouteOption[] = routes.map(route => ({
      distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration),
      coordinates: route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      steps: route.legs.flatMap(leg => leg.steps.map(step => ({
        instruction: describeStep(step), distanceMeters: Math.round(step.distance),
      }))),
    })).filter(option => option.coordinates.length >= 2 && !crossesIncident(option.coordinates, incidents));
    if (!options.length) return { ...unset, reason: "Every available route enters an affected area. Choose points on its reported passage network." };
    return { status: "complete", distanceMeters: options[0].distanceMeters, coordinates: options[0].coordinates,
      expectedTravelTime: options[0].durationSeconds, reason: `Standard ${mode} route outside mapped incidents.`, options };
  } catch { throw new RequestError("The route service is temporarily unavailable. Try again shortly.", 503); }
}
