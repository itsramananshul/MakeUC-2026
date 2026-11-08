import type { Metadata } from "next";
import VenezuelaMap from "./venezuela-map";

export const metadata: Metadata = {
  title: "Venezuela earthquake imagery · Gaslight Maps",
  description: "Satellite imagery of northern Venezuela captured June 26–28, 2026, after the June 24 earthquakes.",
};

export default function Page() {
  return <VenezuelaMap />;
}
