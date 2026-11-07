import { z } from "zod";
import { RequestError } from "./store";

const id = z.string().trim().min(1).max(80);
const name = z.string().trim().min(1).max(32);
const note = z.string().trim().max(400).optional();
const confidence = z.number().min(0).max(1).optional();
const status = z.enum(["open", "blocked", "hazard"]);
export const joinInput = z.object({ observerId: id.optional(), displayName: name });
export const positionInput = z.object({ observerId: id, checkpointId: id });
export const observationInput = z.object({
  id, observerId: id, checkpointId: id, kind: z.enum(["passage", "exit", "help"]),
  from: id.optional(), to: id.optional(), nodeId: id.optional(), status: status.optional(),
  evidenceType: z.enum(["manual", "text", "voice", "image"]), note, confidence, confirmed: z.literal(true),
});
export const interpretInput = z.object({
  observerId: id, checkpointId: id, evidenceType: z.enum(["image", "text", "voice"]),
  note, imageBase64: z.string().max(1_600_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
  imageMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
}).refine(value => value.imageBase64 ? !!value.imageMimeType : !!value.note, {
  message: "Provide a photo or a short observation.",
});
export const suggestionSchema = z.object({
  kind: z.enum(["passage", "exit", "help"]),
  from: id.nullish(), to: id.nullish(), nodeId: id.nullish(), status: status.nullish(),
  confidence: z.number().min(0).max(1), note: z.string().trim().max(400),
});

export async function readInput<T>(request: Request, schema: z.ZodType<T>, maxBytes = 10_000): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("A JSON body is required.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestError("This report is too large.", 413);
    }
    parts.push(value);
  }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(parts).toString()); }
  catch { throw new RequestError("Send valid JSON."); }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RequestError(issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message);
  }
  return result.data;
}
