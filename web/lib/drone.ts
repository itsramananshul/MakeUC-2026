import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { imageryLimit, mosaic } from "./imagery";
import { RequestError, saveImagery } from "./store";

type Job = { code: string; id: string; startedAt: number; finished?: boolean; importing?: Promise<void> };
const jobs = new Map<string, Job>();
const orthophotoPath = "odm_orthophoto/odm_orthophoto.tif";

function workerUrl(path: string) {
  const base = process.env.NODEODM_URL;
  if (!base) throw new RequestError("Raw photos need a configured NodeODM worker. Import an orthomosaic to add an imagery layer now.", 503);
  const url = new URL(path, base);
  if (process.env.NODEODM_TOKEN) url.searchParams.set("token", process.env.NODEODM_TOKEN);
  return url;
}

export async function startDroneJob(code: string | undefined, files: File[]) {
  const worker = workerUrl("/task/new");
  if (files.length < 5 || files.length > 40 || files.some(file => !/\.(jpe?g|png)$/i.test(file.name))) {
    throw new RequestError("Select 5 to 40 overlapping, geotagged JPEG or PNG aerial photos.");
  }
  if (files.reduce((size, file) => size + file.size, 0) > imageryLimit) {
    throw new RequestError("Choose up to 72 MB of photos.", 413);
  }
  if ([...jobs.values()].some(job => job.code === code && !job.finished && Date.now() - job.startedAt < 30 * 60_000)) {
    throw new RequestError("An aerial processing job is already active for this drill.", 409);
  }
  const id = randomUUID();
  const job: Job = { code: code ?? id, id, startedAt: Date.now() };
  jobs.set(id, job);
  const form = new FormData();
  files.forEach(file => form.append("images", file, file.name));
  form.append("name", `AFTERMAP ${code ?? id}`);
  form.append("outputs", JSON.stringify([orthophotoPath]));
  form.append("options", JSON.stringify([{ name: "orthophoto-resolution", value: 10 }, { name: "fast-orthophoto", value: true }, { name: "max-concurrency", value: 4 }]));
  try {
    const response = await fetch(worker, {
      method: "POST", body: form, headers: { "set-uuid": id }, signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json() as { uuid?: string };
    if (!response.ok || data.uuid !== id) throw new Error("worker rejected job");
    return { id, status: "queued" };
  } catch {
    jobs.delete(id);
    throw new RequestError("The drone worker could not accept the photos.", 502);
  }
}

export async function droneStatus(code: string, id: string, publish?: (bytes: Buffer, data: Omit<Awaited<ReturnType<typeof mosaic>>, "bytes"> & { source: string; timestamp: string }) => void, restoreAt?: number) {
  let job = jobs.get(id);
  if (!job && restoreAt) {
    job = { code, id, startedAt: restoreAt };
    jobs.set(id, job);
  }
  if (!job || job.code !== code) throw new RequestError("That processing job was not found.", 404);
  if (job.finished) return { id, status: "complete", progress: 100 };
  const response = await fetch(workerUrl(`/task/${job.id}/info`), { signal: AbortSignal.timeout(10_000) });
  const info = await response.json() as { status?: { code?: number; errorMessage?: string }; progress?: number; imagesCount?: number };
  if (!response.ok || !info.status?.code) throw new RequestError("The drone worker could not return job status.", 502);
  if (info.status.code === 30 || info.status.code === 50) {
    jobs.delete(id);
    return { id, status: "failed", error: info.status.errorMessage || "The worker could not align these images." };
  }
  if (info.status.code !== 40) return { id, status: info.status.code === 10 ? "queued" : "processing", progress: info.progress ?? 0 };

  job.importing ??= (async () => {
    const artifact = await fetch(workerUrl(`/task/${id}/download/all.zip`), { signal: AbortSignal.timeout(45_000) });
    if (!artifact.ok || !artifact.headers.get("content-type")?.includes("zip") || Number(artifact.headers.get("content-length")) > imageryLimit) {
      throw new RequestError("The generated orthomosaic could not be imported. Export a GeoTIFF under 72 MB from the worker.", 502);
    }
    const archive = await artifact.arrayBuffer();
    if (archive.byteLength > imageryLimit) throw new RequestError("The drone archive is too large.", 413);
    const files = unzipSync(new Uint8Array(archive), {
      filter: entry => entry.name === orthophotoPath && entry.originalSize <= imageryLimit,
    });
    const raster = files[orthophotoPath];
    if (!raster) throw new RequestError("The drone archive did not include an importable orthomosaic.", 502);
    const { bytes, ...geometry } = await mosaic([Uint8Array.from(raster).buffer], !publish);
    const layer = {
      ...geometry, count: info.imagesCount ?? geometry.count, label: "Drone orthomosaic",
      source: "OpenDroneMap · uploaded drone photographs", timestamp: new Date().toISOString(),
    };
    if (publish) publish(bytes, layer);
    else saveImagery(code, bytes, layer);
    job!.finished = true;
  })();
  try { await job.importing; }
  catch (error) { jobs.delete(id); throw error; }
  return { id, status: "complete", progress: 100 };
}
