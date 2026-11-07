import { UndirectedGraph } from "graphology";
import { bidirectional, singleSource } from "graphology-shortest-path/dijkstra";
import { nearestPoint } from "./geography";
import { coordinateKey, distanceMeters, within, type Coordinate, type Incident, type IncidentRoute, type Road } from "./incident-types";

type Node = Coordinate & { label: string };
type Graph = UndirectedGraph<Node, { weight: number }>;
const noRoute = (reason: string): IncidentRoute => ({ status: "unavailable", coordinates: [], distanceMeters: 0, reason });

function add(graph: Graph, point: Coordinate, label: string) {
  const key = coordinateKey(point);
  graph.mergeNode(key, { ...point, label });
  return key;
}
function link(graph: Graph, from: string, to: string) {
  if (from === to || graph.hasEdge(from, to)) return;
  graph.addUndirectedEdge(from, to, { weight: distanceMeters(graph.getNodeAttributes(from), graph.getNodeAttributes(to)) });
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

export function incidentRoute(incident: Incident, origin: Coordinate, destination: Coordinate): IncidentRoute {
  if (!within(origin, incident.bounds)) return noRoute("Choose a starting point inside the incident.");
  if (distanceMeters(origin, destination) < 1) return noRoute("Choose a different destination.");
  const graph: Graph = new UndirectedGraph();
  const usable = incident.roads.filter(road => road.state === "open");
  for (const road of usable) link(graph, add(graph, road.from, road.label), add(graph, road.to, road.label));
  const start = project(origin, incident.roads), finish = project(destination, incident.roads);
  if (!start || start.road.state !== "open" || start.gap > 20) {
    return noRoute("The starting point is not close enough to a reported open passage.");
  }
  function connect(snap: NonNullable<ReturnType<typeof project>>) {
    const id = add(graph, snap.point, snap.road.label);
    link(graph, id, coordinateKey(snap.road.from)); link(graph, id, coordinateKey(snap.road.to));
    return id;
  }
  const startId = connect(start);
  const finishId = finish && finish.gap <= 15 && finish.road.state === "open" && within(destination, incident.bounds)
    ? connect(finish) : null;
  if (finishId && finish?.road.id === start.road.id) link(graph, startId, finishId);
  let path = finishId ? bidirectional(graph, startId, finishId, "weight") : null;
  const complete = !!path && path.length > 1;
  if (!complete) {
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
  const distance = coordinates.slice(1).reduce((sum, next, i) => sum + distanceMeters(coordinates[i], next), 0);
  return {
    status: complete ? "complete" : "partial", coordinates, distanceMeters: Math.round(distance),
    startLabel: graph.getNodeAttribute(startId, "label"),
    endLabel: graph.getNodeAttribute(path.at(-1)!, "label"),
    reason: complete ? "Candidate walking route along reported open passages." :
      "The route ends at the closest reachable reported passage. The remaining connection is unverified.",
  };
}
