import { UndirectedGraph } from "graphology";
import { bidirectional, singleSource } from "graphology-shortest-path/dijkstra";
import { nearestPoint } from "./geography";
import { coordinateKey, distanceMeters, withinIncident, type Coordinate, type Incident, type IncidentRoute, type IncidentSummary, type Road } from "./incident-types";
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
  if (!withinIncident(origin, incident)) return noRoute("Choose a starting point inside the incident.");
  if (distanceMeters(origin, destination) < 1) return noRoute("Choose a different destination.");
  const graph: Graph = new UndirectedGraph();
  const segmentKey = (road: Road) => [coordinateKey(road.from), coordinateKey(road.to)].sort().join("|");
  const excluded = preview ? new Set(incident.roads.filter(road => road.state !== "open" && road.state !== "unknown").map(segmentKey)) : null;
  const usable = incident.roads.filter(road => (road.state === "open" || (preview && road.state === "unknown")) &&
    !excluded?.has(segmentKey(road)));
  if (preview) usable.sort((a, b) => Number(b.state === "open") - Number(a.state === "open"));
  for (const road of usable) link(graph, add(graph, road.from, road.label), add(graph, road.to, road.label), road.state !== "open");
  const snappingRoads = preview ? usable : incident.roads;
  const start = project(origin, snappingRoads), finish = project(destination, snappingRoads);
  if (!start || (!preview && start.road.state !== "open") || start.gap > 20) {
    return noRoute("The starting point is not close enough to a reported open passage.");
  }
  function connect(snap: NonNullable<ReturnType<typeof project>>) {
    const id = add(graph, snap.point, snap.road.label);
    link(graph, id, coordinateKey(snap.road.from), snap.road.state !== "open");
    link(graph, id, coordinateKey(snap.road.to), snap.road.state !== "open");
    return id;
  }
  const startId = connect(start);
  const finishId = finish && finish.gap <= (preview ? 20 : 15) && (preview || finish.road.state === "open") && withinIncident(destination, incident)
    ? connect(finish) : null;
  if (finishId && finish?.road.id === start.road.id) link(graph, startId, finishId, start.road.state !== "open");
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
