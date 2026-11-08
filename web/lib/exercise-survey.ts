import { createHash } from "node:crypto";
import cincinnati from "./cincinnati-survey-passages.json";
import catia from "./catia-exercise-passages.json";
import type { Incident, Road } from "./incident-types";

const exercises = [
  { name: "Cincinnati flood exercise", hash: "3779d9a2b5c05fca172165b76e27dd62bd15acb37ae88980659f741d5d100c71", roads: cincinnati },
  { name: "Catia La Mar exercise", hash: catia.centralHash, roads: catia.roads },
];
const source = (name: string) => name + " (simulated imagery)";
const reportPrefix = "cincinnati-imagery-exercise-";

export function exerciseSurveySource(files: ArrayBuffer[]) {
  for (const file of files) {
    const hash = createHash("sha256").update(new Uint8Array(file)).digest("hex");
    const exercise = exercises.find(entry => entry.hash === hash);
    if (exercise) return source(exercise.name);
  }
}
export function isExerciseSource(value: string) {
  return exercises.some(exercise => source(exercise.name) === value);
}

export function syncExercisePassages(incident: Incident) {
  const selected = exercises.filter(exercise => incident.surveys?.some(image => image.source === source(exercise.name)));
  const included = new Set(selected.flatMap(exercise => exercise.roads.map(road => reportPrefix + road.id)));
  const expired = incident.reports.filter(report => report.id.startsWith(reportPrefix) && !included.has(report.id));
  if (expired.length) {
    const inserted = new Set(expired.map(report => report.edgeId));
    const expiredIds = new Set(expired.map(report => report.id));
    incident.reports = incident.reports.filter(report => !expiredIds.has(report.id));
    for (const report of incident.reports) inserted.delete(report.edgeId);
    incident.roads = incident.roads.filter(road => !inserted.has(road.id));
  }
  for (const exercise of selected) {
    for (const road of exercise.roads as Road[]) {
      if (incident.roads.some(existing => existing.id === road.id)) continue;
      incident.roads.push(structuredClone(road));
      incident.reports.push({
        id: reportPrefix + road.id, displayName: exercise.name, edgeId: road.id,
        condition: road.state === "open" ? "open" : "blocked", at: incident.imagery!.timestamp,
        note: road.state === "open" ? "Reported walking passage in the exercise." :
          "Reported closure in the exercise imagery.",
        evidenceType: "manual",
      });
    }
  }
  incident.roadCount = incident.roads.length;
}
