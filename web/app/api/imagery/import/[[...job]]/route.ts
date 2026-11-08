import { exerciseSurveySource } from "@/lib/exercise-survey";
import { maxGeoTiffs } from "@/lib/imagery-limits";
import exif from "exif-reader";
import sharp from "sharp";
import { droneStatus, startDroneJob } from "@/lib/drone";
import { geographicBounds } from "@/lib/geography";
import { imageryLimit, mosaic } from "@/lib/imagery";
import { aerialImport, createIncident, getIncident, keyMatches, recordAerialImport } from "@/lib/incident-store";
import { bearer, failure, json } from "@/lib/incident-validation";
import { RequestError } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ job?: string[] }> };
type Mosaic = Awaited<ReturnType<typeof mosaic>>;

function publish(bytes: Buffer, data: Pick<Mosaic, "bounds" | "detail">, source: string, jobId?: string) {
  const bounds = geographicBounds(data.bounds);
  return createIncident("Aerial survey", bounds, undefined, {
    bounds, bytes, source, timestamp: new Date().toISOString(), jobId,
    detail: data.detail?.map(tile => ({ bounds: geographicBounds(tile.bounds), bytes: tile.bytes })),
  });
}

async function hasGps(file: File) {
  try {
    const metadata = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    if (!metadata.exif) return false;
    const gps = exif(metadata.exif).GPSInfo;
    const valid = (values: number[] | undefined, max: number) =>
      values?.length === 3 && values.every(Number.isFinite) &&
      values[0] >= 0 && values[0] <= max && values.slice(1).every(value => value >= 0 && value < 60);
    return !!gps && /^(N|S)$/.test(gps.GPSLatitudeRef ?? "") && /^(E|W)$/.test(gps.GPSLongitudeRef ?? "") &&
      valid(gps.GPSLatitude, 90) && valid(gps.GPSLongitude, 180);
  } catch { return false; }
}

export async function POST(request: Request, context: Context) {
  try {
    const { job = [] } = await context.params;
    if (job.length) {
      const [id] = job;
      const saved = job.length === 1 && aerialImport(id);
      if (!saved) throw new RequestError("That aerial import was not found.", 404);
      if (saved.incident_id) return json({ status: "complete", incident: getIncident(saved.incident_id), key: id });
      const result = await droneStatus(id, id, (bytes, data) => {
        publish(bytes, data, data.source, id);
      }, saved.created_at);
      if (result.status !== "complete") return json(result);
      const completed = aerialImport(id);
      if (!completed?.incident_id) throw new RequestError("The aerial layer could not be published.", 500);
      return json({ status: "complete", incident: getIncident(completed.incident_id), key: id });
    }

    const key = process.env.AFTERMAP_OPERATOR_KEY;
    if (key && !keyMatches(bearer(request), key)) throw new RequestError("Enter the workspace operator key.", 403);
    if (Number(request.headers.get("content-length")) > imageryLimit + 128_000) {
      throw new RequestError("Choose up to 72 MB of imagery.", 413);
    }
    const form = await request.formData().catch(() => {
      throw new RequestError("The image upload could not be read.", 400);
    });
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > maxGeoTiffs) throw new RequestError(`Choose 1 to ${maxGeoTiffs} aerial images.`);
    if (files.reduce((total, file) => total + file.size, 0) > imageryLimit) {
      throw new RequestError("Choose up to 72 MB of imagery.", 413);
    }
    if (files.every(file => /\.tiff?$/i.test(file.name))) {
      const rasters = await Promise.all(files.map(file => file.arrayBuffer()));
      const result = await mosaic(rasters, false);
      return json({ status: "complete", ...publish(result.bytes, result, exerciseSurveySource(rasters) ?? "Uploaded georeferenced aerial survey") }, 201);
    }
    if (files.length < 5 || files.length > 40 || !files.every(file => /\.(jpe?g|png)$/i.test(file.name))) {
      throw new RequestError("Choose GeoTIFFs or 5 to 40 overlapping JPEG or PNG drone photos.", 422);
    }
    for (const file of files) {
      if (!await hasGps(file)) {
        throw new RequestError("These photos are missing GPS coordinates. Upload the original geotagged drone files or a GeoTIFF.", 422);
      }
    }
    const result = await startDroneJob(undefined, files);
    recordAerialImport(result.id);
    return json(result, 202);
  } catch (error) { return failure(error); }
}
