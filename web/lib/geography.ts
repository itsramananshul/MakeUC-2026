import type { Bounds } from "./imagery-frame";
import type { Coordinate, GeographicBounds } from "./incident-types";
const radius = 6_378_137;
const degrees = 180 / Math.PI;
export function unproject(x: number, y: number): Coordinate {
  return { longitude: x / radius * degrees, latitude: Math.atan(Math.sinh(y / radius)) * degrees };
}
export function geographicBounds(bounds: Bounds): GeographicBounds {
  const lower = unproject(bounds[0], bounds[1]);
  const upper = unproject(bounds[2], bounds[3]);
  return { west: lower.longitude, south: lower.latitude, east: upper.longitude, north: upper.latitude };
}
export function midpoint(bounds: GeographicBounds): Coordinate {
  return { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 };
}
export function nearestPoint(target: Coordinate, from: Coordinate, to: Coordinate) {
  const scale = Math.cos(target.latitude / degrees);
  const dx = (to.longitude - from.longitude) * scale, dy = to.latitude - from.latitude;
  const u = dx * dx + dy * dy;
  const f = u === 0 ? 0 : Math.max(0, Math.min(1,
    ((target.longitude - from.longitude) * scale * dx + (target.latitude - from.latitude) * dy) / u));
  return { latitude: from.latitude + (to.latitude - from.latitude) * f,
    longitude: from.longitude + (to.longitude - from.longitude) * f };
}
