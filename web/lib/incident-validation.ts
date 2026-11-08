import { z } from "zod";
import { RequestError } from "./store";

export const coordinate = z.object({
  latitude: z.number().min(-85).max(85), longitude: z.number().min(-180).max(180),
});
const reporterName = z.string().trim().min(1).max(40);
const reportNote = z.string().trim().max(800).default("");
const reportPhoto = z.string().max(1_600_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional();
export const incidentInput = z.object({
  name: z.string().trim().min(2).max(80),
  bounds: z.object({
    west: z.number().min(-180).max(180), east: z.number().min(-180).max(180),
    south: z.number().min(-85).max(85), north: z.number().min(-85).max(85),
  }),
  observation: z.object({
    displayName: reporterName, note: reportNote, photoBase64: reportPhoto,
  }).refine(value => !!value.note || !!value.photoBase64, "Add a note or a photo.").optional(),
});
const routeCoordinate = coordinate.extend({ latitude: z.number().min(-85.051129).max(85.051129) });
export const routeInput = z.object({
  origin: routeCoordinate, destination: routeCoordinate,
  mode: z.enum(["driving", "walking", "cycling"]).default("walking"),
});
export const reportInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  displayName: reporterName,
  edgeId: z.string().max(120).optional(),
  condition: z.enum(["open", "blocked", "hazard"]).optional(),
  note: reportNote,
  evidenceType: z.enum(["manual", "text", "voice", "image"]),
  location: coordinate.optional(), from: coordinate.optional(), to: coordinate.optional(),
  photoBase64: reportPhoto,
  confirmed: z.literal(true),
}).refine(report => !!report.edgeId || !!report.location || !!(report.from && report.to), "Choose a passage or location.");

export const bearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer ([^\s]{1,256})$/i)?.[1] ?? "";
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  console.error("AFTERMAP incident API", error instanceof Error ? error.name : "Unknown");
  return json({ error: "The server could not complete this request." }, 500);
}
