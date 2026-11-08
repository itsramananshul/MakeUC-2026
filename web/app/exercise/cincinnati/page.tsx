import type { Metadata } from "next";
import type { Incident } from "@/lib/incident-types";
import { cincinnatiFloodImagery } from "@/lib/cincinnati-exercise";
import CincinnatiExercise from "./cincinnati-exercise";
import survey from "./survey.json";

export const metadata: Metadata = {
  title: "Cincinnati flood exercise | Gaslight Maps",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CincinnatiExercise incident={{ ...survey, imagery: cincinnatiFloodImagery } as Incident} />;
}
