import { UndirectedGraph } from "graphology";
import { bidirectional, singleSource } from "graphology-shortest-path/dijkstra";
import { nearestPoint } from "./geography";
import { coordinateKey, distanceMeters, roadLegs, withinIncident, type Coordinate, type Incident, type IncidentRoute, type IncidentSummary, type Road } from "./incident-types";
import { crossesReportedClosure } from "./incident-route-assessment";
import { crossesIncident } from "./route-boundaries";

type Node = Coordinate & { label: string };
type Graph = UndirectedGraph<Node, { weight: number; unverified: boolean }>;
const noRoute = (reason: string): IncidentRoute => ({ status: "unavailable", coordinates: [], distanceMeters: 0, reason });

function add(graph: Graph, point: Coordinate, label: string) {
  const key = coordinateKey(point);
  graph.mergeNode(key, { ...point, label });
  return key;
}
function link(graph: Graph, from: string, to: string, unverified = false) {
  if (from === to || graph.hasEdge(from, to)) return;
  const distance = distanceMeters(graph.getNodeAttributes(from), graph.getNodeAttributes(to));
  graph.addUndirectedEdge(from, to, { weight: unverified ? distance * 1.6 : distance, unverified });
}
function project(point: Coordinate, roads: Road[]) {
  let best: { road: Road; point: Coordinate; gap: number } | undefined;
  for (const road of roads) {
    const candidate = nearestPoint(point, road.from, road.to);
    const gap = distanceMeters(point, candidate);
    if (!best || gap < best.gap || (gap < best.gap + .01 && road.state === "open" && best.road.state !== "open")) {
      best = { road, point: candidate, gap };
    }
  }
  return best;
}

export function incidentRoute(incident: Incident, origin: Coordinate, destination: Coordinate,
  incidents: IncidentSummary[] = []): IncidentRoute {
  return findRoute(incident, origin, destination, incidents, false);
}

export function mappedIncidentRoute(incident: Incident, origin: Coordinate, destination: Coordinate,
  incidents: IncidentSummary[]): IncidentRoute {
  return findRoute(incident, origin, destination, incidents, true);
}

function findRoute(incident: Incident, origin: Coordinate, destination: Coordinate,
  incidents: IncidentSummary[], preview: boolean): IncidentRoute {
  if (!preview && !withinIncident(origin, incident)) return noRoute("Choose a starting point inside the incident.");
  if (distanceMeters(origin, destination) < 1) return noRoute("Choose a different destination.");
  const graph: Graph = new UndirectedGraph();
  const segmentKey = (road: Road) => [coordinateKey(road.from), coordinateKey(road.to)].sort().join("|");
  const segments = incident.roads.flatMap(roadLegs);
  const excluded = preview ? new Set(segments.filter(road => road.state !== "open" && road.state !== "unknown").map(segmentKey)) : null;
  const usable = segments.filter(road => (road.state === "open" || (preview && road.state === "unknown")) &&
    !excluded?.has(segmentKey(road)));
  if (preview) usable.sort((a, b) => Number(b.state === "open") - Number(a.state === "open"));
  for (const road of usable) link(graph, add(graph, road.from, road.label), add(graph, road.to, road.label), road.state !== "open");
  const splits = new Map<Road, { id: string; offset: number }[]>();
  function connect(snap: NonNullable<ReturnType<typeof project>>) {
    const { road, point } = snap;
    const id = add(graph, point, road.label);
    let points = splits.get(road);
    if (!points) {
      points = [
        { id: coordinateKey(road.from), offset: 0 },
        { id: coordinateKey(road.to), offset: distanceMeters(road.from, road.to) },
      ];
      splits.set(road, points);
    }
    points.push({ id, offset: distanceMeters(road.from, point) });
    return id;
  }
  if (preview) {
    const streets = usable.filter(road => road.id.startsWith("osm-"));
    for (const passage of incident.roads.filter(road => road.state === "open" && road.id.startsWith("field-"))) {
      for (const end of [passage.from, passage.to]) {
        if (!graph.hasNode(coordinateKey(end))) continue;
        const snap = project(end, streets);
        if (!snap || snap.gap > 12) continue;
        const junction = connect(snap);
        link(graph, coordinateKey(end), junction, true);
      }
    }
  }
  const snappingRoads = preview ? usable : segments;
  const openRoads = segments.filter(road => road.state === "open");
  function snapEndpoint(point: Coordinate, limit: number) {
    const nearest = project(point, snappingRoads);
    if (nearest?.road.state === "open") return nearest;
    const open = project(point, openRoads);
    if (!open || open.gap > limit || crossesReportedClosure(point, open.point, segments)) return nearest;
    return open;
  }
  const start = snapEndpoint(origin, 20), finish = snapEndpoint(destination, 15);
  const snapLimit = preview ? 35 : 20;
  if (!start || (!preview && start.road.state !== "open") || start.gap > snapLimit ||
      crossesReportedClosure(origin, start.point, segments)) {
    return noRoute("The starting point is not close enough to a reported open passage.");
  }
  const startId = connect(start);
  const finishId = finish && finish.gap <= (preview ? snapLimit : 15) && (preview || finish.road.state === "open") &&
    (preview || withinIncident(destination, incident)) && !crossesReportedClosure(destination, finish.point, segments)
    ? connect(finish) : null;
  for (const [road, points] of splits) {
    points.sort((a, b) => a.offset - b.offset);
    for (let index = 1; index < points.length; index++) {
      link(graph, points[index - 1].id, points[index].id, road.state !== "open");
    }
  }
  let path = finishId ? bidirectional(graph, startId, finishId, "weight") : null;
  const complete = !!path && path.length > 1;
  if (!complete) {
    if (preview) return noRoute("The mapped streets do not connect these points.");
    const reached = singleSource(graph, startId, "weight");
    let closest = distanceMeters(start.point, destination);
    for (const [id, candidate] of Object.entries(reached)) {
      const gap = distanceMeters(graph.getNodeAttributes(id), destination);
      if (candidate.length > 1 && gap < closest) { closest = gap; path = candidate; }
    }
  }
  if (!path || path.length < 2) return noRoute("No connected reported open passage leads toward that destination.");
  const coordinates = path.map(id => {
    const { latitude, longitude } = graph.getNodeAttributes(id);
    return { latitude, longitude };
  });
  if (crossesIncident(coordinates, incidents, incident.id)) {
    return noRoute("This route enters another incident. The connection between incident areas is unverified.");
  }
  const distance = coordinates.slice(1).reduce((sum, next, i) => sum + distanceMeters(coordinates[i], next), 0);
  const unverifiedSegments = preview ? path.slice(1).flatMap((node, index) =>
    graph.getEdgeAttribute(path[index], node, "unverified") ? [index] : []) : undefined;
  return {
    status: complete ? "complete" : "partial", coordinates, distanceMeters: Math.round(distance), incidentId: incident.id,
    ...(unverifiedSegments?.length ? { unverifiedSegments } : {}),
    startLabel: graph.getNodeAttribute(startId, "label"),
    endLabel: graph.getNodeAttribute(path.at(-1)!, "label"),
    reason: unverifiedSegments?.length ? "Dashed sections follow mapped streets with no report confirming they’re open." :
      complete ? "Candidate walking route along reported open passages." :
      "The route ends at the closest reachable reported passage. The remaining connection is unverified.",
  };
}
