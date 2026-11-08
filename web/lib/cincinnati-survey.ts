import { createHash } from "node:crypto";
import passages from "./cincinnati-survey-passages.json";
import type { Incident, Road } from "./incident-types";

const referenceTiff = "3779d9a2b5c05fca172165b76e27dd62bd15acb37ae88980659f741d5d100c71";
export const cincinnatiSurveySource = "Cincinnati flood exercise (simulated imagery)";
const reportPrefix = "cincinnati-imagery-exercise-";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const isCincinnatiSurvey = (files: ArrayBuffer[]) =>
  files.some(bytes => digest(new Uint8Array(bytes)) === referenceTiff);

export function syncCincinnatiPassages(incident: Incident) {
  if (incident.surveys?.some(image => image.source === cincinnatiSurveySource)) {
    for (const road of passages as Road[]) {
      if (incident.roads.some(existing => existing.id === road.id)) continue;
      incident.roads.push(structuredClone(road));
      incident.reports.push({
        id: reportPrefix + road.id, displayName: "Cincinnati flood exercise", edgeId: road.id,
        condition: road.state === "open" ? "open" : "blocked", at: incident.imagery!.timestamp,
        note: road.state === "open" ? "Cleared walking passage beside the Justice Center in the exercise." :
          "Collapse debris blocks this stretch in the exercise imagery.",
        evidenceType: "manual",
      });
    }
  } else {
    const inserted = new Set(incident.reports.filter(report => report.id.startsWith(reportPrefix)).map(report => report.edgeId));
    incident.reports = incident.reports.filter(report => !report.id.startsWith(reportPrefix));
    for (const report of incident.reports) inserted.delete(report.edgeId);
    if (inserted.size) incident.roads = incident.roads.filter(road => !inserted.has(road.id));
  }
  incident.roadCount = incident.roads.length;
}
