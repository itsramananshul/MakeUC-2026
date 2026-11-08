import { booleanIntersects } from "@turf/boolean-intersects";
import { lineString } from "@turf/helpers";
import { nearestPoint } from "./geography";
import { getIncident } from "./incident-store";
import { distanceMeters, incidentCoverage, lngLat, roadLegs, type Coordinate, type Incident, type IncidentSummary, type Road, type RouteOption } from "./incident-types";
import { coveragePolygon } from "./route-boundaries";

const closed = (road: Road) => road.state === "blocked" || road.state === "hazard" || road.state === "conflict";

function closureSegments(roads: Road[]) {
  return roads.filter(closed).flatMap(roadLegs).map(road => {
    const trim = Math.min(.25, .01 / distanceMeters(road.from, road.to));
    const at = (fraction: number): [number, number] => [
      road.from.longitude + (road.to.longitude - road.from.longitude) * fraction,
      road.from.latitude + (road.to.latitude - road.from.latitude) * fraction,
    ];
    // A route may meet the road at its end to turn onto a different street.
    return { road, interior: lineString([at(trim), at(1 - trim)]) };
  });
}

function hitsClosure(from: Coordinate, to: Coordinate, closures: ReturnType<typeof closureSegments>,
  segment = lineString([lngLat(from), lngLat(to)])) {
  return closures.some(({ road, interior }) => booleanIntersects(segment, interior) || followsClosedRoad(from, to, road));
}

export function crossesReportedClosure(from: Coordinate, to: Coordinate, roads: Road[]) {
  return distanceMeters(from, to) > .01 && hitsClosure(from, to, closureSegments(roads));
}

export function avoidClosures(incident: Incident): Incident {
  const closures = closureSegments(incident.roads);
  if (!closures.length) return incident;
  const roads = incident.roads.filter(road => closed(road) ||
    roadLegs(road).every(leg => !hitsClosure(leg.from, leg.to, closures)));
  return { ...incident, roads };
}

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

export function assessIncidentRoutes(incidents: IncidentSummary[], details = new Map<string, Incident>()) {
  function incidentDetails(id: string) {
    const detail = details.get(id) ?? getIncident(id);
    details.set(id, detail);
    return detail;
  }
  return function assess(option: RouteOption): RouteOption | null {
    const line = lineString(option.coordinates.map(lngLat));
    const affected = incidents.flatMap(incident => {
      const areas = incidentCoverage(incident).map(coveragePolygon).filter(area => booleanIntersects(line, area));
      return areas.length ? [{ areas, detail: incidentDetails(incident.id) }] : [];
    });
    if (!affected.length) return option;
    const areas = affected.flatMap(incident => incident.areas);
    const closures = affected.flatMap(({ detail }) => closureSegments(detail.roads));
    const hazards = affected.flatMap(({ detail }) => detail.reports.flatMap(report =>
      !report.edgeId && report.location && (report.condition === "blocked" || report.condition === "hazard") ? [report.location] : []));
    const unverifiedSegments: number[] = [];
    for (let index = 1; index < option.coordinates.length; index++) {
      const from = option.coordinates[index - 1], to = option.coordinates[index];
      const segment = lineString([lngLat(from), lngLat(to)]);
      if (hitsClosure(from, to, closures, segment) ||
          hazards.some(point => distanceMeters(point, nearestPoint(point, from, to)) < 8)) return null;
      if (areas.some(area => booleanIntersects(segment, area))) unverifiedSegments.push(index - 1);
    }
    return { ...option, unverifiedSegments };
  }
}
