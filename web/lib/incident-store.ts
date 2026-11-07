import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { database, RequestError } from "./store";
import {
  coordinateKey, distanceMeters, within, type Coordinate, type FieldReport, type GeographicBounds,
  type Incident, type IncidentImagery, type IncidentSummary, type Road,
} from "./incident-types";

type ReportInput = Omit<FieldReport, "at" | "evidenceUrl"> & {
  from?: Coordinate; to?: Coordinate; photoBase64?: string; confirmed: true;
};

const hash = (value: string) => createHash("sha256").update(value).digest();
export function keyMatches(candidate: string, expected: string) {
  return timingSafeEqual(hash(candidate), hash(expected));
}

function init() {
  const db = database();
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS incident_jobs (
      incident_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (incident_id, id)
    );
    CREATE TABLE IF NOT EXISTS incident_evidence (
      incident_id TEXT NOT NULL, id TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY (incident_id, id)
    );
  `);
  return db;
}

function summary(incident: Incident): IncidentSummary {
  const { roads, reports, ...result } = incident;
  return { ...result, roadCount: roads.length };
}
export function incidentList(): IncidentSummary[] {
  return init().prepare("SELECT details FROM incidents ORDER BY rowid DESC").all()
    .map(row => summary(JSON.parse(row.details as string) as Incident));
}
export function getIncident(id: string): Incident {
  const row = init().prepare("SELECT details FROM incidents WHERE id = ?").get(id);
  if (!row) throw new RequestError("This incident was not found.", 404);
  return JSON.parse(row.details as string) as Incident;
}
export function authorizeIncident(id: string, key: string) {
  const row = init().prepare("SELECT key_hash FROM incidents WHERE id = ?").get(id);
  if (!row) throw new RequestError("This incident was not found.", 404);
  const expected = Buffer.from(row.key_hash as string, "hex");
  if (!timingSafeEqual(hash(key), expected)) throw new RequestError("Enter the incident access key.", 403);
}
export function createIncident(name: string, bounds: GeographicBounds) {
  const { west, south, east, north } = bounds;
  const latitude = (south + north) / 2;
  if (east <= west || north <= south ||
      distanceMeters({ latitude, longitude: west }, { latitude, longitude: east }) > 10_000 ||
      distanceMeters({ latitude: south, longitude: west }, { latitude: north, longitude: west }) > 10_000) {
    throw new RequestError("Select an incident area under 10 km across.");
  }
  const db = init();
  if (Number(db.prepare("SELECT count(*) AS total FROM incidents").get()?.total) >= 500) {
    throw new RequestError("The incident workspace has reached its limit.", 429);
  }
  const incident: Incident = {
    id: randomBytes(12).toString("base64url"), name, kind: "incident", bounds, imagery: null,
    version: 1, roadCount: 0, roads: [], reports: [],
  };
  const key = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO incidents VALUES (?, ?, ?)").run(incident.id, hash(key).toString("hex"), JSON.stringify(incident));
  return { incident, key };
}

function changeIncident(id: string, mutate: (incident: Incident) => boolean) {
  const db = init();
  db.exec("BEGIN IMMEDIATE");
  try {
    const incident = getIncident(id);
    if (mutate(incident)) {
      incident.version += 1;
      incident.roadCount = incident.roads.length;
      db.prepare("UPDATE incidents SET details = ? WHERE id = ?").run(JSON.stringify(incident), id);
    }
    db.exec("COMMIT");
    return incident;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function setIncidentRoads(id: string, imported: Road[]) {
  return changeIncident(id, incident => {
    const seen = new Set(incident.roads.map(road => road.id));
    const additions = imported.filter(road => !seen.has(road.id));
    if (incident.roads.length + additions.length > 9000) {
      throw new RequestError("This area contains too many roads. Use a smaller incident area.", 422);
    }
    incident.roads.push(...additions);
    return additions.length > 0;
  });
}
export function saveIncidentImage(id: string, bytes: Buffer, data: Omit<IncidentImagery, "url">, jobId?: string) {
  return changeIncident(id, incident => {
    const bounds = incident.bounds, image = data.bounds;
    if (image.east <= bounds.west || image.west >= bounds.east || image.north <= bounds.south || image.south >= bounds.north) {
      throw new RequestError("This image is outside the selected incident area.", 422);
    }
    const assetId = randomBytes(16).toString("hex");
    const db = database();
    db.prepare("INSERT INTO imagery VALUES (?, ?)").run(assetId, bytes);
    const surveys = incident.surveys ?? (incident.imagery ? [incident.imagery] : []);
    const newest = { ...data, url: `/api/imagery/${assetId}` };
    if (surveys.length >= 12) {
      const oldest = surveys.shift();
      if (oldest) db.prepare("DELETE FROM imagery WHERE id = ?").run(oldest.url.split("/").at(-1)!);
    }
    incident.surveys = [...surveys, newest];
    incident.imagery = newest;
    if (jobId) db.prepare("UPDATE incident_jobs SET state = 'complete' WHERE incident_id = ? AND id = ?").run(id, jobId);
    return true;
  });
}

export function submitIncidentReport(id: string, report: ReportInput) {
  return changeIncident(id, incident => {
    if (incident.reports.some(item => item.id === report.id)) return false;
    if (incident.reports.length >= 5000) throw new RequestError("This incident has reached its report limit.", 429);

    let road = report.edgeId ? incident.roads.find(item => item.id === report.edgeId) : undefined;
    if (report.edgeId && !road) throw new RequestError("That road segment was not found.", 404);
    if (report.from && report.to && !road && report.condition) {
      const length = distanceMeters(report.from, report.to);
      if (length < 1 || length > 250 || !within(report.from, incident.bounds) || !within(report.to, incident.bounds)) {
        throw new RequestError("Mark two distinct points inside the incident, up to 250 m apart.");
      }
      function snap(point: Coordinate) {
        let nearest = point, gap = 12;
        for (const edge of incident.roads) for (const endpoint of [edge.from, edge.to]) {
          const distance = distanceMeters(point, endpoint);
          if (distance < gap && within(endpoint, incident.bounds)) { gap = distance; nearest = endpoint; }
        }
        return nearest;
      }
      const from = snap(report.from), to = snap(report.to);
      if (distanceMeters(from, to) < 1 || distanceMeters(from, to) > 250) {
        throw new RequestError("Choose two distinct passage endpoints within 250 m after snapping.");
      }
      const endpoints = [coordinateKey(from), coordinateKey(to)].sort().join("|");
      const edgeId = `field-${hash(endpoints).toString("hex").slice(0, 20)}`;
      road = incident.roads.find(item => item.id === edgeId);
      if (!road) {
        road = { id: edgeId, from, to, state: "unknown", label: "Field-reported connection" };
        incident.roads.push(road);
      }
    }
    if (!road && (!report.location || !within(report.location, incident.bounds))) {
      throw new RequestError("Choose a passage or a point inside this incident.");
    }
    if (road && !report.condition) throw new RequestError("Choose a passage condition.");

    const now = new Date().toISOString();
    if (road && report.condition) {
      const statuses = new Set([report.condition]);
      const reporters = new Set([report.displayName.toLowerCase()]);
      for (const recent of incident.reports) {
        if (Date.parse(now) - Date.parse(recent.at) >= 120_000) break;
        const person = recent.displayName.toLowerCase();
        if (recent.edgeId !== road.id || !recent.condition || reporters.has(person)) continue;
        reporters.add(person);
        statuses.add(recent.condition);
      }
      road.state = statuses.size > 1 ? "conflict" : report.condition;
    }

    const observation: FieldReport = {
      id: report.id, edgeId: road?.id, displayName: report.displayName, condition: report.condition,
      note: report.note, at: now, evidenceType: report.evidenceType, location: report.location,
    };
    if (report.photoBase64) {
      const bytes = Buffer.from(report.photoBase64, "base64");
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.length > 1_200_000) {
        throw new RequestError("Attach a JPEG photo under 1.2 MB.");
      }
      database().prepare("INSERT INTO incident_evidence VALUES (?, ?, ?)").run(id, report.id, bytes);
      observation.evidenceUrl = `/api/incidents/${id}/evidence/${report.id}`;
    }
    incident.reports.unshift(observation);
    return true;
  });
}
export function getEvidence(id: string, reportId: string): Uint8Array | null {
  const row = init().prepare("SELECT bytes FROM incident_evidence WHERE incident_id = ? AND id = ?").get(id, reportId);
  return (row?.bytes as Uint8Array | undefined) ?? null;
}

export function pendingJob(id: string) {
  return init().prepare("SELECT id, state, created_at FROM incident_jobs WHERE incident_id = ? AND state = 'queued' ORDER BY created_at DESC LIMIT 1")
    .get(id) as { id: string; state: string; created_at: number } | undefined;
}
export function incidentJob(id: string, jobId: string) {
  return init().prepare("SELECT id, state, created_at FROM incident_jobs WHERE incident_id = ? AND id = ?")
    .get(id, jobId) as { id: string; state: string; created_at: number } | undefined;
}
export function recordJob(id: string, jobId: string) {
  init().prepare("INSERT INTO incident_jobs VALUES (?, ?, 'queued', ?)").run(id, jobId, Date.now());
}
export function failJob(id: string, jobId: string) {
  init().prepare("UPDATE incident_jobs SET state = 'failed' WHERE incident_id = ? AND id = ?").run(id, jobId);
}
