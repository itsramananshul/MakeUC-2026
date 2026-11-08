import { booleanIntersects } from "@turf/boolean-intersects";
import { lineString, polygon } from "@turf/helpers";
import { boundsTuple, incidentCoverage, lngLat, type Coordinate, type GeographicBounds, type IncidentSummary } from "./incident-types";

export function coveragePolygon(bounds: GeographicBounds) {
  const [w, s, e, n] = boundsTuple(bounds);
  return polygon([[[w, s], [e, s], [e, n], [w, n], [w, s]]]);
}

export function crossesIncident(points: Coordinate[], incidents: IncidentSummary[], allowedId?: string) {
  if (points.length < 2 || !incidents.length) return false;
  const line = lineString(points.map(lngLat));
  return incidents.some(incident => {
    if (incident.id === allowedId) return false;
    return incidentCoverage(incident).some(bounds => booleanIntersects(line, coveragePolygon(bounds)));
  });
}
