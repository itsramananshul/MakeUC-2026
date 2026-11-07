import { droneStatus, startDroneJob } from "@/lib/drone";
import { imageryLimit, mosaic } from "@/lib/imagery";
import { interpret } from "@/lib/interpret";
import {
  addObservation, getWorld, joinWorld, RequestError, requireCheckpoint, requireParticipant, saveImagery, setPosition,
} from "@/lib/store";
import { interpretInput, joinInput, observationInput, positionInput, readInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ code: string; action?: string[] }> };

function json(result: unknown, status = 200) {
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  console.error("AFTERMAP request error", error instanceof Error ? error.name : "Unknown");
  return json({ error: "The drill server could not complete that request." }, 500);
}

export async function GET(_request: Request, context: Context) {
  const { code, action = [] } = await context.params;
  try {
    const state = getWorld(code);
    if (!action.length) return json(state);
    if (action.length === 3 && action[0] === "imagery" && action[1] === "raw") {
      return json(await droneStatus(state.session.code, action[2]));
    }
    return json({ error: "Unknown drill endpoint." }, 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const { code, action = [] } = await context.params;
  try {
    const operation = action.join("/");
    if (operation === "join") {
      const input = await readInput(request, joinInput);
      return json(joinWorld(code, input.displayName, input.observerId));
    }
    if (operation === "position") {
      const input = await readInput(request, positionInput);
      return json(setPosition(code, input.observerId, input.checkpointId));
    }
    if (operation === "observations") {
      return json(addObservation(code, await readInput(request, observationInput)));
    }
    if (operation === "interpret") {
      const input = await readInput(request, interpretInput, 1_610_000);
      const world = getWorld(code);
      requireParticipant(world, input.observerId);
      requireCheckpoint(world, input.checkpointId);
      return json(await interpret(world, input));
    }
    if (operation === "imagery" || operation === "imagery/raw") {
      const world = getWorld(code);
      const token = process.env.AFTERMAP_IMAGERY_TOKEN;
      if (token && request.headers.get("x-aftermap-imagery-token") !== token) {
        throw new RequestError("Enter the operator upload code.", 403);
      }
      const contentLength = Number(request.headers.get("content-length"));
      if (!contentLength || contentLength > imageryLimit + 80_000) {
        throw new RequestError("Choose up to 72 MB of imagery.", 413);
      }
      const form = await request.formData();
      const files = form.getAll("files").filter((value): value is File => typeof value !== "string");
      if (operation === "imagery/raw") return json(await startDroneJob(world.session.code, files), 202);
      if (!files.length || files.length > 8 || files.some(file => !/\.tiff?$/i.test(file.name))) {
        throw new RequestError("Choose one to eight georeferenced .tif or .tiff images.");
      }
      const { bytes, ...geometry } = await mosaic(await Promise.all(files.map(file => file.arrayBuffer())));
      return json(saveImagery(code, bytes, {
        ...geometry, label: files.length > 1 ? "Imported aerial mosaic" : files[0].name,
        source: files.length > 1 ? `${files.length} uploaded GeoTIFFs` : "Uploaded GeoTIFF",
        timestamp: new Date().toISOString(),
      }));
    }
    return json({ error: "Unknown drill endpoint." }, 404);
  } catch (error) { return failure(error); }
}
