import type { ImageryLayer } from "./imagery-frame";

export type Checkpoint = {
  id: string; label: string; x: number; y: number;
  kind: "entrance" | "checkpoint" | "room" | "exit";
};
export type PassageStatus = "open" | "blocked" | "hazard";
export type EdgeState = PassageStatus | "unknown" | "conflict";
export type EvidenceType = "manual" | "text" | "voice" | "image";
export type Edge = {
  id: string; from: string; to: string; label: string; distance: number;
  state: EdgeState; discovered: boolean; lastObservationAt: string | null;
  observationIds: string[];
};
export type Participant = {
  id: string; displayName: string; checkpointId: string | null; lastSeenAt: string;
};
export type Report = {
  id: string; observerId: string; checkpointId: string;
  kind: "passage" | "exit" | "help"; from?: string; to?: string; nodeId?: string;
  status?: PassageStatus; evidenceType: EvidenceType; confidence?: number;
  note?: string; confirmed: true;
};
export type Observation = Report & {
  timestamp: string; displayName: string; edgeId?: string; discovery?: boolean;
};
export type Route = { nodeIds: string[]; edgeIds: string[]; distance: number };
export type Snapshot = {
  session: { code: string; name: string; mode: "drill" };
  version: number;
  nodes: Checkpoint[];
  edges: Edge[];
  participants: Participant[];
  observations: Observation[];
  route: Route | null;
  previousRoute: Route | null;
  imagery?: ImageryLayer;
  routeChange: { observationId: string; reason: string; at: string } | null;
};
export type Suggestion = Pick<Report, "kind" | "from" | "to" | "nodeId" | "status" | "note" | "confidence">;

export const DEMO_CODE = "WESTHALL";
export const DEFAULT_START = "SOUTH";
export const checkpoints: Checkpoint[] = [
  { id: "SOUTH", label: "Staging point", x: 325, y: 500, kind: "entrance" },
  { id: "ATRIUM", label: "Coastal junction", x: 391, y: 408, kind: "checkpoint" },
  { id: "WEST", label: "West checkpoint", x: 168, y: 389, kind: "checkpoint" },
  { id: "WEST-N", label: "West crossing", x: 223, y: 301, kind: "checkpoint" },
  { id: "CENTRAL", label: "Harbor junction", x: 483, y: 279, kind: "checkpoint" },
  { id: "EAST", label: "East crossing", x: 568, y: 166, kind: "checkpoint" },
  { id: "EAST-S", label: "Service junction", x: 711, y: 350, kind: "checkpoint" },
  { id: "EXIT", label: "East assembly", x: 650, y: 60, kind: "exit" },
  { id: "204", label: "Site 204", x: 302, y: 182, kind: "room" },
  { id: "STAIRS", label: "North checkpoint", x: 373, y: 215, kind: "checkpoint" },
  { id: "LAB", label: "Debris site", x: 625, y: 480, kind: "room" },
  { id: "STORE", label: "Supply site", x: 805, y: 222, kind: "room" },
];

export function edgeKey(from: string, to: string): string {
  return [from, to].sort().join(":");
}

function initialEdge(from: string, to: string, label: string, state: EdgeState = "unknown"): Edge {
  const a = checkpoints.find(node => node.id === from)!;
  const b = checkpoints.find(node => node.id === to)!;
  return {
    id: edgeKey(from, to), from, to, label, distance: Math.round(Math.hypot(a.x - b.x, a.y - b.y)),
    state, discovered: false, lastObservationAt: null, observationIds: [],
  };
}

export function initialWorld(): Snapshot {
  return {
    session: { code: DEMO_CODE, name: "Mexico Beach", mode: "drill" },
    version: 0, nodes: checkpoints,
    edges: [
      initialEdge("SOUTH", "ATRIUM", "South approach", "open"),
      initialEdge("ATRIUM", "CENTRAL", "Harbor Road"),
      initialEdge("CENTRAL", "EAST", "North approach", "open"),
      initialEdge("EAST", "EXIT", "Assembly approach", "open"),
      initialEdge("ATRIUM", "EAST-S", "Coastal detour", "open"),
      initialEdge("ATRIUM", "WEST", "West crossing path"),
      initialEdge("WEST", "WEST-N", "West passage"),
      initialEdge("WEST-N", "CENTRAL", "Site 204 approach"),
      initialEdge("WEST-N", "204", "Site 204 path"),
      initialEdge("CENTRAL", "STAIRS", "North checkpoint approach"),
      initialEdge("EAST-S", "LAB", "Debris site approach"),
      initialEdge("EAST-S", "STORE", "Supply site approach"),
    ],
    participants: [], observations: [], route: null, previousRoute: null, routeChange: null,
  };
}

export function verifiedExits(world: Snapshot): Set<string> {
  return new Set(world.observations.flatMap(item => item.kind === "exit" && item.nodeId ? [item.nodeId] : []));
}

export function findRoute(world: Snapshot, start = DEFAULT_START, end?: string): Route | null {
  const exits = verifiedExits(world);
  if (end && !exits.has(end)) return null;
  const destinations = end ? new Set([end]) : exits;
  if (!destinations.size || !world.nodes.some(node => node.id === start)) return null;
  const visited = new Set<string>();
  const candidates = [{ nodeIds: [start], edgeIds: [] as string[], distance: 0 }];
  while (candidates.length) {
    candidates.sort((a, b) => a.distance - b.distance);
    const route = candidates.shift()!;
    const current = route.nodeIds.at(-1)!;
    if (visited.has(current)) continue;
    if (destinations.has(current)) return route;
    visited.add(current);
    for (const edge of world.edges) {
      if (edge.state !== "open" || (edge.from !== current && edge.to !== current)) continue;
      const next = edge.from === current ? edge.to : edge.from;
      if (!visited.has(next)) {
        candidates.push({
          nodeIds: [...route.nodeIds, next],
          edgeIds: [...route.edgeIds, edge.id],
          distance: route.distance + edge.distance,
        });
      }
    }
  }
  return null;
}

export const stateLabels: Record<EdgeState, string> = {
  open: "Reported open", blocked: "Reported blocked", hazard: "Suspected hazard",
  unknown: "Unobserved", conflict: "Conflicting reports",
};
