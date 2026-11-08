export type Coordinate = { latitude: number; longitude: number };
export type RouteTravelMode = "driving" | "walking" | "cycling" | "transit";
export type GeographicBounds = { west: number; south: number; east: number; north: number };
export type RoadState = "unknown" | "open" | "blocked" | "hazard" | "conflict";
export type Road = { id: string; from: Coordinate; to: Coordinate; state: RoadState; label: string };
export type FieldReport = {
  id: string; displayName: string; edgeId?: string; condition?: "open" | "blocked" | "hazard";
  note: string; at: string; evidenceType: "manual" | "text" | "voice" | "image";
  location?: Coordinate; evidenceUrl?: string;
};
export type IncidentImagery = { url: string; bounds: GeographicBounds; source: string; timestamp: string };
export type IncidentSummary = {
  id: string; name: string; kind: "incident"; bounds: GeographicBounds; imagery: IncidentImagery | null; surveys?: IncidentImagery[];
  version: number; roadCount: number;
};
export type Incident = IncidentSummary & { roads: Road[]; reports: FieldReport[] };
export type Place = { id: string; name: string; detail: string; latitude: number; longitude: number };
export type IncidentRoute = {
  status: "complete" | "partial" | "unavailable"; coordinates: Coordinate[]; distanceMeters: number;
  reason: string; startLabel?: string; endLabel?: string;
};
export const coordinateKey = (point: Coordinate) => `${point.longitude.toFixed(7)},${point.latitude.toFixed(7)}`;
export const lngLat = (point: Coordinate): [number, number] => [point.longitude, point.latitude];
export const boundsTuple = (bounds: GeographicBounds): [number, number, number, number] =>
  [bounds.west, bounds.south, bounds.east, bounds.north];
export const within = (point: Coordinate, bounds: GeographicBounds) =>
  point.longitude >= bounds.west && point.longitude <= bounds.east &&
  point.latitude >= bounds.south && point.latitude <= bounds.north;
export function distanceMeters(a: Coordinate, b: Coordinate) {
  const radians = Math.PI / 180;
  const dy = (b.latitude - a.latitude) * radians;
  const dx = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dy / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dx / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
