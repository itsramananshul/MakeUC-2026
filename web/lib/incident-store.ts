import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { syncExercisePassages } from "./exercise-survey";
import { publishIncidentUpdate } from "./incident-events";
import { database, RequestError } from "./store";
import {
  coordinateKey, distanceMeters, withinIncident, type Coordinate, type FieldReport, type GeographicBounds,
  type Incident, type IncidentImagery, type IncidentSummary, type Road,
} from "./incident-types";

type ReportInput = Omit<FieldReport, "at" | "evidenceUrl"> & {
  from?: Coordinate; to?: Coordinate; trace?: Coordinate[]; photoBase64?: string; confirmed: true;
};
type InitialObservation = Pick<ReportInput, "displayName" | "note" | "photoBase64">;
type SurveyAsset = { bounds: GeographicBounds; bytes: Buffer };
type InitialSurvey = SurveyAsset & {
  source: string; timestamp: string; detail?: SurveyAsset[]; jobId?: string;
};
type StoredIncident = Incident & { unpublishedSurveys?: IncidentImagery[] };

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
    CREATE TABLE IF NOT EXISTS aerial_imports (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, incident_id TEXT
    );
    CREATE TABLE IF NOT EXISTS incident_evidence (
      incident_id TEXT NOT NULL, id TEXT NOT NULL, bytes BLOB NOT NULL,
      PRIMARY KEY (incident_id, id)
    );
  `);
  return db;
}

function mapName(name: string) {
  if (name === "Catia La Mar exercise (simulated imagery)") return "Catia La Mar";
  if (name.startsWith("Cincinnati flood exercise")) return "Cincinnati";
  return name;
}

function summary(incident: StoredIncident): IncidentSummary {
  const { roads, reports, unpublishedSurveys, ...result } = incident;
  return { ...result, name: mapName(result.name), roadCount: roads.length };
}
export function incidentList(): IncidentSummary[] {
  return init().prepare("SELECT details FROM incidents WHERE json_extract(details, '$.resolvedAt') IS NULL ORDER BY rowid DESC").all()
    .map(row => summary(JSON.parse(row.details as string) as Incident));
}
export function publishedRecoveryImagery(): IncidentImagery[] {
  return init().prepare("SELECT json_extract(details, '$.recoveryImagery') AS image FROM incidents WHERE image IS NOT NULL").all()
    .map(row => JSON.parse(row.image as string) as IncidentImagery);
}
function loadIncident(id: string): StoredIncident {
  const row = init().prepare("SELECT details FROM incidents WHERE id = ?").get(id);
  if (!row) throw new RequestError("This incident was not found.", 404);
  return JSON.parse(row.details as string) as StoredIncident;
}
function publicIncident({ unpublishedSurveys, ...incident }: StoredIncident): Incident {
  const name = mapName(incident.name);
  if (name !== "Catia La Mar" && name !== "Cincinnati") return incident;
  return {
    ...incident, name,
    reports: incident.reports.map(report => report.id.startsWith("cincinnati-imagery-exercise-")
      ? { ...report, displayName: name, note: report.condition === "open" ? "Reported walking passage." :
        incident.roads.find(road => road.id === report.edgeId)?.label === "Fallen tree" ? "Fallen tree blocking the road." :
          "Obstruction reported on the road." }
      : report),
  };
}
export function getIncident(id: string): Incident {
  return publicIncident(loadIncident(id));
}
export function authorizeIncident(id: string, key: string) {
  const row = init().prepare("SELECT key_hash FROM incidents WHERE id = ?").get(id);
  if (!row) throw new RequestError("This incident was not found.", 404);
  const expected = Buffer.from(row.key_hash as string, "hex");
  if (!timingSafeEqual(hash(key), expected)) throw new RequestError("Enter the incident access key.", 403);
}
function storeSurvey(bytes: Buffer, data: Omit<IncidentImagery, "url" | "detailTiles">, detail: SurveyAsset[]) {
  const insert = database().prepare("INSERT INTO imagery VALUES (?, ?)");
  function saveAsset(buffer: Buffer) {
    const assetId = randomBytes(16).toString("hex");
    insert.run(assetId, buffer);
    return `/api/imagery/${assetId}`;
  }
  const survey: IncidentImagery = { ...data, url: saveAsset(bytes) };
  if (detail.length) survey.detailTiles = detail.map(tile => ({ bounds: tile.bounds, url: saveAsset(tile.bytes) }));
  return survey;
}

export function recordAerialImport(id: string) {
  init().prepare("INSERT INTO aerial_imports (id, created_at) VALUES (?, ?)").run(id, Date.now());
}

export function aerialImport(id: string) {
  return init().prepare("SELECT created_at, incident_id FROM aerial_imports WHERE id = ?").get(id) as
    { created_at: number; incident_id: string | null } | undefined;
}

export function createIncident(name: string, bounds: GeographicBounds, observation?: InitialObservation, survey?: InitialSurvey) {
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
  const key = survey?.jobId ?? randomBytes(24).toString("base64url");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (survey?.jobId) {
      const job = aerialImport(survey.jobId);
      if (!job) throw new RequestError("That aerial import was not found.", 404);
      if (job.incident_id) {
        const existing = getIncident(job.incident_id);
        db.exec("COMMIT");
        return { incident: existing, key };
      }
    }
    if (survey) {
      incident.imagery = storeSurvey(survey.bytes, { bounds, source: survey.source, timestamp: survey.timestamp }, survey.detail ?? []);
      incident.surveys = [incident.imagery];
      syncExercisePassages(incident);
    }
    if (observation) {
      const report: FieldReport = {
        id: randomBytes(12).toString("base64url"), displayName: observation.displayName,
        note: observation.note, at: new Date().toISOString(),
        evidenceType: observation.photoBase64 ? "image" : "text",
        location: { latitude, longitude: (west + east) / 2 },
      };
      if (observation.photoBase64) report.evidenceUrl = saveEvidence(incident.id, report.id, observation.photoBase64);
      incident.reports.push(report);
    }
    db.prepare("INSERT INTO incidents VALUES (?, ?, ?)").run(incident.id, hash(key).toString("hex"), JSON.stringify(incident));
    if (survey?.jobId) db.prepare("UPDATE aerial_imports SET incident_id = ? WHERE id = ?").run(incident.id, survey.jobId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  publishIncidentUpdate(incident.id);
  return { incident, key };
}

function changeIncident(id: string, mutate: (incident: StoredIncident) => boolean) {
  const db = init();
  let incident: StoredIncident;
  let changed: boolean;
  db.exec("BEGIN IMMEDIATE");
  try {
    incident = loadIncident(id);
    changed = mutate(incident);
    if (changed) {
      incident.version += 1;
      incident.roadCount = incident.roads.length;
      db.prepare("UPDATE incidents SET details = ? WHERE id = ?").run(JSON.stringify(incident), id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (changed) publishIncidentUpdate(id);
  return publicIncident(incident);
}
export function requireActiveIncident(incident: Incident) {
  if (incident.resolvedAt) throw new RequestError("This incident has been resolved.", 409);
  return incident;
}
export function resolveIncident(id: string, recoverySurveyUrl: string | null) {
  return changeIncident(id, incident => {
    if (incident.resolvedAt) return false;
    const job = pendingJob(id);
    if (job && Date.now() - job.created_at < 30 * 60_000) {
      throw new RequestError("Wait for the aerial survey to finish before resolving this incident.", 409);
    }
    if (recoverySurveyUrl) {
      if (incident.imagery?.url !== recoverySurveyUrl) {
        throw new RequestError("The latest survey changed. Review it before publishing it as the repaired map.", 409);
      }
      incident.recoveryImagery = incident.imagery;
    }
    if (job) failJob(id, job.id);
    incident.resolvedAt = new Date().toISOString();
    return true;
  });
}
export function setIncidentRoads(id: string, imported: Road[]) {
  return changeIncident(id, incident => {
    requireActiveIncident(incident);
    const seen = new Set(incident.roads.map(road => road.id));
    const additions = imported.filter(road => !seen.has(road.id));
    if (incident.roads.length + additions.length > 9000) {
      throw new RequestError("This area contains too many roads. Use a smaller incident area.", 422);
    }
    incident.roads.push(...additions);
    return additions.length > 0;
  });
}
export function saveIncidentImage(id: string, bytes: Buffer, data: Omit<IncidentImagery, "url" | "detailTiles">, jobId?: string,
  detail: { bounds: GeographicBounds; bytes: Buffer }[] = []) {
  return changeIncident(id, incident => {
    requireActiveIncident(incident);
    if (jobId && incidentJob(id, jobId)?.state !== "queued") return false;
    const bounds = incident.bounds, image = data.bounds;
    if (image.east <= bounds.west || image.west >= bounds.east || image.north <= bounds.south || image.south >= bounds.north) {
      throw new RequestError("This image is outside the selected incident area.", 422);
    }
    const db = database();
    const surveys = incident.surveys ?? (incident.imagery ? [incident.imagery] : []);
    const unpublished = incident.unpublishedSurveys ?? [];
    const newest = storeSurvey(bytes, data, detail);
    if (surveys.length + unpublished.length >= 12) {
      const oldest = unpublished.shift() ?? surveys.shift();
      if (oldest) {
        const remove = db.prepare("DELETE FROM imagery WHERE id = ?");
        for (const raster of [oldest, ...(oldest.detailTiles ?? [])]) remove.run(raster.url.split("/").at(-1)!);
      }
    }
    incident.surveys = [...surveys, newest];
    incident.imagery = newest;
    syncExercisePassages(incident);
    if (jobId) db.prepare("UPDATE incident_jobs SET state = 'complete' WHERE incident_id = ? AND id = ?").run(id, jobId);
    return true;
  });
}

export function removeIncidentImagery(id: string) {
  return changeIncident(id, incident => {
    if (incident.resolvedAt) {
      if (!incident.recoveryImagery) return false;
      delete incident.recoveryImagery;
      return true;
    }
    if (!incident.imagery) return false;
    const job = pendingJob(id);
    if (job && Date.now() - job.created_at < 30 * 60_000) {
      throw new RequestError("Wait for the aerial survey to finish before removing imagery.", 409);
    }
    if (job) failJob(id, job.id);
    incident.unpublishedSurveys = [...(incident.unpublishedSurveys ?? []), ...(incident.surveys ?? [incident.imagery])];
    incident.imagery = null;
    incident.surveys = [];
    syncExercisePassages(incident);
    return true;
  });
}

export function submitIncidentReport(id: string, report: ReportInput) {
  return changeIncident(id, incident => {
    if (incident.reports.some(item => item.id === report.id)) return false;
    requireActiveIncident(incident);
    if (incident.reports.length >= 5000) throw new RequestError("This incident has reached its report limit.", 429);

    let road = report.edgeId ? incident.roads.find(item => item.id === report.edgeId) : undefined;
    if (report.edgeId && !road) throw new RequestError("That road segment was not found.", 404);
    if (report.trace) {
      if (road && !road.id.startsWith("field-")) throw new RequestError("Only a field-reported passage can be redrawn.");
      const points = report.trace;
      const legs = points.slice(1).map((point, index) => distanceMeters(points[index], point));
      if (!report.condition || points.some(point => !withinIncident(point, incident)) ||
          legs.some(length => length < 1) || legs.reduce((sum, length) => sum + length, 0) > 250) {
        throw new RequestError("Trace up to 250 m inside the incident, with at least 1 m between points.");
      }
      const from = points[0], to = points[points.length - 1], via = points.slice(1, -1);
      if (road) {
        Object.assign(road, { from, to, via });
      } else {
        const id = `field-${hash(points.map(coordinateKey).join("|")).toString("hex").slice(0, 20)}`;
        road = incident.roads.find(item => item.id === id);
        if (!road) {
          road = { id, from, to, via, state: "unknown", label: "Field-reported connection" };
          incident.roads.push(road);
        }
      }
    }
    if (report.from && report.to && !road && report.condition) {
      const length = distanceMeters(report.from, report.to);
      if (length < 1 || length > 250 || !withinIncident(report.from, incident) || !withinIncident(report.to, incident)) {
        throw new RequestError("Mark two distinct points inside the incident, up to 250 m apart.");
      }
      function snap(point: Coordinate) {
        let nearest = point, gap = 12;
        for (const edge of incident.roads) for (const endpoint of [edge.from, edge.to]) {
          const distance = distanceMeters(point, endpoint);
          if (distance < gap && withinIncident(endpoint, incident)) { gap = distance; nearest = endpoint; }
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
    if (!road && (!report.location || !withinIncident(report.location, incident))) {
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
    if (report.photoBase64) observation.evidenceUrl = saveEvidence(id, report.id, report.photoBase64);
    incident.reports.unshift(observation);
    return true;
  });
}
function saveEvidence(incidentId: string, reportId: string, encoded: string) {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.length > 1_200_000) {
    throw new RequestError("Attach a JPEG photo under 1.2 MB.");
  }
  database().prepare("INSERT INTO incident_evidence VALUES (?, ?, ?)").run(incidentId, reportId, bytes);
  return `/api/incidents/${incidentId}/evidence/${reportId}`;
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
  requireActiveIncident(getIncident(id));
  init().prepare("INSERT INTO incident_jobs VALUES (?, ?, 'queued', ?)").run(id, jobId, Date.now());
}
export function failJob(id: string, jobId: string) {
  init().prepare("UPDATE incident_jobs SET state = 'failed' WHERE incident_id = ? AND id = ? AND state = 'queued'").run(id, jobId);
}
