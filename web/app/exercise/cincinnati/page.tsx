import type { Metadata } from "next";
import type { Incident } from "@/lib/incident-types";
import CincinnatiExercise from "./cincinnati-exercise";
import survey from "./survey.json";

export const metadata: Metadata = {
  title: "Cincinnati flood exercise | Gaslight Maps",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CincinnatiExercise incident={survey as Incident} />;
}
