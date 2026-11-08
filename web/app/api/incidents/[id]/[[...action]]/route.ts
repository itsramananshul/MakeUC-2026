import { after } from "next/server";
import { droneStatus, startDroneJob } from "@/lib/drone";
import { geographicBounds, midpoint } from "@/lib/geography";
import { imageryLimit, mosaic } from "@/lib/imagery";
import { incidentExtent, withinIncident } from "@/lib/incident-types";
import { authorizeIncident, failJob, getEvidence, getIncident, incidentJob, incidentList, pendingJob, recordJob, removeIncidentImagery, requireActiveIncident, resolveIncident, saveIncidentImage, setIncidentRoads, submitIncidentReport } from "@/lib/incident-store";
import { bearer, failure, json, reportInput, resolveInput, roadImportInput, routeInput } from "@/lib/incident-validation";
import { loadRoads } from "@/lib/osm";
import { RequestError } from "@/lib/store";
import { readInput } from "@/lib/validation";
import { walkingDirections } from "@/lib/walking-directions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; action?: string[] }> };
const syncingSurveys = new Set<string>();

async function syncSurvey(id: string, job: NonNullable<ReturnType<typeof incidentJob>>) {
  try {
    const result = await droneStatus(id, job.id, (bytes, data) => {
      saveIncidentImage(id, bytes, { bounds: geographicBounds(data.bounds), source: data.source, timestamp: data.timestamp }, job.id,
        data.detail?.map(tile => ({ bounds: geographicBounds(tile.bounds), bytes: tile.bytes })));
    }, job.created_at);
    if (result.status === "failed") failJob(id, job.id);
    return result;
  } catch (error) {
    if (error instanceof RequestError && (error.status === 413 || error.status === 422)) failJob(id, job.id);
    throw error;
  }
}

export async function GET(request: Request, context: Context) {
  const { id, action = [] } = await context.params;
  try {
    if (!action.length) {
      const incident = getIncident(id);
      const job = pendingJob(id);
      if (job && !syncingSurveys.has(id)) {
        syncingSurveys.add(id);
        after(async () => {
          try { await syncSurvey(id, job); }
          catch { /* The operator can still check status, and a later read can retry. */ }
          finally { syncingSurveys.delete(id); }
        });
      }
      return json(incident);
    }
    if (action.length === 2 && action[0] === "evidence") {
      authorizeIncident(id, bearer(request));
      const image = getEvidence(id, action[1]);
      if (!image) throw new RequestError("Evidence not found.", 404);
      return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
    }
    if (action[0] === "imagery" && action[1] === "raw") {
      authorizeIncident(id, bearer(request));
      if (action.length === 2) return json({ job: pendingJob(id) ?? null });
      const job = incidentJob(id, action[2]);
      if (!job) throw new RequestError("That processing job was not found.", 404);
      if (job.state === "complete") return json({ id: job.id, status: "complete", progress: 100 });
      if (job.state === "failed") return json({ id: job.id, status: "failed" });
      return json(await syncSurvey(id, job));
    }
    return json({ error: "Unknown incident endpoint." }, 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const { id, action = [] } = await context.params;
  try {
    const operation = action.join("/");
    if (operation === "route") {
      const { origin, destination, mode } = await readInput(request, routeInput);
      const incident = getIncident(id);
      if (incident.resolvedAt) return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "This incident is resolved. Use standard directions." });
      if (mode !== "walking") return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "Switch to Walk to use reported passages in this incident." });
      return json(await walkingDirections(origin, destination, incidentList()));
    }
    authorizeIncident(id, bearer(request));
    if (operation === "resolve") {
      const { recoverySurveyUrl } = await readInput(request, resolveInput);
      return json({ incident: resolveIncident(id, recoverySurveyUrl) });
    }
    if (operation === "roads") {
      const incident = requireActiveIncident(getIncident(id));
      const { center } = request.body ? await readInput(request, roadImportInput) : {};
      if (center && !withinIncident(center, incident)) {
        throw new RequestError("Center the map inside the incident or its aerial coverage before importing roads.");
      }
      const point = center ?? midpoint(incident.bounds);
      const extent = incidentExtent(incident);
      const latitudePadding = .004;
      const longitudePadding = latitudePadding / Math.cos(point.latitude * Math.PI / 180);
      const bounds = {
        west: Math.max(extent.west, point.longitude - longitudePadding),
        south: Math.max(extent.south, point.latitude - latitudePadding),
        east: Math.min(extent.east, point.longitude + longitudePadding),
        north: Math.min(extent.north, point.latitude + latitudePadding),
      };
      return json({ incident: setIncidentRoads(id, await loadRoads(bounds)) });
    }
    if (operation === "reports") {
      return json({ incident: submitIncidentReport(id, await readInput(request, reportInput, 1_610_000)) });
    }
    if (operation === "imagery" || operation === "imagery/raw") {
      requireActiveIncident(getIncident(id));
      const size = Number(request.headers.get("content-length"));
      if (!size || size > imageryLimit + 80_000) throw new RequestError("Choose up to 72 MB of imagery.", 413);
      const data = await request.formData();
      const files = data.getAll("files").filter((value): value is File => typeof value !== "string");
      if (operation === "imagery/raw") {
        const pending = pendingJob(id);
        if (pending && Date.now() - pending.created_at < 30 * 60_000) throw new RequestError("An aerial survey is already processing.", 409);
        if (pending) failJob(id, pending.id);
        const job = await startDroneJob(id, files);
        recordJob(id, job.id);
        return json(job, 202);
      }
      if (!files.length || files.length > 8 || files.some(file => !/\.tiff?$/i.test(file.name))) {
        throw new RequestError("Choose one to eight georeferenced TIFF files.");
      }
      const result = await mosaic(await Promise.all(files.map(file => file.arrayBuffer())), false);
      const incident = saveIncidentImage(id, result.bytes, {
        bounds: geographicBounds(result.bounds), timestamp: new Date().toISOString(),
        source: files.length === 1 ? "Uploaded GeoTIFF" : `${files.length} uploaded GeoTIFFs`,
      }, undefined, result.detail?.map(tile => ({ bounds: geographicBounds(tile.bounds), bytes: tile.bytes })));
      return json({ incident });
    }
    return json({ error: "Unknown incident endpoint." }, 404);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const { id, action = [] } = await context.params;
  try {
    if (action.join("/") !== "imagery") return json({ error: "Unknown incident endpoint." }, 404);
    authorizeIncident(id, bearer(request));
    return json({ incident: removeIncidentImagery(id) });
  } catch (error) { return failure(error); }
}
