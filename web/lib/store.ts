import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BASE_IMAGERY } from "./imagery-frame";
import {
  DEMO_CODE, edgeKey, findRoute, initialWorld, type Edge, type Observation, type Report, type Snapshot,
} from "./world";

export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

let db: DatabaseSync | undefined;
export function database(): DatabaseSync {
  if (db) return db;
  const path = resolve(/* turbopackIgnore: true */ process.env.AFTERMAP_DB_PATH || ".aftermap/drill.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS worlds (code TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS imagery (id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
  `);
  connection.prepare("INSERT OR IGNORE INTO worlds VALUES (?, ?)").run(DEMO_CODE, JSON.stringify(initialWorld()));
  db = connection;
  return connection;
}

export function getWorld(code: string): Snapshot {
  const row = database().prepare("SELECT data FROM worlds WHERE code = ?").get(code.toUpperCase());
  if (!row) throw new RequestError("That drill code was not found.", 404);
  const world = JSON.parse(row.data as string) as Snapshot;
  world.imagery ??= BASE_IMAGERY;
  return world;
}

function updateWorld<T>(code: string, update: (world: Snapshot) => { result: T; changed: boolean }): T {
  const connection = database();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const world = getWorld(code);
    const { result, changed } = update(world);
    if (changed) {
      world.version += 1;
      connection.prepare("UPDATE worlds SET data = ? WHERE code = ?")
        .run(JSON.stringify(world), world.session.code);
    }
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function joinWorld(code: string, displayName: string, observerId?: string) {
  return updateWorld(code, world => {
    const current = world.participants.find(item => item.id === observerId);
    if (!current && world.participants.length >= 40) throw new RequestError("This drill is full.", 429);
    const observer = current ?? { id: randomUUID(), displayName, checkpointId: null, lastSeenAt: "" };
    observer.displayName = displayName;
    observer.lastSeenAt = new Date().toISOString();
    if (!current) world.participants.push(observer);
    return { changed: true, result: { observerId: observer.id, state: world } };
  });
}

export function requireParticipant(world: Snapshot, id: string) {
  const participant = world.participants.find(item => item.id === id);
  if (!participant) throw new RequestError("Join the drill before reporting.", 403);
  return participant;
}

export function requireCheckpoint(world: Snapshot, id: string) {
  const checkpoint = world.nodes.find(item => item.id === id);
  if (!checkpoint) throw new RequestError("That checkpoint does not exist in this drill.");
  return checkpoint;
}

export function setPosition(code: string, observerId: string, checkpointId: string) {
  return updateWorld(code, world => {
    requireCheckpoint(world, checkpointId);
    const participant = requireParticipant(world, observerId);
    participant.checkpointId = checkpointId;
    participant.lastSeenAt = new Date().toISOString();
    return { changed: true, result: { state: world } };
  });
}

function reconcilePassage(world: Snapshot, report: Report, time: string): { edge: Edge; discovery: boolean } {
  const from = requireCheckpoint(world, report.from ?? "");
  const to = requireCheckpoint(world, report.to ?? "");
  if (from.id === to.id || !report.status || ![from.id, to.id].includes(report.checkpointId)) {
    throw new RequestError("Choose a different checkpoint connected to your current position.");
  }

  const id = edgeKey(from.id, to.id);
  const known = world.edges.find(item => item.id === id);
  const edge: Edge = known ?? {
    id, from: from.id, to: to.id, label: `${from.label} ↔ ${to.label}`,
    distance: Math.round(Math.hypot(from.x - to.x, from.y - to.y)),
    state: "unknown", discovered: true, lastObservationAt: null, observationIds: [],
  };
  if (!known) world.edges.push(edge);

  const statuses = new Set([report.status]);
  const observers = new Set([report.observerId]);
  for (const item of world.observations) {
    if (item.edgeId !== id || !item.status || observers.has(item.observerId)) continue;
    if (Date.parse(time) - Date.parse(item.timestamp) > 120_000) break;
    observers.add(item.observerId);
    statuses.add(item.status);
  }
  edge.state = statuses.size > 1 ? "conflict" : report.status;
  edge.lastObservationAt = time;
  edge.observationIds.unshift(report.id);
  return { edge, discovery: !known };
}

export function addObservation(code: string, report: Report) {
  return updateWorld(code, world => {
    const participant = requireParticipant(world, report.observerId);
    requireCheckpoint(world, report.checkpointId);
    const previous = world.observations.find(item => item.id === report.id);
    if (previous) {
      if (previous.observerId !== report.observerId) throw new RequestError("That observation ID is already used.", 409);
      return { changed: false, result: { state: world } };
    }
    if (world.observations.length >= 500) throw new RequestError("The drill has reached its report limit.", 429);

    const timestamp = new Date().toISOString();
    const observation: Observation = { ...report, displayName: participant.displayName, timestamp };
    let reason: string;
    if (report.kind === "passage") {
      const { edge, discovery } = reconcilePassage(world, report, timestamp);
      observation.edgeId = edge.id;
      observation.discovery = discovery;
      reason = discovery ? `New connection reported at ${edge.label}.` :
        edge.state === "conflict" ? `${edge.label} has conflicting reports.` :
        `${edge.label} was reported ${edge.state === "hazard" ? "as a hazard" : edge.state}.`;
    } else {
      const node = requireCheckpoint(world, report.nodeId ?? "");
      if (report.kind === "exit" && node.kind !== "exit") throw new RequestError("Choose an assembly point.");
      reason = `${node.label} was reported as an assembly point.`;
    }

    world.observations.unshift(observation);
    participant.checkpointId = report.checkpointId;
    participant.lastSeenAt = timestamp;
    const route = findRoute(world);
    if (JSON.stringify(route?.edgeIds) !== JSON.stringify(world.route?.edgeIds)) {
      world.previousRoute = world.route ?? world.previousRoute;
      world.route = route;
      world.routeChange = { observationId: report.id, reason, at: timestamp };
    }
    return { changed: true, result: { state: world } };
  });
}

export function getImage(id: string): Uint8Array | null {
  const row = database().prepare("SELECT bytes FROM imagery WHERE id = ?").get(id);
  return (row?.bytes as Uint8Array | undefined) ?? null;
}

export function saveImagery(code: string, bytes: Buffer, imagery: Omit<NonNullable<Snapshot["imagery"]>, "url">) {
  return updateWorld(code, world => {
    const id = randomUUID();
    database().prepare("INSERT INTO imagery (id, bytes) VALUES (?, ?)").run(id, bytes);
    const previousId = world.imagery?.url.split("/").at(-1);
    if (previousId && world.imagery?.url.startsWith("/api/imagery/")) {
      database().prepare("DELETE FROM imagery WHERE id = ?").run(previousId);
    }
    world.imagery = { ...imagery, url: `/api/imagery/${id}` };
    return { changed: true, result: { state: world } };
  });
}
