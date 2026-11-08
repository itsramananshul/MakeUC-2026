import { nearestPoint } from "./geography";
import { distanceMeters, type Coordinate, type IncidentRoute, type RouteOption, type TravelMode } from "./incident-types";

export type NavigationRoute = IncidentRoute & { steps?: RouteOption["steps"]; durationSeconds?: number };
export type NavigationFix = Coordinate & { accuracy: number };

export const navigationLimits = {
  walking: { accuracy: 35, offRoute: 24, arrival: 15, zoom: 17 },
  cycling: { accuracy: 45, offRoute: 35, arrival: 20, zoom: 16.5 },
  driving: { accuracy: 65, offRoute: 55, arrival: 30, zoom: 16 },
} satisfies Record<TravelMode, { accuracy: number; offRoute: number; arrival: number; zoom: number }>;

export function indexRoute(route: NavigationRoute) {
  const segments = [];
  let length = 0;
  for (let index = 1; index < route.coordinates.length; index++) {
    const from = route.coordinates[index - 1];
    const to = route.coordinates[index];
    const meters = distanceMeters(from, to);
    if (meters === 0) continue;
    segments.push({ from, to, meters, start: length });
    length += meters;
  }
  let offset = 0;
  const steps = (route.steps ?? []).map(step => {
    const maneuver = { instruction: step.instruction, offset };
    offset += step.distanceMeters;
    return maneuver;
  });
  return { segments, length, steps };
}

export function navigationProgress(position: Coordinate, path: ReturnType<typeof indexRoute>, previous: number) {
  let closest = { gap: Infinity, along: 0 };
  for (const segment of path.segments) {
    const point = nearestPoint(position, segment.from, segment.to);
    const gap = distanceMeters(position, point);
    const along = segment.start + Math.min(segment.meters, distanceMeters(segment.from, point));
    const betterContinuity = Math.abs(along - previous) < Math.abs(closest.along - previous);
    if (gap < closest.gap - 2 || (gap < closest.gap + 2 && betterContinuity)) closest = { gap, along };
  }
  const remaining = Math.max(0, path.length - closest.along);
  const next = path.steps.find(step => step.offset >= closest.along - 6);
  return {
    ...closest, remaining,
    instruction: next?.instruction ?? "Continue along the route",
    nextIn: next ? Math.max(0, next.offset - closest.along) : remaining,
  };
}
