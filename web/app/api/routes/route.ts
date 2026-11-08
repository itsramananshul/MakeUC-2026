import { incidentRoute } from "@/lib/incident-route";
import { getIncident, incidentList } from "@/lib/incident-store";
import { within } from "@/lib/incident-types";
import { failure, json, routeInput } from "@/lib/incident-validation";
import { standardRoute } from "@/lib/osm";
import { readInput } from "@/lib/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { origin, destination, mode } = await readInput(request, routeInput);
    const incidents = incidentList();
    const active = incidents.find(incident => within(origin, incident.bounds) && within(destination, incident.bounds));
    if (active) {
      if (mode !== "walking") return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: "Only verified walking passages are available inside this incident. Switch to Walk." });
      return json(incidentRoute(getIncident(active.id), origin, destination));
    }
    if (incidents.some(incident => within(origin, incident.bounds) || within(destination, incident.bounds))) {
      return json({ status: "unavailable", coordinates: [], distanceMeters: 0,
        reason: active ? "Switch to walking to route along reported passages in this incident." :
          "This trip crosses an incident boundary. Open the incident to check its reported passages." });
    }
    return json(await standardRoute(origin, destination, incidents, mode));
  } catch (error) { return failure(error); }
}
