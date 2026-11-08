import { assessIncidentRoutes, avoidClosures } from "./incident-route-assessment";
import { incidentRoute, mappedIncidentRoute } from "./incident-route";
import { getIncident } from "./incident-store";
import { distanceMeters, withinIncident, type Coordinate, type Incident, type IncidentSummary } from "./incident-types";
import { loadRoads, standardRoute } from "./osm";

export async function walkingDirections(origin: Coordinate, destination: Coordinate, incidents: IncidentSummary[]) {
  const common = incidents.find(incident => withinIncident(origin, incident) && withinIncident(destination, incident));
  const touching = common ?? incidents.find(incident => withinIncident(origin, incident) || withinIncident(destination, incident));
  const local = touching ? getIncident(touching.id) : null;
  const assess = assessIncidentRoutes(incidents, local ? new Map([[local.id, local]]) : undefined);
  const reported = common && local ? incidentRoute(avoidClosures(local), origin, destination, incidents) : null;

  const passesAssessment = (route: ReturnType<typeof incidentRoute>) => route.coordinates.length > 1 &&
    assess({ ...route, steps: [], durationSeconds: 0 });
  if (reported?.status === "complete" && passesAssessment(reported)) return reported;
  const fieldPassage = local?.roads.some(road => road.state === "open" && road.id.startsWith("field-"));
  const hasReportedSegment = (route: ReturnType<typeof incidentRoute>) =>
    (route.unverifiedSegments?.length ?? 0) < route.coordinates.length - 1;
  function tryMapped(incident: Incident) {
    const route = mappedIncidentRoute(avoidClosures(incident), origin, destination, incidents);
    return route.status === "complete" && passesAssessment(route) ? route : null;
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
  return reported?.status === "partial" && passesAssessment(reported) ? reported : route;
}
