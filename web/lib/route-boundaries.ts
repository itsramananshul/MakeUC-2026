import { booleanIntersects } from "@turf/boolean-intersects";
import { lineString, polygon } from "@turf/helpers";
import { boundsTuple, lngLat, type Coordinate, type IncidentSummary } from "./incident-types";

export function crossesIncident(points: Coordinate[], incidents: IncidentSummary[], allowedId?: string) {
  if (points.length < 2 || !incidents.length) return false;
  const line = lineString(points.map(lngLat));
  return incidents.some(incident => {
    if (incident.id === allowedId) return false;
    const [w, s, e, n] = boundsTuple(incident.bounds);
    return booleanIntersects(line, polygon([[[w, s], [e, s], [e, n], [w, n], [w, s]]]));
  });
}
