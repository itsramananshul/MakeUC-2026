import { createIncident, incidentList, keyMatches } from "@/lib/incident-store";
import { bearer, failure, incidentInput, json } from "@/lib/incident-validation";
import { RequestError } from "@/lib/store";
import { readInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return json({ incidents: incidentList() }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const key = process.env.AFTERMAP_OPERATOR_KEY;
    if (key && !keyMatches(bearer(request), key)) throw new RequestError("Enter the workspace operator key.", 403);
    const input = await readInput(request, incidentInput);
    return json(createIncident(input.name, input.bounds), 201);
  } catch (error) { return failure(error); }
}
