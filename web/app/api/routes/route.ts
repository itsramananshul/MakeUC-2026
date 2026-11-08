import { assessIncidentRoutes } from "@/lib/incident-route-assessment";
import { incidentList } from "@/lib/incident-store";
import { withinIncident } from "@/lib/incident-types";
import { failure, json, routeInput } from "@/lib/incident-validation";
import { standardRoute } from "@/lib/osm";
import { readInput } from "@/lib/validation";
import { walkingDirections } from "@/lib/walking-directions";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { origin, destination, mode } = await readInput(request, routeInput);
    const incidents = incidentList();
    if (mode === "walking") return json(await walkingDirections(origin, destination, incidents));
    if (mode === "driving") return json(await standardRoute(origin, destination, incidents, mode, assessIncidentRoutes(incidents)));
    if (incidents.some(incident => withinIncident(origin, incident) || withinIncident(destination, incident))) {
      return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "Switch to Walk for directions that include streets in the affected area." });
    }
    if (mode === "transit") return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
      reason: "Transit routing is currently unavailable. Choose Drive, Walk, or Bike." });
    return json(await standardRoute(origin, destination, incidents, mode));
  } catch (error) { return failure(error); }
}
