import { booleanIntersects } from "@turf/boolean-intersects";
import { lineString } from "@turf/helpers";
import { nearestPoint } from "./geography";
import { incidentRoute, mappedIncidentRoute } from "./incident-route";
import { getIncident } from "./incident-store";
import { distanceMeters, incidentCoverage, lngLat, withinIncident, type Coordinate, type Incident, type IncidentSummary, type Road, type RouteOption } from "./incident-types";
import { loadRoads, standardRoute } from "./osm";
import { coveragePolygon } from "./route-boundaries";

const closed = (road: Road) => road.state === "blocked" || road.state === "hazard" || road.state === "conflict";

function followsClosedRoad(from: Coordinate, to: Coordinate, road: Road) {
  const scale = Math.cos(road.from.latitude * Math.PI / 180);
  const dx = (road.to.longitude - road.from.longitude) * scale;
  const dy = road.to.latitude - road.from.latitude;
  const length = Math.hypot(dx, dy);
  if (!length) return false;
  const projection = (point: Coordinate) =>
    ((point.longitude - road.from.longitude) * scale * dx + (point.latitude - road.from.latitude) * dy) / length;
  const first = projection(from), last = projection(to);
  const start = Math.max(0, Math.min(first, last));
  const end = Math.min(length, Math.max(first, last));
  const segmentLength = Math.hypot((to.longitude - from.longitude) * scale, to.latitude - from.latitude);
  if (end - start < Math.min(length, segmentLength) * .2 || Math.abs(last - first) < segmentLength * .8 || first === last) return false;
  const fraction = ((start + end) / 2 - first) / (last - first);
  const middle = { latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    longitude: from.longitude + (to.longitude - from.longitude) * fraction };
  return distanceMeters(middle, nearestPoint(middle, road.from, road.to)) < 8;
}

export async function walkingDirections(origin: Coordinate, destination: Coordinate, incidents: IncidentSummary[]) {
  const common = incidents.find(incident => withinIncident(origin, incident) && withinIncident(destination, incident));
  const details = new Map<string, Incident>();
  const incidentDetails = (id: string) => {
    const detail = details.get(id) ?? getIncident(id);
    details.set(id, detail);
    return detail;
  };
  const local = common ? incidentDetails(common.id) : null;
  const reported = local ? incidentRoute(local, origin, destination, incidents) : null;
  function assess(option: RouteOption): RouteOption | null {
    const line = lineString(option.coordinates.map(lngLat));
    const affected = incidents.flatMap(incident => {
      const areas = incidentCoverage(incident).map(coveragePolygon).filter(area => booleanIntersects(line, area));
      return areas.length ? [{ areas, detail: incidentDetails(incident.id) }] : [];
    });
    if (!affected.length) return option;
    const areas = affected.flatMap(incident => incident.areas);
    const closures = affected.flatMap(({ detail }) => detail.roads.filter(closed));
    const hazards = affected.flatMap(({ detail }) => detail.reports.flatMap(report =>
      !report.edgeId && report.location && (report.condition === "blocked" || report.condition === "hazard") ? [report.location] : []));
    const unverifiedSegments: number[] = [];
    for (let index = 1; index < option.coordinates.length; index++) {
      const from = option.coordinates[index - 1], to = option.coordinates[index];
      if (closures.some(road => followsClosedRoad(from, to, road)) ||
          hazards.some(point => distanceMeters(point, nearestPoint(point, from, to)) < 8)) return null;
      if (areas.some(area => booleanIntersects(lineString([lngLat(from), lngLat(to)]), area))) unverifiedSegments.push(index - 1);
    }
    return { ...option, unverifiedSegments };
  }

  const usable = (route: ReturnType<typeof incidentRoute>) => route.status === "complete" &&
    assess({ ...route, steps: [], durationSeconds: 0 });
  if (reported && usable(reported)) return reported;
  const fieldPassage = local?.roads.some(road => road.state === "open" && road.id.startsWith("field-"));
  const hasReportedSegment = (route: ReturnType<typeof incidentRoute>) =>
    (route.unverifiedSegments?.length ?? 0) < route.coordinates.length - 1;
  function tryMapped(incident: Incident) {
    const closures = incident.roads.filter(closed);
    const roads = incident.roads.filter(road => road.state !== "unknown" ||
      !closures.some(closure => followsClosedRoad(road.from, road.to, closure)));
    const route = mappedIncidentRoute({ ...incident, roads }, origin, destination, incidents);
    return usable(route) ? route : null;
  }
  const stored = local?.roads.length ? tryMapped(local) : null;
  if (stored && (!fieldPassage || hasReportedSegment(stored))) return stored;

  async function nearbyRoute(incident: Incident) {
    if (distanceMeters(origin, destination) > 4000) return null;
    try {
      const padding = .0018;
      const roads = await loadRoads({
        west: Math.max(-180, Math.min(origin.longitude, destination.longitude) - padding),
        south: Math.max(-85, Math.min(origin.latitude, destination.latitude) - padding),
        east: Math.min(180, Math.max(origin.longitude, destination.longitude) + padding),
        north: Math.min(85, Math.max(origin.latitude, destination.latitude) + padding),
      });
      const existing = new Set(incident.roads.map(road => road.id));
      return tryMapped({ ...incident, roads: [...incident.roads, ...roads.filter(road => !existing.has(road.id))] });
    } catch { return null; }
  }

  const connected = local && fieldPassage ? await nearbyRoute(local) : null;
  if (connected && hasReportedSegment(connected)) return connected;
  const route = await standardRoute(origin, destination, incidents, "walking", assess);
  if (route.status === "complete" || !local) return route;
  const alternate = stored ?? connected ?? (fieldPassage ? null : await nearbyRoute(local));
  if (alternate) return alternate;
  return reported?.status === "partial" ? reported : route;
}
